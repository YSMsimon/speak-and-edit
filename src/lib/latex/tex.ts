// Editing a LaTeX file (the one open in an Overleaf tab) as text. \section, \subsection and friends are
// sections, like Docs headings. Pure functions; lib/targets/overleaf.ts applies the result to the editor.

export interface TexSection {
  title: string;
  level: number;
  /** Line index of the \section line. */
  line: number;
  /** Line index where the section ends: the next section of the same or higher level, \end{document}, or the end. */
  end: number;
}

const LEVELS: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5 };
const SECTION = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{(.*)\}\s*(?:%.*)?$/;
const END_DOC = /^\s*\\end\{document\}/;
const BACKMATTER = /^\s*\\(bibliography|bibliographystyle|printbibliography|appendix)\b/;

export function sections(text: string): TexSection[] {
  const lines = text.split("\n");
  const found: TexSection[] = [];
  let endDoc = lines.length;
  lines.forEach((l, i) => {
    if (END_DOC.test(l) && endDoc === lines.length) endDoc = i;
    const m = SECTION.exec(l);
    if (m && i < endDoc) found.push({ title: m[2]!.trim(), level: LEVELS[m[1]!]!, line: i, end: endDoc });
  });
  for (let i = 0; i < found.length; i++) {
    const next = found.slice(i + 1).find((s) => s.level <= found[i]!.level);
    found[i]!.end = next ? next.line : endDoc;
    // Keep \bibliography and \appendix out of the last section.
    for (let j = found[i]!.line + 1; j < found[i]!.end; j++) {
      if (BACKMATTER.test(lines[j]!)) {
        found[i]!.end = j;
        break;
      }
    }
  }
  return found;
}

const norm = (s: string) => s.toLowerCase().replace(/\\[a-z]+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function findSection(text: string, title: string | null): TexSection | undefined {
  if (!title) return undefined;
  const all = sections(text);
  return all.find((s) => s.title === title) ?? all.find((s) => norm(s.title) === norm(title));
}

/** Makes plain words safe in LaTeX: & % $ # _ { } ~ ^ \\ are escaped. Already-escaped text is left alone. */
export function escapeTex(s: string): string {
  return s
    .replace(/\\(?![&%$#_{}~^])/g, "\\textbackslash{}")
    .replace(/(?<!\\)([&%$#_{}])/g, "\\$1")
    .replace(/(?<!\\)~/g, "\\textasciitilde{}")
    .replace(/(?<!\\)\^/g, "\\textasciicircum{}");
}

/** A LaTeX comment line: in the source, never in the PDF. Used for credit and for Scribe's comments. */
export const texComment = (s: string) => `% [Scribe] ${s.replace(/\n+/g, " ")}`;

export interface TexEdit {
  text: string;
  where: string;
  added: string;
  removed?: string;
}

function bodyStart(lines: string[]): number {
  const i = lines.findIndex((l) => /^\s*\\begin\{document\}/.test(l));
  return i < 0 ? 0 : i + 1;
}

/** The last line of a section that holds text, so new text goes right after it, before blank lines. */
function lastContent(lines: string[], from: number, to: number): number {
  let at = to;
  while (at > from && lines[at - 1]!.trim() === "") at--;
  return at;
}

/**
 * Adds a paragraph at the end of a section, or at the end of the document (before \bibliography and
 * \end{document}) when none is named. Inside an itemize, each line becomes an \item.
 */
export function appendTo(text: string, section: string | null, add: string, creditLine?: string): TexEdit {
  const lines = text.split("\n");
  const s = findSection(text, section);
  let end: number;
  if (s) end = s.end;
  else {
    const all = sections(text);
    end = all.length ? all[all.length - 1]!.end : lines.findIndex((l) => END_DOC.test(l));
    if (end < 0) end = lines.length;
  }
  const at = lastContent(lines, s ? s.line + 1 : bodyStart(lines), end);
  const prev = lines[at - 1] ?? "";
  const items = add
    .split(/\n+/)
    .map((l) => l.trim().replace(/^[-*•]\s+/, ""))
    .filter(Boolean)
    .map(escapeTex);
  if (!items.length) throw new Error("Nothing to add.");
  // In a list that's still open at that point, add \item lines inside it.
  const openList = /^\s*\\end\{(itemize|enumerate)\}/.test(prev);
  let insertAt = at;
  let newLines: string[];
  if (openList) {
    insertAt = at - 1;
    const indent = (lines.slice(0, insertAt).reverse().find((l) => /\\item\b/.test(l)) ?? "  \\item").match(/^\s*/)![0];
    newLines = items.map((t) => `${indent}\\item ${t}`);
  } else {
    // A new paragraph: a blank line before it unless the section has no text yet.
    const sectionEmpty = s ? at === s.line + 1 : false;
    newLines = [...(sectionEmpty || prev.trim() === "" ? [] : [""]), ...items];
  }
  if (creditLine) newLines.push((openList ? newLines[newLines.length - 1]!.match(/^\s*/)![0] : "") + texComment(creditLine));
  lines.splice(insertAt, 0, ...newLines);
  return { text: lines.join("\n"), where: s?.title ?? "the document", added: items.join("\n") };
}

/** Replaces text found in the section (or the document body). Exact first, then ignoring case. */
export function replaceIn(text: string, section: string | null, find: string, withText: string, creditLine?: string): TexEdit {
  const lines = text.split("\n");
  const s = findSection(text, section);
  const from = s ? s.line + 1 : bodyStart(lines);
  const to = s ? s.end : lines.length;
  const replacement = escapeTex(withText);
  // The room says "30%"; the source says "30\%". Try the words as said, then as LaTeX writes them.
  const needles = [...new Set([find, escapeTex(find)])];
  for (const exact of [true, false]) {
    for (const needle of needles) {
      for (let i = from; i < to; i++) {
        if (/^\s*%/.test(lines[i]!)) continue;
        const at = exact ? lines[i]!.indexOf(needle) : lines[i]!.toLowerCase().indexOf(needle.toLowerCase());
        if (at < 0) continue;
        const line = lines[i]!;
        lines[i] = line.slice(0, at) + replacement + line.slice(at + needle.length);
        if (creditLine) lines.splice(i + 1, 0, texComment(creditLine));
        return { text: lines.join("\n"), where: s?.title ?? "the document", added: replacement, removed: line.slice(at, at + needle.length) };
      }
    }
  }
  throw new Error(`Couldn’t find “${find}”${s ? ` in ${s.title}` : ""}.`);
}

/** A comment on a line: a % [Scribe] line right under it. In the source only, never in the PDF. */
export function commentOn(text: string, section: string | null, find: string | null, comment: string, creditLine?: string): TexEdit {
  const lines = text.split("\n");
  const s = findSection(text, section);
  const from = s ? s.line + 1 : bodyStart(lines);
  const to = s ? s.end : lines.length;
  let at = -1;
  if (find) {
    const needles = [...new Set([find, escapeTex(find)])].map((n) => n.toLowerCase());
    for (let i = from; i < to && at < 0; i++) if (!/^\s*%/.test(lines[i]!) && needles.some((n) => lines[i]!.toLowerCase().includes(n))) at = i;
    if (at < 0) throw new Error(`Couldn’t find “${find}”${s ? ` in ${s.title}` : ""}.`);
  } else at = s ? s.line : Math.max(from - 1, 0);
  // Indented like the line it's about, so it reads as part of that line (an \item in a list, say).
  const indent = find ? lines[at]!.match(/^\s*/)![0] : "";
  lines.splice(at + 1, 0, indent + texComment(`${comment}${creditLine ? ` (${creditLine})` : ""}`));
  // Say exactly where the "% [Scribe]" line went: it's in the source only, never in the PDF or Overleaf's comment panel.
  const line = `line ${at + 2}`;
  const where = s ? `${s.title}, ${line}` : find ? line : `${line}, right after \\begin{document}`;
  return { text: lines.join("\n"), where, added: comment };
}

/**
 * The text a real Overleaf comment anchors to: the words it's about (found like commentOn finds them),
 * else the section's heading line, else the first line of the document's body. Character offsets.
 */
export function commentRange(text: string, section: string | null, find: string | null): { from: number; to: number; line: number; where: string } {
  const lines = text.split("\n");
  const s = findSection(text, section);
  const from = s ? s.line + 1 : bodyStart(lines);
  const to = s ? s.end : lines.length;
  const offset = (i: number) => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
  if (find) {
    for (const needle of [...new Set([find, escapeTex(find)])]) {
      for (let i = from; i < to; i++) {
        if (/^\s*%/.test(lines[i]!)) continue;
        const at = lines[i]!.toLowerCase().indexOf(needle.toLowerCase());
        if (at >= 0) return { from: offset(i) + at, to: offset(i) + at + needle.length, line: i + 1, where: s ? `${s.title}, line ${i + 1}` : `line ${i + 1}` };
      }
    }
    throw new Error(`Couldn’t find “${find}”${s ? ` in ${s.title}` : ""}.`);
  }
  let i = s ? s.line : from;
  while (i < lines.length - 1 && !lines[i]!.trim()) i++;
  const lead = lines[i]!.length - lines[i]!.trimStart().length;
  return { from: offset(i) + lead, to: offset(i) + lines[i]!.trimEnd().length, line: i + 1, where: s ? `${s.title}, line ${i + 1}` : `line ${i + 1}` };
}

/** A "% [Scribe]" line at the end of a section, or of the document (before \bibliography and \end{document}). */
export function appendComment(text: string, section: string | null, comment: string): TexEdit {
  const lines = text.split("\n");
  const s = findSection(text, section);
  let end: number;
  if (s) end = s.end;
  else {
    const all = sections(text);
    end = all.length ? all[all.length - 1]!.end : lines.findIndex((l) => END_DOC.test(l));
    if (end < 0) end = lines.length;
  }
  const at = lastContent(lines, s ? s.line + 1 : bodyStart(lines), end);
  lines.splice(at, 0, texComment(comment));
  return { text: lines.join("\n"), where: s?.title ?? "the document", added: comment };
}

const WORDS = /[\p{L}\p{N}]+/gu;
const wordsOf = (s: string) => (s.toLowerCase().match(WORDS) ?? []).filter((w) => w.length >= 3);

/**
 * The source line a line of the PDF came from: the body line sharing most of its words. LaTeX commands
 * are dropped, a word hyphenated at the end of the PDF line is left out, and partial words count
 * ("ap-prove"). Null when no line shares at least half.
 */
export function matchSourceLine(source: string, pdfText: string): { line: number; text: string } | null {
  const lines = source.split("\n");
  const want = wordsOf(pdfText.replace(/\S+-$/, ""));
  if (!want.length) return null;
  let best = { at: -1, score: 0 };
  for (let i = bodyStart(lines); i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.trim() || /^\s*%/.test(l) || END_DOC.test(l)) continue;
    const have = wordsOf(l.replace(/\\[a-zA-Z]+\*?/g, " "));
    const hit = want.filter((w) => have.includes(w) || (w.length >= 4 && have.some((h) => h.length >= 4 && (h.includes(w) || w.includes(h))))).length;
    const score = hit / want.length;
    if (score > best.score) best = { at: i, score };
  }
  return best.score >= 0.5 ? { line: best.at + 1, text: lines[best.at]! } : null;
}

/** "line 12" or "source line 12" in a request. Meet often writes "line 12" as "online 12" or "blind 12". */
export function lineReference(command: string): { n: number; source: boolean } | null {
  const m = /\b(source\s+(?:code\s+)?)?(?:line|online|blind)\s+(?:number\s+)?(\d{1,4})\b/i.exec(command);
  return m ? { n: Number(m[2]), source: Boolean(m[1]) } : null;
}

/** The document for the model: section titles and the body, without the preamble. */
export function describeTex(text: string, maxChars = 2400): { text: string; parts: string[] } {
  const lines = text.split("\n");
  const body = lines.slice(bodyStart(lines)).filter((l) => l.trim() && !/^\s*%/.test(l) && !END_DOC.test(l));
  const parts = sections(text).map((s) => s.title);
  const out = [parts.length ? `Section titles: ${parts.join(" | ")}` : "(The document has no sections.)", "", ...body].join("\n");
  return { text: out.length > maxChars ? `${out.slice(0, maxChars)}\n…(trimmed)` : out, parts };
}

/** The smallest single change that turns before into after, so the editor keeps cursors and collaborators. */
export function diffOne(before: string, after: string): { from: number; to: number; insert: string } | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB--;
    endA--;
  }
  return { from: start, to: endB, insert: after.slice(start, endA) };
}
