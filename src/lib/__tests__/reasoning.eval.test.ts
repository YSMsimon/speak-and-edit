// Speed against accuracy for each model's reasoning level, on the live tests' cases.
// Skipped unless SCRIBE_EVAL=1. Ollama runs through the local Ollama app (cloud models, nothing
// downloaded); OpenAI and Anthropic need OPENAI_API_KEY / ANTHROPIC_API_KEY in the environment.
// Writes the full results to SCRIBE_EVAL_OUT (a JSON file) when set.
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { confirmRequest, decideSmart, parseCommand, type AiModel, type Reasoning } from '../ai/agent';
import { buildOutline, describeOutline } from '../docs/outline';
import { makeDoc, SPEC } from './fixtures';

const run = process.env.SCRIBE_EVAL === '1';
const REPEATS = Number(process.env.SCRIBE_EVAL_REPEATS ?? 2);
const outline = buildOutline(makeDoc(SPEC));
const ctx = { outline: `File “Q4 Platform Spec” (Google Doc)\n${describeOutline(outline)}\n\nFile “Tracker” (Google Sheet)\nTab “Tasks” (columns: Task | Owner | Status)\n  row 2: Fix login | Wei | open`, recent: [] as string[] };
const state = 'Scribe now: Commands mode, ask before writing, no working file (Scribe picks per request), listening, video recording on.';
const sharing = 'Priya is sharing their screen.';

type Case = { job: 'request' | 'smart' | 'wake'; name: string; call: (ai: AiModel) => Promise<boolean> };
const req = (name: string, command: string, ok: (i: Awaited<ReturnType<typeof parseCommand>>['intent']) => boolean, extra: Record<string, string> = {}): Case => ({
  job: 'request',
  name,
  call: async (ai) => ok((await parseCommand(ai, { speaker: 'Simon', command }, { ...ctx, ...extra })).intent),
});
const smart = (speaker: string, text: string, want: 'append' | 'request' | 'none', recent: string[] = []): Case => ({
  job: 'smart',
  name: text,
  call: async (ai) => {
    const { decision } = await decideSmart(ai, { speaker, text }, { ...ctx, recent });
    return (decision.action === 'none' || decision.action === 'request' ? decision.action : 'append') === want;
  },
});
const wake = (text: string, want: boolean): Case => ({
  job: 'wake',
  name: text,
  call: async (ai) =>
    (await confirmRequest(ai, { speaker: 'Simon', text, wakeWord: 'Scribe' }, { recent: ['Priya: Okay, let’s go through the launch plan.'], files: ['Q4 Platform Spec', 'Tracker'] })).confirmation.forScribe === want,
});

const CASES: Case[] = [
  req('append to a section', 'add to decisions, use Postgres 16 for the event store', (i) => i.action === 'append' && i.section === 'Decisions'),
  req('replace a date', 'change the launch date to December 8', (i) => i.action === 'replace' && /december 8/i.test(i.replaceWith ?? '')),
  req('ask which one', 'move it to the fifteenth', (i) => i.action === 'clarify'),
  req('small talk is none', 'can you hear me okay', (i) => i.action === 'none'),
  req('a question', "what's the launch date?", (i) => i.action === 'question'),
  req('add a task', 'add a task: Simon sets up staging by Friday', (i) => i.action === 'append' && i.file === 'Tracker'),
  req('mark done', 'mark fix login as done', (i) => i.action === 'replace' && /fix login/i.test(i.find ?? '') && i.cells.some((c) => /done/i.test(c.value))),
  req('comment text only', 'comment on the launch date, saying this might slip a week', (i) => i.action === 'comment' && /slip/i.test(i.text ?? '') && !/comment/i.test(i.text ?? '')),
  req('control: smart mode', 'switch to smart mode', (i) => i.action === 'control' && i.control?.mode === 'smart', { state }),
  req('control: record everything', 'record everything from now on', (i) => i.action === 'control' && i.control?.mode === 'record' && !i.control?.recording, { state }),
  req('control: working file', 'work on the tracker', (i) => i.action === 'control' && i.control?.file === 'Tracker', { state }),
  req('control: stop recording', 'stop recording', (i) => i.action === 'control' && i.control?.recording === 'stop', { state }),
  req('an edit is not a control', 'record in decisions that we use Postgres 16', (i) => i.action === 'append', { state }),
  req('screenshot means a picture', 'screenshot this and put it in the spec', (i) => i.screen === 'image', { screen: sharing }),
  req('"this table" means read the screen', 'add this table to the tracker', (i) => i.screen === 'read', { screen: sharing }),
  smart('Wei Zhang', "Okay, so we're agreed, let's go with Postgres 16 for the event store.", 'append'),
  smart('Sarah Chen', 'Simon, can you set up the staging database by Friday?', 'append', ['Simon: sure']),
  smart('Marcus Lee', 'How was everyone’s weekend?', 'none'),
  smart('Marcus Lee', 'Maybe Postgres, maybe Mongo, I’m honestly not sure yet.', 'none'),
  smart('Wei Zhang', 'Can you hear me now? My mic was off.', 'none'),
  smart('Simon', 'Can you take a screenshot?', 'request'),
  smart('Simon', 'Can you take a screenshot for me and then put it into the doc?', 'request'),
  smart('Simon', 'Add in a comment saying, okay, okay, thank you.', 'request'),
  smart('Simon', 'Uh, can you change to command mode?', 'request'),
  smart('Simon', 'Priya, can you share your screen?', 'none'),
  smart('Simon', 'Okay, okay, thank you.', 'none'),
  wake('Subscribe! Add Postgres 16 to decisions.', true),
  wake('Describe, can you take a screenshot of this slide?', true),
  wake('Scrub, mark the login fix as done in the tracker.', true),
  wake('Describe the onboarding flow for me, Priya.', false),
  wake('Subscribe to the newsletter if you want the release notes.', false),
  wake('Subscribe! Hello, how are you? Thank you, and you?', false),
];

const ollama = (model: string) => createOpenAICompatible({ name: 'ollama', baseURL: 'http://localhost:11434/v1' }).chatModel(model);
type Setup = { label: string; ai: AiModel };
const SETUPS: Setup[] = [];
for (const m of ['gpt-oss:120b-cloud', 'gpt-oss:20b-cloud']) {
  SETUPS.push({ label: `Ollama ${m} · default`, ai: { model: ollama(m), mode: 'prompt' } });
  SETUPS.push({ label: `Ollama ${m} · low`, ai: { model: ollama(m), mode: 'prompt', reasoning: 'low' } });
}
if (process.env.OPENAI_API_KEY) {
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  for (const [m, lowest] of [['gpt-5-mini', 'minimal'], ['gpt-5.4-mini', 'none']] as [string, Reasoning][]) {
    SETUPS.push({ label: `OpenAI ${m} · default`, ai: { model: openai.chat(m), mode: 'strict' } });
    SETUPS.push({ label: `OpenAI ${m} · ${lowest}`, ai: { model: openai.chat(m), mode: 'strict', reasoning: lowest } });
  }
}
if (process.env.ANTHROPIC_API_KEY) {
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  SETUPS.push({ label: 'Anthropic claude-haiku-5-5 · default', ai: { model: anthropic('claude-haiku-5-5'), mode: 'strict' } });
  SETUPS.push({ label: 'Anthropic claude-haiku-5-5 · none', ai: { model: anthropic('claude-haiku-5-5'), mode: 'strict', reasoning: 'none' } });
}
const only = process.env.SCRIBE_EVAL_ONLY;

type Result = { setup: string; job: string; name: string; ok: boolean; ms: number; error?: string };

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t);
  }));
}

const median = (xs: number[]) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : 0);
const p90 = (xs: number[]) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.9))]! : 0);

describe.skipIf(!run)('reasoning level: speed against accuracy', () => {
  it('runs every case on every setup', async () => {
    const results: Result[] = [];
    for (const setup of SETUPS.filter((s) => !only || s.label.includes(only))) {
      const jobs = CASES.flatMap((c) => Array.from({ length: REPEATS }, () => c));
      await pool(jobs, 4, async (c) => {
        const t0 = Date.now();
        try {
          results.push({ setup: setup.label, job: c.job, name: c.name, ok: await c.call(setup.ai), ms: Date.now() - t0 });
        } catch (e) {
          results.push({ setup: setup.label, job: c.job, name: c.name, ok: false, ms: Date.now() - t0, error: String(e instanceof Error ? e.message : e).slice(0, 200) });
        }
      });
      const mine = results.filter((r) => r.setup === setup.label);
      const pct = (rs: Result[]) => `${rs.filter((r) => r.ok).length}/${rs.length}`;
      console.log(
        `${setup.label.padEnd(44)} all ${pct(mine)} · request ${pct(mine.filter((r) => r.job === 'request'))} · smart ${pct(mine.filter((r) => r.job === 'smart'))} · wake ${pct(mine.filter((r) => r.job === 'wake'))} · median ${(median(mine.map((r) => r.ms)) / 1000).toFixed(2)} s · p90 ${(p90(mine.map((r) => r.ms)) / 1000).toFixed(2)} s · errors ${mine.filter((r) => r.error).length}`
      );
    }
    if (process.env.SCRIBE_EVAL_OUT) writeFileSync(process.env.SCRIBE_EVAL_OUT, JSON.stringify(results, null, 1));
    expect(results.length).toBeGreaterThan(0);
  }, 3_600_000);
});
