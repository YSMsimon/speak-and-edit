// The files Scribe can write to: Google Docs, Sheets and Slides.

export type FileKind = "doc" | "sheet" | "slides";
export const FILE_KINDS: FileKind[] = ["doc", "sheet", "slides"];

export interface FileRef {
  id: string;
  kind: FileKind;
  title: string;
}

export const KIND_LABEL: Record<FileKind, string> = {
  doc: "Google Doc",
  sheet: "Google Sheet",
  slides: "Google Slides",
};

const PATHS: Record<FileKind, string> = { doc: "document", sheet: "spreadsheets", slides: "presentation" };

export function parseGoogleUrl(input: string): { id: string; kind: FileKind } | null {
  const m = /docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]{20,})/.exec(input);
  if (!m?.[1] || !m[2]) return null;
  const kind = FILE_KINDS.find((k) => PATHS[k] === m[1])!;
  return { id: m[2], kind };
}

export const fileUrl = (f: Pick<FileRef, "id" | "kind">) => `https://docs.google.com/${PATHS[f.kind]}/d/${f.id}/edit`;

/** "Q4 Spec - Google Docs" → "Q4 Spec" */
export function titleFromTab(title: string | undefined): string {
  return (title ?? "").replace(/\s+-\s+Google (Docs|Sheets|Slides)\s*$/i, "").trim() || "Untitled";
}

export const TAB_PATTERNS = [
  "https://docs.google.com/document/d/*",
  "https://docs.google.com/spreadsheets/d/*",
  "https://docs.google.com/presentation/d/*",
];
