// Google Docs: suggestions (SUGGEST write mode), anchored comments, and the transcript section.

import { closestLines, describeOutline, findSection, findText, LINE_MATCH, type Outline, type Section } from "../docs/outline";
import { planEdit, sectionAnchor, TRANSCRIPT_HEADING, type EditIntent } from "../docs/plan";
import type { BatchUpdateResponse, DocRequest, Range, WriteControl } from "../docs/types";
import type { FileRef } from "../files";
import { clip, NeedsChoice, type ApplyOptions, type ApplyResult, type FileContext, type MediaInput, type Target, type WriteIntent } from "./types";

export interface DocsIO {
  fetchOutline: (docId: string) => Promise<Outline>;
  batchUpdate: (docId: string, requests: DocRequest[], wc?: WriteControl) => Promise<BatchUpdateResponse>;
  isRevisionConflict: (e: unknown) => boolean;
}

export { TRANSCRIPT_HEADING };
export const CAPTURES_HEADING = "Shared screen";
/** Content width of a Letter page with 1-inch margins. */
const IMAGE_WIDTH_PT = 468;

function proposedText(w: WriteIntent): string {
  if (w.action === "replace") return `Change “${w.find ?? ""}” to “${w.replaceWith ?? ""}”`;
  return w.text ?? "";
}

const shorten = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/**
 * The line a comment is about when the words don't match exactly (Meet misheard some). A clear winner gets
 * the comment; a close call asks the room, with the real lines as the choices. Exported for tests.
 */
export function lineFor(outline: Outline, phrase: string, section?: Section): Range {
  const ranked = closestLines(outline, phrase.replace(/…$/, ""), section);
  // Nothing in the named section: look through the whole doc.
  const pool = ranked.length || !section ? ranked : closestLines(outline, phrase.replace(/…$/, ""));
  const [best, next] = pool;
  if (best && best.score >= LINE_MATCH.sure && (!next || best.score - next.score >= LINE_MATCH.margin)) {
    const p = best.paragraph;
    return { startIndex: p.startIndex, endIndex: Math.max(p.startIndex + 1, p.endIndex - 1) };
  }
  const options = pool.filter((m) => m.score >= LINE_MATCH.possible).map((m) => shorten(m.paragraph.text.trim()));
  if (options.length) throw new NeedsChoice("Which line did you mean?", options);
  throw new Error(`Couldn’t find a line like “${shorten(phrase, 60)}” in the doc.`);
}

export function docsTarget(io: DocsIO): Target & { appendTranscript(file: FileRef, lines: string[]): Promise<void> } {
  async function comment(file: FileRef, outline: Outline, w: WriteIntent, o: ApplyOptions, note?: string): Promise<ApplyResult> {
    const section = findSection(outline, w.section);
    const range = (w.find ? (findText(outline, w.find, section) ?? lineFor(outline, w.find, section)) : null) ?? sectionAnchor(outline, w.section);
    if (!range) throw new Error("The doc is empty, so there’s nothing to comment on.");
    const body = w.action === "comment" ? (w.text ?? "") : `Proposed: ${proposedText(w)}`;
    const content = [body, o.credit].filter(Boolean).join("\n— ");
    const r = await io.batchUpdate(file.id, [{ insertComment: { content, range } }]);
    if (r.commentUpdateState === "ALL_FAILED_UNKNOWN_REASON") throw new Error("Docs didn’t save the comment.");
    return { where: section?.title ?? "the doc", add: body, status: "commented", suggestionIds: [], warning: note };
  }

  async function edit(file: FileRef, first: Outline, e: EditIntent, o: ApplyOptions): Promise<ApplyResult> {
    const suggest = o.landAs === "suggest";
    let outline = first;
    let plan = planEdit(outline, e);
    let response: BatchUpdateResponse | null = null;
    for (let attempt = 0; attempt < 3 && !response; attempt++) {
      if (attempt > 0) {
        outline = await io.fetchOutline(file.id);
        plan = planEdit(outline, e);
      }
      if (!plan.ok) throw new Error(plan.error);
      try {
        // A style change would be a second suggestion to accept; as a suggestion, the plain-text reset waits until it's accepted (decide).
        const requests = suggest ? plan.requests.filter((r) => !("updateTextStyle" in r)) : plan.requests;
        response = await io.batchUpdate(file.id, requests, { writeMode: suggest ? "SUGGEST" : "EDIT", requiredRevisionId: outline.revisionId });
      } catch (err) {
        // Someone typed in the doc since we read it: read again and recompute.
        if (io.isRevisionConflict(err)) continue;
        throw err;
      }
    }
    if (!response || !plan.ok) throw new Error("The doc kept changing. Try again.");

    const ids = (response.suggestionResponses ?? []).flatMap((r) => r.createdSuggestionIds ?? []);
    const warnings: string[] = [];
    if (suggest && !ids.length) warnings.push("Docs didn’t return a suggestion ID, so accept or reject it in the doc.");
    if (o.withCredit && o.credit) {
      try {
        // The credit goes in the suggestion's own thread when possible, otherwise on the new text.
        const req: DocRequest = ids[0]
          ? { addCommentReply: { suggestionId: ids[0], post: { content: o.credit } } }
          : { insertComment: { content: o.credit, range: plan.anchor } };
        const r = await io.batchUpdate(file.id, [req]);
        if (r.commentUpdateState === "ALL_FAILED_UNKNOWN_REASON") warnings.push("The credit comment didn’t save.");
      } catch (err) {
        warnings.push(`Credit comment failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return {
      where: plan.sectionTitle ?? "the doc",
      remove: plan.summary.remove,
      add: plan.summary.add,
      status: suggest ? "waiting" : "applied",
      suggestionIds: ids,
      warning: warnings.join(" ") || undefined,
    };
  }

  return {
    async describe(file): Promise<FileContext> {
      const outline = await io.fetchOutline(file.id);
      return { title: outline.title, text: clip(describeOutline(outline, 100_000), 2400), parts: outline.sections.map((s) => s.title) };
    },

    async apply(file, w, o) {
      const outline = await io.fetchOutline(file.id);
      if (w.action === "comment" || o.landAs === "comment") {
        return comment(file, outline, w, o);
      }
      if (w.action === "replace") {
        if (!w.find) throw new Error("The request didn’t say which text to change.");
        return edit(file, outline, { kind: "replace", section: w.section, find: w.find, replaceWith: w.replaceWith ?? "" }, o);
      }
      const text = w.text ?? (w.rows?.length ? w.rows.map((r) => r.map((c) => c.value).filter(Boolean).join(" — ")).join("\n") : w.cells.map((c) => c.value).join(", "));
      if (!text.trim()) throw new Error("Nothing to add.");
      return edit(file, outline, { kind: "append", section: w.section, text }, o);
    },

    async decide(file, suggestionIds, accept, added) {
      const requests: DocRequest[] = suggestionIds.map((suggestionId) =>
        accept ? { acceptSuggestion: { suggestionId } } : { rejectSuggestion: { suggestionId } }
      );
      await io.batchUpdate(file.id, requests);
      if (!accept || !added) return;
      // A suggestion added right under a heading can't carry its own "body text" style:
      // once accepted it comes out as another heading. Turn those lines back into body text.
      const after = await io.fetchOutline(file.id);
      const fix = [...headingsToFix(after, added.section, added.text), ...plainTextFix(after, added.section, added.text)];
      if (fix.length) await io.batchUpdate(file.id, fix, { writeMode: "EDIT" });
    },

    async insertMedia(file, m, w, o, publicUrls) {
      const outline = await io.fetchOutline(file.id);
      const label = m.kind === "image" ? "Screenshot" : "Recording";
      if (o.landAs === "comment") {
        const range = sectionAnchor(outline, w.section);
        if (!range) throw new Error("The doc is empty, so there’s nothing to comment on.");
        const content = [`${label}: ${m.caption}\n${m.link}`, o.withCredit ? o.credit : ""].filter(Boolean).join("\n— ");
        const r = await io.batchUpdate(file.id, [{ insertComment: { content, range } }]);
        if (r.commentUpdateState === "ALL_FAILED_UNKNOWN_REASON") throw new Error("Docs didn’t save the comment.");
        return { where: findSection(outline, w.section)?.title ?? "the doc", add: `${label}: ${m.caption}`, status: "commented", suggestionIds: [] };
      }

      // Try each public link in turn; Google sometimes can't fetch one form of Drive link.
      const uris: (string | null)[] = m.kind === "image" && publicUrls?.length ? publicUrls : [null];
      let lastError: unknown = null;
      for (const uri of uris) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const current = attempt === 0 ? outline : await io.fetchOutline(file.id);
          const plan = planMedia(current, w.section, m.caption, m.link, uri);
          try {
            await io.batchUpdate(file.id, plan.requests, { writeMode: "EDIT", requiredRevisionId: current.revisionId });
          } catch (err) {
            if (io.isRevisionConflict(err)) continue;
            lastError = err;
            break;
          }
          const warnings: string[] = [];
          if (o.landAs === "suggest") warnings.push(`${label}s are added directly, not as suggestions.`);
          if (m.kind === "image" && !uri) warnings.push("Added as a link, because the picture couldn’t be shared for Google to copy.");
          if (o.withCredit && o.credit) {
            const r = await io.batchUpdate(file.id, [{ insertComment: { content: o.credit, range: plan.captionRange } }]).catch(() => null);
            if (!r || r.commentUpdateState === "ALL_FAILED_UNKNOWN_REASON") warnings.push("The credit comment didn’t save.");
          }
          return { where: plan.where, add: `${label}: ${m.caption}`, status: "applied", suggestionIds: [], warning: warnings.join(" ") || undefined };
        }
      }
      const why = lastError instanceof Error ? lastError.message : "the doc kept changing";
      throw new Error(m.kind === "image" && publicUrls?.length ? `Google couldn’t copy the picture into the doc: ${why}` : `Couldn’t add it to the doc: ${why}`);
    },

    /** Writes caption lines under a "Transcript" heading, creating it at the end of the doc if needed. */
    async appendTranscript(file, lines) {
      if (!lines.length) return;
      for (let attempt = 0; attempt < 3; attempt++) {
        const outline = await io.fetchOutline(file.id);
        const requests = planTranscript(outline, lines);
        try {
          await io.batchUpdate(file.id, requests, { writeMode: "EDIT", requiredRevisionId: outline.revisionId });
          return;
        } catch (err) {
          if (io.isRevisionConflict(err)) continue;
          throw err;
        }
      }
      throw new Error("The doc kept changing. Try again.");
    },
  };
}

/** Requests that add transcript lines, plus the heading the first time. Exported for tests. */
export function planTranscript(outline: Outline, lines: string[]): DocRequest[] {
  const body = lines.map((l) => l.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean).join("\n");
  const section = findSection(outline, TRANSCRIPT_HEADING);
  const normal = (start: number, end: number): DocRequest => ({
    updateParagraphStyle: { range: { startIndex: start, endIndex: end }, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: "namedStyleType" },
  });
  if (section) {
    const after = section.paragraphs[section.paragraphs.length - 1] ?? section.heading;
    const index = after.endIndex - 1;
    const requests: DocRequest[] = [{ insertText: { location: { index }, text: `\n${body}` } }];
    if (after === section.heading) requests.push(normal(index + 1, index + 1 + body.length + 1));
    return requests;
  }
  const last = outline.paragraphs[outline.paragraphs.length - 1];
  const index = last ? last.endIndex - 1 : 1;
  const headStart = index + 1;
  const headEnd = headStart + TRANSCRIPT_HEADING.length + 1;
  return [
    { insertText: { location: { index }, text: `\n${TRANSCRIPT_HEADING}\n${body}` } },
    {
      updateParagraphStyle: {
        range: { startIndex: headStart, endIndex: headEnd },
        paragraphStyle: { namedStyleType: "HEADING_2" },
        fields: "namedStyleType",
      },
    },
    normal(headEnd, headEnd + body.length + 1),
  ];
}

/**
 * Requests that add a picture (or just a link) with a one-line caption: at the end of
 * the named section, else under a "Shared screen" heading at the end of the doc.
 * Exported for tests.
 */
export function planMedia(
  outline: Outline,
  section: string | null,
  caption: string,
  link: string,
  imageUri: string | null
): { requests: DocRequest[]; captionRange: Range; where: string } {
  const target = findSection(outline, section) ?? findSection(outline, CAPTURES_HEADING);
  const last = outline.paragraphs[outline.paragraphs.length - 1];
  const after = target ? (target.paragraphs[target.paragraphs.length - 1] ?? target.heading) : last;
  const index = after ? after.endIndex - 1 : 1;
  const needsHeading = !target;
  const text = caption.replace(/\s*\n\s*/g, " ").trim();

  // Layout after inserting at `index` (the new "\n" there closes the paragraph before):
  //   [heading]\n  [image]\n  caption\n(the old paragraph's newline)
  let cursor = index + 1;
  const first = cursor;
  const headingRange = { startIndex: cursor, endIndex: cursor + CAPTURES_HEADING.length + 1 };
  if (needsHeading) cursor = headingRange.endIndex;
  const imageAt = cursor;
  if (imageUri) cursor += 1;
  const captionStart = cursor;
  const captionEnd = captionStart + text.length;

  const inserted = `${needsHeading ? `\n${CAPTURES_HEADING}` : ""}${imageUri ? "\n" : ""}\n${text}`;
  const body = { startIndex: needsHeading ? headingRange.endIndex : first, endIndex: captionEnd + 1 };
  const requests: DocRequest[] = [
    { insertText: { location: { index }, text: inserted } },
    // New paragraphs copy the style of the one they split; make them plain, unbulleted text.
    { deleteParagraphBullets: { range: { startIndex: first, endIndex: captionEnd + 1 } } },
    { updateParagraphStyle: { range: body, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: "namedStyleType" } },
  ];
  if (needsHeading) {
    requests.push({ updateParagraphStyle: { range: headingRange, paragraphStyle: { namedStyleType: "HEADING_2" }, fields: "namedStyleType" } });
  }
  if (text) {
    requests.push({ updateTextStyle: { range: { startIndex: captionStart, endIndex: captionEnd }, textStyle: { italic: true, link: { url: link } }, fields: "italic,link" } });
  }
  // Last, so the indexes above don't move. The picture takes one index.
  if (imageUri) {
    requests.push({ insertInlineImage: { location: { index: imageAt }, uri: imageUri, objectSize: { width: { magnitude: IMAGE_WIDTH_PT, unit: "PT" } } } });
  }
  const shift = imageUri ? 1 : 0;
  return {
    requests,
    captionRange: { startIndex: captionStart + shift, endIndex: Math.max(captionStart + shift + 1, captionEnd + shift) },
    where: target?.title ?? CAPTURES_HEADING,
  };
}

/**
 * After accepting a suggestion: the added lines that sit right under the section's heading
 * but came out as headings themselves. Exported for tests.
 */
/**
 * After accepting a suggestion: clear italic, bold, underline and links that the added lines copied from
 * the text before them (an italic linked screenshot caption, say). Exported for tests.
 */
export function plainTextFix(outline: Outline, section: string, text: string): DocRequest[] {
  const s = findSection(outline, section);
  const lines = new Set(text.split("\n").map((l) => l.trim()).filter(Boolean));
  const paragraphs = s ? [...s.paragraphs] : outline.paragraphs;
  return paragraphs
    .filter((p) => p.headingLevel === 0 && lines.has(p.text.trim()) && p.endIndex - 1 > p.startIndex)
    .map((p) => ({ updateTextStyle: { range: { startIndex: p.startIndex, endIndex: p.endIndex - 1 }, textStyle: {}, fields: "bold,italic,underline,strikethrough,link" } }));
}

export function headingsToFix(outline: Outline, section: string, text: string): DocRequest[] {
  const s = findSection(outline, section);
  if (!s) return [];
  const lines = new Set(text.split("\n").map((l) => l.trim()).filter(Boolean));
  const start = outline.paragraphs.indexOf(s.heading);
  const out: DocRequest[] = [];
  for (const p of outline.paragraphs.slice(start + 1)) {
    if (p.headingLevel === 0 || !lines.has(p.text.trim())) break;
    out.push({ updateParagraphStyle: { range: { startIndex: p.startIndex, endIndex: p.endIndex }, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: "namedStyleType" } });
  }
  return out;
}
