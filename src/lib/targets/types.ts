// What every file type (Docs, Sheets, Slides) offers the engine.

import type { FileRef } from "../files";

/** One change, as the model or the user asked for it. File-type neutral. */
export interface WriteIntent {
  action: "append" | "replace" | "comment" | "new_slide";
  /** Docs: heading. Sheets: tab name. Slides: slide title or number. */
  section: string | null;
  text: string | null;
  find: string | null;
  replaceWith: string | null;
  /** Sheets: column → value pairs for a row or a cell. */
  cells: { column: string; value: string }[];
  /** Sheets: several rows at once, e.g. a table read off the shared screen. */
  rows?: { column: string; value: string }[][];
}

/** A screenshot or recording already uploaded to the user's Drive. */
export interface MediaInput {
  kind: "image" | "video";
  driveId: string;
  /** Private Drive link to the original. */
  link: string;
  width: number;
  height: number;
  /** One line under the picture, or the link text: "Shared screen, 14:32 (Priya)". */
  caption: string;
  /** Short title for a new slide. */
  title: string;
}

export type LandAs = "suggest" | "direct" | "comment";

/** The request named something Scribe can't pin down on its own (which line?). The room picks from real options. */
export class NeedsChoice extends Error {
  constructor(
    readonly question: string,
    readonly options: string[]
  ) {
    super(question);
  }
}

export interface ApplyOptions {
  landAs: LandAs;
  /** The credit line, e.g. "Sarah Chen, 14:21: “add Postgres…”". */
  credit: string;
  /** Write the credit next to the change (Docs comment thread, Sheets note, Slides speaker notes). */
  withCredit: boolean;
}

export interface ApplyResult {
  where: string;
  remove?: string;
  add: string;
  /** waiting = a Docs suggestion someone still has to accept. */
  status: "waiting" | "applied" | "commented";
  suggestionIds: string[];
  warning?: string;
}

export interface FileContext {
  /** Text the model reads to understand the file. */
  text: string;
  /** Section titles, tab names or slide titles, for the panel. */
  parts: string[];
  title: string;
}

export interface Target {
  describe(file: FileRef): Promise<FileContext>;
  apply(file: FileRef, w: WriteIntent, o: ApplyOptions): Promise<ApplyResult>;
  /** Accept or reject Docs suggestions. Other file types have none. */
  decide?(file: FileRef, suggestionIds: string[], accept: boolean, added?: { section: string; text: string }): Promise<void>;
  /**
   * Adds a screenshot or recording. publicUrls are temporary public links to the image
   * (Docs and Slides can only copy a picture from one); null means link to it instead.
   */
  insertMedia?(file: FileRef, m: MediaInput, w: WriteIntent, o: ApplyOptions, publicUrls: string[] | null): Promise<ApplyResult>;
  /** "Line 12" in a request: what's on that line, by the PDF's margin numbers or ("source line 12") the source. Overleaf only. */
  lineRef?(file: FileRef, ref: { n: number; source: boolean }): Promise<LineHit | null>;
}

export interface LineHit {
  /** "line 12 of the PDF" or "source line 12". */
  label: string;
  /** What the PDF shows on that line, when it came from the PDF. */
  pdfText?: string;
  /** The source line it is (1-based) and its text, when found. */
  line?: number;
  text?: string;
}

export const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…(trimmed)` : s;
}
