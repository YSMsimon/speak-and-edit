// Messages between the Meet tab (content script) and the side panel.

export type MeetStatus = "loading" | "waiting" | "in-call" | "listening" | "ended" | "error";

export interface MeetState {
  status: MeetStatus;
  title: string | null;
  userName: string | null;
  paused: boolean;
  detail?: string;
  /** Someone is sharing their screen. presenter is null when Meet's label couldn't be read. */
  screen?: { presenter: string | null } | null;
  /** Saving each new slide of the shared screen by itself. */
  autoCapture?: boolean;
  /** The Meet code from the address (abc-defg-hij): which saved meeting this is. */
  code?: string | null;
  /** When this tab last joined the call, and last left it. */
  joinedAt?: number | null;
  leftAt?: number | null;
}

/** A finished line the Meet tab kept because the panel was closed. */
export interface MissedLine {
  speaker: string;
  text: string;
  at: number;
}

/** One still of the shared screen, as a JPEG data URL. */
export interface Frame {
  dataUrl: string;
  width: number;
  height: number;
  presenter: string | null;
  at: number;
}

export type CaptureReply = { ok: true; frame: Frame } | { ok: false; error: string };

export type ToPanel =
  | { type: "meet/state"; state: MeetState }
  | { type: "meet/partial"; speaker: string; text: string }
  | { type: "meet/clear-partial" }
  /** paused: said while listening is paused. The panel acts only on "Scribe, resume" then. */
  | { type: "meet/final"; speaker: string; text: string; at: number; paused?: boolean }
  /** The photo Meet shows next to a speaker's captions. Sent once per speaker, and again if it changes. */
  | { type: "meet/avatar"; speaker: string; url: string }
  | { type: "meet/screen"; frame: Frame };

export type ToMeet =
  | { type: "meet/get-state" }
  | { type: "meet/set-paused"; paused: boolean }
  | { type: "meet/capture" }
  | { type: "meet/set-auto-capture"; on: boolean }
  /** Hands over the lines heard while the panel was closed, and forgets them. Replies MissedLine[]. */
  | { type: "meet/take-missed" };
