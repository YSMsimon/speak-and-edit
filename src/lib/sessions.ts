// Saved meetings: one per Google Meet call, in chrome.storage.local (on this computer only,
// never synced). Closing the panel, reloading Scribe or restarting Chrome picks the same
// meeting up again. There is nothing to manage: the Meet code decides which meeting it is.

import type { SavedMeeting } from "./engine";

/** Meetings are kept this long after they were last used. */
export const KEEP_DAYS = 30;
/**
 * The same Meet code within this long continues the meeting. After it a new meeting starts,
 * because a weekly event keeps the same code every week.
 */
export const CONTINUE_MS = 2 * 60 * 60 * 1000;

export interface MeetingIndexItem {
  id: string;
  code: string;
  title: string | null;
  startedAt: number;
  updatedAt: number;
  lines: number;
}

const INDEX = "scribe.meetings";
const key = (id: string) => `scribe.meeting.${id}`;

/** chrome.storage.local, or a stand-in in tests. */
export interface Store {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export const chromeStore: Store = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
};

/** The meeting to continue for this Meet code, if it was used recently enough. */
export function pickMeeting(index: MeetingIndexItem[], code: string, now: number): MeetingIndexItem | undefined {
  return index
    .filter((m) => m.code === code && now - m.updatedAt < CONTINUE_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function expired(index: MeetingIndexItem[], now: number): MeetingIndexItem[] {
  return index.filter((m) => now - m.updatedAt > KEEP_DAYS * 24 * 60 * 60 * 1000);
}

export async function listMeetings(store: Store = chromeStore): Promise<MeetingIndexItem[]> {
  const raw = (await store.get([INDEX]))[INDEX];
  return Array.isArray(raw) ? (raw as MeetingIndexItem[]) : [];
}

export async function loadMeeting(id: string, store: Store = chromeStore): Promise<SavedMeeting | null> {
  const raw = (await store.get([key(id)]))[key(id)] as Partial<SavedMeeting> | undefined;
  if (!raw || raw.v !== 1 || !Array.isArray(raw.entries) || typeof raw.code !== "string") return null;
  return raw as SavedMeeting;
}

export async function saveMeeting(m: SavedMeeting, store: Store = chromeStore): Promise<void> {
  const index = (await listMeetings(store)).filter((x) => x.id !== m.id);
  const item: MeetingIndexItem = { id: m.id, code: m.code, title: m.title, startedAt: m.startedAt, updatedAt: m.updatedAt, lines: m.entries.length };
  await store.set({ [key(m.id)]: m, [INDEX]: [...index, item] });
}

/** Removes meetings older than KEEP_DAYS. Returns how many went. */
export async function pruneMeetings(now: number, store: Store = chromeStore): Promise<number> {
  const index = await listMeetings(store);
  const old = expired(index, now);
  if (!old.length) return 0;
  await store.remove(old.map((m) => key(m.id)));
  await store.set({ [INDEX]: index.filter((m) => !old.includes(m)) });
  return old.length;
}

/** "Delete saved meetings": every one, including the meeting open now. */
export async function deleteAllMeetings(store: Store = chromeStore): Promise<number> {
  const index = await listMeetings(store);
  await store.remove([...index.map((m) => key(m.id)), INDEX]);
  return index.length;
}
