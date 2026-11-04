import { describe, expect, it, vi } from 'vitest';
import type { Intent, ScreenRead } from '../ai/agent';
import { buildOutline } from '../docs/outline';
import { Engine, type EngineDeps } from '../engine';
import type { FileRef } from '../files';
import type { Frame, MeetState } from '../messages';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { docsTarget } from '../targets/docs';
import type { ApplyOptions, MediaInput, Target, WriteIntent } from '../targets/types';
import { makeDoc, SPEC } from './fixtures';

const DOC: FileRef = { id: 'doc1', kind: 'doc', title: 'Spec' };
const SHEET: FileRef = { id: 'sheet1', kind: 'sheet', title: 'Tracker' };
const DECK: FileRef = { id: 'deck1', kind: 'slides', title: 'Deck' };
const at = new Date(2026, 10, 1, 14, 32).getTime();
const FRAME: Frame = { dataUrl: 'data:image/jpeg;base64,aGk=', width: 1600, height: 900, presenter: 'Priya', at };
const MEET: MeetState = { status: 'listening', title: 'Sync', userName: 'Simon', paused: false, screen: { presenter: 'Priya' } };

const intent = (p: Partial<Intent>): Intent => ({
  action: 'none', file: null, section: null, text: null, find: null, replaceWith: null, cells: [], clarifyQuestion: null, options: [], screen: 'none', control: null, ...p,
});

function setup(over: Partial<Settings> = {}, intents: Intent[] = [], reads: ScreenRead[] = [], fail: { share?: boolean; release?: boolean; insert?: boolean } = {}) {
  const settings: Settings = { ...DEFAULT_SETTINGS, approval: 'auto', files: [DOC, SHEET, DECK], ...over };
  const log: string[] = [];
  const inserted: { file: FileRef; m: MediaInput; o: ApplyOptions; urls: string[] | null }[] = [];
  const applied: { file: FileRef; w: WriteIntent }[] = [];
  const mediaTarget = (kind: string): Target => ({
    describe: async () => ({ title: kind, text: `${kind} outline`, parts: [] }),
    apply: async (file, w) => {
      applied.push({ file, w });
      return { where: 'Tasks rows 2–3', add: 'rows', status: 'applied', suggestionIds: [] };
    },
    insertMedia: async (file, m, _w, o, urls) => {
      log.push(`insert:${urls ? 'public' : 'link'}`);
      if (fail.insert) throw new Error('Google couldn’t copy the picture.');
      inserted.push({ file, m, o, urls });
      return { where: 'Slide 3 (new)', add: `${m.kind}: ${m.caption}`, status: 'applied', suggestionIds: [] };
    },
  });
  const docs = docsTarget({
    fetchOutline: async () => buildOutline(makeDoc(SPEC)),
    batchUpdate: async () => ({ documentId: 'doc1', commentUpdateState: 'ALL_SAVED' as const }),
    isRevisionConflict: () => false,
  });
  const deps: EngineDeps = {
    settings: () => settings,
    targets: { doc: docs, sheet: mediaTarget('sheet'), slides: mediaTarget('slides'), note: { describe: async () => { throw new Error('no notes here'); }, apply: async () => { throw new Error('no notes here'); } }, tex: { describe: async () => { throw new Error('no Overleaf here'); }, apply: async () => { throw new Error('no Overleaf here'); } } },
    appendTranscript: async () => undefined,
    model: () => ({ model: {} as never, mode: 'prompt' }),
    visionModel: () => ({ model: { vision: true } as never, mode: 'prompt' }),
    resolveProvider: async () => 'ollama',
    updateSettings: (patch) => void Object.assign(settings, patch),
    control: { setListening: async () => undefined, recording: async () => 'ok', recordingState: () => 'off' },
    ai: {
      parseCommand: vi.fn(async () => ({ intent: intents.shift() ?? intent({}), usage: { inputTokens: 1, outputTokens: 1 } })),
      decideSmart: vi.fn(),
      answerQuestion: vi.fn(),
      readScreen: vi.fn(async () => ({ read: reads.shift()!, usage: { inputTokens: 1, outputTokens: 1 } })),
    },
    media: {
      capture: vi.fn(async () => (log.push('capture'), FRAME)),
      upload: vi.fn(async (_b: Blob, name: string) => (log.push(`upload:${name}`), { id: 'drv1', link: 'https://drive.google.com/file/d/drv1/view' })),
      share: vi.fn(async () => {
        log.push('share');
        if (fail.share) throw new Error('Sharing is turned off for this account.');
        return {
          urls: ['https://public/1'],
          release: async () => {
            log.push('release');
            if (fail.release) throw new Error('network down');
          },
        };
      }),
    },
    now: () => at,
    schedule: () => undefined,
  };
  const engine = new Engine(deps);
  engine.setMeet(MEET);
  return { engine, deps, log, inserted, applied, settings };
}

const last = (e: Engine) => e.getState().entries.at(-1)!.action;

describe('Shared screen: commands', () => {
  it('"screenshot this" saves to Drive, shares only while inserting, then switches the link off', async () => {
    const t = setup({}, [intent({ action: 'append', screen: 'image' })]);
    t.engine.addLine('Simon', 'Scribe, screenshot this into the deck', at);
    await t.engine.idle();
    expect(t.log).toEqual(['capture', 'upload:Scribe screenshot 2026-11-01 14.32.00.jpg', 'share', 'insert:public', 'release']);
    expect(t.inserted[0]!.file).toEqual(DECK); // no file named → the captures file (first Slides)
    expect(t.inserted[0]!.m).toMatchObject({ kind: 'image', driveId: 'drv1', caption: 'Shared screen, 14:32 (Priya)' });
    expect(last(t.engine)).toMatchObject({ kind: 'written', result: { add: expect.stringContaining('https://drive.google.com/file/d/drv1/view') } });
    // The model was told someone is sharing.
    expect(t.deps.ai.parseCommand).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ screen: 'Priya is sharing their screen.' }));
  });

  it('switches the public link off even when inserting fails, and says so', async () => {
    const t = setup({}, [intent({ action: 'append', screen: 'image' })], [], { insert: true });
    t.engine.addLine('Simon', 'Scribe, screenshot this', at);
    await t.engine.idle();
    expect(t.log.slice(-2)).toEqual(['insert:public', 'release']);
    expect(last(t.engine)).toMatchObject({ kind: 'error', message: 'Google couldn’t copy the picture.' });
  });

  it('warns loudly when the link could not be switched off', async () => {
    const t = setup({}, [intent({ action: 'append', screen: 'image' })], [], { release: true });
    t.engine.addLine('Simon', 'Scribe, screenshot this', at);
    await t.engine.idle();
    expect(last(t.engine)).toMatchObject({ kind: 'written', warning: expect.stringContaining('still public in Drive') });
  });

  it('adds a private link instead when sharing is blocked', async () => {
    const t = setup({}, [intent({ action: 'append', screen: 'image' })], [], { share: true });
    t.engine.addLine('Simon', 'Scribe, screenshot this', at);
    await t.engine.idle();
    expect(t.log).toContain('insert:link');
    expect(t.log).not.toContain('release');
    expect(last(t.engine)).toMatchObject({ kind: 'written', warning: expect.stringContaining('Couldn’t share the picture') });
  });

  it('never shares anything for Sheets, which only get a private link', async () => {
    const t = setup({}, [intent({ action: 'append', file: 'Tracker', screen: 'image' })]);
    t.engine.addLine('Simon', 'Scribe, screenshot this into the tracker', at);
    await t.engine.idle();
    expect(t.log).not.toContain('share');
    expect(t.inserted[0]!.file).toEqual(SHEET);
  });

  it('"add this table to the sheet" reads the screen with the vision model and adds the rows', async () => {
    const rows = [
      [{ column: 'Task', value: 'Payment page' }, { column: 'Owner', value: 'Priya' }],
      [{ column: 'Task', value: 'Load test' }, { column: 'Owner', value: 'Marco' }],
    ];
    const t = setup({}, [intent({ action: 'append', file: 'Tracker', screen: 'read' })], [
      { action: 'append', file: 'Tracker', section: 'Tasks', text: null, find: null, replaceWith: null, rows, note: null },
    ]);
    t.engine.addLine('Simon', 'Scribe, add this table to the tracker', at);
    await t.engine.idle();
    expect(t.deps.ai.readScreen).toHaveBeenCalledWith(
      { model: { vision: true }, mode: 'prompt' },
      { speaker: 'Simon', command: 'add this table to the tracker', image: FRAME.dataUrl },
      expect.anything()
    );
    expect(t.applied[0]).toMatchObject({ file: SHEET, w: { action: 'append', section: 'Tasks', rows } });
    expect(t.log).not.toContain('upload'); // reading the screen stores nothing
  });

  it('says why when the screen doesn’t show what was asked for', async () => {
    const t = setup({}, [intent({ action: 'append', screen: 'read' })], [
      { action: 'none', file: null, section: null, text: null, find: null, replaceWith: null, rows: [], note: 'There is no table on the screen.' },
    ]);
    t.engine.addLine('Simon', 'Scribe, add this table', at);
    await t.engine.idle();
    expect(last(t.engine)).toEqual({ kind: 'answer', answer: 'There is no table on the screen.' });
  });
});

describe('Shared screen: buttons, auto-capture, recordings', () => {
  it('auto-captured slides wait for approval in manual mode, then upload', async () => {
    const t = setup({ approval: 'manual' });
    const id = t.engine.addScreen(FRAME, 'auto');
    await t.engine.idle();
    expect(last(t.engine)).toMatchObject({ kind: 'proposal', proposal: { origin: 'screen', file: DECK, media: { kind: 'image', preview: FRAME.dataUrl } } });
    expect(t.log).toEqual([]);
    t.engine.approve(id);
    await t.engine.idle();
    expect(t.log).toEqual(['upload:Scribe screenshot 2026-11-01 14.32.00.jpg', 'share', 'insert:public', 'release']);
  });

  it('the Screenshot button shows an error card when nobody is sharing', async () => {
    const t = setup();
    (t.deps.media.capture as any).mockRejectedValueOnce(new Error('Nobody is sharing their screen.'));
    t.engine.takeScreenshot();
    await t.engine.idle();
    expect(last(t.engine)).toEqual({ kind: 'error', message: 'Nobody is sharing their screen.' });
  });

  it('a recording is uploaded and linked, never made public', async () => {
    const t = setup({ screen: { autoCapture: false, targetFileId: 'doc1' } });
    const docs = { ...t.deps.targets.slides };
    t.deps.targets.doc = docs; // record what reaches the captures file
    t.engine.addRecording({ blob: new Blob(['v']), mimeType: 'video/webm;codecs=vp9,opus', start: at, end: at + 5 * 60_000, width: 1280, height: 720, by: 'Simon' });
    await t.engine.idle();
    expect(t.log).toEqual(['upload:Scribe recording 2026-11-01 14.32.00.webm', 'insert:link']);
    expect(t.inserted[0]!.m).toMatchObject({ kind: 'video', caption: 'Recording 14:32–14:37 (5 min), started by Simon' });
  });

  it('comments-only people get a comment, so nothing is shared', async () => {
    const t = setup({ roles: { Simon: 'comment' } }, [intent({ action: 'append', screen: 'image' })]);
    t.engine.addLine('Simon', 'Scribe, screenshot this', at);
    await t.engine.idle();
    expect(t.log).not.toContain('share');
    expect(t.inserted[0]!.o.landAs).toBe('comment');
  });
});
