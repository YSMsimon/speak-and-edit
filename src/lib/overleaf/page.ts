// What runs inside an Overleaf project tab, through chrome.scripting.executeScript({ world: "MAIN" }).
// Each function is sent to the page as source, so it must not use anything from outside its own body.
// Overleaf's editor is CodeMirror 6; the page keeps it in window.overleaf.unstable.store ("editor.view"),
// with the open file's name in "editor.open_doc_name". The .cm-content element is the fallback.

export interface PageDoc {
  ok: true;
  text: string;
  /** The file open in the editor, e.g. "main.tex". */
  file: string;
  projectName: string;
}

export interface PageProblem {
  ok: false;
  reason: "loading" | "not-editor";
}

/** Reads the open file. Runs in the page. */
export function pageRead(): PageDoc | PageProblem {
  type View = { state: { doc: { toString(): string } } };
  const w = window as unknown as { overleaf?: { unstable?: { store?: { get(k: string): unknown } } } };
  const store = w.overleaf?.unstable?.store;
  const get = (k: string) => {
    try {
      return store?.get(k);
    } catch {
      return undefined;
    }
  };
  const el = document.querySelector(".cm-content") as (Element & { cmView?: { view?: View } }) | null;
  const view = (get("editor.view") as View | undefined) ?? el?.cmView?.view;
  if (!view) return { ok: false, reason: document.querySelector(".ide-react-main, #ide-root") ? "loading" : "not-editor" };
  const selected = document.querySelector('[role="treeitem"][aria-selected="true"]')?.getAttribute("aria-label");
  const file = (get("editor.open_doc_name") as string | undefined) ?? selected ?? "";
  const projectName = (document.querySelector('meta[name="ol-projectName"]') as HTMLMetaElement | null)?.content ?? document.title.replace(/\s+-\s+Online LaTeX Editor Overleaf\s*$/i, "");
  return { ok: true, text: view.state.doc.toString(), file, projectName };
}

export type PageWrite = { ok: true } | { ok: false; reason: "changed" | "no-editor" | "other-file" };

/**
 * Makes one change, but only if the file still reads `before` and is still `file`; otherwise someone
 * typed in between, and the caller reads again. Runs in the page.
 */
export function pageWrite(file: string, before: string, change: { from: number; to: number; insert: string }): PageWrite {
  type View = { state: { doc: { toString(): string } }; dispatch(t: object): void };
  const w = window as unknown as { overleaf?: { unstable?: { store?: { get(k: string): unknown } } } };
  const store = w.overleaf?.unstable?.store;
  const get = (k: string) => {
    try {
      return store?.get(k);
    } catch {
      return undefined;
    }
  };
  const el = document.querySelector(".cm-content") as (Element & { cmView?: { view?: View } }) | null;
  const view = (get("editor.view") as View | undefined) ?? el?.cmView?.view;
  if (!view) return { ok: false, reason: "no-editor" };
  const open = (get("editor.open_doc_name") as string | undefined) ?? document.querySelector('[role="treeitem"][aria-selected="true"]')?.getAttribute("aria-label") ?? "";
  if (file && open && open !== file) return { ok: false, reason: "other-file" };
  if (view.state.doc.toString() !== before) return { ok: false, reason: "changed" };
  view.dispatch({ changes: change });
  return { ok: true };
}
