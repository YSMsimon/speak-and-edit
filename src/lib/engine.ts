// The meeting engine: every finished caption line comes in here, and this decides
// what happens to it. It runs inside the side panel, one step at a time, so two
// writes never race each other on the same file.
//
//   mode     Commands: only "Scribe, …" lines.  Smart: the model judges every line.
//            Record: no model, every line goes to the Transcript section.
//   approval Auto: edits go straight into the file.  Manual ("Ask before writing"): Docs
//            edits become suggestions to accept; anything that can't be a suggestion
//            (Sheets, Slides, transcript lines, screenshots) waits in the panel for Approve.
//   control  "Scribe, switch to Smart mode" and the like change Scribe's own settings.
//   screen   Stills of the shared screen and recordings are saved to the user's Drive,
//            then added to a file. Docs and Slides copy a picture only from a public link,
//            so it is public for those few seconds and switched off right after.
//   meeting  One saved meeting per Meet call (sessions.ts): snapshot() and loadMeeting() let the
//            panel close and reopen without losing anything. Lines heard while it was closed come
//            back from the Meet tab (addMissed) and are never run as requests.
//   context  Each request gets the last 6 lines, plus older lines and a running summary that fit
//            about 10% of the model's window (ai/context.ts).

import { answerQuestion, confirmRequest, decideSmart, parseCommand, readScreen, summarizeMeeting, type AiModel, type Control, type Intent, type Usage } from "./ai/agent";
import { budgetFor, earlierBlock, knownWindow, linesToFold, lineText, RECENT_LINES, type Line } from "./ai/context";
import { modelFor, resolveProvider, visionModelFor } from "./ai/providers";
import { CREDIT_TEMPLATE, fillCredit, TRANSCRIPT_HEADING } from "./docs/plan";
import { normalizeError } from "./problems";
import type { AiJob, Feedback, Interaction } from "./interactions";
import { dataUrlToBlob, type DriveFile, type PublicLink } from "./drive";
import { KIND_LABEL, type FileKind, type FileRef } from "./files";
import type { Frame, MeetState } from "./messages";
import { captureFile, focusFile, transcriptFile, type ProviderId, type Settings } from "./settings";
import { NeedsChoice, squash, type ApplyResult, type FileContext, type LandAs, type Target, type WriteIntent } from "./targets/types";
import { detectWake, isResume, looksLikeControl } from "./wake";

/** A screenshot or recording waiting to be saved and added to a file. */
export interface PendingMedia {
  kind: "image" | "video";
  /** A data URL for stills, a Blob for recordings. */
  source: string | Blob;
  mimeType: string;
  fileName: string;
  width: number;
  height: number;
  caption: string;
  title: string;
  /** For the panel: a data URL of the still, or nothing for video. */
  preview?: string;
}

export interface RecordingDone {
  blob: Blob;
  mimeType: string;
  start: number;
  end: number;
  width: number;
  height: number;
  by: string;
  /** Time spent paused, left out of the length. */
  pausedMs?: number;
}

export interface Proposal {
  origin: "command" | "smart" | "screen";
  file: FileRef;
  write: WriteIntent;
  /** Smart mode's reason: decision, action_item, open_question, fact. */
  label?: string;
  quote: string;
  speaker: string;
  at: number;
  /** Set when this person may only comment: the edit is saved as a comment instead. */
  commentOnly?: string;
  /** A screenshot or recording to add. */
  media?: PendingMedia;
  /** The still the AI read, shown next to what it wrote. */
  seen?: string;
  /** What the AI couldn't read or left out, told to the room. */
  note?: string;
}

export type Action =
  | { kind: "pending"; step: string }
  | { kind: "skipped" }
  | { kind: "ignored"; reason: string }
  | { kind: "clarify"; question: string; options: string[]; command: string }
  | { kind: "answer"; answer: string }
  | { kind: "error"; message: string }
  | { kind: "proposal"; proposal: Proposal }
  | { kind: "discarded"; what: string }
  | { kind: "written"; proposal: Proposal; result: ApplyResult; decision?: "accepted" | "rejected"; warning?: string }
  | { kind: "transcript"; status: "waiting" | "queued" | "written" | "failed"; line: string; fileTitle: string; message?: string }
  /** The control tool ran: what was asked (params), what changed, what couldn't. */
  | { kind: "control"; params: Record<string, string>; done: string[]; failed: string[] };

export interface Entry {
  id: string;
  speaker: string;
  text: string;
  at: number;
  addressed: boolean;
  typed: boolean;
  /** Not a spoken line: a still of the shared screen, a finished recording, or a stretch Scribe heard nothing. */
  source?: "screen" | "recording" | "gap";
  /** Heard while the panel was closed: shown, kept, never run as a request. */
  missed?: boolean;
  action: Action;
}

/** The running summary of older lines, and the last line it covers. */
export interface MeetingSummary {
  text: string;
  through: string;
}

/** One meeting as saved in chrome.storage.local (sessions.ts). */
export interface SavedMeeting {
  v: 1;
  /** Also the start of every entry ID in it, so two meetings' IDs never collide. */
  id: string;
  code: string;
  title: string | null;
  startedAt: number;
  updatedAt: number;
  /** The last time Scribe knew you were in the call, and when you left it (null while in it). */
  lastInCall: number | null;
  leftAt: number | null;
  /** The end of the last "heard nothing" marker, so the same gap is never marked twice. */
  lastGapEnd: number | null;
  entries: Entry[];
  speakers: Record<string, number>;
  avatars: Record<string, string>;
  usage: Usage;
  summary: MeetingSummary | null;
  nextId: number;
}

export interface FileInfo {
  title?: string;
  parts: string[];
  error?: string;
}

export interface EngineState {
  meet: MeetState | null;
  entries: Entry[];
  partial: { speaker: string; text: string } | null;
  speakers: Record<string, number>;
  /** Speaker name → the photo Meet shows next to their captions. */
  avatars: Record<string, string>;
  /** You, from your Google account: your own lines use this name instead of Meet's "You". */
  self: { name: string; picture: string | null } | null;
  files: Record<string, FileInfo>;
  provider: ProviderId | null;
  providerError: string | null;
  usage: Usage;
}

/** Everything the engine touches outside itself, so tests can swap it out. */
export interface EngineDeps {
  settings: () => Settings;
  targets: Record<FileKind, Target>;
  appendTranscript: (file: FileRef, lines: string[]) => Promise<void>;
  model: (id: ProviderId, s: Settings) => AiModel;
  /** The model that reads the shared screen. */
  visionModel: (id: ProviderId, s: Settings) => AiModel;
  resolveProvider: (s: Settings) => Promise<ProviderId | null>;
  ai: {
    parseCommand: typeof parseCommand;
    decideSmart: typeof decideSmart;
    answerQuestion: typeof answerQuestion;
    readScreen: typeof readScreen;
    /** Folds older lines into the running summary. Without it, older lines are only trimmed. */
    summarizeMeeting?: typeof summarizeMeeting;
    /** Was a line that starts with a word like the wake word ("Subscribe!") really said to Scribe? */
    confirmRequest?: typeof confirmRequest;
  };
  /** The chosen model's context window in tokens. Defaults to what each provider is known to offer. */
  contextWindow?: (id: ProviderId, s: Settings) => Promise<number>;
  /** The AI log (interactions.ts): every model call, every outcome, every approve/reject/retry. */
  log?: (e: Interaction) => void;
  /** Saves a settings change (the control tool). */
  updateSettings: (patch: Partial<Settings>) => void;
  /** Things outside the engine that the control tool can switch. Each throws with a readable message. */
  control: {
    setListening: (paused: boolean) => Promise<void>;
    recording: (action: "start" | "stop" | "pause" | "resume") => Promise<string>;
    recordingState: () => "off" | "on" | "paused";
  };
  media: {
    /** A still of the shared screen. Throws with a readable message when there is none. */
    capture: () => Promise<Frame>;
    upload: (blob: Blob, name: string, mimeType: string) => Promise<DriveFile>;
    share: (driveId: string) => Promise<PublicLink>;
  };
  now: () => number;
  schedule: (fn: () => void, ms: number) => void;
}

export const defaultAi = { parseCommand, decideSmart, answerQuestion, readScreen, summarizeMeeting, confirmRequest };
export const defaultModel = modelFor;
export const defaultVisionModel = visionModelFor;
/** How long after a bare "Scribe," the same speaker's next line still counts as the request. */
const FOLLOW_UP_MS = 8000;

export const defaultResolve = (s: Settings) => resolveProvider(s.provider, s);

const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);
const MODE_LABEL: Record<Settings["listenMode"], string> = { commands: "Commands", smart: "Smart", record: "Record all" };
const stamp = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
};
const duration = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
const emptyWrite = (section: string | null = null, text: string | null = null): WriteIntent => ({
  action: "append",
  section,
  text,
  find: null,
  replaceWith: null,
  cells: [],
});
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const FILE_TTL = 60_000;
const TRANSCRIPT_DELAY = 3000;
const TRANSCRIPT_BATCH = 8;
/** A failed transcript line is sent again with the next batches, this many times. */
const TRANSCRIPT_TRIES = 3;
/** Shorter stretches out of the call aren't marked. */
const GAP_MIN_MS = 30_000;
/** After a failed summary, wait this long before trying again. */
const SUMMARY_BACKOFF_MS = 120_000;
const STOPPED = "Stopped when the panel closed.";

export class Engine {
  private state: EngineState = {
    meet: null,
    entries: [],
    partial: null,
    speakers: {},
    avatars: {},
    self: null,
    files: {},
    provider: null,
    providerError: null,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private nextId = 1;
  private fileCache = new Map<string, { at: number; ctx?: FileContext; error?: string }>();
  private transcriptQueue: { id: string; line: string; file: FileRef }[] = [];
  /** Someone said only "Scribe," and paused: their next line is the request. */
  /** maybe: the bare word only sounded like the wake word ("Subscribe!"), so the request gets checked. */
  private awaiting: { speaker: string; until: number; maybe?: boolean } | null = null;
  private flushScheduled = false;
  /** The meeting these lines belong to; null until the Meet code is known. */
  private meeting: { id: string; code: string; title: string | null; startedAt: number } | null = null;
  private lastInCall: number | null = null;
  private leftAt: number | null = null;
  private lastGapEnd: number | null = null;
  private wasInCall = false;
  private summary: MeetingSummary | null = null;
  private summarizing: Promise<void> | null = null;
  private summaryFailedAt = 0;
  private transcriptTries = new Map<string, number>();
  /** Goes up on every change worth saving, so the panel saves only when something changed. */
  private rev = 0;
  /** The line the current step works on, so AI calls in the log say which line they were for. */
  private working: string | null = null;

  constructor(private deps: EngineDeps) {
    if (deps.log) this.deps = { ...deps, ai: this.loggedAi(deps.ai, deps.log) };
  }

  /** Every AI call, in and out, with its time and any error, for the AI log. */
  private loggedAi(ai: EngineDeps["ai"], log: (e: Interaction) => void): EngineDeps["ai"] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrap = <F extends (...args: any[]) => Promise<any>>(job: AiJob, fn: F | undefined): F | undefined => {
      if (!fn) return undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (async (...args: any[]) => {
        const started = Date.now();
        const s = this.deps.settings();
        const provider = this.state.provider ?? s.provider;
        const base = {
          t: "ai" as const,
          at: this.deps.now(),
          meeting: this.meeting?.id ?? null,
          ...(this.working ? { entry: this.working } : {}),
          job,
          provider,
          model: s.models[provider] ?? null,
          input: args[1],
          ...(job === "summarizeMeeting" ? {} : { ctx: args[2] }),
        };
        try {
          const out = await fn(...args);
          const { usage, ...rest } = (out ?? {}) as { usage?: Usage };
          log({ ...base, output: rest, usage, ms: Date.now() - started });
          return out;
        } catch (e) {
          log({ ...base, error: message(e), ms: Date.now() - started });
          throw e;
        }
      }) as F;
    };
    return {
      ...ai,
      parseCommand: wrap("parseCommand", ai.parseCommand)!,
      decideSmart: wrap("decideSmart", ai.decideSmart)!,
      answerQuestion: wrap("answerQuestion", ai.answerQuestion)!,
      readScreen: wrap("readScreen", ai.readScreen)!,
      summarizeMeeting: wrap("summarizeMeeting", ai.summarizeMeeting),
      confirmRequest: wrap("confirmRequest", ai.confirmRequest),
    };
  }

  private logFeedback(id: string, action: Feedback, detail?: string) {
    this.deps.log?.({ t: "feedback", at: this.deps.now(), meeting: this.meeting?.id ?? null, entry: id, action, ...(detail ? { detail } : {}) });
  }

  /* ---------- store ---------- */

  getState = () => this.state;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    if ("entries" in patch || "speakers" in patch || "avatars" in patch || "usage" in patch) this.rev++;
    for (const fn of this.listeners) fn();
  }

  revision = () => this.rev;

  private newId() {
    return `${this.meeting?.id ?? "e"}.${this.nextId++}`;
  }

  private setAction(id: string, action: Action) {
    this.set({ entries: this.state.entries.map((e) => (e.id === id ? { ...e, action } : e)) });
    if (action.kind === "pending" || !this.deps.log) return;
    const e = this.entry(id);
    if (!e) return;
    this.deps.log({
      t: "outcome",
      at: this.deps.now(),
      meeting: this.meeting?.id ?? null,
      entry: id,
      speaker: e.speaker,
      text: e.text,
      mode: this.deps.settings().listenMode,
      kind: action.kind,
      ...(describeAction(action) ? { detail: describeAction(action) } : {}),
      ...(e.missed ? { missed: true } : {}),
      ...(e.typed ? { typed: true } : {}),
    });
  }

  private entry(id: string) {
    return this.state.entries.find((e) => e.id === id);
  }

  private addUsage(u: Usage) {
    const cur = this.state.usage;
    this.set({ usage: { inputTokens: cur.inputTokens + u.inputTokens, outputTokens: cur.outputTokens + u.outputTokens } });
  }

  /** Runs a step after every step before it, and turns a failure into an error card. */
  private enqueue(id: string | null, step: () => Promise<void>) {
    this.queue = this.queue.then(() => {
      this.working = id;
      return step();
    }).catch((e) => {
      if (id) this.setAction(id, { kind: "error", message: normalizeError(e) });
    });
  }

  /** Waits until every queued step has finished. Used by tests. */
  idle = () => this.queue;

  /* ---------- inputs ---------- */

  /**
   * The Meet tab's state. Leaving the call and coming back (or a closed tab and a new one)
   * leaves a marker for the stretch Scribe heard nothing, so nobody thinks it ignored them.
   */
  setMeet(meet: MeetState | null) {
    const now = this.deps.now();
    const inCall = !!meet && (meet.status === "in-call" || meet.status === "listening");
    if (inCall) {
      const joined = meet.joinedAt ?? now;
      let from = this.leftAt;
      // The tab knows when it left, which is later than what the panel last saw if it was closed meanwhile.
      if (meet.leftAt && meet.leftAt < joined && (from === null || meet.leftAt > from)) from = meet.leftAt;
      const fresh = this.lastGapEnd === null || joined > this.lastGapEnd;
      if (this.meeting && from !== null && from >= this.meeting.startedAt && fresh && joined - from >= GAP_MIN_MS) this.addGap(from, joined);
      this.leftAt = null;
      this.lastInCall = now;
    } else if (this.wasInCall) {
      this.leftAt = now;
    }
    this.wasInCall = inCall;
    // Meet shows the title a moment after the code.
    if (this.meeting && !this.meeting.title && meet?.title) this.meeting = { ...this.meeting, title: meet.title };
    this.set({ meet });
  }

  private addGap(from: number, to: number) {
    this.lastGapEnd = to;
    const entry: Entry = {
      id: this.newId(),
      speaker: "Scribe",
      text: `Scribe heard nothing from ${clock(from)} to ${clock(to)}.`,
      at: to,
      addressed: false,
      typed: false,
      source: "gap",
      action: { kind: "skipped" },
    };
    this.set({ entries: this.insertByTime(this.state.entries, [entry]) });
  }

  /** Puts entries where they belong by time; ties keep the order they came in. */
  private insertByTime(entries: Entry[], add: Entry[]): Entry[] {
    const out = [...entries];
    for (const e of add) {
      let i = out.length;
      while (i > 0 && out[i - 1]!.at > e.at) i--;
      out.splice(i, 0, e);
    }
    return out;
  }

  setPartial(partial: { speaker: string; text: string } | null) {
    this.set({ partial: partial ? { ...partial, speaker: this.who(partial.speaker) } : null });
  }

  /** Your name and photo from your Google account. */
  setSelf(self: { name: string; picture: string | null } | null) {
    const avatars = self?.picture ? { ...this.state.avatars, [self.name]: self.picture } : this.state.avatars;
    this.set({ self, avatars });
  }

  noteAvatar(speaker: string, url: string) {
    const name = this.who(speaker);
    if (this.state.avatars[name] !== url) this.set({ avatars: { ...this.state.avatars, [name]: url } });
  }

  /** Meet labels your own captions "You"; use your real name once Scribe knows it. */
  private who(speaker: string): string {
    return speaker === "You" && this.state.self ? this.state.self.name : speaker;
  }

  /** A finished caption line, or a request typed into the panel. */
  addLine(speaker: string, text: string, at: number, typed = false): string {
    const entry = this.pushLine(speaker, text, at, typed);
    this.enqueue(entry.id, () => this.handle(entry.id));
    this.maybeSummarize();
    return entry.id;
  }

  /**
   * Lines the Meet tab heard while the panel was closed. They're shown and kept, in time order,
   * but never run as requests: "Scribe, delete that" from ten minutes ago mustn't fire now.
   * In Record all they still go to the transcript, which is a record, not a request.
   */
  addMissed(lines: { speaker: string; text: string; at: number }[]) {
    const have = new Set(this.state.entries.map((e) => `${e.speaker}\u0000${e.at}\u0000${e.text}`));
    const add: Entry[] = [];
    const speakers = { ...this.state.speakers };
    for (const l of [...lines].sort((a, b) => a.at - b.at)) {
      const speaker = this.who(l.speaker);
      if (!l.text.trim() || have.has(`${speaker}\u0000${l.at}\u0000${l.text}`)) continue;
      add.push({ id: this.newId(), speaker, text: l.text, at: l.at, addressed: false, typed: false, missed: true, action: { kind: "skipped" } });
      speakers[speaker] = (speakers[speaker] ?? 0) + 1;
    }
    if (!add.length) return;
    this.set({ entries: this.insertByTime(this.state.entries, add), speakers });
    const s = this.deps.settings();
    if (s.listenMode === "record") {
      for (const e of add) {
        const w = detectWake(e.text, s.wakeWord);
        if ((s.roles[e.speaker] ?? s.defaultRole) !== "ignore" && !(w.addressed && looksLikeControl(w.command))) this.recordLine(e);
      }
    }
    this.maybeSummarize();
  }

  /* ---------- the saved meeting ---------- */

  meetingCode = () => this.meeting?.code ?? null;

  /**
   * A new meeting for this Meet code. Lines from before the code was known are kept;
   * lines from another meeting (already saved) are not.
   */
  beginMeeting(code: string, title: string | null) {
    const now = this.deps.now();
    const keep = this.meeting === null;
    this.meeting = { id: `m${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`, code, title, startedAt: now };
    this.lastInCall = this.wasInCall ? now : null;
    this.leftAt = null;
    this.lastGapEnd = null;
    this.summary = null;
    this.summaryFailedAt = 0;
    this.transcriptTries.clear();
    this.nextId = 1;
    if (!keep) {
      this.awaiting = null;
      this.set({ entries: [], speakers: {}, partial: null, usage: { inputTokens: 0, outputTokens: 0 } });
    } else {
      this.rev++;
    }
  }

  /**
   * A saved meeting, back in the panel. Work that was running when the panel closed is marked
   * stopped (spoken lines can be retried); waiting approvals and Docs suggestions come back as
   * they were; transcript lines that hadn't been written yet are sent again.
   */
  loadMeeting(m: SavedMeeting) {
    const carry = this.meeting === null ? this.state.entries : [];
    this.meeting = { id: m.id, code: m.code, title: m.title, startedAt: m.startedAt };
    this.nextId = Math.max(1, m.nextId);
    this.summary = m.summary ?? null;
    this.summaryFailedAt = 0;
    this.lastInCall = m.lastInCall;
    // The panel was closed, so as far as it knows, the meeting was last seen then.
    this.leftAt = m.leftAt ?? m.lastInCall;
    this.lastGapEnd = m.lastGapEnd;
    this.wasInCall = false;
    this.transcriptTries.clear();
    const restored = m.entries.map((e) => restoreEntry(e));
    const speakers = { ...m.speakers };
    for (const e of carry) if (!e.source) speakers[e.speaker] = (speakers[e.speaker] ?? 0) + 1;
    this.set({ entries: this.insertByTime(restored, carry), speakers, avatars: { ...m.avatars, ...this.state.avatars }, usage: m.usage });
    const file = transcriptFile(this.deps.settings());
    for (const e of restored) {
      if (e.action.kind !== "transcript" || e.action.status !== "queued") continue;
      if (file) this.queueTranscript(e.id, e.action.line, file);
      else this.setAction(e.id, { ...e.action, status: "failed", message: "No Doc to write the transcript to." });
    }
    // An in-call state that arrived before the meeting was loaded: check it for a gap now.
    if (this.state.meet) this.setMeet(this.state.meet);
  }

  /** "Delete saved meetings": the panel starts over, and the same call continues as a new, empty meeting. */
  clearMeeting() {
    const m = this.meeting;
    this.meeting = null;
    this.awaiting = null;
    this.set({ entries: [], speakers: {}, partial: null, usage: { inputTokens: 0, outputTokens: 0 } });
    if (m) this.beginMeeting(m.code, m.title);
  }

  /** What to save. Null until the Meet code is known. Pictures that were already saved to Drive are left out. */
  snapshot(): SavedMeeting | null {
    if (!this.meeting) return null;
    const now = this.deps.now();
    return {
      v: 1,
      ...this.meeting,
      updatedAt: now,
      lastInCall: this.wasInCall ? now : this.lastInCall,
      leftAt: this.leftAt,
      lastGapEnd: this.lastGapEnd,
      entries: this.state.entries.map(saveableEntry),
      speakers: this.state.speakers,
      avatars: this.state.avatars,
      usage: this.state.usage,
      summary: this.summary,
      nextId: this.nextId,
    };
  }

  private pushLine(rawSpeaker: string, text: string, at: number, typed: boolean, addressed = typed): Entry {
    const speaker = this.who(rawSpeaker);
    const entry: Entry = { id: this.newId(), speaker, text, at, addressed, typed, action: { kind: "pending", step: "Reading" } };
    this.set({
      entries: [...this.state.entries, entry],
      speakers: { ...this.state.speakers, [speaker]: (this.state.speakers[speaker] ?? 0) + 1 },
      partial: null,
    });
    return entry;
  }

  /**
   * A line said while listening is paused. Only "Scribe, resume" is acted on, here and
   * without the AI; everything else is dropped and never shown or sent anywhere.
   */
  pausedLine(rawSpeaker: string, text: string, at: number): string | null {
    const speaker = this.who(rawSpeaker);
    const s = this.deps.settings();
    const wake = detectWake(text, s.wakeWord);
    if (!(wake.addressed || wake.maybe) || !isResume(wake.command) || (s.roles[speaker] ?? s.defaultRole) === "ignore") return null;
    const entry = this.pushLine(speaker, text, at, false, true);
    this.enqueue(entry.id, () => this.applyControl(entry, { mode: null, file: null, approval: null, listening: "resume", recording: null }));
    return entry.id;
  }

  /** A still of the shared screen: from the Screenshot button, or a new slide while "Save each new slide" is on. */
  addScreen(frame: Frame, how: "button" | "auto"): string {
    const speaker = frame.presenter ?? "Shared screen";
    const text = how === "auto" ? "New slide on the shared screen" : "Screenshot of the shared screen";
    const entry = this.addSourceEntry(speaker, text, frame.at, "screen");
    this.enqueue(entry.id, async () => {
      const file = captureFile(this.deps.settings());
      if (!file) return this.setAction(entry.id, { kind: "error", message: "Connect a Google file in Outputs to save screenshots." });
      return this.gate(entry, { origin: "screen", file, write: emptyWrite(), quote: text, speaker, at: frame.at, media: this.imageMedia(frame) });
    });
    return entry.id;
  }

  /** The Screenshot button. */
  takeScreenshot() {
    this.enqueue(null, async () => {
      try {
        this.addScreen(await this.deps.media.capture(), "button");
      } catch (e) {
        const entry = this.addSourceEntry("Shared screen", "Screenshot", this.deps.now(), "screen");
        this.setAction(entry.id, { kind: "error", message: message(e) });
      }
    });
  }

  /** A finished recording of the Meet tab. */
  addRecording(r: RecordingDone): string {
    const took = duration(r.end - r.start - (r.pausedMs ?? 0));
    const entry = this.addSourceEntry(r.by, `Recorded ${took} of the call`, r.end, "recording");
    this.enqueue(entry.id, async () => {
      const file = captureFile(this.deps.settings());
      if (!file) return this.setAction(entry.id, { kind: "error", message: "Connect a Google file in Outputs to save recordings." });
      const ext = r.mimeType.includes("mp4") ? "mp4" : "webm";
      const media: PendingMedia = {
        kind: "video",
        source: r.blob,
        mimeType: r.mimeType.split(";")[0] ?? r.mimeType,
        fileName: `Scribe recording ${stamp(r.start)}.${ext}`,
        width: r.width,
        height: r.height,
        caption: `Recording ${clock(r.start)}–${clock(r.end)} (${took}), started by ${r.by}`,
        title: `Recording ${clock(r.start)}`,
      };
      return this.gate(entry, { origin: "screen", file, write: emptyWrite(), quote: entry.text, speaker: r.by, at: r.end, media });
    });
    return entry.id;
  }

  private addSourceEntry(speaker: string, text: string, at: number, source: "screen" | "recording"): Entry {
    const entry: Entry = { id: this.newId(), speaker, text, at, addressed: false, typed: false, source, action: { kind: "pending", step: "Saving" } };
    this.set({ entries: [...this.state.entries, entry] });
    return entry;
  }

  private imageMedia(frame: Frame): PendingMedia {
    const who = frame.presenter ? ` (${frame.presenter})` : "";
    return {
      kind: "image",
      source: frame.dataUrl,
      mimeType: "image/jpeg",
      fileName: `Scribe screenshot ${stamp(frame.at)}.jpg`,
      width: frame.width,
      height: frame.height,
      caption: `Shared screen, ${clock(frame.at)}${who}`,
      title: `Shared screen ${clock(frame.at)}`,
      preview: frame.dataUrl,
    };
  }

  answerClarify(id: string, choice: string) {
    const e = this.entry(id);
    if (!e || e.action.kind !== "clarify") return;
    const command = e.action.command;
    this.logFeedback(id, "answer", choice);
    this.setAction(id, { kind: "pending", step: "Rereading with your answer" });
    this.enqueue(id, () => this.runCommand(e, command, choice));
  }

  /** Manual approval: write what's waiting. */
  approve(id: string) {
    const e = this.entry(id);
    if (!e) return;
    const a = e.action;
    if (a.kind === "proposal" || (a.kind === "transcript" && a.status === "waiting")) this.logFeedback(id, "approve");
    if (a.kind === "proposal") {
      this.setAction(id, { kind: "pending", step: "Writing" });
      this.enqueue(id, () => this.commit(id, a.proposal));
    } else if (a.kind === "transcript" && a.status === "waiting") {
      const file = transcriptFile(this.deps.settings());
      if (file) this.queueTranscript(id, a.line, file);
    }
  }

  /** Runs a line that failed again, as if it had just been said. Screenshots and recordings can't be redone. */
  retry(id: string) {
    const e = this.entry(id);
    if (e?.action.kind === "transcript" && e.action.status === "failed") {
      const file = transcriptFile(this.deps.settings());
      if (file) {
        this.transcriptTries.delete(id);
        this.queueTranscript(id, e.action.line, file);
      }
      return;
    }
    if (!e || e.action.kind !== "error" || e.source) return;
    this.logFeedback(id, "retry", e.action.message);
    this.setAction(id, { kind: "pending", step: "Trying again" });
    this.enqueue(id, () => this.handle(id));
  }

  approveAll() {
    for (const e of this.state.entries) {
      if (e.action.kind === "proposal" || (e.action.kind === "transcript" && e.action.status === "waiting")) this.approve(e.id);
    }
  }

  discard(id: string) {
    const e = this.entry(id);
    if (!e) return;
    if (e.action.kind === "proposal" || (e.action.kind === "transcript" && e.action.status === "waiting")) this.logFeedback(id, "discard");
    if (e.action.kind === "proposal") this.setAction(id, { kind: "discarded", what: `${e.action.proposal.file.title}` });
    else if (e.action.kind === "transcript" && e.action.status === "waiting") this.setAction(id, { kind: "discarded", what: "Transcript" });
  }

  /** Accept or reject a Docs suggestion Scribe made. */
  decide(id: string, accept: boolean) {
    const e = this.entry(id);
    if (!e || e.action.kind !== "written" || e.action.result.status !== "waiting" || e.action.decision) return;
    const written = e.action;
    this.logFeedback(id, accept ? "accept" : "reject", `${written.result.where}: ${written.result.add}`);
    const target = this.deps.targets[written.proposal.file.kind];
    this.enqueue(null, async () => {
      try {
        if (!target.decide || !written.result.suggestionIds.length) throw new Error("No suggestion ID to act on. Accept or reject it in Google Docs.");
        await target.decide(written.proposal.file, written.result.suggestionIds, accept, { section: written.result.where, text: written.result.add });
        this.invalidate(written.proposal.file.id);
        this.setAction(id, { ...written, decision: accept ? "accepted" : "rejected" });
      } catch (err) {
        this.setAction(id, { ...written, warning: message(err) });
      }
    });
  }

  /* ---------- files ---------- */

  invalidate(fileId?: string) {
    if (fileId) this.fileCache.delete(fileId);
    else this.fileCache.clear();
  }

  /** Reads every connected file (or uses a fresh enough copy) and describes them for the model. */
  async describeFiles(fresh = false): Promise<string> {
    const s = this.deps.settings();
    const now = this.deps.now();
    const parts: string[] = [];
    const info: Record<string, FileInfo> = {};
    for (const f of s.files) {
      let c = this.fileCache.get(f.id);
      if (fresh || !c || now - c.at > FILE_TTL) {
        try {
          c = { at: now, ctx: await this.deps.targets[f.kind].describe(f) };
        } catch (e) {
          c = { at: now, error: message(e) };
        }
        this.fileCache.set(f.id, c);
      }
      const title = c.ctx?.title ?? f.title;
      info[f.id] = { title, parts: c.ctx?.parts ?? [], error: c.error };
      parts.push(c.ctx ? `File “${title}” (${KIND_LABEL[f.kind]})\n${c.ctx.text}` : `File “${f.title}” (${KIND_LABEL[f.kind]}): couldn’t read it (${c.error}).`);
    }
    this.set({ files: info });
    return parts.join("\n\n") || "(no files connected)";
  }

  async refreshFiles() {
    await this.describeFiles(true);
  }

  /** A connected file by (roughly) its title. */
  private matchFile(title: string): FileRef | undefined {
    const files = this.deps.settings().files;
    const want = squash(title);
    if (!want) return undefined;
    return (
      files.find((f) => squash(f.title) === want || squash(this.state.files[f.id]?.title ?? "") === want) ??
      files.find((f) => squash(f.title).includes(want) || want.includes(squash(f.title)))
    );
  }

  /** The named file, else the working file, else the first one. */
  private resolveFile(title: string | null, action: string): FileRef | undefined {
    const s = this.deps.settings();
    const focus = focusFile(s);
    const named = title ? this.matchFile(title) : undefined;
    if (action === "new_slide" && named?.kind !== "slides") {
      if (focus?.kind === "slides") return focus;
      return s.files.find((f) => f.kind === "slides") ?? named ?? focus ?? s.files[0];
    }
    return named ?? focus ?? s.files[0];
  }

  /* ---------- handling one line ---------- */

  private async model(): Promise<AiModel | null> {
    const s = this.deps.settings();
    const id = await this.deps.resolveProvider(s);
    if (!id) {
      this.set({ provider: null, providerError: "No AI is ready. Pick one in the AI model tab." });
      return null;
    }
    this.set({ provider: id, providerError: null });
    return this.deps.model(id, s);
  }

  private async vision(): Promise<AiModel | null> {
    const s = this.deps.settings();
    const id = await this.deps.resolveProvider(s);
    return id ? this.deps.visionModel(id, s) : null;
  }

  /** Scribe's settings in one line, for the model. */
  private stateLine(): string {
    const s = this.deps.settings();
    const focus = focusFile(s);
    const approval = s.approval === "auto" ? "auto (edits go straight in)" : "ask before writing";
    const file = focus ? `working file “${focus.title}”` : "no working file (Scribe picks per request)";
    const listening = this.state.meet?.paused ? "listening paused" : "listening";
    return `Scribe now: ${MODE_LABEL[s.listenMode]} mode, ${approval}, ${file}, ${listening}, video recording ${this.deps.control.recordingState()}.`;
  }

  private screenLine(): string | undefined {
    const screen = this.state.meet?.screen;
    return screen ? `${screen.presenter ?? "Someone"} is sharing their screen.` : undefined;
  }

  private recent(beforeId: string) {
    const idx = this.state.entries.findIndex((e) => e.id === beforeId);
    return this.state.entries.slice(Math.max(0, idx - RECENT_LINES), idx).map((e) => `${e.speaker}: ${e.text}`);
  }

  /** Lines before the last 6 (before `beforeId`, or before the end), newer than the summary. */
  private olderLines(beforeId?: string): Line[] {
    const all = this.state.entries;
    const end = beforeId ? all.findIndex((e) => e.id === beforeId) : all.length;
    const stop = Math.max(0, (end < 0 ? all.length : end) - RECENT_LINES);
    const from = this.summary ? all.findIndex((e) => e.id === this.summary!.through) + 1 : 0;
    return all.slice(Math.max(0, from), stop).map((e) => ({ id: e.id, speaker: e.speaker, text: e.text, at: e.at }));
  }

  /** Tokens for older lines and the summary, from the model in use. */
  private async budget(): Promise<number> {
    const s = this.deps.settings();
    const id = this.state.provider ?? (await this.deps.resolveProvider(s));
    if (!id) return 0;
    const window = this.deps.contextWindow ? await this.deps.contextWindow(id, s).catch(() => knownWindow(id, s.models[id] ?? "")) : knownWindow(id, s.models[id] ?? "");
    return budgetFor(window);
  }

  /** The "Earlier in the meeting" block for a request. */
  private async earlier(beforeId: string, query?: string): Promise<string> {
    const lines = this.olderLines(beforeId);
    if (!lines.length && !this.summary) return "";
    return earlierBlock(lines, { budget: await this.budget(), query, summary: this.summary?.text });
  }

  /**
   * In the background, never in a request's way: when the older lines no longer fit the budget,
   * the oldest are folded into the running summary. Record all uses no model, so it never runs there.
   */
  private maybeSummarize() {
    const summarize = this.deps.ai.summarizeMeeting;
    if (!summarize || this.summarizing || this.deps.now() - this.summaryFailedAt < SUMMARY_BACKOFF_MS) return;
    if (this.deps.settings().listenMode === "record" || this.state.meet?.paused) return;
    this.summarizing = (async () => {
      try {
        const budget = await this.budget();
        const fold = linesToFold(this.olderLines(), budget);
        if (!fold.length) return;
        const s = this.deps.settings();
        const id = await this.deps.resolveProvider(s);
        if (!id) return;
        const { summary, usage } = await summarize(this.deps.model(id, s), { previous: this.summary?.text ?? null, lines: fold.map(lineText) });
        this.addUsage(usage);
        if (summary) this.summary = { text: summary, through: fold[fold.length - 1]!.id };
        this.rev++;
      } catch {
        this.summaryFailedAt = this.deps.now();
      } finally {
        this.summarizing = null;
      }
    })();
  }

  /** Waits for a summary in progress. Used by tests. */
  summaryIdle = () => this.summarizing ?? Promise.resolve();

  /** Used by tests and the panel. */
  summaryText = () => this.summary?.text ?? null;

  private async handle(id: string) {
    const entry = this.entry(id);
    if (!entry) return;
    // Said while a pause request was still being worked out: Scribe is paused by the time this line's
    // turn comes, so treat it like anything said while paused. It's never shown or sent anywhere.
    if (this.state.meet?.paused && !entry.typed) return this.drop(id);
    const s = this.deps.settings();
    const role = s.roles[entry.speaker] ?? s.defaultRole;
    if (role === "ignore") return this.setAction(id, { kind: "skipped" });

    if (s.listenMode === "record" && !entry.typed) {
      // Record all writes lines as they are, except requests to change Scribe itself.
      const w = detectWake(entry.text, s.wakeWord);
      if (!((w.addressed || w.maybe) && looksLikeControl(w.command))) return this.recordLine(entry);
    }

    const wake = entry.typed ? { addressed: true, command: entry.text } : detectWake(entry.text, s.wakeWord);
    if (wake.wakeOnly) {
      this.awaiting = { speaker: entry.speaker, until: entry.at + FOLLOW_UP_MS, ...("maybe" in wake && wake.maybe ? { maybe: true } : {}) };
      return this.setAction(id, { kind: "skipped" });
    }
    const maybe = "maybe" in wake && wake.maybe === true;
    // "Scribe," … pause … "add Postgres 16 to decisions": the same speaker's next line is the request,
    // even if someone else says something in between.
    const follow = this.awaiting && entry.at <= this.awaiting.until && this.awaiting.speaker === entry.speaker ? this.awaiting : null;
    if (follow || wake.addressed || maybe || (this.awaiting && entry.at > this.awaiting.until)) this.awaiting = null;
    let command = wake.addressed || maybe ? wake.command : follow ? entry.text.trim() : null;
    // The name was only a sound-alike ("Subscribe! …", "Describe …"): one short AI call decides whether the
    // line asks Scribe to do something, or is ordinary talk that happens to start that way.
    if (command && (maybe || (!wake.addressed && follow?.maybe))) {
      const checked = await this.confirmed(entry, maybe ? entry.text : `${s.wakeWord}, ${command}`, command);
      if (checked === null) {
        if (s.listenMode === "smart" && words(entry.text) >= 3) return this.runSmart(entry);
        return this.setAction(id, { kind: "skipped" });
      }
      command = checked;
    }
    if (command) {
      this.set({ entries: this.state.entries.map((e) => (e.id === id ? { ...e, addressed: true } : e)) });
      return this.runCommand({ ...entry, addressed: true }, command);
    }
    // Smart mode needs no wake word, so short requests ("Take a screenshot.") count too.
    if (s.listenMode === "smart" && words(entry.text) >= 3) return this.runSmart(entry);
    this.setAction(id, { kind: "skipped" });
  }

  /**
   * The request to run, or null when the line wasn't for Scribe. Without a checker or a model,
   * the sound-alike counts, as it did before the check existed.
   */
  private async confirmed(entry: Entry, text: string, command: string): Promise<string | null> {
    const check = this.deps.ai.confirmRequest;
    if (!check) return command;
    this.setAction(entry.id, { kind: "pending", step: "Checking it was for Scribe" });
    const model = await this.model();
    if (!model) return null;
    try {
      const s = this.deps.settings();
      const { confirmation, usage } = await check(model, { speaker: entry.speaker, text, wakeWord: s.wakeWord }, { recent: this.recent(entry.id), files: s.files.map((f) => f.title) });
      this.addUsage(usage);
      // The person's own words run, not the AI's rewording: the credit line quotes them.
      return confirmation.forScribe ? command : null;
    } catch {
      // Unsure is not a request: nothing is changed on a guess.
      return null;
    }
  }

  /** Removes a line as if it was never heard. */
  private drop(id: string) {
    const entry = this.entry(id);
    if (!entry) return;
    const count = (this.state.speakers[entry.speaker] ?? 1) - 1;
    const speakers = { ...this.state.speakers };
    if (count > 0) speakers[entry.speaker] = count;
    else delete speakers[entry.speaker];
    this.set({ entries: this.state.entries.filter((e) => e.id !== id), speakers });
  }

  private recordLine(entry: Entry) {
    const s = this.deps.settings();
    const file = transcriptFile(s);
    if (!file) return this.setAction(entry.id, { kind: "error", message: "Connect a Google Doc in Outputs. Record mode writes to its Transcript section." });
    const line = `${entry.speaker} (${clock(entry.at)}): ${entry.text}`;
    if (s.approval === "manual") return this.setAction(entry.id, { kind: "transcript", status: "waiting", line, fileTitle: file.title });
    this.queueTranscript(entry.id, line, file);
  }

  private queueTranscript(id: string, line: string, file: FileRef) {
    this.transcriptQueue.push({ id, line, file });
    this.setAction(id, { kind: "transcript", status: "queued", line, fileTitle: file.title });
    if (this.transcriptQueue.length >= TRANSCRIPT_BATCH) {
      this.flushTranscript();
    } else if (!this.flushScheduled) {
      this.flushScheduled = true;
      this.deps.schedule(() => this.flushTranscript(), TRANSCRIPT_DELAY);
    }
  }

  /** Back online: transcript lines that failed get their tries back and go again. */
  retryTranscripts() {
    const failed = this.state.entries.filter((e) => e.action.kind === "transcript" && e.action.status === "failed");
    for (const e of failed) this.retry(e.id);
  }

  /**
   * Writes queued transcript lines in one batch per file. Lines that failed before go first,
   * a few times, so a dropped connection doesn't leave holes in the transcript.
   */
  flushTranscript() {
    this.flushScheduled = false;
    const queued = new Set(this.transcriptQueue.map((b) => b.id));
    const file = transcriptFile(this.deps.settings());
    const again = file
      ? this.state.entries
          .filter((e) => e.action.kind === "transcript" && e.action.status === "failed" && !queued.has(e.id) && (this.transcriptTries.get(e.id) ?? 0) < TRANSCRIPT_TRIES)
          .map((e) => ({ id: e.id, line: (e.action as { line: string }).line, file }))
      : [];
    const batch = [...again, ...this.transcriptQueue.splice(0)];
    if (!batch.length) return;
    this.enqueue(null, async () => {
      const byFile = new Map<string, typeof batch>();
      for (const b of batch) byFile.set(b.file.id, [...(byFile.get(b.file.id) ?? []), b]);
      for (const items of byFile.values()) {
        const file = items[0]!.file;
        try {
          await this.deps.appendTranscript(file, items.map((i) => i.line));
          this.invalidate(file.id);
          for (const i of items) {
            this.transcriptTries.delete(i.id);
            this.setAction(i.id, { kind: "transcript", status: "written", line: i.line, fileTitle: file.title });
          }
        } catch (e) {
          for (const i of items) {
            this.transcriptTries.set(i.id, (this.transcriptTries.get(i.id) ?? 0) + 1);
            this.setAction(i.id, { kind: "transcript", status: "failed", line: i.line, fileTitle: file.title, message: message(e) });
          }
        }
      }
    });
  }

  private async runCommand(entry: Entry, command: string, clarification?: string) {
    const s = this.deps.settings();
    if (!s.files.length) return this.setAction(entry.id, { kind: "error", message: "Connect a Google file in the Outputs tab first." });
    this.setAction(entry.id, { kind: "pending", step: "Reading your files" });
    const outline = await this.describeFiles(true);
    const model = await this.model();
    if (!model) return this.setAction(entry.id, { kind: "error", message: this.state.providerError ?? "No AI is ready." });

    this.setAction(entry.id, { kind: "pending", step: "Working out the request" });
    const ctx = { outline, recent: this.recent(entry.id), earlier: (await this.earlier(entry.id, command)) || undefined, screen: this.screenLine(), state: this.stateLine() };
    const { intent, usage } = await this.deps.ai.parseCommand(model, { speaker: entry.speaker, command, clarification }, ctx);
    this.addUsage(usage);
    await this.applyIntent(entry, command, intent, ctx, model);
  }

  private async applyIntent(entry: Entry, command: string, intent: Intent, ctx: { outline: string; recent: string[]; earlier?: string; screen?: string }, model: AiModel) {
    const writes = intent.action === "append" || intent.action === "replace" || intent.action === "new_slide" || intent.action === "comment";
    if (writes && intent.screen === "image") return this.screenshotCommand(entry, command, intent);
    if (writes && intent.screen === "read") return this.readCommand(entry, command, intent, ctx);
    switch (intent.action) {
      case "none":
        return this.setAction(entry.id, { kind: "ignored", reason: "Not a request about your files." });
      case "control":
        return this.applyControl(entry, intent.control);
      case "clarify":
        return this.setAction(entry.id, {
          kind: "clarify",
          question: intent.clarifyQuestion ?? "Which one did you mean?",
          options: intent.options.length ? intent.options : ["Skip it"],
          command,
        });
      case "question": {
        this.setAction(entry.id, { kind: "pending", step: "Looking it up" });
        const { answer, usage } = await this.deps.ai.answerQuestion(model, intent.text ?? command, ctx);
        this.addUsage(usage);
        return this.setAction(entry.id, { kind: "answer", answer });
      }
      default: {
        const file = this.resolveFile(intent.file, intent.action);
        if (!file) return this.setAction(entry.id, { kind: "error", message: "Connect a Google file in the Outputs tab first." });
        const write: WriteIntent = {
          action: intent.action,
          section: intent.section,
          text: intent.text,
          find: intent.find,
          replaceWith: intent.replaceWith,
          cells: intent.cells ?? [],
        };
        return this.gate(entry, { origin: "command", file, write, quote: command, speaker: entry.speaker, at: entry.at, commentOnly: this.commentOnly(entry) });
      }
    }
  }

  /** "Scribe, screenshot this into the deck." */
  private async screenshotCommand(entry: Entry, command: string, intent: Intent) {
    this.setAction(entry.id, { kind: "pending", step: "Taking a screenshot" });
    const frame = await this.deps.media.capture();
    const file = intent.file ? this.resolveFile(intent.file, intent.action) : captureFile(this.deps.settings());
    if (!file) return this.setAction(entry.id, { kind: "error", message: "Connect a Google file in the Outputs tab first." });
    return this.gate(entry, {
      origin: "command",
      file,
      write: emptyWrite(intent.section),
      quote: command,
      speaker: entry.speaker,
      at: entry.at,
      commentOnly: this.commentOnly(entry),
      media: this.imageMedia(frame),
    });
  }

  /** "Scribe, add this table to the sheet": the AI reads the shared screen and writes text. */
  private async readCommand(entry: Entry, command: string, intent: Intent, ctx: { outline: string; recent: string[] }) {
    this.setAction(entry.id, { kind: "pending", step: "Looking at the shared screen" });
    const frame = await this.deps.media.capture();
    const model = await this.vision();
    if (!model) return this.setAction(entry.id, { kind: "error", message: this.state.providerError ?? "No AI is ready." });
    this.setAction(entry.id, { kind: "pending", step: "Reading the shared screen" });
    let read;
    try {
      ({ read } = await this.deps.ai.readScreen(model, { speaker: entry.speaker, command, image: frame.dataUrl }, ctx).then((r) => {
        this.addUsage(r.usage);
        return r;
      }));
    } catch (e) {
      throw new Error(`Reading the screen failed: ${message(e)} Check that the model in AI model can see images.`);
    }
    if (read.action === "none") return this.setAction(entry.id, { kind: "answer", answer: read.note ?? "The shared screen doesn’t show that." });
    const file = this.resolveFile(read.file ?? intent.file, read.action);
    if (!file) return this.setAction(entry.id, { kind: "error", message: "Connect a Google file in the Outputs tab first." });
    const write: WriteIntent = {
      action: read.action,
      section: read.section ?? intent.section,
      text: read.text,
      find: read.find,
      replaceWith: read.replaceWith,
      cells: [],
      rows: read.rows,
    };
    return this.gate(entry, {
      origin: "command",
      file,
      write,
      quote: command,
      speaker: entry.speaker,
      at: entry.at,
      commentOnly: this.commentOnly(entry),
      seen: frame.dataUrl,
      note: read.note ?? undefined,
    });
  }

  private async runSmart(entry: Entry) {
    const s = this.deps.settings();
    if (!s.files.length) return this.setAction(entry.id, { kind: "skipped" });
    const model = await this.model();
    if (!model) return this.setAction(entry.id, { kind: "skipped" });
    this.setAction(entry.id, { kind: "pending", step: "Checking if this should be recorded" });
    const outline = await this.describeFiles(false);
    // Smart mode judges every line, so it gets only the short summary, not the older lines.
    const earlier = this.summary ? `Summary of what came before (Scribe's notes, not exact words):\n${this.summary.text}` : undefined;
    const { decision, usage } = await this.deps.ai.decideSmart(model, { speaker: entry.speaker, text: entry.text }, { outline, recent: this.recent(entry.id), earlier, state: this.stateLine() });
    this.addUsage(usage);
    if (decision.action === "none") return this.setAction(entry.id, { kind: "skipped" });
    if (decision.action === "request") {
      // "Can you take a screenshot?" in Smart mode: handled exactly like "Scribe, take a screenshot".
      this.set({ entries: this.state.entries.map((e) => (e.id === entry.id ? { ...e, addressed: true } : e)) });
      return this.runCommand({ ...entry, addressed: true }, entry.text.trim());
    }
    const file = this.resolveFile(decision.file, decision.action);
    if (!file) return this.setAction(entry.id, { kind: "skipped" });
    const write: WriteIntent = {
      action: decision.action,
      // Transcript is Record all's; Smart mode's notes go elsewhere (the doc's end, before Transcript).
      section: decision.section?.trim().toLowerCase() === TRANSCRIPT_HEADING.toLowerCase() ? null : decision.section,
      text: decision.text,
      find: decision.find,
      replaceWith: decision.replaceWith,
      cells: decision.cells ?? [],
    };
    return this.gate(entry, {
      origin: "smart",
      label: decision.label === "none" ? undefined : decision.label,
      file,
      write,
      quote: entry.text,
      speaker: entry.speaker,
      at: entry.at,
      commentOnly: this.commentOnly(entry),
    });
  }

  private commentOnly(entry: Entry): string | undefined {
    const s = this.deps.settings();
    return (s.roles[entry.speaker] ?? s.defaultRole) === "comment" ? `${entry.speaker} is set to comments only.` : undefined;
  }

  /** How a change lands: as a comment, a Docs suggestion, or directly. */
  private landAs(p: Proposal): LandAs {
    const s = this.deps.settings();
    if (p.commentOnly || s.commentsOnly) return "comment";
    if (s.approval === "manual" && p.file.kind === "doc" && !p.media) return "suggest";
    return "direct";
  }

  /**
   * Auto: write now, directly. Ask before writing: Docs edits go in as suggestions (accepted
   * in the panel or the doc); anything else that changes a file waits here for Approve.
   * Comments change no text, so they're added in both.
   */
  private async gate(entry: Entry, proposal: Proposal) {
    const landAs = this.landAs(proposal);
    const changesText = landAs !== "comment" && proposal.write.action !== "comment";
    if (this.deps.settings().approval === "manual" && changesText && landAs !== "suggest") {
      return this.setAction(entry.id, { kind: "proposal", proposal });
    }
    return this.commit(entry.id, proposal);
  }

  /** The control tool: change Scribe's mode, working file, approval, listening or recording. */
  private async applyControl(entry: Entry, c: Control | null) {
    const s = this.deps.settings();
    if ((s.roles[entry.speaker] ?? s.defaultRole) === "comment") {
      return this.setAction(entry.id, { kind: "error", message: `${entry.speaker} is set to comments only, so they can’t change Scribe’s settings.` });
    }
    const params: Record<string, string> = {};
    const done: string[] = [];
    const failed: string[] = [];
    const patch: Partial<Settings> = {};
    if (c?.mode) {
      params.mode = c.mode;
      patch.listenMode = c.mode;
      done.push(`Switched to ${MODE_LABEL[c.mode]} mode.`);
    }
    if (c?.file) {
      params.file = c.file;
      if (/^(any|all|none|auto|any file|all files)$/i.test(c.file.trim())) {
        patch.focusFileId = null;
        done.push("Scribe picks the file for each request.");
      } else {
        const f = this.matchFile(c.file);
        if (f) {
          patch.focusFileId = f.id;
          done.push(`Working on ${f.title}.`);
        } else {
          failed.push(`No connected file called “${c.file}”. Connected: ${s.files.map((x) => x.title).join(", ") || "none"}.`);
        }
      }
    }
    if (c?.approval) {
      params.approval = c.approval;
      patch.approval = c.approval === "auto" ? "auto" : "manual";
      done.push(c.approval === "auto" ? "Auto: edits go straight into the file." : "Ask before writing: Docs edits become suggestions, everything else waits for Approve.");
    }
    if (Object.keys(patch).length) this.deps.updateSettings(patch);
    if (c?.listening) {
      params.listening = c.listening;
      try {
        await this.deps.control.setListening(c.listening === "pause");
        done.push(c.listening === "pause" ? `Paused. Say “${s.wakeWord}, resume” to continue.` : "Listening again.");
      } catch (e) {
        failed.push(message(e));
      }
    }
    if (c?.recording) {
      params.recording = c.recording;
      try {
        done.push(await this.deps.control.recording(c.recording));
      } catch (e) {
        failed.push(message(e));
      }
    }
    if (!done.length && !failed.length) return this.setAction(entry.id, { kind: "ignored", reason: "It didn’t say what to change." });
    this.setAction(entry.id, { kind: "control", params, done, failed });
  }

  private async commit(id: string, p: Proposal) {
    const s = this.deps.settings();
    this.setAction(id, { kind: "pending", step: `Writing to ${p.file.title}` });
    const credit = fillCredit(CREDIT_TEMPLATE, { name: p.speaker, time: clock(p.at), quote: p.quote });
    const options = { landAs: this.landAs(p), credit, withCredit: s.outputs.docComments };
    const warnings = [p.commentOnly, p.note].filter(Boolean) as string[];
    let result: ApplyResult;
    try {
      result = p.media ? await this.commitMedia(id, p, options, warnings) : await this.deps.targets[p.file.kind].apply(p.file, p.write, options);
    } catch (e) {
      // "Which line did you mean?": ask with the file's real lines; the answer reruns the request.
      if (e instanceof NeedsChoice) return this.setAction(id, { kind: "clarify", question: e.question, options: e.options, command: p.quote });
      throw e;
    }
    if (result.warning) warnings.push(result.warning);
    this.invalidate(p.file.id);
    this.setAction(id, { kind: "written", proposal: p, result, warning: warnings.join(" ") || undefined });
  }

  /** Upload to Drive, share by link only while Google copies the picture, add it, switch the link off. */
  private async commitMedia(id: string, p: Proposal, options: { landAs: LandAs; credit: string; withCredit: boolean }, warnings: string[]): Promise<ApplyResult> {
    const m = p.media!;
    const target = this.deps.targets[p.file.kind];
    if (!target.insertMedia) throw new Error(`Scribe can’t add ${m.kind === "image" ? "screenshots" : "recordings"} to a ${KIND_LABEL[p.file.kind]}.`);
    this.setAction(id, { kind: "pending", step: "Saving to your Drive" });
    const blob = typeof m.source === "string" ? dataUrlToBlob(m.source) : m.source;
    const saved = await this.deps.media.upload(blob, m.fileName, m.mimeType);

    let link: PublicLink | null = null;
    // Only Docs and Slides copy a picture from a link; everything else links to Drive, so nothing goes public.
    if (m.kind === "image" && (p.file.kind === "doc" || p.file.kind === "slides") && options.landAs !== "comment") {
      try {
        link = await this.deps.media.share(saved.id);
      } catch (e) {
        warnings.push(`Couldn’t share the picture for Google to copy (${message(e)}).`);
      }
    }
    this.setAction(id, { kind: "pending", step: `Adding to ${p.file.title}` });
    let result: ApplyResult | null = null;
    let failure: unknown = null;
    try {
      result = await target.insertMedia(
        p.file,
        { kind: m.kind, driveId: saved.id, link: saved.link, width: m.width, height: m.height, caption: m.caption, title: m.title },
        p.write,
        options,
        link?.urls ?? null
      );
    } catch (e) {
      failure = e;
    }
    if (link) {
      try {
        await link.release();
      } catch (e) {
        warnings.push(`The picture is still public in Drive. Turn off link sharing for it: ${saved.link} (${message(e)})`);
      }
    }
    if (failure || !result) throw new Error([message(failure), ...warnings].join(" "));
    return { ...result, add: `${result.add} · ${saved.link}` };
  }
}

/** An entry as saved: pictures already in Drive are dropped, a recording waiting for approval can't be kept. */
function saveableEntry(e: Entry): Entry {
  const a = e.action;
  if (a.kind === "proposal") {
    const m = a.proposal.media;
    if (m && typeof m.source !== "string") return { ...e, action: { kind: "error", message: "This recording was waiting for approval when the panel closed and couldn't be kept. Record it again." } };
    return { ...e, action: { ...a, proposal: { ...a.proposal, seen: undefined, media: m ? { ...m, preview: undefined } : undefined } } };
  }
  if (a.kind === "written") {
    const m = a.proposal.media;
    return { ...e, action: { ...a, proposal: { ...a.proposal, seen: undefined, media: m ? { ...m, source: "", preview: undefined } : undefined } } };
  }
  return e;
}

/** An entry coming back from storage. */
function restoreEntry(e: Entry): Entry {
  const a = e.action;
  if (a.kind === "pending") return { ...e, action: { kind: "error", message: e.source ? STOPPED : `${STOPPED} Retry runs it again.` } };
  if (a.kind === "proposal" && a.proposal.media?.kind === "image" && typeof a.proposal.media.source === "string") {
    return { ...e, action: { ...a, proposal: { ...a.proposal, media: { ...a.proposal.media, preview: a.proposal.media.source } } } };
  }
  return e;
}

/** One line about what happened to a line, for the AI log. */
function describeAction(a: Action): string | undefined {
  switch (a.kind) {
    case "error":
      return a.message;
    case "ignored":
      return a.reason;
    case "answer":
      return a.answer;
    case "clarify":
      return `${a.question} [${a.options.join(" | ")}]`;
    case "proposal":
      return `${a.proposal.file.title} · ${a.proposal.write.action} · ${a.proposal.write.section ?? ""} · ${a.proposal.write.text ?? a.proposal.write.replaceWith ?? ""}`;
    case "written":
      return `${a.result.status} · ${a.proposal.file.title} › ${a.result.where} · ${a.result.add}${a.decision ? ` · ${a.decision}` : ""}`;
    case "transcript":
      return `${a.status} · ${a.fileTitle}${a.message ? ` · ${a.message}` : ""}`;
    case "control":
      return [...a.done, ...a.failed].join(" ");
    case "discarded":
      return a.what;
    default:
      return undefined;
  }
}
