import { describe, expect, it, vi } from 'vitest';
import type { Context, Intent } from '../ai/agent';
import { Engine, looksLikeAnswer, type EngineDeps, type Entry } from '../engine';
import type { FileRef } from '../files';
import type { MeetState } from '../messages';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import type { Target, WriteIntent } from '../targets/types';
import type { Interaction } from '../interactions';

const DOC: FileRef = { id: 'doc1', kind: 'doc', title: 'Spec' };
const T0 = new Date(2026, 10, 6, 14, 0).getTime();
const MIN = 60_000;
const CODE = 'abc-defg-hij';

const intent = (p: Partial<Intent>): Intent => ({
  action: 'none', file: null, section: null, text: null, find: null, replaceWith: null, cells: [], clarifyQuestion: null, options: [], screen: 'none', control: null, ...p,
});
const meet = (status: MeetState['status'], p: Partial<MeetState> = {}): MeetState => ({ status, title: 'Weekly sync', userName: 'Simon', paused: false, code: CODE, ...p });

function setup(over: Partial<Settings> = {}, opts: { window?: number; transcriptFails?: number; forScribe?: boolean | 'fail'; log?: (e: Interaction) => void } = {}) {
  const settings: Settings = { ...DEFAULT_SETTINGS, approval: 'auto', files: [DOC], ...over };
  let now = T0;
  const writes: WriteIntent[] = [];
  const transcripts: string[][] = [];
  const timers: (() => void)[] = [];
  let failsLeft = opts.transcriptFails ?? 0;
  const doc: Target = {
    describe: async () => ({ title: 'Spec', text: '## Decisions', parts: ['Decisions'] }),
    apply: async (_f, w) => {
      writes.push(w);
      return { where: 'Decisions', add: w.text ?? '', status: 'applied', suggestionIds: [] };
    },
  };
  const contexts: Context[] = [];
  const intents: Intent[] = [];
  const summarize = vi.fn(async (_m: unknown, input: { previous: string | null; lines: string[] }) => ({
    summary: `${input.previous ? `${input.previous}\n` : ''}- folded ${input.lines.length} lines`,
    usage: { inputTokens: 1, outputTokens: 1 },
  }));
  const confirm = vi.fn(async () => {
    if (opts.forScribe === 'fail') throw new Error('offline');
    return { confirmation: { forScribe: Boolean(opts.forScribe), request: opts.forScribe ? 'reworded by the model' : null }, usage: { inputTokens: 2, outputTokens: 1 } };
  });
  const deps: EngineDeps = {
    settings: () => settings,
    targets: { doc, sheet: doc, slides: doc, note: doc, tex: doc },
    appendTranscript: async (_f, lines) => {
      if (failsLeft > 0) {
        failsLeft--;
        throw new Error('offline');
      }
      transcripts.push(lines);
    },
    model: () => ({ model: {} as never, mode: 'prompt' }),
    visionModel: () => ({ model: {} as never, mode: 'prompt' }),
    resolveProvider: async () => 'ollama',
    ai: {
      parseCommand: vi.fn(async (_m, _input, ctx: Context) => {
        contexts.push(ctx);
        return { intent: intents.shift() ?? intent({}), usage: { inputTokens: 10, outputTokens: 5 } };
      }),
      decideSmart: vi.fn(async () => ({ decision: { action: 'none', label: 'none', file: null, section: null, text: null, find: null, replaceWith: null, cells: [] } as never, usage: { inputTokens: 0, outputTokens: 0 } })),
      answerQuestion: vi.fn(async () => ({ answer: '', usage: { inputTokens: 0, outputTokens: 0 } })),
      readScreen: vi.fn(async () => {
        throw new Error('not used');
      }),
      summarizeMeeting: summarize,
      ...(opts.forScribe === undefined ? {} : { confirmRequest: confirm }),
    },
    contextWindow: async () => opts.window ?? 131_072,
    ...(opts.log ? { log: opts.log } : {}),
    updateSettings: (patch) => void Object.assign(settings, patch),
    control: { setListening: async () => undefined, recording: async () => '', recordingState: () => 'off' },
    media: {
      capture: async () => {
        throw new Error('not used');
      },
      upload: async () => ({ id: 'f', link: 'l' }),
      share: async () => ({ urls: [], release: async () => undefined }),
    },
    now: () => now,
    schedule: (fn) => void timers.push(fn),
  };
  const engine = new Engine(deps);
  const flushTimers = () => timers.splice(0).forEach((f) => f());
  return {
    engine, deps, settings, writes, transcripts, contexts, intents, summarize, confirm, flushTimers,
    at: (t: number) => void (now = t),
    entries: (): Entry[] => engine.getState().entries,
  };
}

describe('saving and restoring a meeting', () => {
  it('has nothing to save until the Meet code is known', () => {
    const t = setup();
    expect(t.engine.snapshot()).toBeNull();
  });

  it('keeps lines from before the code was known, and IDs carry the meeting', async () => {
    const t = setup();
    t.engine.addLine('Priya', 'Morning all.', T0);
    t.engine.beginMeeting(CODE, 'Weekly sync');
    t.engine.addLine('Marco', 'Hi.', T0 + 1000);
    await t.engine.idle();
    const snap = t.engine.snapshot()!;
    expect(snap.entries.map((e) => e.text)).toEqual(['Morning all.', 'Hi.']);
    expect(snap.entries[1]!.id.startsWith(`${snap.id}.`)).toBe(true);
  });

  it('comes back after the panel reopens: waiting approvals stay, running work is marked stopped, queued transcript lines are sent', async () => {
    const a = setup({ approval: 'manual' });
    a.engine.beginMeeting(CODE, 'Weekly sync');
    a.intents.push(intent({ action: 'append', section: 'Decisions', text: 'Use Postgres' }));
    // A Docs edit in Ask before writing becomes a suggestion; make it wait in the panel instead.
    a.settings.files = [{ id: 'sheet1', kind: 'sheet', title: 'Tracker' }];
    a.engine.addLine('Priya', 'Scribe, add a task: use Postgres.', T0);
    await a.engine.idle();
    expect(a.entries()[0]!.action.kind).toBe('proposal');
    const snap = structuredClone(a.engine.snapshot()!);
    // As if the panel closed while a request was still being worked out.
    snap.entries.push({ id: `${snap.id}.9`, speaker: 'Marco', text: 'Scribe, what is the date?', at: T0 + 2000, addressed: true, typed: false, action: { kind: 'pending', step: 'Working out the request' } });
    snap.entries.push({ id: `${snap.id}.10`, speaker: 'Lena', text: 'Noted.', at: T0 + 3000, addressed: false, typed: false, action: { kind: 'transcript', status: 'queued', line: 'Lena (14:00): Noted.', fileTitle: 'Spec' } });

    const b = setup({ approval: 'manual' });
    b.engine.loadMeeting(snap);
    const [proposal, stopped, queued] = b.entries();
    expect(proposal!.action.kind).toBe('proposal');
    expect(stopped!.action).toMatchObject({ kind: 'error', message: expect.stringMatching(/Stopped when the panel closed\. Retry/) });
    expect(queued!.action).toMatchObject({ kind: 'transcript', status: 'queued' });
    b.flushTimers();
    await b.engine.idle();
    expect(b.transcripts).toEqual([['Lena (14:00): Noted.']]);
    // Approve still works after the reopen.
    b.engine.approve(proposal!.id);
    await b.engine.idle();
    expect(b.entries()[0]!.action.kind).toBe('written');
  });

  it('a new meeting starts empty and its IDs never collide with the old one', async () => {
    const t = setup();
    t.engine.beginMeeting(CODE, 'A');
    t.engine.addLine('Priya', 'One.', T0);
    const first = t.entries()[0]!.id;
    t.at(T0 + MIN);
    t.engine.beginMeeting('xyz-wxyz-xyz', 'B');
    expect(t.entries()).toEqual([]);
    t.engine.addLine('Marco', 'Two.', T0 + MIN);
    expect(t.entries()[0]!.id).not.toBe(first);
  });

  it('Delete saved meetings empties the panel and keeps the call going as a new meeting', () => {
    const t = setup();
    t.engine.beginMeeting(CODE, 'A');
    t.engine.addLine('Priya', 'One.', T0);
    const before = t.engine.snapshot()!.id;
    t.at(T0 + 5);
    t.engine.clearMeeting();
    expect(t.entries()).toEqual([]);
    expect(t.engine.meetingCode()).toBe(CODE);
    expect(t.engine.snapshot()!.id).not.toBe(before);
  });
});

describe('lines heard while the panel was closed', () => {
  it('are shown in time order and never run, even when addressed to Scribe', async () => {
    const t = setup();
    t.engine.beginMeeting(CODE, null);
    t.engine.addLine('Priya', 'Back now.', T0 + 10 * MIN);
    t.engine.addMissed([
      { speaker: 'Marco', text: 'Scribe, delete the decisions section.', at: T0 + 2 * MIN },
      { speaker: 'Lena', text: 'We should ship Monday.', at: T0 + 3 * MIN },
    ]);
    await t.engine.idle();
    expect(t.entries().map((e) => e.text)).toEqual(['Scribe, delete the decisions section.', 'We should ship Monday.', 'Back now.']);
    expect(t.entries().filter((e) => e.missed).every((e) => e.action.kind === 'skipped')).toBe(true);
    expect(t.deps.ai.parseCommand).not.toHaveBeenCalled();
    expect(t.writes).toEqual([]);
  });

  it('ignores a line it already has', () => {
    const t = setup();
    t.engine.beginMeeting(CODE, null);
    const line = { speaker: 'Lena', text: 'Hello.', at: T0 };
    t.engine.addMissed([line]);
    t.engine.addMissed([line]);
    expect(t.entries()).toHaveLength(1);
  });

  it('in Record all, still go to the transcript, except requests to change Scribe', async () => {
    const t = setup({ listenMode: 'record' });
    t.engine.beginMeeting(CODE, null);
    t.engine.addMissed([
      { speaker: 'Lena', text: 'We should ship Monday.', at: T0 },
      { speaker: 'Marco', text: 'Scribe, switch to smart mode.', at: T0 + 1000 },
    ]);
    t.flushTimers();
    await t.engine.idle();
    expect(t.transcripts).toEqual([['Lena (14:00): We should ship Monday.']]);
  });
});

describe('the "heard nothing" marker', () => {
  const gaps = (t: ReturnType<typeof setup>) => t.entries().filter((e) => e.source === 'gap');

  it('marks leaving the call and coming back, once', () => {
    const t = setup();
    t.engine.beginMeeting(CODE, null);
    t.engine.setMeet(meet('listening', { joinedAt: T0 }));
    t.at(T0 + 20 * MIN);
    t.engine.setMeet(meet('ended', { leftAt: T0 + 20 * MIN }));
    t.at(T0 + 23 * MIN);
    t.engine.setMeet(meet('in-call', { joinedAt: T0 + 23 * MIN, leftAt: T0 + 20 * MIN }));
    t.engine.setMeet(meet('listening', { joinedAt: T0 + 23 * MIN, leftAt: T0 + 20 * MIN }));
    expect(gaps(t).map((e) => e.text)).toEqual(['Scribe heard nothing from 14:20 to 14:23.']);
  });

  it('skips a short drop', () => {
    const t = setup();
    t.engine.beginMeeting(CODE, null);
    t.engine.setMeet(meet('listening', { joinedAt: T0 }));
    t.at(T0 + MIN);
    t.engine.setMeet(null);
    t.at(T0 + MIN + 10_000);
    t.engine.setMeet(meet('listening', { joinedAt: T0 + MIN + 10_000 }));
    expect(gaps(t)).toEqual([]);
  });

  it('after a reopen: no marker when the Meet tab stayed in the call, since its lines come back', () => {
    const a = setup();
    a.engine.beginMeeting(CODE, null);
    a.engine.setMeet(meet('listening', { joinedAt: T0 }));
    a.at(T0 + 30 * MIN);
    const snap = a.engine.snapshot()!;
    const b = setup();
    b.at(T0 + 40 * MIN);
    b.engine.loadMeeting(snap);
    b.engine.setMeet(meet('listening', { joinedAt: T0 }));
    expect(gaps(b)).toEqual([]);
  });

  it('after a reopen: marks from when the tab left, when it left and came back meanwhile', () => {
    const a = setup();
    a.engine.beginMeeting(CODE, null);
    a.engine.setMeet(meet('listening', { joinedAt: T0 }));
    a.at(T0 + 10 * MIN);
    const snap = a.engine.snapshot()!;
    const b = setup();
    b.at(T0 + 40 * MIN);
    b.engine.loadMeeting(snap);
    b.engine.setMeet(meet('listening', { joinedAt: T0 + 35 * MIN, leftAt: T0 + 30 * MIN }));
    expect(gaps(b).map((e) => e.text)).toEqual(['Scribe heard nothing from 14:30 to 14:35.']);
  });

  it('after a reopen with a new Meet tab: marks from when the panel last saw the call', () => {
    const a = setup();
    a.engine.beginMeeting(CODE, null);
    a.engine.setMeet(meet('listening', { joinedAt: T0 }));
    a.at(T0 + 10 * MIN);
    const snap = a.engine.snapshot()!;
    const b = setup();
    b.at(T0 + 16 * MIN);
    b.engine.loadMeeting(snap);
    b.engine.setMeet(meet('listening', { joinedAt: T0 + 15 * MIN }));
    expect(gaps(b).map((e) => e.text)).toEqual(['Scribe heard nothing from 14:10 to 14:15.']);
  });
});

describe('older lines in each request', () => {
  it('sends the line the request points back to, beyond the last 6', async () => {
    const t = setup();
    t.engine.beginMeeting(CODE, null);
    t.engine.addLine('Priya', 'The pilot budget is 40 thousand dollars.', T0);
    for (let i = 0; i < 20; i++) t.engine.addLine(i % 2 ? 'Marco' : 'Lena', `Remark ${i} about the schedule.`, T0 + (i + 1) * 1000);
    t.intents.push(intent({ action: 'append', section: 'Decisions', text: 'Pilot budget: $40k' }));
    t.engine.addLine('Simon', 'Scribe, add what Priya said about the budget to decisions.', T0 + 30_000);
    await t.engine.idle();
    const ctx = t.contexts[0]!;
    expect(ctx.recent).toHaveLength(6);
    expect(ctx.recent.join('\n')).not.toContain('40 thousand');
    expect(ctx.earlier).toContain('Priya: The pilot budget is 40 thousand dollars.');
  });

  it('sends nothing extra in a short meeting', async () => {
    const t = setup();
    t.engine.beginMeeting(CODE, null);
    t.engine.addLine('Lena', 'Hi.', T0);
    t.engine.addLine('Simon', 'Scribe, add Postgres to decisions.', T0 + 1000);
    await t.engine.idle();
    expect(t.contexts[0]!.earlier).toBeUndefined();
  });

  it('folds the oldest lines into a summary once the meeting outgrows the budget, in the background', async () => {
    // A 4k window: about 400 tokens for older lines.
    const t = setup({}, { window: 4_096 });
    t.engine.beginMeeting(CODE, null);
    for (let i = 0; i < 60; i++) {
      t.engine.addLine(i % 2 ? 'Marco' : 'Lena', `Remark ${i} about the launch plan, the budget and the dates for the pilot.`, T0 + i * 1000);
      await t.engine.summaryIdle();
    }
    expect(t.summarize).toHaveBeenCalled();
    expect(t.engine.summaryText()).toMatch(/folded \d+ lines/);
    expect(t.engine.snapshot()!.summary?.through).toBeTruthy();
    t.intents.push(intent({}));
    t.engine.addLine('Simon', 'Scribe, what did we say about the budget?', T0 + 100_000);
    await t.engine.idle();
    expect(t.contexts.at(-1)!.earlier).toMatch(/^Summary of what came before/);
  });

  it('never summarizes in Record all, which uses no model', async () => {
    const t = setup({ listenMode: 'record' }, { window: 4_096 });
    t.engine.beginMeeting(CODE, null);
    for (let i = 0; i < 60; i++) t.engine.addLine('Lena', `Remark ${i} about the launch plan, the budget and the dates.`, T0 + i * 1000);
    await t.engine.summaryIdle();
    expect(t.summarize).not.toHaveBeenCalled();
  });
});

describe('transcript lines that failed', () => {
  it('go again, first, with the next batch', async () => {
    const t = setup({ listenMode: 'record' }, { transcriptFails: 1 });
    t.engine.beginMeeting(CODE, null);
    t.engine.addLine('Lena', 'First.', T0);
    await t.engine.idle();
    t.flushTimers();
    await t.engine.idle();
    expect(t.entries()[0]!.action).toMatchObject({ kind: 'transcript', status: 'failed' });
    t.engine.addLine('Marco', 'Second.', T0 + 1000);
    await t.engine.idle();
    t.flushTimers();
    await t.engine.idle();
    expect(t.transcripts).toEqual([['Lena (14:00): First.', 'Marco (14:00): Second.']]);
    expect(t.entries().every((e) => e.action.kind === 'transcript' && e.action.status === 'written')).toBe(true);
  });

  it('stop retrying by themselves after 3 tries; back online gives them more', async () => {
    const t = setup({ listenMode: 'record' }, { transcriptFails: 3 });
    t.engine.beginMeeting(CODE, null);
    t.engine.addLine('Lena', 'Only line.', T0);
    for (let i = 0; i < 4; i++) {
      await t.engine.idle();
      t.engine.flushTranscript();
      await t.engine.idle();
    }
    expect(t.transcripts).toEqual([]);
    t.engine.retryTranscripts();
    t.flushTimers();
    await t.engine.idle();
    expect(t.transcripts).toEqual([['Lena (14:00): Only line.']]);
  });
});

describe('a word that only sounds like the wake word', () => {
  it('runs nothing when the AI says it was ordinary talk', async () => {
    const t = setup({}, { forScribe: false });
    t.engine.addLine('Lena', 'Describe the onboarding flow for me, Priya.', T0);
    await t.engine.idle();
    expect(t.confirm).toHaveBeenCalledTimes(1);
    expect(t.deps.ai.parseCommand).not.toHaveBeenCalled();
    expect(t.entries()[0]!.action.kind).toBe('skipped');
  });

  it('runs the request, in the person’s own words, when the AI says it was for Scribe', async () => {
    const t = setup({}, { forScribe: true });
    t.intents.push(intent({ action: 'append', section: 'Decisions', text: 'Use Postgres 16' }));
    t.engine.addLine('Simon', 'Subscribe! Add Postgres 16 to decisions.', T0);
    await t.engine.idle();
    expect(t.confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(t.deps.ai.parseCommand).mock.calls[0]![1]).toMatchObject({ command: 'Add Postgres 16 to decisions.' });
    expect(t.entries()[0]!.action.kind).toBe('written');
  });

  it('checks the next line after a bare sound-alike, too', async () => {
    const t = setup({}, { forScribe: false });
    t.engine.addLine('Simon', 'Subscribe!', T0);
    t.engine.addLine('Simon', 'Hello, how are you?', T0 + 2000);
    await t.engine.idle();
    expect(t.confirm).toHaveBeenCalledTimes(1);
    expect(t.deps.ai.parseCommand).not.toHaveBeenCalled();
  });

  it('never asks when the wake word itself was said', async () => {
    const t = setup({}, { forScribe: false });
    t.engine.addLine('Simon', 'Scribe, add Postgres 16 to decisions.', T0);
    await t.engine.idle();
    expect(t.confirm).not.toHaveBeenCalled();
    expect(t.deps.ai.parseCommand).toHaveBeenCalledTimes(1);
  });

  it('changes nothing when the check fails', async () => {
    const t = setup({}, { forScribe: 'fail' });
    t.engine.addLine('Simon', 'Subscribe! Delete the decisions section.', T0);
    await t.engine.idle();
    expect(t.deps.ai.parseCommand).not.toHaveBeenCalled();
    expect(t.writes).toEqual([]);
  });

  it('in Smart mode, judges ordinary talk like any other line', async () => {
    const t = setup({ listenMode: 'smart' }, { forScribe: false });
    t.engine.addLine('Lena', 'Describe the onboarding flow for me, Priya.', T0);
    await t.engine.idle();
    expect(t.deps.ai.decideSmart).toHaveBeenCalledTimes(1);
  });
});

describe('the AI log, from the engine', () => {
  it('records each AI call with its line, what came of it, and an approval', async () => {
    const events: Interaction[] = [];
    const t = setup({ approval: 'manual', files: [{ id: 'sheet1', kind: 'sheet', title: 'Tracker' }] }, { log: (e) => events.push(e) });
    t.engine.beginMeeting(CODE, 'Weekly sync');
    t.intents.push(intent({ action: 'append', file: 'Tracker', cells: [{ column: 'Task', value: 'Set up staging' }] }));
    const id = t.engine.addLine('Simon', 'Scribe, add a task: set up staging.', T0);
    await t.engine.idle();
    t.engine.approve(id);
    await t.engine.idle();
    const call = events.find((e) => e.t === 'ai');
    expect(call).toMatchObject({ t: 'ai', job: 'parseCommand', entry: id, input: { speaker: 'Simon', command: 'add a task: set up staging.' } });
    expect(call && 'ms' in call && call.ms).toBeGreaterThanOrEqual(0);
    expect(events.filter((e) => e.t === 'outcome').map((e) => (e as { kind: string }).kind)).toEqual(['proposal', 'written']);
    expect(events.find((e) => e.t === 'feedback')).toMatchObject({ action: 'approve', entry: id });
  });
});

describe('a line number in a request about a paper', () => {
  const TEX: FileRef = { id: 'overleaf:paper', kind: 'tex', title: 'Paper' };
  const texTarget = (hit: Awaited<ReturnType<NonNullable<Target['lineRef']>>>, applied: WriteIntent[]): Target => ({
    describe: async () => ({ title: 'Paper', text: 'Section titles: Introduction', parts: ['Introduction'] }),
    apply: async (_f, w) => {
      applied.push(w);
      return { where: 'line 7', add: w.text ?? '', status: 'commented', suggestionIds: [] };
    },
    lineRef: async () => hit,
  });

  it('anchors a comment under the source line of PDF line 12, and tells the model what it says', async () => {
    const applied: WriteIntent[] = [];
    const t = setup({ files: [TEX] });
    t.deps.targets.tex = texTarget({ label: 'line 12 of the PDF', pdfText: 'tools let a helper ap-', line: 6, text: 'In their auto modes, the counting tools let a helper approve each visit.' }, applied);
    t.intents.push(intent({ action: 'comment', text: 'Their auto mode should be removed' }));
    t.engine.addLine('Simon', 'Scribe, for line 12, make a comment: their auto mode should be removed.', T0);
    await t.engine.idle();
    expect(t.contexts[0]!.lineHint).toMatch(/line 12 of the PDF in “Paper”, which reads: “tools let a helper ap-”, It is source line 6/);
    expect(applied[0]!.find).toBe('In their auto modes, the counting tools let a helper approve each visit.');
  });

  it('says so, instead of commenting somewhere else, when the line isn’t in the PDF preview', async () => {
    const applied: WriteIntent[] = [];
    const t = setup({ files: [TEX] });
    t.deps.targets.tex = texTarget(null, applied);
    t.intents.push(intent({ action: 'comment', text: 'Cut this' }));
    t.engine.addLine('Simon', 'Scribe, comment on line 400: cut this.', T0);
    await t.engine.idle();
    expect(applied).toEqual([]);
    expect(t.entries()[0]!.action).toMatchObject({ kind: 'error', message: expect.stringMatching(/Couldn’t find line 400 in the PDF preview of “Paper”/) });
  });
});

describe('a spoken answer to Scribe’s question', () => {
  const TEX: FileRef = { id: 'overleaf:paper', kind: 'tex', title: 'Paper' };
  const tex = (applied: WriteIntent[], seen: number[]): Target => ({
    describe: async () => ({ title: 'Paper', text: 'Section titles: Introduction', parts: ['Introduction'] }),
    apply: async (_f, w) => {
      applied.push(w);
      return { where: 'line 22', add: w.text ?? '', status: 'commented', suggestionIds: [] };
    },
    lineRef: async (_f, ref) => {
      seen.push(ref.n);
      return { label: `line ${ref.n} of the editor`, line: ref.n, text: `Text on line ${ref.n}.` };
    },
  });

  it('“Which line?” … “Blind 21.”: the reply answers it, and its line number wins', async () => {
    const applied: WriteIntent[] = [];
    const seen: number[] = [];
    const t = setup({ files: [TEX], listenMode: 'smart' });
    t.deps.targets.tex = tex(applied, seen);
    t.intents.push(intent({ action: 'clarify', clarifyQuestion: 'Which line should I comment on?', options: ['Line 21', 'Line 23'] }));
    t.intents.push(intent({ action: 'comment', text: 'Delete it later' }));
    t.engine.addLine('Simon', 'Scribe, on line 23, can you add a comment to delete it later?', T0);
    await t.engine.idle();
    expect(t.entries()[0]!.action.kind).toBe('clarify');
    t.engine.addLine('Simon', 'Blind 21.', T0 + 5000);
    await t.engine.idle();
    await t.engine.idle();
    const calls = vi.mocked(t.deps.ai.parseCommand).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]![1]).toMatchObject({ clarification: 'Blind 21.' });
    expect(seen.at(-1)).toBe(21);
    expect(applied[0]!.find).toBe('Text on line 21.');
    expect(t.entries()[1]!.action.kind).toBe('skipped');
  });

  it('a long unrelated line isn’t taken as the answer', async () => {
    const t = setup({ files: [TEX] });
    t.deps.targets.tex = tex([], []);
    t.intents.push(intent({ action: 'clarify', clarifyQuestion: 'Which line?', options: ['Line 21'] }));
    t.engine.addLine('Simon', 'Scribe, comment on line 23: cut this.', T0);
    await t.engine.idle();
    t.engine.addLine('Simon', 'Anyway, we should also talk about the budget for the spring pilot.', T0 + 5000);
    await t.engine.idle();
    expect(vi.mocked(t.deps.ai.parseCommand).mock.calls).toHaveLength(1);
  });
});

describe('what counts as an answer to Scribe’s question', () => {
  it('a choice, a line number, or a pick, never a new request', () => {
    const q = 'Which line should I comment on?';
    expect(looksLikeAnswer('Blind 21.', q, ['Line 21', 'Line 23'], 'comment on line 23')).toBe(true);
    expect(looksLikeAnswer('The tomato bed', 'Which one?', ['Tomato bed', 'Herb bed'], 'comment on the bed line')).toBe(true);
    expect(looksLikeAnswer('the first one', 'Which one?', ['A', 'B'], 'move it')).toBe(true);
    expect(looksLikeAnswer("add to decisions: we're using Postgres 16.", 'Which date?', ['Launch date: December 1', 'Beta: November 20'], 'move it to the 15th')).toBe(false);
    expect(looksLikeAnswer('Can everyone hear me?', 'Which date?', ['Launch date: December 1'], 'move it')).toBe(false);
  });

  it('after a question, the same person’s next request still runs as a request', async () => {
    const t = setup();
    t.intents.push(intent({ action: 'clarify', clarifyQuestion: 'Which date should move?', options: ['Launch date: December 1', 'Beta: November 20'] }));
    t.intents.push(intent({ action: 'append', section: 'Decisions', text: 'Use Postgres 16' }));
    t.engine.addLine('Simon', 'Scribe, move it to the fifteenth.', T0);
    await t.engine.idle();
    t.engine.addLine('Simon', "Scribe, add to decisions: we're using Postgres 16.", T0 + 3000);
    await t.engine.idle();
    const calls = vi.mocked(t.deps.ai.parseCommand).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]![1]).toMatchObject({ command: "add to decisions: we're using Postgres 16." });
    expect(calls[1]![1]).not.toHaveProperty('clarification', expect.anything());
    expect(t.entries()[1]!.action.kind).toBe('written');
  });
});
