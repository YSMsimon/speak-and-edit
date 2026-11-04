// The files Scribe can write to: Google Docs, Sheets and Slides, Obsidian notes and Overleaf projects.

/**
 * note: an Obsidian (Markdown) note in a vault folder on this computer (v0.7).
 * tex: an Overleaf project, edited through its tab; id is "overleaf:<project id>" (v0.8).
 */
export type FileKind = "doc" | "sheet" | "slides" | "note" | "tex";

export interface FileRef {
  id: string;
  kind: FileKind;
  /** Notes only: the vault's folder name, for obsidian:// links. */
  vault?: string;
  title: string;
}

export const KIND_LABEL: Record<FileKind, string> = {
  doc: "Google Doc",
  sheet: "Google Sheet",
  slides: "Google Slides",
  note: "Obsidian note",
  tex: "Overleaf project",
};

type GoogleKind = Exclude<FileKind, "note" | "tex">;
const PATHS: Record<GoogleKind, string> = { doc: "document", sheet: "spreadsheets", slides: "presentation" };

export function parseGoogleUrl(input: string): { id: string; kind: FileKind } | null {
  const m = /docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]{20,})/.exec(input);
  if (!m?.[1] || !m[2]) return null;
  const kind = (Object.keys(PATHS) as GoogleKind[]).find((k) => PATHS[k] === m[1])!;
  return { id: m[2], kind };
}

export const fileUrl = (f: Pick<FileRef, "id" | "kind" | "vault">) =>
  f.kind === "note"
    ? `obsidian://open?vault=${encodeURIComponent(f.vault ?? "")}&file=${encodeURIComponent(f.id.replace(/^note:/, "").replace(/\.md$/, ""))}`
    : f.kind === "tex"
      ? `https://www.overleaf.com/project/${f.id.replace(/^overleaf:/, "")}`
      : `https://docs.google.com/${PATHS[f.kind]}/d/${f.id}/edit`;

/** "Q4 Spec - Google Docs" → "Q4 Spec" */
export function titleFromTab(title: string | undefined): string {
  return (title ?? "").replace(/\s+-\s+Google (Docs|Sheets|Slides)\s*$/i, "").trim() || "Untitled";
}

export const TAB_PATTERNS = [
  "https://docs.google.com/document/d/*",
  "https://docs.google.com/spreadsheets/d/*",
  "https://docs.google.com/presentation/d/*",
];
