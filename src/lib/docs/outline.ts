// Reads a Google Doc into paragraphs and heading-based sections.
// All indexes are the Docs API's UTF-16 indexes, which match JavaScript string indexes.

import type { GoogleDoc, Range } from "./types";

export interface Para {
  startIndex: number;
  endIndex: number; // exclusive; the paragraph's final "\n" sits at endIndex - 1
  text: string; // includes the trailing "\n"
  style: string; // namedStyleType, e.g. HEADING_2 or NORMAL_TEXT
  headingLevel: number; // 0 for body text
  bullet: boolean;
}

export interface Section {
  title: string;
  level: number;
  heading: Para;
  paragraphs: Para[]; // body paragraphs under this heading, before the next heading of the same or higher level
}

export interface Outline {
  documentId: string;
  title: string;
  revisionId?: string;
  paragraphs: Para[];
  sections: Section[];
}

const HEADING = /^(?:HEADING_(\d)|TITLE)$/;

export function headingLevel(style: string | undefined): number {
  if (!style) return 0;
  const m = HEADING.exec(style);
  if (!m) return 0;
  return m[1] ? Number(m[1]) : 0.5; // TITLE ranks above HEADING_1
}

export function buildOutline(doc: GoogleDoc): Outline {
  const paragraphs: Para[] = [];
  for (const el of doc.body?.content ?? []) {
    if (!el.paragraph || el.startIndex === undefined || el.endIndex === undefined) continue;
    const text = (el.paragraph.elements ?? []).map((e) => e.textRun?.content ?? "").join("");
    const style = el.paragraph.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT";
    paragraphs.push({
      startIndex: el.startIndex,
      endIndex: el.endIndex,
      text,
      style,
      headingLevel: headingLevel(style),
      bullet: Boolean(el.paragraph.bullet),
    });
  }

  const sections: Section[] = [];
  const open: Section[] = [];
  for (const p of paragraphs) {
    if (p.headingLevel > 0) {
      while (open.length && open[open.length - 1]!.level >= p.headingLevel) open.pop();
      const s: Section = { title: p.text.trim(), level: p.headingLevel, heading: p, paragraphs: [] };
      sections.push(s);
      open.push(s);
    } else {
      // Body text belongs to every heading still open above it.
      for (const s of open) s.paragraphs.push(p);
    }
  }
  return { documentId: doc.documentId, title: doc.title, revisionId: doc.revisionId, paragraphs, sections };
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Finds a section by title, tolerating case, punctuation and a little wording. */
export function findSection(outline: Outline, title: string | null | undefined): Section | undefined {
  if (!title) return undefined;
  const want = squash(title);
  if (!want) return undefined;
  return (
    outline.sections.find((s) => squash(s.title) === want) ??
    outline.sections.find((s) => squash(s.title).includes(want) || want.includes(squash(s.title)))
  );
}

/** Locates text inside one paragraph. Exact match first, then case-insensitive. */
export function findText(outline: Outline, phrase: string, section?: Section): Range | null {
  const needle = phrase.trim();
  if (!needle) return null;
  const pool = section ? [section.heading, ...section.paragraphs] : outline.paragraphs;
  for (const exact of [true, false]) {
    for (const p of pool) {
      const hay = exact ? p.text : p.text.toLowerCase();
      const at = hay.indexOf(exact ? needle : needle.toLowerCase());
      if (at >= 0) return { startIndex: p.startIndex + at, endIndex: p.startIndex + at + needle.length };
    }
  }
  return null;
}

/** Words of a line, lowercased, without punctuation or a transcript prefix like "Simon Y (17:55): ". */
function wordsOf(text: string): string[] {
  return text
    .replace(/^[^:\n]{1,40}\(\d{1,2}:\d{2}\):\s*/, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const pairsOf = (w: string[]) => w.slice(1).map((x, i) => `${w[i]} ${x}`);

export interface LineMatch {
  paragraph: Para;
  /** 0–1: half the share of the phrase's words in the line, half the share of its word pairs in order. */
  score: number;
}

/**
 * The doc's body lines ranked by how much of `phrase` they contain. For lines named out loud, where Meet's
 * captions may have misheard a few words ("She turn on Savage" for "sheet, turn on, save").
 */
export function closestLines(outline: Outline, phrase: string, section?: Section, limit = 3): LineMatch[] {
  const want = wordsOf(phrase);
  if (!want.length) return [];
  const wantPairs = pairsOf(want);
  const pool = (section ? section.paragraphs : outline.paragraphs).filter((p) => p.headingLevel === 0 && p.text.trim());
  return pool
    .map((paragraph) => {
      const have = wordsOf(paragraph.text);
      const words = new Set(have);
      const pairs = new Set(pairsOf(have));
      const uni = want.filter((w) => words.has(w)).length / want.length;
      const bi = wantPairs.length ? wantPairs.filter((x) => pairs.has(x)).length / wantPairs.length : uni;
      return { paragraph, score: Math.round((uni + bi) * 50) / 100 };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** A clear winner: good enough on its own and ahead of the runner-up. */
export const LINE_MATCH = { sure: 0.6, margin: 0.1, possible: 0.3 };

/** A compact text view of the doc for the model: headings and their text, trimmed to a budget. */
export function describeOutline(outline: Outline, maxChars = 2400): string {
  const lines: string[] = [];
  lines.push(outline.sections.length ? `Section titles: ${outline.sections.map((s) => s.title).join(" | ")}` : "(The doc has no headings.)");
  lines.push("");
  for (const p of outline.paragraphs) {
    const t = p.text.trim();
    if (!t) continue;
    if (p.headingLevel > 0) lines.push(`${"#".repeat(Math.max(1, Math.round(p.headingLevel)) + 1)} ${t}`);
    else lines.push(`${p.bullet ? "- " : ""}${t}`);
  }
  const out = lines.join("\n");
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n…(trimmed)` : out;
}
