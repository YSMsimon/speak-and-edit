// Editing an Obsidian (Markdown) meeting note as text: headings are sections, like Docs headings.
// Pure functions, so every edit is easy to test. lib/notes/vault.ts reads and writes the files.

export interface MdSection {
  title: string;
  level: number;
  /** Line index of the heading. */
  line: number;
  /** Line index just after the section's last line (the next heading of the same or higher level, or the end). */
  end: number;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

export function sections(text: string): MdSection[] {
  const lines = text.split("\n");
  const found: MdSection[] = [];
  let inFence = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) inFence = !inFence;
    const m = inFence ? null : HEADING.exec(l);
    if (m) found.push({ title: m[2]!, level: m[1]!.length, line: i, end: lines.length });
  });
  for (let i = 0; i < found.length; i++) {
    const next = found.slice(i + 1).find((s) => s.level <= found[i]!.level);
    if (next) found[i]!.end = next.line;
  }
  return found;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function findSection(text: string, title: string | null): MdSection | undefined {
  if (!title) return undefined;
  const all = sections(text);
  return all.find((s) => s.title === title) ?? all.find((s) => norm(s.title) === norm(title));
}

/** Frontmatter (between leading --- lines) is never edited. */
function bodyStart(lines: string[]): number {
  if (lines[0] !== "---") return 0;
  const close = lines.indexOf("---", 1);
  return close > 0 ? close + 1 : 0;
}

export const TRANSCRIPT = "Transcript";

/** An Obsidian comment: hidden in reading view, kept in the file. Used for credit. */
export const credit = (line: string) => `%% ${line.replace(/%%/g, "%")} %%`;

export interface MdEdit {
  text: string;
  /** Where it landed, for the panel: a section title or "the note". */
  where: string;
  added: string;
  removed?: string;
}

/**
 * Adds lines at the end of a section (before its trailing blank lines), or at the end of the note but
 * before the Transcript section when no section is named. Bullets stay bullets.
 */
export function appendTo(text: string, section: string | null, add: string, creditLine?: string): MdEdit {
  const lines = text.split("\n");
  const s = findSection(text, section);
  const transcript = findSection(text, TRANSCRIPT);
  let at: number;
  if (s) at = s.end;
  else if (transcript && transcript.line >= bodyStart(lines)) at = transcript.line;
  else at = lines.length;
  while (at > (s ? s.line + 1 : bodyStart(lines)) && lines[at - 1]!.trim() === "") at--;
  const prev = lines[at - 1] ?? "";
  const bullet = /^\s*[-*+]\s/.test(prev) ? prev.match(/^\s*[-*+]\s/)![0] : "";
  const entries = add
    .split(/\n+/)
    .map((l) => l.trim().replace(/^[-*•]\s+/, ""))
    .filter(Boolean)
    .map((l) => `${bullet}${l}`);
  if (!entries.length) throw new Error("Nothing to add.");
  if (creditLine) entries[entries.length - 1] += ` ${credit(creditLine)}`;
  // Keep one blank line before the next heading.
  const tail = lines[at] !== undefined && HEADING.test(lines[at]!) ? [""] : [];
  lines.splice(at, 0, ...entries, ...tail);
  return { text: lines.join("\n"), where: s?.title ?? "the note", added: entries.map((e) => e.replace(/\s*%%.*%%$/, "").replace(/^\s*[-*+]\s/, "")).join("\n") };
}

/** Replaces text found in the section (or anywhere). Exact first, then ignoring case. */
export function replaceIn(text: string, section: string | null, find: string, withText: string): MdEdit {
  const s = findSection(text, section);
  const lines = text.split("\n");
  const from = s ? s.line + 1 : bodyStart(lines);
  const to = s ? s.end : lines.length;
  for (const exact of [true, false]) {
    for (let i = from; i < to; i++) {
      const at = exact ? lines[i]!.indexOf(find) : lines[i]!.toLowerCase().indexOf(find.toLowerCase());
      if (at < 0) continue;
      const line = lines[i]!;
      lines[i] = line.slice(0, at) + withText + line.slice(at + find.length);
      return { text: lines.join("\n"), where: s?.title ?? "the note", added: withText, removed: line.slice(at, at + find.length) };
    }
  }
  throw new Error(`Couldn’t find “${find}”${s ? ` in ${s.title}` : ""}.`);
}

/** A comment on a line: an Obsidian callout right under it, so it shows in reading view. */
export function commentOn(text: string, section: string | null, find: string | null, comment: string, creditLine?: string): MdEdit {
  const lines = text.split("\n");
  const s = findSection(text, section);
  let at = -1;
  if (find) {
    const from = s ? s.line + 1 : bodyStart(lines);
    const to = s ? s.end : lines.length;
    const needle = find.toLowerCase();
    for (let i = from; i < to && at < 0; i++) if (lines[i]!.toLowerCase().includes(needle)) at = i;
    if (at < 0) throw new Error(`Couldn’t find “${find}”${s ? ` in ${s.title}` : ""}.`);
  } else {
    at = s ? s.line : Math.max(bodyStart(lines), lines.length - 1);
  }
  const body = `${comment}${creditLine ? ` (${creditLine})` : ""}`;
  lines.splice(at + 1, 0, `> [!comment] ${body}`);
  return { text: lines.join("\n"), where: s?.title ?? "the note", added: comment };
}

/** Adds "## title" at the end of the note (before Transcript) if the note has no such section. */
export function ensureSection(text: string, title: string): string {
  if (findSection(text, title)) return text;
  const lines = text.split("\n");
  const transcript = findSection(text, TRANSCRIPT);
  let at = transcript ? transcript.line : lines.length;
  while (at > bodyStart(lines) && lines[at - 1]!.trim() === "") at--;
  lines.splice(at, 0, "", `## ${title}`, ...(transcript ? [""] : []));
  return lines.join("\n");
}

/** Record all: lines under "## Transcript", created at the end if it isn't there. */
export function appendTranscript(text: string, transcriptLines: string[]): string {
  const base = findSection(text, TRANSCRIPT) ? text : `${text.replace(/\s*$/, "")}\n\n## ${TRANSCRIPT}\n`;
  const lines = base.split("\n");
  const s = findSection(base, TRANSCRIPT)!;
  let at = s.end;
  while (at > s.line + 1 && lines[at - 1]!.trim() === "") at--;
  lines.splice(at, 0, ...transcriptLines);
  return lines.join("\n");
}

/** A compact view for the model: headings and lines, like describeOutline for Docs. */
export function describeNote(text: string, maxChars = 2400): { text: string; parts: string[] } {
  const lines = text.split("\n");
  const body = lines.slice(bodyStart(lines)).filter((l) => l.trim());
  const parts = sections(text).map((s) => s.title);
  const out = [parts.length ? `Section titles: ${parts.join(" | ")}` : "(The note has no headings.)", "", ...body].join("\n");
  return { text: out.length > maxChars ? `${out.slice(0, maxChars)}\n…(trimmed)` : out, parts };
}

/** A new meeting note: frontmatter Obsidian understands, and the sections Scribe fills. */
export function newMeetingNote(title: string, date: Date): string {
  const day = date.toISOString().slice(0, 10);
  return [
    "---",
    "type: meeting",
    `created: ${day}`,
    "tags: [meeting]",
    "---",
    "",
    `# ${title}`,
    "",
    "## Decisions",
    "",
    "## Action items",
    "",
    "## Open questions",
    "",
    "## Notes",
    "",
  ].join("\n");
}
