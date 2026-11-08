// Settings live in chrome.storage.local: on this computer only, never synced.

import { FILE_KINDS, type FileRef } from "./files";
import type { LandAs } from "./targets/types";

/**
 * The AI: the user's own ChatGPT plan (Sign in with ChatGPT), or the model built into Chrome. No API keys.
 * Ollama, OpenRouter and API keys were removed on 2026-11-07, so this version matches the Chrome Web Store
 * one; the last version with them is commit 87744b0.
 */
export type ProviderId = "chrome" | "chatgpt";
export const PROVIDER_IDS: ProviderId[] = ["chrome", "chatgpt"];
/** There is no "Auto" (removed in v0.5): the user picks one. */
export type ProviderChoice = ProviderId;
export type Role = "edit" | "comment" | "ignore";

/**
 * commands: act only on "Scribe, …" lines.
 * smart:    the model reads every line and records decisions, action items and so on by itself.
 * record:   no model; every line goes into the doc's Transcript section.
 */
export type ListenMode = "commands" | "smart" | "record";

export interface Settings {
  wakeWord: string;
  listenMode: ListenMode;
  /**
   * auto: edits go straight into the file.
   * manual ("Ask before writing"): Docs edits become suggestions to accept or reject;
   * anything that can't be a suggestion (Sheets, Slides, transcript lines, screenshots) waits in the panel for Approve.
   */
  approval: "auto" | "manual";
  files: FileRef[];
  /** The file Scribe works on when a request doesn't name one. Null: Scribe picks per request. */
  focusFileId: string | null;
  /** The Doc that "Record everything" writes to. Defaults to the first connected Doc. */
  transcriptFileId: string | null;
  /** Never change text: comments in Docs, notes in Sheets, speaker notes in Slides. */
  commentsOnly: boolean;
  /** Credit each change: a comment in Docs, a cell note in Sheets, a speaker note in Slides. */
  outputs: { docComments: boolean };
  provider: ProviderChoice;
  models: Record<ProviderId, string>;
  /** The signed-in ChatGPT account (email), or null. The tokens themselves are kept apart, in lib/ai/chatgpt.ts. */
  chatgptAccount: string | null;
  roles: Record<string, Role>;
  defaultRole: Role;
  /** Shared screen: where screenshots and recordings go, and whether each new slide is saved by itself. */
  screen: { autoCapture: boolean; targetFileId: string | null };
  /** The "Scribe captures" folder in the user's Drive, once created. */
  driveFolderId: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  wakeWord: "Scribe",
  listenMode: "commands",
  // Suggestions first, so nothing lands in a doc unreviewed until someone switches to Auto.
  approval: "manual",
  files: [],
  focusFileId: null,
  transcriptFileId: null,
  commentsOnly: false,
  outputs: { docComments: true },
  // Needs no sign-in. ChatGPT takes over once signed in.
  provider: "chrome",
  models: {
    chrome: "text",
    // Filled with the plan's first model at sign-in.
    chatgpt: "",
  },
  chatgptAccount: null,
  roles: {},
  defaultRole: "edit",
  screen: { autoCapture: false, targetFileId: null },
  driveFolderId: null,
};

const KEY = "scribe.settings";

export async function loadSettings(): Promise<Settings> {
  const raw = (await chrome.storage.local.get(KEY))[KEY] as Record<string, unknown> | undefined;
  return mergeSettings(raw);
}

/**
 * Fills defaults and upgrades older saves: v0.1 (one doc, comments-only toggle), and versions with
 * Obsidian notes, Overleaf projects, Ollama and API keys, which are dropped (the model falls back to the default).
 */
export function mergeSettings(raw: Record<string, unknown> | undefined): Settings {
  const defaults = DEFAULT_SETTINGS;
  const ids = PROVIDER_IDS as string[];
  const kinds = FILE_KINDS as string[];
  const r = (raw ?? {}) as Partial<Settings> & { docId?: string | null; docTitle?: string | null; mode?: string; autoComment?: boolean; landAs?: LandAs; creditTemplate?: string; slackWebhook?: string; shareWithClaude?: unknown; keys?: unknown; ollamaUrl?: unknown; visionModels?: unknown };
  const saved: FileRef[] = Array.isArray(r.files) ? r.files : r.docId ? [{ id: r.docId, kind: "doc", title: r.docTitle ?? "Google Doc" }] : [];
  const files = saved.filter((f) => kinds.includes(f.kind));
  // v0.2 had "How changes land": suggest / direct / comment. Only "comment" survives, as commentsOnly.
  const commentsOnly = r.commentsOnly ?? (r.landAs === "comment" || r.mode === "comment");
  const listenMode: ListenMode = r.listenMode ?? (r.autoComment ? "smart" : "commands");
  // Dropped in v0.5: the editable credit line and the Slack output.
  // Dropped: the editable credit line and the Slack output (v0.5), "Share with Claude" (removed 2026-11-01),
  // and API keys, the Ollama address and per-provider screen models (removed 2026-11-07).
  const { docId: _d, docTitle: _t, mode: _m, autoComment: _a, landAs: _l, creditTemplate: _c, slackWebhook: _w, shareWithClaude: _sc, keys: _k, ollamaUrl: _o, visionModels: _v, ...rest } = r;
  const known = <T,>(o: Partial<Record<string, T>> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => ids.includes(k))) as Partial<Record<ProviderId, T>>;
  // "auto", Ollama and the removed key providers fall back to the default.
  const provider: ProviderChoice = ids.includes(r.provider ?? "") ? (r.provider as ProviderChoice) : defaults.provider;
  return {
    ...defaults,
    ...rest,
    files,
    commentsOnly,
    focusFileId: files.some((f) => f.id === r.focusFileId) ? (r.focusFileId ?? null) : null,
    listenMode,
    outputs: { docComments: r.outputs?.docComments ?? defaults.outputs.docComments },
    provider,
    models: { ...defaults.models, ...known(r.models) },
    chatgptAccount: r.chatgptAccount ?? null,
    roles: { ...r.roles },
    screen: { ...defaults.screen, ...r.screen },
  };
}

/** The working file, if one is set and still connected. */
export function focusFile(s: Settings): FileRef | undefined {
  return s.focusFileId ? s.files.find((f) => f.id === s.focusFileId) : undefined;
}

export function transcriptFile(s: Settings): FileRef | undefined {
  const focus = focusFile(s);
  return (
    s.files.find((f) => f.id === s.transcriptFileId && f.kind === "doc") ??
    (focus?.kind === "doc" ? focus : undefined) ??
    s.files.find((f) => f.kind === "doc")
  );
}

/** Where screenshots and recordings go: the chosen file, else the first Slides, else the first Doc. */
export function captureFile(s: Settings): FileRef | undefined {
  return (
    s.files.find((f) => f.id === s.screen.targetFileId) ??
    focusFile(s) ??
    s.files.find((f) => f.kind === "slides") ??
    s.files.find((f) => f.kind === "doc") ??
    s.files[0]
  );
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[KEY]) cb(mergeSettings(changes[KEY].newValue as Record<string, unknown>));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
