import { describe, expect, it } from 'vitest';
import { buildOutline } from '../docs/outline';
import type { FileRef } from '../files';
import { planTranscript } from '../targets/docs';
import { columnLetter, rowFromCells, sheetsTarget, type FetchJson } from '../targets/sheets';
import { appendText, pickSlide, slidesTarget } from '../targets/slides';
import type { WriteIntent } from '../targets/types';
import { applyToText, makeDoc, SPEC } from './fixtures';

const w = (p: Partial<WriteIntent>): WriteIntent => ({ action: 'append', section: null, text: null, find: null, replaceWith: null, cells: [], ...p });
const opts = { landAs: 'suggest' as const, credit: 'Sarah, 14:21: “x”', withCredit: true };

/** A fake Google API: answers GETs from a table and records every write. */
function fakeGoogle(routes: Record<string, unknown>) {
  const writes: { url: string; method: string; body: any }[] = [];
  const fetchJson: FetchJson = async <T,>(url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      writes.push({ url: decodeURIComponent(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return (url.includes(':append') ? { updates: { updatedRange: 'Tasks!A4:C4' } } : { replies: [{ replaceAllText: { occurrencesChanged: 1 } }] }) as T;
    }
    const key = Object.keys(routes).find((k) => decodeURIComponent(url).includes(k));
    if (!key) throw new Error(`no route for ${decodeURIComponent(url)}`);
    return routes[key] as T;
  };
  return { fetchJson, writes };
}

describe('Transcript in Docs', () => {
  it('creates a Transcript heading at the end the first time', () => {
    const doc = makeDoc(SPEC);
    const text = applyToText(doc, planTranscript(buildOutline(doc), ['Sarah (14:21): Ship Friday', 'Wei (14:22): Agreed']));
    expect(text.endsWith('Launch: November 24\nTranscript\nSarah (14:21): Ship Friday\nWei (14:22): Agreed\n')).toBe(true);
  });

  it('appends under an existing Transcript heading', () => {
    const doc = makeDoc([...SPEC, '## Transcript', 'Old (14:00): hello']);
    const reqs = planTranscript(buildOutline(doc), ['New (14:30): bye']);
    expect(reqs).toHaveLength(1);
    expect(applyToText(doc, reqs).endsWith('Old (14:00): hello\nNew (14:30): bye\n')).toBe(true);
  });
});

describe('Sheets', () => {
  const FILE: FileRef = { id: 's1', kind: 'sheet', title: 'Tracker' };
  const routes = {
    'fields=properties.title': { properties: { title: 'Tracker' }, sheets: [{ properties: { sheetId: 7, title: 'Tasks' } }] },
    "values/'Tasks'!A1:Z40": { values: [['Task', 'Owner', 'Status'], ['Fix login', 'Wei', 'open'], ['Migrate DB', 'Sarah', 'open']] },
    'fields=sheets(data': { sheets: [{ data: [{ rowData: [{ values: [{ note: '' }] }] }] }] },
  };

  it('helpers line values up with the header', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(27)).toBe('AB');
    expect(rowFromCells(['Task', 'Owner', 'Status'], [{ column: 'owner', value: 'Simon' }, { column: 'Task', value: 'Staging' }], null)).toEqual(['Staging', 'Simon', '']);
  });

  it('appends a row and leaves the credit as a note on it', async () => {
    const g = fakeGoogle(routes);
    const r = await sheetsTarget(g.fetchJson).apply(FILE, w({ section: 'Tasks', cells: [{ column: 'Task', value: 'Set up staging' }, { column: 'Owner', value: 'Simon' }] }), opts);
    expect(g.writes[0]).toMatchObject({ method: 'POST', body: { values: [['Set up staging', 'Simon', '']] } });
    expect(g.writes[0]!.url).toContain("values/'Tasks'!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS");
    expect(g.writes[1]!.body.requests[0].updateCells).toMatchObject({ range: { sheetId: 7, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0 }, fields: 'note' });
    expect(r).toMatchObject({ where: 'Tasks row 4', status: 'applied', warning: 'Sheets can’t take suggestions, so this was written directly.' });
  });

  it('changes one cell and keeps the old value in the note', async () => {
    const g = fakeGoogle(routes);
    const r = await sheetsTarget(g.fetchJson).apply(FILE, w({ action: 'replace', section: 'Tasks', find: 'Migrate DB', cells: [{ column: 'Status', value: 'done' }] }), opts);
    expect(g.writes[0]).toMatchObject({ method: 'PUT', body: { values: [['done']] } });
    expect(g.writes[0]!.url).toContain("values/'Tasks'!C3");
    expect(g.writes[1]!.body.requests[0].updateCells.rows[0].values[0].note).toContain('Was: open');
    expect(r).toMatchObject({ where: 'Tasks C3', remove: 'open', add: 'done' });
  });

  it('says so when the row is not there', async () => {
    const g = fakeGoogle(routes);
    await expect(sheetsTarget(g.fetchJson).apply(FILE, w({ action: 'replace', find: 'Nope', replaceWith: 'x' }), opts)).rejects.toThrow('Couldn’t find “Nope” in Tasks.');
  });
});

describe('Slides', () => {
  const FILE: FileRef = { id: 'p1', kind: 'slides', title: 'Deck' };
  const slide = (id: string, title: string, body: string) => ({
    objectId: id,
    pageElements: [
      { objectId: `${id}_t`, shape: { placeholder: { type: 'TITLE' }, text: { textElements: [{ textRun: { content: `${title}\n` } }] } } },
      { objectId: `${id}_b`, shape: { placeholder: { type: 'BODY' }, text: { textElements: body ? [{ textRun: { content: `${body}\n` } }] : [] } } },
    ],
    slideProperties: { notesPage: { notesProperties: { speakerNotesObjectId: `${id}_n` }, pageElements: [{ objectId: `${id}_n`, shape: { text: { textElements: [] } } }] } },
  });
  const deck = { title: 'Deck', slides: [slide('s1', 'Q4 review', ''), slide('s2', 'Timeline', 'Beta: Nov 10\nLaunch: Nov 24')] };

  it('finds slides by number or title', () => {
    expect(pickSlide(deck.slides, '2')).toBe(1);
    expect(pickSlide(deck.slides, 'slide 1')).toBe(0);
    expect(pickSlide(deck.slides, 'timeline')).toBe(1);
    expect(pickSlide(deck.slides, null)).toBe(1);
  });

  it('appends text as a new paragraph at the end of a shape', () => {
    expect(appendText('b', 'One\nTwo\n', 'Three')).toEqual({ insertText: { objectId: 'b', insertionIndex: 7, text: '\nThree' } });
    expect(appendText('b', '', 'First')).toEqual({ insertText: { objectId: 'b', insertionIndex: 0, text: 'First' } });
  });

  it('adds a bullet to the right slide and credits it in the speaker notes', async () => {
    const g = fakeGoogle({ 'presentations/p1': deck });
    const r = await slidesTarget(g.fetchJson).apply(FILE, w({ section: 'Timeline', text: 'GA: Dec 8' }), opts);
    expect(g.writes[0]!.body.requests[0]).toEqual({ insertText: { objectId: 's2_b', insertionIndex: 27, text: '\nGA: Dec 8' } });
    expect(g.writes[1]!.body.requests[0]).toEqual({ insertText: { objectId: 's2_n', insertionIndex: 0, text: opts.credit } });
    expect(r).toMatchObject({ where: 'Slide 2 (Timeline)', status: 'applied' });
  });

  it('replaces text only on the chosen slide', async () => {
    const g = fakeGoogle({ 'presentations/p1': deck });
    await slidesTarget(g.fetchJson).apply(FILE, w({ action: 'replace', section: 'Timeline', find: 'Nov 24', replaceWith: 'Dec 8' }), { ...opts, withCredit: false });
    expect(g.writes[0]!.body.requests[0]).toEqual({
      replaceAllText: { containsText: { text: 'Nov 24', matchCase: false }, replaceText: 'Dec 8', pageObjectIds: ['s2'] },
    });
  });

  it('creates a new slide with a title and body', async () => {
    const g = fakeGoogle({ 'presentations/p1': deck });
    const r = await slidesTarget(g.fetchJson).apply(FILE, w({ action: 'new_slide', section: 'Risks', text: 'Vendor delay' }), { ...opts, withCredit: false });
    const reqs = g.writes[0]!.body.requests;
    expect(reqs[0].createSlide).toMatchObject({ insertionIndex: 2, slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' } });
    expect(reqs[1].insertText.text).toBe('Risks');
    expect(reqs[2].insertText.text).toBe('Vendor delay');
    expect(r.where).toBe('Slide 3 (new)');
  });
});
