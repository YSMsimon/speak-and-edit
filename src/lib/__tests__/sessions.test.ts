import { describe, expect, it } from 'vitest';
import type { SavedMeeting } from '../engine';
import { CONTINUE_MS, deleteAllMeetings, listMeetings, loadMeeting, pickMeeting, pruneMeetings, saveMeeting, type MeetingIndexItem, type Store } from '../sessions';

function memoryStore(): Store & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))])),
    set: async (items) => void Object.entries(items).forEach(([k, v]) => data.set(k, structuredClone(v))),
    remove: async (keys) => void keys.forEach((k) => data.delete(k)),
  };
}

const DAY = 24 * 60 * 60 * 1000;
const meeting = (id: string, code: string, updatedAt: number): SavedMeeting => ({
  v: 1, id, code, title: 'Weekly sync', startedAt: updatedAt - 1000, updatedAt, lastInCall: updatedAt, leftAt: null, lastGapEnd: null,
  entries: [{ id: `${id}.1`, speaker: 'Priya', text: 'Hello', at: updatedAt, addressed: false, typed: false, action: { kind: 'skipped' } }],
  speakers: { Priya: 1 }, avatars: {}, usage: { inputTokens: 0, outputTokens: 0 }, summary: null, nextId: 2,
});

describe('pickMeeting', () => {
  const now = 10 * DAY;
  const index: MeetingIndexItem[] = [
    { id: 'a', code: 'abc-defg-hij', title: null, startedAt: 0, updatedAt: now - 10 * 60_000, lines: 3 },
    { id: 'b', code: 'abc-defg-hij', title: null, startedAt: 0, updatedAt: now - 7 * DAY, lines: 9 },
    { id: 'c', code: 'xyz-wxyz-xyz', title: null, startedAt: 0, updatedAt: now - 60_000, lines: 1 },
  ];
  it('continues the same Meet code used in the last 2 hours', () => {
    expect(pickMeeting(index, 'abc-defg-hij', now)?.id).toBe('a');
  });
  it('starts over when the code was last used longer ago (a weekly event keeps its code)', () => {
    expect(pickMeeting(index, 'abc-defg-hij', now + CONTINUE_MS)).toBeUndefined();
  });
  it('never mixes up two codes', () => {
    expect(pickMeeting(index, 'new-code-xyz', now)).toBeUndefined();
  });
});

describe('saved meetings in storage', () => {
  it('saves, lists and loads a meeting', async () => {
    const store = memoryStore();
    await saveMeeting(meeting('m1', 'abc-defg-hij', 5 * DAY), store);
    await saveMeeting({ ...meeting('m1', 'abc-defg-hij', 5 * DAY + 1), title: 'Renamed' }, store);
    const list = await listMeetings(store);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'm1', title: 'Renamed', lines: 1 });
    expect((await loadMeeting('m1', store))?.entries[0]?.text).toBe('Hello');
    expect(await loadMeeting('nope', store)).toBeNull();
  });

  it('ignores something that is not a saved meeting', async () => {
    const store = memoryStore();
    store.data.set('scribe.meeting.bad', { v: 2 });
    expect(await loadMeeting('bad', store)).toBeNull();
  });

  it('drops meetings older than 30 days', async () => {
    const store = memoryStore();
    await saveMeeting(meeting('old', 'aaa-aaaa-aaa', 1 * DAY), store);
    await saveMeeting(meeting('new', 'bbb-bbbb-bbb', 40 * DAY), store);
    expect(await pruneMeetings(41 * DAY, store)).toBe(1);
    expect((await listMeetings(store)).map((m) => m.id)).toEqual(['new']);
    expect(store.data.has('scribe.meeting.old')).toBe(false);
  });

  it('deletes every saved meeting', async () => {
    const store = memoryStore();
    await saveMeeting(meeting('m1', 'aaa-aaaa-aaa', DAY), store);
    await saveMeeting(meeting('m2', 'bbb-bbbb-bbb', DAY), store);
    expect(await deleteAllMeetings(store)).toBe(2);
    expect(store.data.size).toBe(0);
  });
});
