import { describe, expect, it, vi } from 'vitest';
import { createInteractionLog, stripPictures, type Interaction, type LogStore } from '../interactions';

function memoryStore(): LogStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (keys) => Object.fromEntries([...data].filter(([k]) => keys === null || keys.includes(k)).map(([k, v]) => [k, structuredClone(v)])),
    set: async (items) => void Object.entries(items).forEach(([k, v]) => data.set(k, structuredClone(v))),
    remove: async (keys) => void keys.forEach((k) => data.delete(k)),
  };
}

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 7, 15, 0);
const outcome = (at: number, kind = 'written'): Interaction => ({ t: 'outcome', at, meeting: 'm1', entry: 'm1.1', speaker: 'Priya', text: 'Scribe, add Postgres', mode: 'commands', kind });

describe('the AI log', () => {
  it('writes events by day, and exports them as JSON lines', async () => {
    const store = memoryStore();
    const post = vi.fn(async (_lines: string) => undefined);
    const log = createInteractionLog({ store, post, now: () => T0 });
    log.add(outcome(T0));
    log.add(outcome(T0 + DAY, 'error'));
    await log.flush();
    expect([...store.data.keys()].sort()).toEqual(['scribe.log.2026-11-07', 'scribe.log.2026-11-08']);
    expect(post).toHaveBeenCalledTimes(1);
    expect(String(post.mock.calls[0]![0]).split('\n')).toHaveLength(2);
    const lines = (await log.exportJsonl()).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.kind)).toEqual(['written', 'error']);
  });

  it('leaves pictures out', () => {
    expect(stripPictures({ input: { image: `data:image/jpeg;base64,${'A'.repeat(4096)}`, command: 'add this table' } })).toEqual({ input: { image: '[picture, 4 KB]', command: 'add this table' } });
  });

  it('drops days older than 30 days, and everything on Delete', async () => {
    const store = memoryStore();
    const log = createInteractionLog({ store, now: () => T0 + 31 * DAY });
    log.add(outcome(T0));
    log.add(outcome(T0 + 30 * DAY));
    await log.flush();
    await log.prune();
    expect([...store.data.keys()]).toEqual(['scribe.log.2026-12-07']);
    store.data.set('scribe.settings', { keep: true });
    expect(await log.clear()).toBe(1);
    expect([...store.data.keys()]).toEqual(['scribe.settings']);
  });
});
