// Obsidian notes (Markdown files in a vault folder): add under a heading, change text, comment as a callout,
// credit as a hidden %% comment %%, and Record all's Transcript. No suggestions: "Ask before writing"
// holds changes in the panel, as for Sheets and Slides.
import type { FileRef } from "../files";
import { appendTo, appendTranscript, commentOn, describeNote, ensureSection, replaceIn, type MdEdit } from "../notes/markdown";
import { readNote, writeNote } from "../notes/vault";
import type { ApplyOptions, ApplyResult, FileContext, MediaInput, Target, WriteIntent } from "./types";

export const SCREEN_HEADING = "Shared screen";

export interface NotesIO {
  /** The vault folder, with write permission. Throws a readable error when there is none. */
  root(): Promise<FileSystemDirectoryHandle>;
}

/** Note path from a FileRef id ("note:Meetings/2026-11-01 Weekly sync.md"). */
export const notePath = (f: FileRef) => f.id.replace(/^note:/, "");

const rowText = (w: WriteIntent) =>
  w.text ??
  (w.rows?.length ? w.rows.map((r) => r.map((c) => `${c.column}: ${c.value}`).join(", ")).join("\n") : w.cells.map((c) => `${c.column}: ${c.value}`).join(", "));

export function notesTarget(io: NotesIO): Target & { appendTranscript(file: FileRef, lines: string[]): Promise<void> } {
  // One edit at a time per note, so Record all's batches and requests never overwrite each other.
  const locks = new Map<string, Promise<unknown>>();
  async function edit<T>(file: FileRef, fn: (text: string) => { text: string; out: T }): Promise<T> {
    const path = notePath(file);
    const run = (locks.get(path) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const root = await io.root();
      const { text, out } = fn(await readNote(root, path));
      await writeNote(root, path, text);
      return out;
    });
    locks.set(path, run);
    return run;
  }

  const result = (e: MdEdit, status: ApplyResult["status"]): ApplyResult => ({ where: e.where, add: e.added, ...(e.removed ? { remove: e.removed } : {}), status, suggestionIds: [] });

  return {
    async describe(file): Promise<FileContext> {
      const text = await readNote(await io.root(), notePath(file));
      const d = describeNote(text);
      return { title: file.title, text: d.text, parts: d.parts };
    },

    async apply(file, w, o: ApplyOptions) {
      const creditLine = o.withCredit ? o.credit : undefined;
      if (w.action === "comment" || o.landAs === "comment") {
        const body = w.action === "comment" ? (w.text ?? "") : `Proposed: ${w.action === "replace" ? `change “${w.find ?? ""}” to “${w.replaceWith ?? ""}”` : rowText(w)}`;
        return edit(file, (t) => {
          const e = commentOn(t, w.section, w.find, body, creditLine);
          return { text: e.text, out: result(e, "commented") };
        });
      }
      if (w.action === "replace") {
        if (!w.find) throw new Error("The request didn’t say which text to change.");
        return edit(file, (t) => {
          const e = replaceIn(t, w.section, w.find!, w.replaceWith ?? "");
          // Credit for a change goes on its own hidden line right after the section's text.
          return { text: e.text, out: result(e, "applied") };
        });
      }
      const text = rowText(w);
      return edit(file, (t) => {
        const e = appendTo(t, w.section, text, creditLine);
        return { text: e.text, out: result(e, "applied") };
      });
    },

    async insertMedia(file, m: MediaInput, _w, o) {
      const noun = m.kind === "image" ? "Screenshot" : "Recording";
      return edit(file, (t) => {
        const withHeading = ensureSection(t, SCREEN_HEADING);
        const e = appendTo(withHeading, SCREEN_HEADING, `[${noun}: ${m.caption}](${m.link})`, o.withCredit ? o.credit : undefined);
        return { text: e.text, out: { ...result(e, "applied"), add: `${noun}: ${m.caption} · ${m.link}` } };
      });
    },

    async appendTranscript(file, lines) {
      await edit(file, (t) => ({ text: appendTranscript(t, lines), out: undefined }));
    },
  };
}
