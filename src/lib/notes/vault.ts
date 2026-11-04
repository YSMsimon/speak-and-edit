// The Obsidian vault folder, through Chrome's File System Access: picked once, kept in IndexedDB, and
// asked again (with one click) if Chrome forgets the permission. Nothing to sign in to; files stay on disk.

const DB = "scribe-notes";
const STORE = "handles";
const KEY = "vault";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const loadVault = () => idb<FileSystemDirectoryHandle | undefined>("readonly", (s) => s.get(KEY)).then((h) => h ?? null);
export const saveVault = (h: FileSystemDirectoryHandle) => idb("readwrite", (s) => s.put(h, KEY));
export const forgetVault = () => idb("readwrite", (s) => s.delete(KEY));

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission(d: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(d: { mode: "readwrite" }): Promise<PermissionState>;
};

/** True when Scribe may write in the folder. With ask, Chrome shows its prompt; call it straight from a click. */
export async function vaultAccess(h: FileSystemDirectoryHandle, ask: boolean): Promise<boolean> {
  const p = h as PermissionHandle;
  if ((await p.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return ask ? (await p.requestPermission({ mode: "readwrite" })) === "granted" : false;
}

/** Chrome's folder chooser. Call it straight from a click. */
export async function pickVault(): Promise<FileSystemDirectoryHandle> {
  const pick = (window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  const h = await pick({ id: "scribe-vault", mode: "readwrite" });
  await saveVault(h);
  return h;
}

const parts = (path: string) => path.split("/").filter(Boolean);

async function dirAt(root: FileSystemDirectoryHandle, dirs: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let d = root;
  for (const name of dirs) d = await d.getDirectoryHandle(name, { create });
  return d;
}

export async function readNote(root: FileSystemDirectoryHandle, path: string): Promise<string> {
  const p = parts(path);
  const dir = await dirAt(root, p.slice(0, -1), false);
  const file = await (await dir.getFileHandle(p.at(-1)!)).getFile();
  return file.text();
}

export async function writeNote(root: FileSystemDirectoryHandle, path: string, data: string | Blob): Promise<void> {
  const p = parts(path);
  const dir = await dirAt(root, p.slice(0, -1), true);
  const w = await (await dir.getFileHandle(p.at(-1)!, { create: true })).createWritable();
  await w.write(data);
  await w.close();
}

export async function noteExists(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  try {
    await readNote(root, path);
    return true;
  } catch {
    return false;
  }
}

/** Markdown notes in a folder of the vault (not its subfolders), newest name first. */
export async function listNotes(root: FileSystemDirectoryHandle, folder: string): Promise<string[]> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await dirAt(root, parts(folder), false);
  } catch {
    return [];
  }
  const out: string[] = [];
  for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (h.kind === "file" && name.endsWith(".md")) out.push([...parts(folder), name].join("/"));
  }
  return out.sort().reverse();
}

/** A name that works as a file name on every system. */
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim() || "Meeting";
