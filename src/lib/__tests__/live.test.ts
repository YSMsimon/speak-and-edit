// Calls a real model. Skipped unless SCRIBE_LIVE=1. Uses Ollama's free cloud model
// through the local Ollama app (nothing is downloaded).
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { confirmRequest, decideSmart, parseCommand, readScreen } from '../ai/agent';
import { buildOutline, describeOutline } from '../docs/outline';
import { planEdit } from '../docs/plan';
import { makeDoc, SPEC } from './fixtures';

const live = process.env.SCRIBE_LIVE === '1';
const MODEL = process.env.SCRIBE_MODEL ?? 'gpt-oss:120b-cloud';
const ai = { model: createOpenAICompatible({ name: 'ollama', baseURL: 'http://localhost:11434/v1' }).chatModel(MODEL), mode: 'prompt' as const };
const outline = buildOutline(makeDoc(SPEC));
const ctx = { outline: `File “Q4 Platform Spec” (Google Doc)\n${describeOutline(outline)}\n\nFile “Tracker” (Google Sheet)\nTab “Tasks” (columns: Task | Owner | Status)\n  row 2: Fix login | Wei | open`, recent: [] };

describe.skipIf(!live)(`live: ${MODEL}`, () => {
  it('adds to a section', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Sarah Chen', command: 'add to decisions, use Postgres 16 for the event store' }, ctx);
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('append');
    expect(intent.section).toBe('Decisions');
    expect(planEdit(outline, { kind: 'append', section: intent.section, text: intent.text! }).ok).toBe(true);
  }, 60_000);

  it('replaces text that is really in the doc', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Sarah Chen', command: 'change the launch date to December 8' }, ctx);
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('replace');
    const plan = planEdit(outline, { kind: 'replace', section: intent.section, find: intent.find!, replaceWith: intent.replaceWith ?? '' });
    expect(plan.ok).toBe(true);
  }, 60_000);

  it('asks when "it" could mean two dates', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Wei Zhang', command: 'move it to the fifteenth' }, ctx);
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('clarify');
  }, 60_000);

  it('says none for small talk', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Marcus Lee', command: 'can you hear me okay' }, ctx);
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('none');
  }, 60_000);
});

describe.skipIf(!live)(`live smart mode: ${MODEL}`, () => {
  const cases: [string, string, string[], 'append' | 'request' | 'none'][] = [
    ['Wei Zhang', "Okay, so we're agreed, let's go with Postgres 16 for the event store.", [], 'append'],
    ['Sarah Chen', 'Simon, can you set up the staging database by Friday?', ['Simon: sure'], 'append'],
    ['Marcus Lee', 'How was everyone’s weekend?', [], 'none'],
    ['Marcus Lee', 'Maybe Postgres, maybe Mongo, I’m honestly not sure yet.', [], 'none'],
    ['Wei Zhang', 'Can you hear me now? My mic was off.', [], 'none'],
    // Simon's call, 2026-11-01: requests with no wake word.
    ['Simon', 'Can you take a screenshot?', [], 'request'],
    ['Simon', 'Can you take a screenshot for me and then put it into the doc?', [], 'request'],
    ['Simon', 'Add in a comment saying, okay, okay, thank you.', [], 'request'],
    ['Simon', 'Uh, can you change to command mode?', [], 'request'],
    ['Simon', 'Priya, can you share your screen?', [], 'none'],
    ['Simon', 'Okay, okay, thank you.', [], 'none'],
  ];
  for (const [speaker, text, recent, want] of cases) {
    it(`${want}: ${text}`, async () => {
      const { decision } = await decideSmart(ai, { speaker, text }, { ...ctx, recent });
      console.log(JSON.stringify(decision));
      expect(decision.action === 'none' || decision.action === 'request' ? decision.action : 'append').toBe(want);
    }, 60_000);
  }
});


const VISION = process.env.SCRIBE_VISION_MODEL ?? 'gemma4:31b-cloud';
const eyes = { model: createOpenAICompatible({ name: 'ollama', baseURL: 'http://localhost:11434/v1' }).chatModel(VISION), mode: 'prompt' as const };

describe.skipIf(!live)(`live screen: ${VISION}`, () => {
  it('reads a table off a shared screen into Sheet rows', async () => {
    const png = readFileSync(new URL('./assets/shared-table.png', import.meta.url)).toString('base64');
    const { read } = await readScreen(eyes, { speaker: 'Simon', command: 'add this table to the tracker', image: `data:image/png;base64,${png}` }, ctx);
    console.log(JSON.stringify(read));
    expect(read.action).toBe('append');
    expect(read.file).toBe('Tracker');
    const tasks = read.rows.map((r) => r.find((c) => c.column === 'Task')?.value);
    expect(tasks).toEqual(['Payment page', 'Load test', 'Press kit']);
    expect(read.rows[1]!.find((c) => c.column === 'Owner')?.value).toBe('Marco');
  }, 90_000);

  it('asks for a picture when someone says "screenshot this"', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: 'screenshot this and put it in the spec' }, { ...ctx, screen: 'Priya is sharing their screen.' });
    console.log(JSON.stringify(intent));
    expect(intent.screen).toBe('image');
  }, 60_000);

  it('asks to read the screen for "add this table to the tracker"', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: 'add this table to the tracker' }, { ...ctx, screen: 'Priya is sharing their screen.' });
    console.log(JSON.stringify(intent));
    expect(intent.screen).toBe('read');
  }, 60_000);
});

describe.skipIf(!live)(`live control tool: ${MODEL}`, () => {
  const state = 'Scribe now: Commands mode, ask before writing, no working file (Scribe picks per request), listening, video recording on.';
  const cases: [string, Record<string, string>][] = [
    ['switch to smart mode', { mode: 'smart' }],
    ['record everything from now on', { mode: 'record' }],
    ['work on the tracker', { file: 'Tracker' }],
    ['just make the edits directly, no suggestions', { approval: 'auto' }],
    ['let me approve changes before they go in', { approval: 'ask' }],
    ['stop listening for a bit', { listening: 'pause' }],
    ['pause the recording', { recording: 'pause' }],
    ['stop recording', { recording: 'stop' }],
  ];
  for (const [command, want] of cases) {
    it(command, async () => {
      const { intent } = await parseCommand(ai, { speaker: 'Simon', command }, { ...ctx, state });
      console.log(JSON.stringify(intent.control));
      expect(intent.action).toBe('control');
      expect(intent.control).toMatchObject(want);
    }, 60_000);
  }
  it('an ordinary edit is not a control', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: 'record in decisions that we use Postgres 16' }, { ...ctx, state });
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('append');
  }, 60_000);
});

describe.skipIf(!live)(`live smoke-test fixes: ${MODEL}`, () => {
  it('a question about the files is a question', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: "what's the launch date?" }, ctx);
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('question');
  }, 60_000);

  it('a change that contradicts the files is still made', async () => {
    const doc = buildOutline(makeDoc(['# Q4 Platform Spec', '## Decisions', '- Use Postgres 16 for the event store', '## Timeline', 'Launch: November 24']));
    const own = { outline: `File “Q4 Platform Spec” (Google Doc)\n${describeOutline(doc)}`, recent: [] };
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: 'change Postgres 16 to MySQL 8 in decisions' }, own);
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('replace');
    expect(intent.replaceWith).toMatch(/mysql 8/i);
  }, 60_000);
});

describe.skipIf(!live)(`live third-run fixes: ${MODEL}`, () => {
  const state = 'Scribe now: Commands mode, ask before writing, no working file (Scribe picks per request), listening, video recording off.';
  it('"add a task" for something not in the files is an append, not a question', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: 'add a task: order pizza for the demo' }, { ...ctx, state });
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('append');
    expect(intent.file).toBe('Tracker');
  }, 60_000);

  it('"mark X as done" changes a Sheet row the code can find', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: 'mark fix login as done' }, { ...ctx, state });
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('replace');
    const named = intent.find ?? intent.cells.find((c) => /fix login/i.test(c.value))?.value;
    expect(named).toMatch(/fix login/i);
  }, 60_000);
});

describe.skipIf(!live)(`live smart-mode requests become the right action: ${MODEL}`, () => {
  it('“Can you take a screenshot?” while someone shares is a picture of the screen', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: 'Can you take a screenshot?' }, { ...ctx, screen: 'Priya is sharing their screen.' });
    console.log(JSON.stringify(intent));
    expect(intent.screen).toBe('image');
  }, 60_000);

  it('“Add in a comment saying, okay, okay, thank you.” is a comment, not text in the doc', async () => {
    // As in Simon's call: one Doc connected. (With two files and no working file, asking which file is right.)
    const oneDoc = { ...ctx, outline: `File “Q4 Platform Spec” (Google Doc)\n${describeOutline(outline)}` };
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: 'Add in a comment saying, okay, okay, thank you.' }, oneDoc);
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('comment');
  }, 60_000);

  it('“Uh, can you change to command mode?” switches the mode', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: 'Uh, can you change to command mode?' }, ctx);
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('control');
    expect(intent.control?.mode).toBe('commands');
  }, 60_000);
});

describe.skipIf(!live)(`live comment on a named line: ${MODEL}`, () => {
  it('the comment says only what to say, and points at the line it’s about', async () => {
    const oneDoc = { ...ctx, outline: `File “Q4 Platform Spec” (Google Doc)\n${describeOutline(outline)}` };
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: 'Can you add a comment on the line about the beta date, saying check this with Wei?' }, oneDoc);
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('comment');
    expect(intent.text?.toLowerCase()).toContain('check this with wei');
    expect(intent.text?.toLowerCase()).not.toContain('comment');
    expect(intent.find?.toLowerCase()).toContain('beta');
  }, 60_000);
});

// Overleaf (v0.8): the model sees the LaTeX source and should still write plain words; Scribe escapes them.
describe.skipIf(!live)(`live Overleaf: ${MODEL}`, () => {
  const PAPER = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
Bees visit some flowers more than others.
\section{Method}
We count bees in five garden beds.
\begin{itemize}
  \item Tomato bed
\end{itemize}
\section{Results}
The pilot reached 30\% accuracy.
\end{document}`;
  const texCtx = async () => {
    const { describeTex } = await import('../latex/tex');
    return { outline: `File “Scribe test” (Overleaf project)\nLaTeX file open: main.tex\n${describeTex(PAPER).text}`, recent: [] };
  };

  it('adds plain words under a \\section, no LaTeX escapes', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: 'add to results: recall was 85% on the R&D tasks' }, await texCtx());
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('append');
    expect(intent.section).toBe('Results');
    expect(intent.text).toMatch(/85%/);
    expect(intent.text).not.toMatch(/\\/);
  }, 60_000);

  it('a change of "30%" finds text the code can match', async () => {
    const { replaceIn } = await import('../latex/tex');
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: 'in results, change 30% to 35%' }, await texCtx());
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('replace');
    const e = replaceIn(PAPER, intent.section, intent.find!, intent.replaceWith ?? '');
    expect(e.text).toContain('35\\% accuracy');
  }, 60_000);

  it('adds to the method list by its section', async () => {
    const { intent } = await parseCommand(ai, { speaker: 'Simon', command: 'add the herb bed to the method list' }, await texCtx());
    console.log(JSON.stringify(intent));
    expect(intent.action).toBe('append');
    expect(intent.section).toBe('Method');
    expect(intent.text).not.toMatch(/\\item/);
  }, 60_000);
});

describe.skipIf(!live)(`live: ${MODEL}, words that only sound like "Scribe"`, () => {
  const files = ['Q4 Platform Spec', 'Tracker'];
  const recent = ['Priya: Okay, let’s go through the launch plan.', 'Marco: We still need a database decision.'];
  const cases: [string, string, boolean][] = [
    ['Simon', 'Subscribe! Add Postgres 16 to decisions.', true],
    ['Simon', 'Describe, can you take a screenshot of this slide?', true],
    ['Simon', 'Scrub, mark the login fix as done in the tracker.', true],
    ['Lena', 'Describe the onboarding flow for me, Priya.', false],
    ['Marco', 'Subscribe to the newsletter if you want the release notes.', false],
    ['Simon', 'Subscribe! Hello, how are you? Thank you, and you?', false],
  ];
  for (const [speaker, text, expected] of cases) {
    it(`${expected ? 'for Scribe' : 'not for Scribe'}: ${text}`, async () => {
      const { confirmation } = await confirmRequest(ai, { speaker, text, wakeWord: 'Scribe' }, { recent, files });
      console.log(JSON.stringify(confirmation));
      expect(confirmation.forScribe).toBe(expected);
    }, 60_000);
  }
});
