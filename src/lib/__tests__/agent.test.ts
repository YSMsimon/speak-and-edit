import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { extractJson, parseCommand, readScreen, settleControl, settleScreen } from '../ai/agent';

function replies(...texts: string[]) {
  const queue = [...texts];
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: queue.shift() ?? '' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

const ctx = { outline: '## Decisions\n- Use Postgres', recent: [] };
const input = { speaker: 'Sam', command: 'add to decisions: launch is December 8' };

describe('extractJson', () => {
  it('reads JSON wrapped in code fences or prose', () => {
    expect(extractJson('Sure!\n```json\n{"action":"none","options":[]}\n```')).toEqual({ action: 'none', options: [], cells: [] });
  });
  it('turns options: null into an empty list', () => {
    expect(extractJson('{"action":"none","options":null}')).toEqual({ action: 'none', options: [], cells: [] });
  });
});

describe('parseCommand on models without schema support (Ollama cloud)', () => {
  const good = '{"action":"append","section":"Decisions","text":"Launch is December 8","find":null,"replaceWith":null,"clarifyQuestion":null,"options":[]}';

  it('parses a correct reply', async () => {
    const { intent, usage } = await parseCommand({ model: replies(good), mode: 'prompt' }, input, ctx);
    expect(intent).toMatchObject({ action: 'append', section: 'Decisions', text: 'Launch is December 8' });
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('retries once when the model makes up its own keys, as gpt-oss did in testing', async () => {
    const model = replies('{"action":"add_decision","decision":"launch is December 8"}', good);
    const { intent, usage } = await parseCommand({ model, mode: 'prompt' }, input, ctx);
    expect(intent.action).toBe('append');
    expect(usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain("didn't fit");
  });

  it('gives up with a clear message after two bad replies', async () => {
    await expect(parseCommand({ model: replies('nope', 'still nope'), mode: 'prompt' }, input, ctx)).rejects.toThrow('usable answer');
  });

  it('puts the exact keys in the system prompt', async () => {
    const model = replies(good);
    await parseCommand({ model, mode: 'prompt' }, input, ctx);
    expect(JSON.stringify(model.doGenerateCalls[0]!.prompt)).toContain('clarifyQuestion');
  });
});

describe('readScreen', () => {
  it('sends the picture to the model and reads rows back', async () => {
    const seen: unknown[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        seen.push(options.prompt);
        return {
          content: [{ type: 'text', text: '{"action":"append","file":"Tracker","section":"Tasks","text":null,"find":null,"replaceWith":null,"rows":[[{"column":"Task","value":"Load test"}]],"note":null}' }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
          warnings: [],
        };
      },
    });
    const { read } = await readScreen({ model, mode: 'prompt' }, { speaker: 'Simon', command: 'add this table to the tracker', image: 'data:image/png;base64,aGk=' }, ctx);
    expect(read).toMatchObject({ action: 'append', file: 'Tracker', rows: [[{ column: 'Task', value: 'Load test' }]] });
    const user = (seen[0] as { role: string; content: { type: string; mediaType?: string }[] }[]).find((m) => m.role === 'user')!;
    expect(user.content.map((c) => c.type)).toEqual(['text', 'file']);
    expect(user.content[1]!.mediaType).toBe('image/png');
  });
});

describe('settleControl', () => {
  const c = { mode: null, file: null, approval: null, listening: null, recording: 'start' as const };
  it('starts a video only when the request says so', () => {
    expect(settleControl(c, 'start recording the call')?.recording).toBe('start');
    expect(settleControl(c, 'start the video recording')?.recording).toBe('start');
  });
  it('reads "record everything" as Record all mode', () => {
    expect(settleControl(c, 'record everything from now on')).toMatchObject({ recording: null, mode: 'record' });
  });
});

describe('settleScreen: code check on screen answers', () => {
  const base = { action: 'append', screen: 'read' as const };
  it('a screen request is never dropped when it asks to add something', () => {
    expect(settleScreen({ ...base, action: 'none' }, 'add this table to the tasks sheet.')).toMatchObject({ action: 'append', screen: 'read' });
    expect(settleScreen({ ...base, action: 'none' }, 'can you see my screen?')).toMatchObject({ action: 'none' });
  });
  it('a table, rows or numbers are read as text unless a picture is asked for', () => {
    expect(settleScreen({ ...base, screen: 'image' as const }, 'add this table to the tasks sheet')).toMatchObject({ screen: 'read' });
    expect(settleScreen({ ...base, screen: 'image' as const }, 'screenshot this table into the deck')).toMatchObject({ screen: 'image' });
    expect(settleScreen({ ...base, screen: 'image' as const }, 'put this slide in the deck')).toMatchObject({ screen: 'image' });
  });
  it('leaves requests that have nothing to do with the screen alone', () => {
    expect(settleScreen({ action: 'none', screen: 'none' as const }, 'add this table')).toMatchObject({ action: 'none' });
  });
});

describe('parseCommand: a change request answered like a question is asked once more', () => {
  const question = '{"action":"question","file":null,"section":null,"text":"Is there a task for the demo room?","find":null,"replaceWith":null,"cells":[],"clarifyQuestion":null,"options":[],"screen":"none","control":null}';
  const append = '{"action":"append","file":"Tasks","section":"Sheet1","text":null,"find":null,"replaceWith":null,"cells":[{"column":"Task","value":"Book the demo room"}],"clarifyQuestion":null,"options":[],"screen":"none","control":null}';
  it('“add a task: …” answered as a question gets a second try, which wins', async () => {
    const { intent } = await parseCommand({ model: replies(question, append), mode: 'prompt' }, { speaker: 'Simon', command: 'add a task: book the demo room.' }, ctx);
    expect(intent.action).toBe('append');
  });
  it('a real question is not asked again', async () => {
    const model = replies(question, append);
    const { intent } = await parseCommand({ model, mode: 'prompt' }, { speaker: 'Simon', command: "what's the launch date?" }, ctx);
    expect(intent.action).toBe('question');
  });
  it('spots change wording, including polite openings', async () => {
    const { looksLikeChange } = await import('../ai/agent');
    expect(['add a task: x', 'please mark login as done', 'can you put this in the deck', 'okay, change MySQL to Postgres'].every(looksLikeChange)).toBe(true);
    expect(["what's the launch date?", 'can you hear me', 'is the beta still on?'].some(looksLikeChange)).toBe(false);
  });
});
