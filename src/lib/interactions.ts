// The AI log: every model call (what went in, what came out, how long, any error), what happened to
// each line, and what the person did about it (approve, discard, accept, reject, retry, answer).
// Kept on this computer only (chrome.storage.local, one key per day, 30 days), for finding the
// mistakes that happen most and turning them into evals and few-shot examples
// (scripts/eval-report.mjs). Smoke builds also append it to .smoke/interactions.jsonl through the
// local dev server, so it can be read straight from disk.

import type { Usage } from "./ai/agent";

export type AiJob = "parseCommand" | "decideSmart" | "answerQuestion" | "readScreen" | "summarizeMeeting" | "confirmRequest";
export type Feedback = "approve" | "discard" | "accept" | "reject" | "retry" | "answer";

interface Base {
  at: number;
  /** The saved meeting it belongs to, when known. */
  meeting: string | null;
  /** The line it's about, when there is one. */
  entry?: string;
}

export type Interaction =
  | (Base & {
      t: "ai";
      job: AiJob;
      provider: string | null;
      model: string | null;
      /** The call's input and context (pictures left out). */
      input: unknown;
      ctx?: unknown;
      output?: unknown;
      error?: string;
      ms: number;
      usage?: Usage;
    })
  | (Base & { t: "outcome"; speaker: string; text: string; mode: string; kind: string; detail?: string; missed?: boolean; typed?: boolean })
  | (Base & { t: "feedback"; action: Feedback; detail?: string });

export const LOG_KEEP_DAYS = 30;
const PREFIX = "scribe.log.";
/** One day can't grow without end: a full day of Smart mode is a few thousand events. */
const DAY_MAX = 20_000;

const dayKey = (t: number) => `${PREFIX}${new Date(t).toISOString().slice(0, 10)}`;

/** Pictures are large and already saved to Drive: keep only a marker. */
export function stripPictures(value: unknown): unknown {
  if (typeof value === "string") return value.startsWith("data:image/") ? `[picture, ${Math.round(value.length / 1024)} KB]` : value;
  if (Array.isArray(value)) return value.map(stripPictures);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripPictures(v)]));
  return value;
}

export interface LogStore {
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

const chromeStore: LogStore = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
};

/**
 * Collects events and writes them every 2 seconds. `post` is the smoke builds' copy to the local
 * dev server; normal builds pass nothing.
 */
export function createInteractionLog(opts: { store?: LogStore; post?: (lines: string) => Promise<unknown>; now?: () => number; every?: number } = {}) {
  const store = opts.store ?? chromeStore;
  const now = opts.now ?? Date.now;
  let buffer: Interaction[] = [];
  let writing: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const batch = buffer;
    buffer = [];
    if (!batch.length) return writing;
    writing = writing.then(async () => {
      const byDay = new Map<string, Interaction[]>();
      for (const e of batch) byDay.set(dayKey(e.at), [...(byDay.get(dayKey(e.at)) ?? []), e]);
      const keys = [...byDay.keys()];
      const old = await store.get(keys);
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        const prev = Array.isArray(old[k]) ? (old[k] as Interaction[]) : [];
        out[k] = [...prev, ...byDay.get(k)!].slice(-DAY_MAX);
      }
      await store.set(out);
      await opts.post?.(batch.map((e) => JSON.stringify(e)).join("\n")).catch(() => undefined);
    }).catch((e) => console.error("Writing the AI log failed", e));
    return writing;
  };

  return {
    add(e: Interaction) {
      buffer.push(stripPictures(e) as Interaction);
      if (!timer) timer = setTimeout(() => void flush(), opts.every ?? 2000);
    },
    flush,
    /** Every kept event, oldest first. */
    async all(): Promise<Interaction[]> {
      await flush();
      const everything = await store.get(null);
      return Object.keys(everything)
        .filter((k) => k.startsWith(PREFIX))
        .sort()
        .flatMap((k) => (Array.isArray(everything[k]) ? (everything[k] as Interaction[]) : []));
    },
    /** One line of JSON per event, for scripts/eval-report.mjs. */
    async exportJsonl(): Promise<string> {
      return (await this.all()).map((e) => JSON.stringify(e)).join("\n") + "\n";
    },
    async prune(): Promise<void> {
      const keys = Object.keys(await store.get(null)).filter((k) => k.startsWith(PREFIX));
      const cutoff = dayKey(now() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000);
      const old = keys.filter((k) => k < cutoff);
      if (old.length) await store.remove(old);
    },
    async clear(): Promise<number> {
      buffer = [];
      const keys = Object.keys(await store.get(null)).filter((k) => k.startsWith(PREFIX));
      await store.remove(keys);
      return keys.length;
    },
  };
}

export type InteractionLog = ReturnType<typeof createInteractionLog>;
