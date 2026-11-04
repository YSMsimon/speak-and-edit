// Turns a parsed intent into Docs API requests. The model never chooses
// indexes; this code computes them from a fresh read of the doc.

import { findSection, findText, type Outline, type Para } from "./outline";
import type { DocRequest, Range } from "./types";

/** Record all's section. Nothing but transcript lines goes in it. */
export const TRANSCRIPT_HEADING = "Transcript";

export type EditIntent =
  | { kind: "append"; section: string | null; text: string }
  | { kind: "replace"; section: string | null; find: string; replaceWith: string };

export type Plan =
  | { ok: true; requests: DocRequest[]; anchor: Range; sectionTitle: string | null; summary: { remove?: string; add: string } }
  | { ok: false; error: string };

function lastParagraph(paragraphs: Para[]): Para | undefined {
  return paragraphs[paragraphs.length - 1];
}

export function planEdit(outline: Outline, intent: EditIntent): Plan {
  const section = findSection(outline, intent.section);
  if (intent.section && !section && intent.kind === "replace") {
    return { ok: false, error: `No section called “${intent.section}” in the doc.` };
  }

  if (intent.kind === "append") {
    // One paragraph per line, without bullet markers of their own: new lines inherit the list style.
    const text = intent.text
      .split(/\n+/)
      .map((l) => l.trim().replace(/^[-*•]\s+/, ""))
      .filter(Boolean)
      .join("\n");
    if (!text) return { ok: false, error: "Nothing to add." };
    // After the last body paragraph of the section, or after the heading itself. With no section, at the end of
    // the doc, but before Record all's Transcript section, which only ever holds what was said.
    const transcript = outline.paragraphs.findIndex((p) => p.headingLevel > 0 && p.text.trim() === TRANSCRIPT_HEADING);
    const beforeTranscript = transcript > 0 ? outline.paragraphs.slice(0, transcript) : outline.paragraphs;
    const after = section ? lastParagraph(section.paragraphs) ?? section.heading : lastParagraph(beforeTranscript) ?? lastParagraph(outline.paragraphs);
    if (!after) return { ok: false, error: "The doc is empty." };
    // Insert "\n<text>" just before the paragraph's own newline. The new paragraph
    // inherits that paragraph's style, so a bullet list stays a bullet list.
    const index = after.endIndex - 1;
    const anchor = { startIndex: index + 1, endIndex: index + 1 + text.length };
    const requests: DocRequest[] = [
      { insertText: { location: { index }, text: `\n${text}` } },
      // New text copies the style of the text before it, e.g. an italic linked screenshot caption.
      // Listing fields without values resets them, so the entry reads as plain text.
      { updateTextStyle: { range: { startIndex: anchor.startIndex, endIndex: anchor.endIndex }, textStyle: {}, fields: "bold,italic,underline,strikethrough,link" } },
    ];
    if (after.headingLevel > 0) {
      // Directly under a heading: make the new paragraph body text, not another heading.
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: anchor.startIndex, endIndex: anchor.endIndex + 1 },
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          fields: "namedStyleType",
        },
      });
    }
    return { ok: true, requests, anchor, sectionTitle: section?.title ?? null, summary: { add: text } };
  }

  // replace
  const found = findText(outline, intent.find, section);
  if (!found) {
    const where = section ? ` in ${section.title}` : "";
    return { ok: false, error: `Couldn’t find “${intent.find}”${where}.` };
  }
  const withText = intent.replaceWith.trim();
  const requests: DocRequest[] = [{ deleteContentRange: { range: found } }];
  if (withText) requests.push({ insertText: { location: { index: found.startIndex }, text: withText } });
  const original = intent.find.trim();
  return {
    ok: true,
    requests,
    anchor: { startIndex: found.startIndex, endIndex: found.startIndex + Math.max(withText.length, 1) },
    sectionTitle: section?.title ?? null,
    summary: { remove: original, add: withText },
  };
}

/** Where a plain comment about a section should be anchored: its heading text. */
export function sectionAnchor(outline: Outline, sectionTitle: string | null | undefined): Range | null {
  const s = findSection(outline, sectionTitle);
  const p = s?.heading ?? outline.paragraphs.find((x) => x.text.trim().length > 0);
  if (!p) return null;
  const end = Math.max(p.startIndex + 1, p.endIndex - 1); // leave out the newline
  return { startIndex: p.startIndex, endIndex: end };
}

/** The credit on every change: who asked, when, and their words. */
export const CREDIT_TEMPLATE = "{name}, {time}: “{quote}”";

export function fillCredit(template: string, v: { name: string; time: string; quote: string }): string {
  const out = template
    .replace(/\{name\}/g, v.name)
    .replace(/\{time\}/g, v.time)
    .replace(/\{quote\}/g, v.quote);
  // insertComment content must be 1–2048 UTF-8 code units.
  return new TextEncoder().encode(out).length > 2000 ? `${out.slice(0, 1900)}…` : out;
}
