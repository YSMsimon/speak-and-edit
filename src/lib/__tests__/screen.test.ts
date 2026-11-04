import { describe, expect, it } from 'vitest';
import { buildOutline } from '../docs/outline';
import { dataUrlToBlob, ensureFolder, sharePublicly, upload, type DriveIO } from '../drive';
import type { FileRef } from '../files';
import { difference, SlideWatcher } from '../screen/watch';
import { CAPTURES_HEADING, docsTarget, planMedia } from '../targets/docs';
import { CAPTURES_TAB, sheetsTarget, type FetchJson } from '../targets/sheets';
import { fitBox, mediaSlideAttempts, slidesTarget } from '../targets/slides';
import type { MediaInput, WriteIntent } from '../targets/types';
import { applyToText, makeDoc, slice, SPEC } from './fixtures';

const w = (p: Partial<WriteIntent> = {}): WriteIntent => ({ action: 'append', section: null, text: null, find: null, replaceWith: null, cells: [], ...p });
const opts = { landAs: 'suggest' as const, credit: 'Priya, 14:32: “New slide on the shared screen”', withCredit: true };
const IMAGE: MediaInput = {
  kind: 'image',
  driveId: 'drv1',
  link: 'https://drive.google.com/file/d/drv1/view',
  width: 1600,
  height: 900,
  caption: 'Shared screen, 14:32 (Priya)',
  title: 'Shared screen 14:32',
};
const VIDEO: MediaInput = { ...IMAGE, kind: 'video', driveId: 'vid1', caption: 'Recording 14:30–14:35 (5 min), started by Simon', title: 'Recording 14:30' };

describe('Slide watcher', () => {
  const flat = (v: number) => new Array(32 * 18).fill(v);

  it('saves a slide once it stops moving, and not again until it changes', () => {
    const watch = new SlideWatcher();
    expect(watch.push(flat(10), 0)).toBe(false); // first sample: nothing to compare
    expect(watch.push(flat(10), 1500)).toBe(true); // still → first slide saved
    expect(watch.push(flat(11), 6000)).toBe(false); // cursor-sized change: same slide
    expect(watch.push(flat(200), 9000)).toBe(false); // moving to a new slide
    expect(watch.push(flat(200), 10500)).toBe(true); // still again, and different → saved
  });

  it('never saves a screen that keeps moving, like a playing video', () => {
    const watch = new SlideWatcher();
    const saves = Array.from({ length: 20 }, (_, i) => watch.push(flat(i % 2 ? 0 : 120), i * 1500)).filter(Boolean);
    expect(saves).toHaveLength(0);
  });

  it('waits at least 4 seconds between saves', () => {
    const watch = new SlideWatcher();
    watch.push(flat(10), 0);
    expect(watch.push(flat(10), 100)).toBe(true);
    watch.push(flat(250), 200);
    expect(watch.push(flat(250), 300)).toBe(false);
    expect(watch.push(flat(250), 4200)).toBe(true);
  });

  it('measures difference from 0 to 1', () => {
    expect(difference(flat(0), flat(255))).toBe(1);
    expect(difference(flat(7), flat(7))).toBe(0);
  });
});

describe('Pictures in Docs', () => {
  it('adds a "Shared screen" heading, the picture and a linked caption at the end', () => {
    const doc = makeDoc(SPEC);
    const plan = planMedia(buildOutline(doc), null, IMAGE.caption, IMAGE.link, 'https://public/1');
    const afterText = applyToText(doc, plan.requests.slice(0, 1));
    const heading = plan.requests.find((r) => 'updateParagraphStyle' in r && r.updateParagraphStyle.paragraphStyle.namedStyleType === 'HEADING_2') as any;
    expect(slice(afterText, heading.updateParagraphStyle.range)).toBe(`${CAPTURES_HEADING}\n`);
    const style = plan.requests.find((r) => 'updateTextStyle' in r) as any;
    expect(slice(afterText, style.updateTextStyle.range)).toBe(IMAGE.caption);
    expect(style.updateTextStyle.textStyle).toEqual({ italic: true, link: { url: IMAGE.link } });

    const text = applyToText(doc, plan.requests);
    expect(text.endsWith(`Launch: November 24\n${CAPTURES_HEADING}\n▣\n${IMAGE.caption}\n`)).toBe(true);
    expect(slice(text, plan.captionRange)).toBe(IMAGE.caption);
    expect(plan.where).toBe(CAPTURES_HEADING);
  });

  it('goes under the named section, without a new heading', () => {
    const doc = makeDoc(SPEC);
    const plan = planMedia(buildOutline(doc), 'Decisions', 'cap', IMAGE.link, 'https://public/1');
    const text = applyToText(doc, plan.requests);
    expect(text).toContain('Use Kafka for events\n▣\ncap\nOpen questions');
    expect(plan.requests.some((r) => 'deleteParagraphBullets' in r)).toBe(true);
    expect(plan.where).toBe('Decisions');
  });

  it('adds only a linked caption when there is no public link', () => {
    const doc = makeDoc([...SPEC, `## ${CAPTURES_HEADING}`, 'Older caption']);
    const plan = planMedia(buildOutline(doc), null, VIDEO.caption, VIDEO.link, null);
    expect(plan.requests.some((r) => 'insertInlineImage' in r)).toBe(false);
    expect(applyToText(doc, plan.requests).endsWith(`Older caption\n${VIDEO.caption}\n`)).toBe(true);
  });

  it('tries the next public link when Google can’t fetch the first', async () => {
    const calls: any[] = [];
    const target = docsTarget({
      fetchOutline: async () => buildOutline(makeDoc(SPEC)),
      batchUpdate: async (_id, requests) => {
        calls.push(requests);
        const img = requests.find((r: any) => r.insertInlineImage) as any;
        if (img?.insertInlineImage.uri === 'https://public/1') throw new Error('There was a problem retrieving the image.');
        return { documentId: 'doc1', commentUpdateState: 'ALL_SAVED' as const };
      },
      isRevisionConflict: () => false,
    });
    const r = await target.insertMedia!({ id: 'doc1', kind: 'doc', title: 'Spec' }, IMAGE, w(), opts, ['https://public/1', 'https://public/2']);
    expect(calls.map((c) => c.find((x: any) => x.insertInlineImage)?.insertInlineImage.uri).filter(Boolean)).toEqual(['https://public/1', 'https://public/2']);
    expect(calls.at(-1)[0]).toMatchObject({ insertComment: { content: opts.credit } });
    expect(r).toMatchObject({ status: 'applied', where: CAPTURES_HEADING, warning: 'Screenshots are added directly, not as suggestions.' });
  });

  it('in comments-only mode, leaves a comment with the Drive link and never inserts', async () => {
    const calls: any[] = [];
    const target = docsTarget({
      fetchOutline: async () => buildOutline(makeDoc(SPEC)),
      batchUpdate: async (_id, requests) => (calls.push(requests), { documentId: 'doc1', commentUpdateState: 'ALL_SAVED' as const }),
      isRevisionConflict: () => false,
    });
    const r = await target.insertMedia!({ id: 'doc1', kind: 'doc', title: 'Spec' }, IMAGE, w({ section: 'Decisions' }), { ...opts, landAs: 'comment' }, null);
    expect(calls).toHaveLength(1);
    expect(calls[0][0].insertComment.content).toContain(IMAGE.link);
    expect(r.status).toBe('commented');
  });
});

/** A fake Google API for Sheets and Slides: answers GETs from a table, records writes, can fail on demand. */
function fakeGoogle(routes: Record<string, unknown>, fail?: (body: any) => string | null) {
  const writes: { url: string; method: string; body: any }[] = [];
  const fetchJson: FetchJson = async <T,>(url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const why = fail?.(body);
      if (why) throw new Error(why);
      writes.push({ url: decodeURIComponent(url), method, body });
      if (url.includes(':append')) return { updates: { updatedRange: `'${CAPTURES_TAB}'!A2:C2` } } as T;
      if (body?.requests?.[0]?.addSheet) return { replies: [{ addSheet: { properties: { sheetId: 9, title: CAPTURES_TAB } } }] } as T;
      return {} as T;
    }
    const key = Object.keys(routes).find((k) => decodeURIComponent(url).includes(k));
    if (!key) throw new Error(`no route for ${decodeURIComponent(url)}`);
    return routes[key] as T;
  };
  return { fetchJson, writes };
}

describe('Captures in Sheets', () => {
  const FILE: FileRef = { id: 's1', kind: 'sheet', title: 'Tracker' };
  const routes = {
    'fields=properties.title': { properties: { title: 'Tracker' }, sheets: [{ properties: { sheetId: 7, title: 'Tasks' } }] },
    "values/'Tasks'!A1:Z40": { values: [['Task', 'Owner', 'Due'], ['Write the spec', 'Alex', 'Nov 5']] },
    'fields=sheets(data': { sheets: [{ data: [{ rowData: [{ values: [{ note: '' }] }] }] }] },
  };

  it('creates a "Scribe captures" tab and adds a private link, never a public one', async () => {
    const g = fakeGoogle(routes);
    const r = await sheetsTarget(g.fetchJson).insertMedia!(FILE, IMAGE, w(), opts, null);
    expect(g.writes[0]!.body.requests[0].addSheet.properties.title).toBe(CAPTURES_TAB);
    expect(g.writes[1]!.body.values).toEqual([['What', 'Caption', 'Link']]);
    expect(g.writes[2]!.body.values[0]).toEqual(['Screenshot', IMAGE.caption, `=HYPERLINK("${IMAGE.link}", "Open in Drive")`]);
    expect(r).toMatchObject({ where: `${CAPTURES_TAB} row 2`, status: 'applied' });
    expect(r.warning).toMatch(/links to the original/);
  });

  it('adds several rows read off the screen at once', async () => {
    const g = fakeGoogle({ ...routes });
    const rows = [
      [{ column: 'Task', value: 'Payment page' }, { column: 'Owner', value: 'Priya' }, { column: 'Due', value: 'Nov 14' }],
      [{ column: 'Task', value: 'Load test' }, { column: 'Owner', value: 'Marco' }, { column: 'Due', value: 'Nov 20' }],
    ];
    const r = await sheetsTarget(g.fetchJson).apply(FILE, w({ rows }), opts);
    const append = g.writes.find((x) => x.url.includes(':append'))!;
    expect(append.body.values).toEqual([['Payment page', 'Priya', 'Nov 14'], ['Load test', 'Marco', 'Nov 20']]);
    expect(r.where).toMatch(/rows 2–3/);
  });
});

describe('Captures in Slides', () => {
  const FILE: FileRef = { id: 'p1', kind: 'slides', title: 'Deck' };
  const deck = {
    title: 'Deck',
    pageSize: { width: { magnitude: 9144000 }, height: { magnitude: 5143500 } },
    slides: [
      {
        objectId: 's1',
        pageElements: [{ objectId: 't1', shape: { placeholder: { type: 'TITLE' }, text: { textElements: [{ textRun: { content: 'Roadmap\n' } }] } } }],
        slideProperties: { notesPage: { notesProperties: { speakerNotesObjectId: 'n1' }, pageElements: [{ objectId: 'n1', shape: { text: { textElements: [] } } }] } },
      },
    ],
  };

  it('fits the picture under the title, keeping its shape', () => {
    const f = fitBox(1600, 900, { x: 0, y: 100, width: 1000, height: 400 });
    expect(f.width / f.height).toBeCloseTo(16 / 9, 2);
    expect(f.height).toBe(400);
    expect(f.x).toBe(Math.round((1000 - f.width) / 2));
  });

  it('makes one all-or-nothing batch per public link, and a link-only fallback', () => {
    const { media, linkOnly } = mediaSlideAttempts(deck, IMAGE, ['u1', 'u2'], { slide: 'S', title: 'T', box: 'B' });
    expect(media).toHaveLength(2);
    expect((media[1]!.at(-1) as any).createImage.url).toBe('u2');
    expect((media[0]![0] as any).createSlide.insertionIndex).toBe(1);
    expect((linkOnly.at(-1) as any).updateTextStyle.style.link.url).toBe(IMAGE.link);
    const video = mediaSlideAttempts(deck, VIDEO, null, { slide: 'S', title: 'T', box: 'B' });
    expect((video.media[0]!.at(-1) as any).createVideo).toMatchObject({ source: 'DRIVE', id: 'vid1' });
  });

  it('falls back to a linked slide when Google can’t copy the picture', async () => {
    const g = fakeGoogle({ 'presentations/p1': deck }, (body) => (body?.requests?.some((r: any) => r.createImage) ? 'There was a problem retrieving the image.' : null));
    const r = await slidesTarget(g.fetchJson).insertMedia!(FILE, IMAGE, w(), opts, ['u1', 'u2']);
    expect(g.writes[0]!.body.requests.some((x: any) => x.createShape)).toBe(true);
    expect(r.where).toBe('Slide 2 (new)');
    expect(r.warning).toMatch(/links to the picture in Drive/);
  });
});

describe('Drive', () => {
  function fakeDrive() {
    const calls: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];
    const io: DriveIO = {
      token: async () => 'tok',
      fetch: (async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET';
        calls.push({ url, method, headers: init.headers as Record<string, string>, body: init.body });
        const json = (v: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status: 200, headers });
        if (url.includes('uploadType=resumable')) return new Response('', { status: 200, headers: { Location: 'https://upload/session/1' } });
        if (url === 'https://upload/session/1') return json({ id: 'f1', webViewLink: 'https://drive.google.com/file/d/f1/view' });
        if (url.includes('/permissions/') && method === 'DELETE') return new Response(null, { status: 204 });
        if (url.includes('/permissions')) return json({ id: 'anyoneWithLink' });
        if (url.includes('/files/old?')) return new Response(JSON.stringify({ error: { message: 'File not found' } }), { status: 404 });
        if (url.includes('/files?fields=id')) return json({ id: 'folder2' });
        return json({ id: 'folder1', trashed: false });
      }) as typeof fetch,
    };
    return { io, calls };
  }

  it('uploads with a resumable session', async () => {
    const d = fakeDrive();
    const f = await upload(d.io, { blob: new Blob(['x']), name: 'a.jpg', mimeType: 'image/jpeg', folderId: 'folder1' });
    expect(f).toEqual({ id: 'f1', link: 'https://drive.google.com/file/d/f1/view' });
    expect(d.calls[0]!.headers['X-Upload-Content-Type']).toBe('image/jpeg');
    expect(JSON.parse(String(d.calls[0]!.body))).toMatchObject({ name: 'a.jpg', parents: ['folder1'] });
    expect(d.calls[1]).toMatchObject({ url: 'https://upload/session/1', method: 'PUT' });
  });

  it('shares by link and switches it off again', async () => {
    const d = fakeDrive();
    const link = await sharePublicly(d.io, 'f1');
    expect(JSON.parse(String(d.calls[0]!.body))).toEqual({ role: 'reader', type: 'anyone' });
    expect(link.urls[0]).toContain('id=f1');
    await link.release();
    expect(d.calls[1]).toMatchObject({ method: 'DELETE' });
    expect(d.calls[1]!.url).toMatch(/files\/f1\/permissions\/anyoneWithLink$/);
  });

  it('reuses the captures folder, and makes a new one when it is gone', async () => {
    const d = fakeDrive();
    expect(await ensureFolder(d.io, 'folder1')).toBe('folder1');
    expect(await ensureFolder(d.io, 'old')).toBe('folder2');
    expect(await ensureFolder(d.io, null)).toBe('folder2');
  });

  it('turns a data URL into a Blob', async () => {
    const b = dataUrlToBlob('data:image/jpeg;base64,aGk=');
    expect(b.type).toBe('image/jpeg');
    expect(await b.text()).toBe('hi');
  });
});

describe('Fixes from the smoke test', () => {
  it('turns an accepted line that came out as a heading back into body text', async () => {
    const { headingsToFix } = await import('../targets/docs');
    const doc = makeDoc(['## Decisions', '## Action items', '## send the recap email', '## Open questions']);
    const fix = headingsToFix(buildOutline(doc), 'Action items', 'send the recap email');
    expect(fix).toHaveLength(1);
    expect(applyToText(doc, []).slice((fix[0] as any).updateParagraphStyle.range.startIndex - 1, (fix[0] as any).updateParagraphStyle.range.endIndex - 1)).toBe('send the recap email\n');
    // Real headings that follow are left alone.
    expect(headingsToFix(buildOutline(doc), 'Action items', 'something else')).toEqual([]);
  });

  it('Drive waits and retries when Google says too many requests', async () => {
    const { driveWait } = await import('../drive');
    driveWait.ms = () => 0;
    let calls = 0;
    const io: DriveIO = {
      token: async () => 't',
      fetch: (async () => (++calls === 1 ? new Response('{}', { status: 429 }) : new Response(JSON.stringify({ id: 'anyone1' }), { status: 200 }))) as typeof fetch,
    };
    await sharePublicly(io, 'f1');
    expect(calls).toBe(2);
  });

  it('Sheets reads every tab in one request', async () => {
    const urls: string[] = [];
    const fetchJson: FetchJson = async <T,>(url: string) => {
      urls.push(decodeURIComponent(url));
      if (url.includes('fields=properties.title')) return { properties: { title: 'T' }, sheets: [{ properties: { sheetId: 1, title: 'Tasks' } }, { properties: { sheetId: 2, title: 'Done' } }] } as T;
      return { valueRanges: [{ values: [['Task', 'Owner'], ['A', 'B']] }, { values: [['Task']] }] } as T;
    };
    const ctx = await sheetsTarget(fetchJson).describe({ id: 's', kind: 'sheet', title: 'T' });
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('values:batchGet');
    expect(ctx.text).toContain('Tab “Tasks” (columns: Task | Owner)');
    expect(ctx.text).toContain('row 2: A | B');
    expect(ctx.text).toContain('Tab “Done”');
  });

  it('backs off for longer each time, or as long as Google asks', async () => {
    const { backoff } = await import('../google');
    expect([0, 1, 2, 3].map((n) => backoff(n, null))).toEqual([2000, 5000, 12000, 25000]);
    expect(backoff(0, '3')).toBe(3000);
  });
});

describe('Fixes from the third smoke run', () => {
  const FILE: FileRef = { id: 's1', kind: 'sheet', title: 'Tracker' };
  const routes = {
    'fields=properties.title': { properties: { title: 'Tracker' }, sheets: [{ properties: { sheetId: 7, title: 'Tasks' } }] },
    "values/'Tasks'!A1:Z40": { values: [['Task', 'Owner', 'Status'], ['Write the spec', 'Alex', 'In progress']] },
    'fields=sheets(data': { sheets: [{ data: [{ rowData: [{ values: [{ note: '' }] }] }] }] },
  };

  it('finds the row from the cells when the model gives no find', async () => {
    const g = fakeGoogle(routes);
    const r = await sheetsTarget(g.fetchJson).apply(FILE, w({ action: 'replace', cells: [{ column: 'Task', value: 'Write the spec' }, { column: 'Status', value: 'Done' }] }), opts);
    const put = g.writes.find((x) => x.method === 'PUT')!;
    expect(put.url).toContain("'Tasks'!C2");
    expect(put.body.values).toEqual([['Done']]);
    expect(r).toMatchObject({ where: 'Tasks C2', remove: 'In progress', add: 'Done' });
  });

  it('changes the cell that differs, not the one that names the row', async () => {
    const g = fakeGoogle(routes);
    await sheetsTarget(g.fetchJson).apply(FILE, w({ action: 'replace', find: 'Write the spec', cells: [{ column: 'Task', value: 'Write the spec' }, { column: 'Status', value: 'Done' }] }), opts);
    expect(g.writes.find((x) => x.method === 'PUT')!.url).toContain("'Tasks'!C2");
  });

  it('turns odd spaces from the model into normal ones', async () => {
    const { plainSpaces } = await import('../ai/agent');
    expect(plainSpaces({ text: 'December 1', rows: [[{ value: 'Nov 14' }]] })).toEqual({ text: 'December 1', rows: [[{ value: 'Nov 14' }]] });
  });
});

describe('Sheets never guesses between rows', () => {
  it('asks which row when the text is in several', async () => {
    const g = fakeGoogle({
      'fields=properties.title': { properties: { title: 'Tracker' }, sheets: [{ properties: { sheetId: 7, title: 'Tasks' } }] },
      "values/'Tasks'!A1:Z40": { values: [['Task', 'Status'], ['Fix login', 'open'], ['Ship docs', 'open']] },
    });
    await expect(
      sheetsTarget(g.fetchJson).apply({ id: 's1', kind: 'sheet', title: 'Tracker' }, w({ action: 'replace', find: 'open', replaceWith: 'done' }), opts)
    ).rejects.toThrow('“open” is in 2 rows (Fix login, Ship docs). Say which one.');
    expect(g.writes).toHaveLength(0);
  });
});
