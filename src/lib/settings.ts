// Settings live in chrome.storage.local: on this computer only, never synced.

import type { FileRef } from "./files";
import type { LandAs } from "./targets/types";

/**
 * Up front, with no API keys: the browser's built-in model, Ollama, or the user's own ChatGPT plan.
 * Under "Use your own API key" (v0.6): OpenRouter (one-click Connect) and keys for OpenAI, Anthropic, Gemini, Groq.
 */
export type ProviderId = "chrome" | "ollama" | "chatgpt" | "openrouter" | "anthropic" | "openai" | "gemini" | "groq";
export const BASIC_PROVIDERS: ProviderId[] = ["chrome", "ollama", "chatgpt"];
export const ADVANCED_PROVIDERS: ProviderId[] = ["openrouter", "anthropic", "openai", "gemini", "groq"];
export const PROVIDER_IDS: ProviderId[] = [...BASIC_PROVIDERS, ...ADVANCED_PROVIDERS];
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
  /** "Use your own API key" providers. Stored only in this browser and sent only to that provider. */
  keys: Partial<Record<ProviderId, string>>;
  ollamaUrl: string;
  roles: Record<string, Role>;
  defaultRole: Role;
  /** Shared screen: where screenshots and recordings go, and whether each new slide is saved by itself. */
  screen: { autoCapture: boolean; targetFileId: string | null };
  /** Models that can see images, per provider. Empty means the provider's normal model. */
  visionModels: Partial<Record<ProviderId, string>>;
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
  // The free option that scored best in the smoke test (39/40). ChatGPT takes over once signed in.
  provider: "ollama",
  models: {
    chrome: "text",
    ollama: "gpt-oss:120b-cloud",
    // Filled with the plan's first model at sign-in.
    chatgpt: "",
    openrouter: "openrouter/auto",
    anthropic: "claude-haiku-5-5",
    openai: "gpt-5-mini",
    gemini: "gemini-2.5-flash-lite",
    groq: "openai/gpt-oss-20b",
  },
  chatgptAccount: null,
  keys: {},
  ollamaUrl: "http://localhost:11434",
  roles: {},
  defaultRole: "edit",
  screen: { autoCapture: false, targetFileId: null },
  // gpt-oss can't see images; Gemma 4 can, and is free on Ollama's cloud.
  visionModels: { ollama: "gemma4:31b-cloud" },
  driveFolderId: null,
};

const KEY = "scribe.settings";

export async function loadSettings(): Promise<Settings> {
  const raw = (await chrome.storage.local.get(KEY))[KEY] as Record<string, unknown> | undefined;
  return mergeSettings(raw);
}

/** Fills defaults and upgrades settings saved by v0.1 (one doc, comments-only toggle). */
export function mergeSettings(raw: Record<string, unknown> | undefined): Settings {
  const r = (raw ?? {}) as Partial<Settings> & { docId?: string | null; docTitle?: string | null; mode?: string; autoComment?: boolean; landAs?: LandAs; creditTemplate?: string; slackWebhook?: string; shareWithClaude?: unknown };
  const files: FileRef[] = Array.isArray(r.files) ? r.files : r.docId ? [{ id: r.docId, kind: "doc", title: r.docTitle ?? "Google Doc" }] : [];
  // v0.2 had "How changes land": suggest / direct / comment. Only "comment" survives, as commentsOnly.
  const commentsOnly = r.commentsOnly ?? (r.landAs === "comment" || r.mode === "comment");
  const listenMode: ListenMode = r.listenMode ?? (r.autoComment ? "smart" : "commands");
  // Dropped in v0.5: the editable credit line and the Slack output.
  // Dropped: the editable credit line and the Slack output (v0.5), and "Share with Claude" (removed 2026-11-01).
  const { docId: _d, docTitle: _t, mode: _m, autoComment: _a, landAs: _l, creditTemplate: _c, slackWebhook: _w, shareWithClaude: _sc, ...rest } = r;
  const known = <T,>(o: Partial<Record<string, T>> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => (PROVIDER_IDS as string[]).includes(k))) as Partial<Record<ProviderId, T>>;
  // "auto" and the removed key providers fall back to the default.
  const provider: ProviderChoice = (PROVIDER_IDS as string[]).includes(r.provider ?? "") ? (r.provider as ProviderChoice) : DEFAULT_SETTINGS.provider;
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    files,
    commentsOnly,
    focusFileId: files.some((f) => f.id === r.focusFileId) ? (r.focusFileId ?? null) : null,
    listenMode,
    outputs: { docComments: r.outputs?.docComments ?? DEFAULT_SETTINGS.outputs.docComments },
    provider,
    models: { ...DEFAULT_SETTINGS.models, ...known(r.models) },
    chatgptAccount: r.chatgptAccount ?? null,
    keys: known(r.keys),
    roles: { ...r.roles },
    screen: { ...DEFAULT_SETTINGS.screen, ...r.screen },
    visionModels: { ...DEFAULT_SETTINGS.visionModels, ...known(r.visionModels) },
  };
}

/** The working file, if one is set and still connected. */
export function focusFile(s: Settings): FileRef | undefined {
  return s.focusFileId ? s.files.find((f) => f.id === s.focusFileId) : undefined;
}

export function transcriptFile(s: Settings): FileRef | undefined {
  const focus = focusFile(s);
  return (
    s.files.find((f) => f.id === s.transcriptFileId && (f.kind === "doc" || f.kind === "note")) ??
    (focus?.kind === "doc" || focus?.kind === "note" ? focus : undefined) ??
    s.files.find((f) => f.kind === "doc" || f.kind === "note")
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
