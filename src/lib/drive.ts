// Google Drive: screenshots and recordings are kept in a "Scribe captures" folder
// in the user's own Drive. The drive.file scope means Scribe can only see files
// it made itself.
//
// Docs and Slides only insert a picture from a link anyone can open. So a picture
// is shared by link for the few seconds Google needs to copy it, then the link is
// switched off again; the Doc or deck keeps Google's own copy.

export interface DriveFile {
  id: string;
  /** Private link: only people the file is shared with can open it. */
  link: string;
}

export interface PublicLink {
  /** Links Google's servers can fetch the file from, best first. */
  urls: string[];
  /** Switches the public link off. Always call it. */
  release(): Promise<void>;
}

export interface DriveIO {
  token(): Promise<string>;
  fetch: typeof fetch;
}

export class DriveError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_NAME = "Scribe captures";

/** Waits before retry n after "too many requests". Tests set this to 0. */
export const driveWait = { ms: (attempt: number) => [2000, 5000, 12000, 25000][attempt] ?? 25000 };

async function request(io: DriveIO, url: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const token = await io.token();
  const res = await io.fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) } });
  if ((res.status === 429 || res.status === 503) && attempt < 4) {
    await new Promise((r) => setTimeout(r, driveWait.ms(attempt)));
    return request(io, url, init, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = `Google Drive returned ${res.status}.`;
    try {
      message = JSON.parse(body)?.error?.message ?? message;
    } catch {
      // keep the default
    }
    if (res.status === 403 && /insufficient|scope/i.test(message)) {
      message = "Scribe needs Drive permission to save captures. Sign out of Google in Outputs, then sign in again.";
    }
    throw new DriveError(message, res.status);
  }
  return res;
}

/** Returns the captures folder, creating it if it's missing or in the trash. */
export async function ensureFolder(io: DriveIO, known: string | null): Promise<string> {
  if (known) {
    try {
      const f = (await (await request(io, `${API}/files/${encodeURIComponent(known)}?fields=id,trashed`)).json()) as { trashed?: boolean };
      if (!f.trashed) return known;
    } catch (e) {
      if (!(e instanceof DriveError) || (e.status !== 404 && e.status !== 403)) throw e;
    }
  }
  const res = await request(io, `${API}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  return ((await res.json()) as { id: string }).id;
}

/** Resumable upload, so long recordings work too. */
export async function upload(
  io: DriveIO,
  file: { blob: Blob; name: string; mimeType: string; folderId: string; description?: string }
): Promise<DriveFile> {
  const start = await request(io, `${UPLOAD}/files?uploadType=resumable&fields=id,webViewLink`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": file.mimeType,
      "X-Upload-Content-Length": String(file.blob.size),
    },
    body: JSON.stringify({ name: file.name, mimeType: file.mimeType, parents: [file.folderId], description: file.description }),
  });
  const location = start.headers.get("Location");
  if (!location) throw new DriveError("Drive didn’t return an upload address.");
  const done = await request(io, location, { method: "PUT", headers: { "Content-Type": file.mimeType }, body: file.blob });
  const f = (await done.json()) as { id: string; webViewLink?: string };
  return { id: f.id, link: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view` };
}

export const publicUrls = (id: string) => [
  `https://drive.google.com/uc?export=download&id=${id}`,
  `https://lh3.googleusercontent.com/d/${id}`,
];

/** Shares the file with "anyone with the link". Call release() as soon as the copy is made. */
export async function sharePublicly(io: DriveIO, id: string): Promise<PublicLink> {
  const res = await request(io, `${API}/files/${encodeURIComponent(id)}/permissions?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  const permissionId = ((await res.json()) as { id: string }).id;
  return {
    urls: publicUrls(id),
    release: async () => {
      await request(io, `${API}/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permissionId)}`, { method: "DELETE" });
    },
  };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head = "", b64 = ""] = dataUrl.split(",");
  const mime = /^data:([^;,]+)/.exec(head)?.[1] ?? "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
