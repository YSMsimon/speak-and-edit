// Overleaf projects: Scribe edits the .tex file open in the project's tab, through the page's own editor,
// so Overleaf saves and syncs the change like typing and collaborators see it live. Add under a \section,
// change text, comment as a "% [Scribe]" line, credit the same way. Overleaf's track changes is a paid
// feature, so "Ask before writing" holds changes in the panel, as for Sheets and Slides.
import type { FileRef } from "../files";
import { appendComment, appendTo, commentOn, describeTex, diffOne, replaceIn, type TexEdit } from "../latex/tex";
import type { PageWrite } from "../overleaf/page";
import type { ApplyOptions, ApplyResult, FileContext, MediaInput, Target, WriteIntent } from "./types";

export interface OverleafIO {
  read(projectId: string): Promise<{ text: string; file: string; tabId: number }>;
  write(tabId: number, file: string, before: string, change: { from: number; to: number; insert: string }): Promise<PageWrite>;
}

/** Project id from a FileRef id ("overleaf:6ae7…"). */
export const projectId = (f: FileRef) => f.id.replace(/^overleaf:/, "");

const rowText = (w: WriteIntent) =>
  w.text ??
  (w.rows?.length ? w.rows.map((r) => r.map((c) => `${c.column}: ${c.value}`).join(", ")).join("\n") : w.cells.map((c) => `${c.column}: ${c.value}`).join(", "));

export function overleafTarget(io: OverleafIO): Target {
  // One edit at a time per project; a change someone typed in between means read again and redo.
  const locks = new Map<string, Promise<unknown>>();
  function edit<T>(file: FileRef, fn: (text: string) => { text: string; out: T }): Promise<T> {
    const id = projectId(file);
    const run = (locks.get(id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const doc = await io.read(id);
        if (!/\.tex$/i.test(doc.file)) throw new Error(`“${doc.file || "This file"}” isn’t a .tex file. Open the .tex file you want Scribe to edit in the Overleaf tab.`);
        const { text, out } = fn(doc.text);
        const change = diffOne(doc.text, text);
        if (!change) return out;
        const res = await io.write(doc.tabId, doc.file, doc.text, change);
        if (res.ok) return out;
        if (res.reason === "other-file") throw new Error("Someone switched files in the Overleaf tab while Scribe was writing. Try again.");
        if (res.reason === "no-editor") throw new Error("The Overleaf editor closed while Scribe was writing. Try again.");
      }
      throw new Error("The Overleaf file kept changing while Scribe wrote. Try again.");
    });
    locks.set(id, run);
    return run as Promise<T>;
  }

  const result = (e: TexEdit, status: ApplyResult["status"]): ApplyResult => ({ where: e.where, add: e.added, ...(e.removed ? { remove: e.removed } : {}), status, suggestionIds: [] });

  return {
    async describe(file): Promise<FileContext> {
      const doc = await io.read(projectId(file));
      const d = describeTex(doc.text);
      return { title: file.title, text: `LaTeX file open: ${doc.file || "unknown"}\n${d.text}`, parts: d.parts };
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
          const e = replaceIn(t, w.section, w.find!, w.replaceWith ?? "", creditLine);
          return { text: e.text, out: result(e, "applied") };
        });
      }
      const text = rowText(w);
      return edit(file, (t) => {
        const e = appendTo(t, w.section, text, creditLine);
        return { text: e.text, out: result(e, "applied") };
      });
    },

    /** Overleaf can't take a picture from a link, so a screenshot or recording goes in as a "% [Scribe]" line with its Drive link. */
    async insertMedia(file, m: MediaInput, w, o) {
      const noun = m.kind === "image" ? "Screenshot" : "Recording";
      return edit(file, (t) => {
        const e = appendComment(t, w.section, `${noun}: ${m.caption} ${m.link}${o.withCredit ? ` (${o.credit})` : ""}`);
        return { text: e.text, out: { ...result(e, "applied"), add: `${noun} link, as a comment in the source` } };
      });
    },
  };
}
