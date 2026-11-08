// Overleaf projects: Scribe edits the .tex file open in the project's tab, through the page's own editor,
// so Overleaf saves and syncs the change like typing and collaborators see it live. Add under a \section,
// change text, credit on a "% [Scribe]" line. Comments are real Overleaf comments, made through Overleaf's
// own comment box (page.ts pageComment); if that box won't open, the comment becomes a "% [Scribe]" line. Overleaf's track changes is a paid
// feature, so "Ask before writing" holds changes in the panel, as for Sheets and Slides.
import type { FileRef } from "../files";
import { appendComment, appendTo, commentOn, commentRange, describeTex, diffOne, matchSourceLine, replaceIn, type TexEdit } from "../latex/tex";
import type { PageComment, PageWrite } from "../overleaf/page";
import type { ApplyOptions, ApplyResult, FileContext, LineHit, MediaInput, Target, WriteIntent } from "./types";

export interface OverleafIO {
  read(projectId: string): Promise<{ text: string; file: string; tabId: number }>;
  write(tabId: number, file: string, before: string, change: { from: number; to: number; insert: string }): Promise<PageWrite>;
  /** A real Overleaf comment on [from, to), through Overleaf's comment box. */
  comment?(tabId: number, file: string, before: string, range: { from: number; to: number }, text: string): Promise<PageComment>;
  /** The text on line n of the PDF preview, by its margin numbers. */
  pdfLine?(tabId: number, n: number): Promise<{ text: string; page: number } | { numbered: false } | null>;
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

  /** A real comment, one at a time per project like edits. Null when Overleaf's comment box wouldn't work. */
  function realComment(file: FileRef, section: string | null, find: string | null, text: string): Promise<{ where: string } | null> {
    const id = projectId(file);
    const run = (locks.get(id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const doc = await io.read(id);
        if (!/\.tex$/i.test(doc.file)) throw new Error(`“${doc.file || "This file"}” isn’t a .tex file. Open the .tex file you want Scribe to edit in the Overleaf tab.`);
        const range = commentRange(doc.text, section, find);
        let res: PageComment;
        try {
          res = await io.comment!(doc.tabId, doc.file, doc.text, range, text);
        } catch (e) {
          // The Overleaf page reloaded while Scribe was in it: read it again and retry.
          if (/frame|removed|no tab|cannot access/i.test(e instanceof Error ? e.message : String(e))) continue;
          throw e;
        }
        if (res.ok) return { where: range.where };
        if (res.reason === "changed") continue;
        if (res.reason === "other-file") throw new Error("Someone switched files in the Overleaf tab while Scribe was commenting. Try again.");
        return null;
      }
      throw new Error("The Overleaf file kept changing while Scribe commented. Try again.");
    });
    locks.set(id, run);
    return run;
  }

  const result = (e: TexEdit, status: ApplyResult["status"]): ApplyResult => ({ where: e.where, add: e.added, ...(e.removed ? { remove: e.removed } : {}), status, suggestionIds: [] });

  return {
    async lineRef(file, ref): Promise<LineHit | null> {
      const doc = await io.read(projectId(file));
      const source = (label: string): LineHit | null => {
        const text = doc.text.split("\n")[ref.n - 1];
        return text?.trim() ? { label, line: ref.n, text } : null;
      };
      if (ref.source) return source(`source line ${ref.n}`);
      const pdf = io.pdfLine ? await io.pdfLine(doc.tabId, ref.n).catch(() => null) : { numbered: false as const };
      // The PDF shows no line numbers, or isn't open: people mean the editor's numbers.
      if (pdf && "numbered" in pdf) return source(`line ${ref.n} of the editor (the PDF has no line numbers)`);
      if (!pdf) return null;
      const match = matchSourceLine(doc.text, pdf.text);
      return { label: `line ${ref.n} of the PDF`, pdfText: pdf.text, ...(match ? { line: match.line, text: match.text } : {}) };
    },

    async describe(file): Promise<FileContext> {
      const doc = await io.read(projectId(file));
      const d = describeTex(doc.text);
      return { title: file.title, text: `LaTeX file open: ${doc.file || "unknown"}\n${d.text}`, parts: d.parts };
    },

    async apply(file, w, o: ApplyOptions) {
      const creditLine = o.withCredit ? o.credit : undefined;
      if (w.action === "comment" || o.landAs === "comment") {
        const body = w.action === "comment" ? (w.text ?? "") : `Proposed: ${w.action === "replace" ? `change “${w.find ?? ""}” to “${w.replaceWith ?? ""}”` : rowText(w)}`;
        // A real Overleaf comment, on the words it's about (a proposed change: on the text it would change).
        const anchor = w.action === "replace" ? w.find : w.action === "comment" ? w.find : null;
        let warning: string | undefined;
        if (io.comment) {
          const posted = await realComment(file, w.section, anchor, creditLine ? `${body} — ${creditLine}` : body);
          if (posted) return { where: posted.where, add: body, status: "commented", suggestionIds: [] };
          warning = "Overleaf’s comment box didn’t open, so the comment is a “% [Scribe]” line in the source instead.";
        }
        const out = await edit(file, (t) => {
          const e = commentOn(t, w.section, w.find, body, creditLine);
          return { text: e.text, out: result(e, "commented") };
        });
        return warning ? { ...out, warning } : out;
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
