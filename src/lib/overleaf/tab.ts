// Reaching an Overleaf project: through the project's tab in this Chrome, where the user is already signed
// in. Nothing is sent to Overleaf by Scribe itself; the page saves the change like any typing.
// Needs the "scripting" permission and Chrome's OK for https://www.overleaf.com/* (asked on Add).
import { pageRead, pageWrite, type PageDoc, type PageWrite, pagePdfLine, type PdfLine, type PdfUnnumbered, pageComment, pageCommentsText, type PageComment } from "./page";

export const OVERLEAF_ORIGIN = "https://www.overleaf.com/*";

/** "https://www.overleaf.com/project/6ae7…" → the 24-character project id. */
export function parseOverleafUrl(input: string): string | null {
  const m = /overleaf\.com\/project\/([a-f0-9]{24})\b/i.exec(input);
  return m?.[1]?.toLowerCase() ?? null;
}

export const overleafUrl = (projectId: string) => `https://www.overleaf.com/project/${projectId}`;

/** "Paper draft - Online LaTeX Editor Overleaf" → "Paper draft" */
export const overleafTitle = (tabTitle: string | undefined) => (tabTitle ?? "").replace(/\s+-\s+Online LaTeX Editor Overleaf\s*$/i, "").trim() || "Overleaf project";

/** True when Chrome lets Scribe into Overleaf tabs. With ask, Chrome shows its prompt; call it straight from a click. */
export async function overleafAccess(ask: boolean): Promise<boolean> {
  const want = { origins: [OVERLEAF_ORIGIN] };
  if (await chrome.permissions.contains(want)) return true;
  return ask ? chrome.permissions.request(want) : false;
}

/** Open Overleaf project tabs in this Chrome: id and title. */
export async function openOverleafTabs(): Promise<{ id: string; title: string; tabId: number }[]> {
  const tabs = await chrome.tabs.query({ url: "https://www.overleaf.com/project/*" });
  const out: { id: string; title: string; tabId: number }[] = [];
  for (const t of tabs) {
    const id = parseOverleafUrl(t.url ?? "");
    if (id && t.id !== undefined && !out.some((o) => o.id === id)) out.push({ id, title: overleafTitle(t.title), tabId: t.id });
  }
  return out;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run<T>(tabId: number, func: (...a: never[]) => T, args: unknown[] = []): Promise<T> {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: func as () => T, args: args as [] });
  return res?.result as T;
}

/**
 * The project's tab, ready to edit. If it isn't open, Scribe opens it in the background and waits for the
 * editor. A tab Chrome put to sleep is woken the same way.
 */
async function projectTab(projectId: string): Promise<number> {
  if (!(await overleafAccess(false))) throw new Error("Chrome needs your OK to use Overleaf. Press Add in Outputs › Overleaf and allow it.");
  const tabs = await chrome.tabs.query({ url: "https://www.overleaf.com/project/*" });
  const mine = tabs.filter((t) => parseOverleafUrl(t.url ?? "") === projectId);
  let tab = mine.find((t) => !t.discarded) ?? mine[0];
  if (!tab?.id) tab = await chrome.tabs.create({ url: overleafUrl(projectId), active: false });
  else if (tab.discarded) await chrome.tabs.reload(tab.id);
  return tab.id!;
}

/** Reads the file open in the project's editor, waiting up to ~25 s for a tab that is still loading. */
export async function readProject(projectId: string): Promise<PageDoc & { tabId: number }> {
  const tabId = await projectTab(projectId);
  for (let i = 0; i < 50; i++) {
    let res: ReturnType<typeof pageRead> | undefined;
    try {
      res = await run(tabId, pageRead);
    } catch {
      res = undefined; // the page is navigating or not injectable yet
    }
    if (res?.ok) return { ...res, tabId };
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw new Error("The Overleaf tab was closed. Open the project again.");
    if (t.url && !parseOverleafUrl(t.url) && t.status === "complete") throw new Error("Sign in to Overleaf in this Chrome, then try again.");
    if (res && !res.ok && res.reason === "not-editor" && t.status === "complete" && i > 10) throw new Error("Sign in to Overleaf in this Chrome, then try again.");
    await wait(500);
  }
  throw new Error("The Overleaf project didn’t open in time. Check the tab, then try again.");
}

/** The text on line n of the project's PDF preview (its margin numbers), or null. */
export async function readPdfLine(tabId: number, n: number): Promise<PdfLine | PdfUnnumbered | null> {
  return run(tabId, pagePdfLine, [n]);
}

/** A real Overleaf comment on [from, to) of the open file, through Overleaf's comment box. */
export async function commentProject(tabId: number, file: string, before: string, range: { from: number; to: number }, text: string): Promise<PageComment> {
  return run(tabId, pageComment, [file, before, range, text]);
}

/** The text of the comments in the project's review panel. */
export async function projectCommentsText(tabId: number, near?: string): Promise<string> {
  return run(tabId, pageCommentsText, near ? [near] : []);
}

export async function writeProject(tabId: number, file: string, before: string, change: { from: number; to: number; insert: string }): Promise<PageWrite> {
  return run(tabId, pageWrite, [file, before, change]);
}
