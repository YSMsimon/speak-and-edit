import { describe, expect, it, vi } from 'vitest';
import type { Intent, SmartDecision } from '../ai/agent';
import { buildOutline } from '../docs/outline';
import type { DocRequest } from '../docs/types';
import { Engine, type EngineDeps } from '../engine';
import type { FileRef } from '../files';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { docsTarget } from '../targets/docs';
import type { ApplyOptions, Target, WriteIntent } from '../targets/types';
import { makeDoc, SPEC } from './fixtures';

const DOC: FileRef = { id: 'doc1', kind: 'doc', title: 'Q4 Platform Spec' };
const SHEET: FileRef = { id: 'sheet1', kind: 'sheet', title: 'Tracker' };

const intent = (p: Partial<Intent>): Intent => ({
  action: 'none', file: null, section: null, text: null, find: null, replaceWith: null, cells: [], clarifyQuestion: null, options: [], screen: 'none', control: null, ...p,
});
const smart = (p: Partial<SmartDecision>): SmartDecision => ({
  action: 'none', label: 'none', file: null, section: null, text: null, find: null, replaceWith: null, cells: [], ...p,
});

function setup(over: Partial<Settings> = {}, intents: Intent[] = [], decisions: SmartDecision[] = []) {
  const settings: Settings = { ...DEFAULT_SETTINGS, files: [DOC], ...over };
  const calls: { requests: DocRequest[]; wc?: unknown }[] = [];
  const transcripts: string[][] = [];
  const timers: (() => void)[] = [];
  let conflictOnce = false;
  const docs = docsTarget({
    fetchOutline: async () => buildOutline(makeDoc(SPEC)),
    batchUpdate: async (_id: string, requests: DocRequest[], wc?: { writeMode?: string }) => {
      if (conflictOnce) {
        conflictOnce = false;
        throw Object.assign(new Error('The required revision ID does not match the latest revision.'), { conflict: true });
      }
      calls.push({ requests, wc });
      const suggest = wc?.writeMode === 'SUGGEST';
      return { documentId: 'doc1', suggestionResponses: requests.map(() => ({ createdSuggestionIds: suggest ? ['suggest.abc'] : [] })), commentUpdateState: 'ALL_SAVED' as const };
    },
    isRevisionConflict: (e) => Boolean((e as { conflict?: boolean }).conflict),
  });
  const sheetWrites: { w: WriteIntent; o: ApplyOptions }[] = [];
  const sheet: Target = {
    describe: async () => ({ title: 'Tracker', text: 'Tab “Tasks” (columns: Task | Owner)', parts: ['Tasks'] }),
    apply: async (_f, w, o) => {
      sheetWrites.push({ w, o });
      return { where: 'Tasks row 5', add: w.cells.map((c) => c.value).join(' | '), status: 'applied', suggestionIds: [] };
    },
  };
  const deps: EngineDeps = {
    settings: () => settings,
    targets: { doc: docs, sheet, slides: sheet, note: { describe: async () => { throw new Error('no notes here'); }, apply: async () => { throw new Error('no notes here'); } }, tex: { describe: async () => { throw new Error('no Overleaf here'); }, apply: async () => { throw new Error('no Overleaf here'); } } },
    appendTranscript: async (_f, lines) => void transcripts.push(lines),
    model: () => ({ model: {} as never, mode: 'prompt' }),
    resolveProvider: async () => 'ollama',
    ai: {
      parseCommand: vi.fn(async () => ({ intent: intents.shift() ?? intent({}), usage: { inputTokens: 10, outputTokens: 5 } })),
      decideSmart: vi.fn(async () => ({ decision: decisions.shift() ?? smart({}), usage: { inputTokens: 3, outputTokens: 1 } })),
      answerQuestion: vi.fn(async () => ({ answer: 'Who owns on-call.', usage: { inputTokens: 1, outputTokens: 1 } })),
      readScreen: vi.fn(async () => {
        throw new Error('not used');
      }),
    },
    visionModel: () => ({ model: {} as never, mode: 'prompt' }),
    updateSettings: (patch) => void Object.assign(settings, patch),
    control: {
      setListening: vi.fn(async () => undefined),
      recording: vi.fn(async (a: string) => `Recording ${a}.`),
      recordingState: () => 'off' as const,
    },
    media: {
      capture: async () => {
        throw new Error('not used');
      },
      upload: async () => ({ id: 'f', link: 'l' }),
      share: async () => ({ urls: [], release: async () => undefined }),
    },
    now: () => 0,
    schedule: (fn) => void timers.push(fn),
  };
  const engine = new Engine(deps);
  return { engine, calls, transcripts, timers, sheetWrites, deps, settings, conflict: () => (conflictOnce = true) };
}

const at = new Date(2026, 10, 1, 14, 21).getTime();
const first = (e: Engine) => e.getState().entries[0]!.action;

describe('Commands mode', () => {
  it('turns "Scribe, add …" into a Docs suggestion plus a credit reply', async () => {
    const t = setup({}, [intent({ action: 'append', section: 'Decisions', text: 'Use Postgres 16 for the event store.' })]);
    t.engine.addLine('Sarah Chen', 'Scribe, add to decisions: use Postgres 16 for the event store.', at);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'written', result: { where: 'Decisions', status: 'waiting', suggestionIds: ['suggest.abc'] } });
    expect(t.calls[0]!.wc).toEqual({ writeMode: 'SUGGEST', requiredRevisionId: 'rev1' });
    expect(t.calls[1]!.requests[0]).toEqual({
      addCommentReply: { suggestionId: 'suggest.abc', post: { content: 'Sarah Chen, 14:21: “add to decisions: use Postgres 16 for the event store.”' } },
    });
  });

  it('ignores ordinary lines and never calls the model', async () => {
    const t = setup();
    t.engine.addLine('Wei Zhang', 'Agreed, Postgres 16, we already run it for billing.', at);
    await t.engine.idle();
    expect(first(t.engine)).toEqual({ kind: 'skipped' });
    expect(t.deps.ai.parseCommand).not.toHaveBeenCalled();
    expect(t.deps.ai.decideSmart).not.toHaveBeenCalled();
  });

  it('saves edits as comments when "As comments only" is chosen', async () => {
    const t = setup({ commentsOnly: true }, [intent({ action: 'append', section: 'Decisions', text: 'X' })]);
    t.engine.addLine('Sarah Chen', 'Scribe add X to decisions', at);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'written', result: { status: 'commented' } });
    expect(t.calls.every((c) => !('insertText' in c.requests[0]!))).toBe(true);
  });

  it('respects people set to comments only, and ignores ignored people', async () => {
    const t = setup({ roles: { Marcus: 'comment', Bot: 'ignore' } }, [intent({ action: 'append', section: 'Decisions', text: 'X' })]);
    t.engine.addLine('Marcus', 'Scribe add X', at);
    t.engine.addLine('Bot', 'Scribe add Y', at);
    await t.engine.idle();
    const [m, b] = t.engine.getState().entries;
    expect(m!.action).toMatchObject({ kind: 'written', result: { status: 'commented' }, warning: 'Marcus is set to comments only.' });
    expect(b!.action).toEqual({ kind: 'skipped' });
  });

  it('reads the doc again and retries when someone edited it meanwhile', async () => {
    const t = setup({}, [intent({ action: 'replace', section: 'Timeline', find: 'November 24', replaceWith: 'December 8' })]);
    t.conflict();
    t.engine.addLine('Sarah Chen', 'Scribe change the launch to December 8', at);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'written', result: { remove: 'November 24', add: 'December 8' } });
  });

  it('asks the room when the request is ambiguous, then uses the answer', async () => {
    const t = setup({}, [
      intent({ action: 'clarify', clarifyQuestion: 'Which date moves to December 15?', options: ['Launch', 'Beta'] }),
      intent({ action: 'replace', section: 'Timeline', find: 'November 10', replaceWith: 'December 15' }),
    ]);
    const id = t.engine.addLine('Wei Zhang', 'Scribe, move it to the fifteenth', at);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'clarify', options: ['Launch', 'Beta'] });
    t.engine.answerClarify(id, 'Beta');
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'written', result: { remove: 'November 10', add: 'December 15' } });
    expect(t.deps.ai.parseCommand).toHaveBeenLastCalledWith(expect.anything(), { speaker: 'Wei Zhang', command: 'move it to the fifteenth', clarification: 'Beta' }, expect.anything());
  });

  it('accepts a waiting suggestion through the Docs API', async () => {
    const t = setup({}, [intent({ action: 'append', section: 'Decisions', text: 'Ship Friday' })]);
    const id = t.engine.addLine('Sarah Chen', 'Scribe add ship Friday', at);
    await t.engine.idle();
    t.engine.decide(id, true);
    await t.engine.idle();
    expect(t.calls.at(-1)!.requests).toEqual([{ acceptSuggestion: { suggestionId: 'suggest.abc' } }]);
    expect(first(t.engine)).toMatchObject({ kind: 'written', decision: 'accepted' });
  });

  it('routes a request to the file the model named', async () => {
    const t = setup({ files: [DOC, SHEET], approval: 'auto' }, [intent({ action: 'append', file: 'Tracker', section: 'Tasks', cells: [{ column: 'Task', value: 'Set up staging' }, { column: 'Owner', value: 'Simon' }] })]);
    t.engine.addLine('Simon', 'Scribe add a task: set up staging, owner Simon', at);
    await t.engine.idle();
    expect(t.sheetWrites[0]!.w.cells).toEqual([{ column: 'Task', value: 'Set up staging' }, { column: 'Owner', value: 'Simon' }]);
    expect(first(t.engine)).toMatchObject({ kind: 'written', proposal: { file: SHEET }, result: { where: 'Tasks row 5' } });
    expect(t.calls).toHaveLength(0);
  });

  it('tells the user to connect a file first', async () => {
    const t = setup({ files: [] });
    t.engine.addLine('Sarah Chen', 'Scribe add ship Friday', at);
    await t.engine.idle();
    expect(first(t.engine)).toEqual({ kind: 'error', message: 'Connect a Google file in the Outputs tab first.' });
  });

  it('a bare “Scribe,” then a pause: the same speaker’s next line is the request, even after someone else talks', async () => {
    const t = setup({ approval: 'auto' }, [intent({ action: 'append', section: 'Decisions', text: 'Postgres 16' })]);
    t.engine.addLine('Simon', 'Scribe,', at);
    t.engine.addLine('Priya', 'Sure, go ahead.', at + 1500);
    t.engine.addLine('Simon', 'add Postgres 16 to decisions', at + 3000);
    await t.engine.idle();
    const [wake, other, request] = t.engine.getState().entries;
    expect(wake!.action.kind).toBe('skipped');
    expect(other!.action.kind).toBe('skipped');
    expect(request).toMatchObject({ addressed: true, action: { kind: 'written', result: { add: expect.stringContaining('Postgres 16') } } });
  });

  it('a bare “Scribe,” stops counting after 8 seconds', async () => {
    const t = setup({ approval: 'auto' }, [intent({ action: 'append', section: 'Decisions', text: 'Postgres 16' })]);
    t.engine.addLine('Simon', 'Scribe,', at);
    t.engine.addLine('Simon', 'anyway, back to the budget', at + 9000);
    await t.engine.idle();
    expect(t.engine.getState().entries[1]!.action.kind).toBe('skipped');
  });

  it('Try again runs a failed line once more, after the problem is fixed', async () => {
    const t = setup({ files: [] }, [intent({ action: 'append', section: 'Decisions', text: 'Ship Friday' })]);
    t.engine.addLine('Sarah Chen', 'Scribe add ship Friday', at);
    await t.engine.idle();
    expect(first(t.engine).kind).toBe('error');
    t.settings.files = [DOC];
    t.engine.retry(t.engine.getState().entries[0]!.id);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'written', result: { add: expect.stringContaining('Ship Friday') } });
  });
});

describe('Auto and Ask before writing', () => {
  const task = intent({ action: 'append', file: 'Tracker', section: 'Tasks', cells: [{ column: 'Task', value: 'Book the room' }] });

  it('Auto edits the doc directly: no suggestion to accept', async () => {
    const t = setup({ approval: 'auto' }, [intent({ action: 'append', section: 'Decisions', text: 'Ship Friday' })]);
    t.engine.addLine('Sarah Chen', 'Scribe add ship Friday', at);
    await t.engine.idle();
    expect(t.calls[0]!.wc).toEqual({ writeMode: 'EDIT', requiredRevisionId: 'rev1' });
    expect(first(t.engine)).toMatchObject({ kind: 'written', result: { status: 'applied', suggestionIds: [] } });
    // The credit goes on the new text as a comment, since there is no suggestion thread.
    expect(t.calls[1]!.requests[0]).toHaveProperty('insertComment');
  });

  it('Ask before writing puts Docs edits in as suggestions right away', async () => {
    const t = setup({ approval: 'manual' }, [intent({ action: 'append', section: 'Decisions', text: 'Ship Friday' })]);
    t.engine.addLine('Sarah Chen', 'Scribe add ship Friday', at);
    await t.engine.idle();
    expect(t.calls[0]!.wc).toEqual({ writeMode: 'SUGGEST', requiredRevisionId: 'rev1' });
    expect(first(t.engine)).toMatchObject({ kind: 'written', result: { status: 'waiting' } });
  });

  it('Ask before writing holds what can’t be a suggestion until someone approves it', async () => {
    const t = setup({ approval: 'manual', files: [DOC, SHEET] }, [task]);
    const id = t.engine.addLine('Sarah Chen', 'Scribe add a task: book the room', at);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'proposal', proposal: { file: SHEET } });
    expect(t.sheetWrites).toHaveLength(0);
    t.engine.approve(id);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'written' });
    expect(t.sheetWrites[0]!.o.landAs).toBe('direct');
  });

  it('writes nothing when discarded', async () => {
    const t = setup({ approval: 'manual', files: [DOC, SHEET] }, [task]);
    const id = t.engine.addLine('Sarah Chen', 'Scribe add a task: book the room', at);
    await t.engine.idle();
    t.engine.discard(id);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'discarded' });
    expect(t.sheetWrites).toHaveLength(0);
  });

  it('comments go straight in, even with Ask before writing', async () => {
    const t = setup({ approval: 'manual', commentsOnly: true }, [intent({ action: 'append', section: 'Decisions', text: 'X' })]);
    t.engine.addLine('Sarah Chen', 'Scribe add X', at);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'written', result: { status: 'commented' } });
  });
});

describe('The control tool', () => {
  const control = (c: Partial<NonNullable<Intent['control']>>) =>
    intent({ action: 'control', control: { mode: null, file: null, approval: null, listening: null, recording: null, ...c } });

  it('switches mode, working file and approval in one go', async () => {
    const t = setup({ files: [DOC, SHEET], approval: 'manual' }, [control({ mode: 'smart', file: 'tracker', approval: 'auto' })]);
    t.engine.addLine('Simon', 'Scribe, switch to smart mode, work on the tracker, and make edits directly', at);
    await t.engine.idle();
    expect(t.settings).toMatchObject({ listenMode: 'smart', focusFileId: 'sheet1', approval: 'auto' });
    expect(first(t.engine)).toMatchObject({
      kind: 'control',
      params: { mode: 'smart', file: 'tracker', approval: 'auto' },
      done: ['Switched to Smart mode.', 'Working on Tracker.', 'Auto: edits go straight into the file.'],
      failed: [],
    });
  });

  it('then sends requests that name no file to the working file', async () => {
    const t = setup({ files: [DOC, SHEET], focusFileId: 'sheet1', approval: 'auto' }, [intent({ action: 'append', cells: [{ column: 'Task', value: 'X' }] })]);
    t.engine.addLine('Simon', 'Scribe add a task X', at);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'written', proposal: { file: SHEET } });
    expect(t.deps.ai.parseCommand).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ state: expect.stringContaining('working file “Tracker”') }));
  });

  it('"any file" clears the working file; an unknown file is reported, not guessed', async () => {
    const t = setup({ files: [DOC, SHEET], focusFileId: 'sheet1' }, [control({ file: 'any' }), control({ file: 'Budget 2027' })]);
    t.engine.addLine('Simon', 'Scribe, use any file', at);
    t.engine.addLine('Simon', 'Scribe, work on the budget', at);
    await t.engine.idle();
    expect(t.settings.focusFileId).toBeNull();
    const [, second] = t.engine.getState().entries;
    expect(second!.action).toMatchObject({ kind: 'control', done: [], failed: [expect.stringContaining('No connected file called “Budget 2027”')] });
  });

  it('pauses listening and controls the recording', async () => {
    const t = setup({}, [control({ listening: 'pause' }), control({ recording: 'pause' })]);
    t.engine.addLine('Simon', 'Scribe, pause', at);
    t.engine.addLine('Simon', 'Scribe, pause the recording', at);
    await t.engine.idle();
    expect(t.deps.control.setListening).toHaveBeenCalledWith(true);
    expect(t.deps.control.recording).toHaveBeenCalledWith('pause');
    const [, rec] = t.engine.getState().entries;
    expect(rec!.action).toMatchObject({ kind: 'control', done: ['Recording pause.'] });
  });

  it('shows why when the recording can’t be started by voice', async () => {
    const t = setup({}, [control({ recording: 'start' })]);
    (t.deps.control.recording as any).mockRejectedValueOnce(new Error('Chrome needs a click to record this tab.'));
    t.engine.addLine('Simon', 'Scribe, start recording', at);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'control', failed: ['Chrome needs a click to record this tab.'] });
  });

  it('"Scribe, resume" works while paused, without the AI; other paused lines are dropped', async () => {
    const t = setup();
    expect(t.engine.pausedLine('Simon', 'We should ship Friday.', at)).toBeNull();
    expect(t.engine.pausedLine('Simon', 'Scribe, resume', at)).not.toBeNull();
    await t.engine.idle();
    expect(t.engine.getState().entries).toHaveLength(1);
    expect(t.deps.control.setListening).toHaveBeenCalledWith(false);
    expect(t.deps.ai.parseCommand).not.toHaveBeenCalled();
  });

  it('Record all still lets you switch modes by voice', async () => {
    const t = setup({ listenMode: 'record', approval: 'auto' }, [control({ mode: 'commands' })]);
    t.engine.addLine('Simon', 'Scribe, switch to commands mode', at);
    t.engine.addLine('Simon', 'Scribe, add that to decisions', at);
    await t.engine.idle();
    expect(t.settings.listenMode).toBe('commands');
    expect(t.deps.ai.parseCommand).toHaveBeenCalledTimes(2); // the second line came after the switch
  });

  it('people set to comments only can’t change settings', async () => {
    const t = setup({ roles: { Marcus: 'comment' } }, [control({ mode: 'record' })]);
    t.engine.addLine('Marcus', 'Scribe, record everything', at);
    await t.engine.idle();
    expect(t.settings.listenMode).toBe('commands');
    expect(first(t.engine)).toMatchObject({ kind: 'error' });
  });
});

describe('Which line?', () => {
  it('turns “Which line did you mean?” into a question with the real lines, and reruns with the answer', async () => {
    const t = setup({ approval: 'auto' }, [intent({ action: 'comment', text: 'Delete this later', find: 'Listen to task' }), intent({ action: 'comment', text: 'Delete this later', find: 'Use Kafka for events' })]);
    const { NeedsChoice } = await import('../targets/types');
    const apply = t.deps.targets.doc.apply;
    let first = true;
    t.deps.targets.doc.apply = async (...args) => {
      if (first) {
        first = false;
        throw new NeedsChoice('Which line did you mean?', ['Use Kafka for events', 'Beta: November 10']);
      }
      return apply(...args);
    };
    t.engine.addLine('Simon', 'Scribe, comment on the line listen to task: delete this later', at);
    await t.engine.idle();
    const e = t.engine.getState().entries[0]!;
    expect(e.action).toMatchObject({ kind: 'clarify', question: 'Which line did you mean?', options: ['Use Kafka for events', 'Beta: November 10'] });
    t.engine.answerClarify(e.id, 'Use Kafka for events');
    await t.engine.idle();
    expect(t.deps.ai.parseCommand).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ clarification: 'Use Kafka for events' }), expect.anything());
    expect(t.engine.getState().entries[0]!.action).toMatchObject({ kind: 'written', result: { status: 'commented', add: 'Delete this later' } });
  });

  it('Smart mode never writes into Transcript', async () => {
    const t = setup({ listenMode: 'smart', approval: 'auto' }, [], [smart({ action: 'append', label: 'open_question', section: 'Transcript', text: 'Who owns on-call?' })]);
    t.engine.addLine('Wei', 'We still need someone to own on-call, right?', at);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'written', proposal: { write: { section: null } } });
  });
});

describe('Pausing', () => {
  it('drops lines said while the pause request was still being worked out', async () => {
    const pause = intent({ action: 'control', control: { mode: null, file: null, approval: null, listening: 'pause', recording: null } });
    const t = setup({ listenMode: 'smart' }, [pause], [smart({ action: 'request' })]);
    // As in the panel: pausing the Meet tab comes back as a paused Meet state.
    (t.deps.control.setListening as any).mockImplementation(async (paused: boolean) => t.engine.setMeet({ status: 'listening', title: 'Sync', userName: 'Simon', paused, screen: null }));
    t.engine.addLine('Simon', 'Can you pause the sound for me?', at);
    t.engine.addLine('Simon', 'Hello, can you hear me?', at + 8000);
    await t.engine.idle();
    const s = t.engine.getState();
    expect(s.entries.map((e) => e.text)).toEqual(['Can you pause the sound for me?']);
    expect(s.speakers).toEqual({ Simon: 1 });
    expect(t.deps.ai.decideSmart).toHaveBeenCalledTimes(1);
  });

  it('still takes typed requests while paused', async () => {
    const t = setup({}, [intent({ action: 'append', section: 'Decisions', text: 'Ship Friday' })]);
    t.engine.setMeet({ status: 'listening', title: 'Sync', userName: 'Simon', paused: true, screen: null });
    t.engine.addLine('Simon', 'add ship Friday to decisions', at, true);
    await t.engine.idle();
    expect(t.engine.getState().entries).toHaveLength(1);
    expect(t.engine.getState().entries[0]!.action.kind).not.toBe('skipped');
  });
});

describe('Who said it', () => {
  it('uses your Google name instead of Meet’s “You”, for lines, the speaker list and photos', async () => {
    const t = setup({ listenMode: 'record' });
    t.engine.setSelf({ name: 'Simon Yang', picture: 'https://lh3.googleusercontent.com/me' });
    t.engine.noteAvatar('Priya', 'https://lh3.googleusercontent.com/priya');
    t.engine.addLine('You', 'So basically.', at);
    t.engine.addLine('Priya', 'Sounds good.', at + 1000);
    await t.engine.idle();
    const s = t.engine.getState();
    expect(s.entries.map((e) => e.speaker)).toEqual(['Simon Yang', 'Priya']);
    expect(s.speakers).toEqual({ 'Simon Yang': 1, Priya: 1 });
    expect(s.avatars).toEqual({ 'Simon Yang': 'https://lh3.googleusercontent.com/me', Priya: 'https://lh3.googleusercontent.com/priya' });
    expect(s.entries[0]!.action).toMatchObject({ kind: 'transcript', line: expect.stringMatching(/^Simon Yang \(/) });
  });

  it('keeps “You” until Scribe knows your name', async () => {
    const t = setup({ listenMode: 'record' });
    t.engine.addLine('You', 'Hello.', at);
    await t.engine.idle();
    expect(t.engine.getState().entries[0]!.speaker).toBe('You');
  });
});

describe('Smart mode', () => {
  it('records a decision without the wake word', async () => {
    const t = setup({ listenMode: 'smart' }, [], [smart({ action: 'append', label: 'decision', section: 'Decisions', text: 'Use Postgres 16 for the event store.' })]);
    t.engine.addLine('Wei Zhang', "Okay, let's go with Postgres 16 for the event store.", at);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'written', proposal: { origin: 'smart', label: 'decision' }, result: { where: 'Decisions' } });
  });

  it('leaves ordinary discussion alone', async () => {
    const t = setup({ listenMode: 'smart' }, [], [smart({ action: 'none' })]);
    t.engine.addLine('Marcus', 'How was everyone’s weekend?', at);
    await t.engine.idle();
    expect(first(t.engine)).toEqual({ kind: 'skipped' });
    expect(t.calls).toHaveLength(0);
  });

  it('acts on a request without the wake word: “Can you take…” goes through the same path as “Scribe, …”', async () => {
    const t = setup({ listenMode: 'smart', approval: 'auto' }, [intent({ action: 'comment', text: 'okay, okay, thank you' })], [smart({ action: 'request' })]);
    t.engine.addLine('Simon', 'Add in a comment saying, okay, okay, thank you.', at);
    await t.engine.idle();
    expect(t.deps.ai.parseCommand).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ command: 'Add in a comment saying, okay, okay, thank you.' }), expect.anything());
    const e = t.engine.getState().entries[0]!;
    expect(e.addressed).toBe(true);
    expect(e.action.kind).not.toBe('skipped');
  });

  it('in Smart mode, three-word requests count too', async () => {
    const t = setup({ listenMode: 'smart' }, [], [smart({ action: 'none' })]);
    t.engine.addLine('Simon', 'Take a screenshot.', at);
    await t.engine.idle();
    expect(t.deps.ai.decideSmart).toHaveBeenCalled();
  });

  it('still obeys "Scribe, …" in Smart mode', async () => {
    const t = setup({ listenMode: 'smart' }, [intent({ action: 'question', text: 'What is open?' })]);
    t.engine.addLine('Simon', 'Scribe, what is still open?', at);
    await t.engine.idle();
    expect(first(t.engine)).toEqual({ kind: 'answer', answer: 'Who owns on-call.' });
    expect(t.deps.ai.decideSmart).not.toHaveBeenCalled();
  });
});

describe('Record mode', () => {
  it('writes lines to the Transcript in batches, with no model', async () => {
    const t = setup({ listenMode: 'record', approval: 'auto' });
    t.engine.addLine('Sarah Chen', 'We should ship Friday.', at);
    t.engine.addLine('Wei Zhang', 'Scribe, add that to decisions.', at);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'transcript', status: 'queued' });
    t.timers.forEach((fn) => fn());
    await t.engine.idle();
    expect(t.transcripts).toEqual([['Sarah Chen (14:21): We should ship Friday.', 'Wei Zhang (14:21): Scribe, add that to decisions.']]);
    expect(first(t.engine)).toMatchObject({ kind: 'transcript', status: 'written' });
    expect(t.deps.ai.parseCommand).not.toHaveBeenCalled();
  });

  it('holds transcript lines for approval in manual mode', async () => {
    const t = setup({ listenMode: 'record', approval: 'manual' });
    const id = t.engine.addLine('Sarah Chen', 'We should ship Friday.', at);
    await t.engine.idle();
    expect(first(t.engine)).toMatchObject({ kind: 'transcript', status: 'waiting' });
    t.engine.approveAll();
    t.timers.forEach((fn) => fn());
    await t.engine.idle();
    expect(t.transcripts).toHaveLength(1);
    expect(t.engine.getState().entries.find((e) => e.id === id)!.action).toMatchObject({ status: 'written' });
  });
});
