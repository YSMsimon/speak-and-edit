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

export interface PdfLine {
  text: string;
  page: number;
}

/** The preview shows no margin line numbers (or no PDF at all): "line 12" then means the editor's. */
export interface PdfUnnumbered {
  numbered: false;
}

/**
 * The text on line n of the PDF preview, by the margin line numbers a paper shows (conference review
 * templates, or the lineno package). Runs in the page. Margin numbers are smaller than the body text,
 * and sit just outside their own column: left of it, or right of it in a two-column paper's outer
 * margin, or in the gap between the columns. Of the pages that have the number, the one most in view wins.
 * Null when the preview has line numbers but isn't showing that one; { numbered: false } when it shows
 * no line numbers at all (ten small numbers on a page count as numbering, so footnote marks don't).
 */
export function pagePdfLine(n: number): PdfLine | PdfUnnumbered | null {
  type Span = { t: string; r: DOMRect };
  const pages = Array.from(document.querySelectorAll(".page[data-page-number]")) as HTMLElement[];
  const hits: (PdfLine & { vis: number })[] = [];
  let numbered = false;
  for (const page of pages) {
    const pr = page.getBoundingClientRect();
    const spans: Span[] = Array.from(page.querySelectorAll(".textLayer span"))
      .map((el) => ({ t: (el.textContent || "").trim(), r: el.getBoundingClientRect() }))
      .filter((s) => s.t);
    const heights = spans.filter((s) => !/^\d+$/.test(s.t)).map((s) => s.r.height).sort((a, b) => a - b);
    if (!heights.length) continue;
    const med = heights[Math.floor(heights.length / 2)]!;
    const isNum = (s: Span) => /^\d{1,4}$/.test(s.t) && s.r.height <= med * 0.85;
    const mid = pr.left + pr.width / 2;
    if (spans.filter(isNum).length >= 10) numbered = true;
    for (const num of spans.filter(isNum)) {
      if (Number(num.t) !== n) continue;
      const cy = num.r.top + num.r.height / 2;
      const tol = Math.max(med * 0.6, 4);
      const row = spans.filter((s) => !isNum(s) && Math.abs(s.r.top + s.r.height / 2 - cy) < tol);
      if (!row.length) continue;
      const oneColumn = row.some((s) => s.r.left < mid - 10 && s.r.right > mid + 10);
      const columns = oneColumn ? [row] : [row.filter((s) => s.r.left + s.r.width / 2 < mid), row.filter((s) => s.r.left + s.r.width / 2 >= mid)].filter((c) => c.length);
      let best: { c: Span[]; gap: number } | null = null;
      for (const c of columns) {
        const left = Math.min(...c.map((s) => s.r.left));
        const right = Math.max(...c.map((s) => s.r.right));
        const gap = num.r.right <= left + 1 ? left - num.r.right : num.r.left >= right - 1 ? num.r.left - right : Infinity;
        if (gap < (best?.gap ?? Infinity)) best = { c, gap };
      }
      if (!best) continue;
      const text = best.c.sort((a, b) => a.r.left - b.r.left).map((s) => s.t).join(" ").replace(/\s+/g, " ").trim();
      const vis = Math.max(0, Math.min(pr.bottom, innerHeight) - Math.max(pr.top, 0));
      hits.push({ text, page: Number(page.dataset.pageNumber), vis });
    }
  }
  hits.sort((a, b) => b.vis - a.vis);
  const top = hits[0];
  if (top) return { text: top.text, page: top.page };
  return numbered ? null : { numbered: false };
}

export type PageComment = { ok: true } | { ok: false; reason: "changed" | "no-editor" | "other-file" | "no-button" | "no-box" | "not-posted" };

/**
 * A real Overleaf comment on [from, to), through Overleaf's own "Add comment" button and comment box,
 * as if typed. Runs in the page. The comment box is a small CodeMirror editor inside a closed shadow root;
 * shadow roots made from now on for that box are opened, so its editor can be reached and the text put
 * straight into it. Nothing goes through the page's text cursor, so the document can't be typed into, and
 * that is checked: the document must read `before` again afterwards. On failure the box is cancelled.
 */
export async function pageComment(file: string, before: string, range: { from: number; to: number }, text: string): Promise<PageComment> {
  type View = { state: { doc: { toString(): string; length: number } }; dispatch(t: object): void; focus(): void };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async <T,>(fn: () => T | null | undefined, ms = 4000): Promise<T | null> => {
    for (let t = 0; t < ms; t += 100) {
      const v = fn();
      if (v) return v;
      await wait(100);
    }
    return null;
  };
  const w = window as unknown as { overleaf?: { unstable?: { store?: { get(k: string): unknown } } } };
  const get = (k: string) => {
    try {
      return w.overleaf?.unstable?.store?.get(k);
    } catch {
      return undefined;
    }
  };
  const el = document.querySelector(".cm-content") as (Element & { cmView?: { view?: View } }) | null;
  const main = (get("editor.view") as View | undefined) ?? el?.cmView?.view;
  if (!main) return { ok: false, reason: "no-editor" };
  const open = (get("editor.open_doc_name") as string | undefined) ?? document.querySelector('[role="treeitem"][aria-selected="true"]')?.getAttribute("aria-label") ?? "";
  if (file && open && open !== file) return { ok: false, reason: "other-file" };
  if (main.state.doc.toString() !== before) return { ok: false, reason: "changed" };

  // Only the comment box's shadow root, and only from now on.
  const proto = Element.prototype as Element & { __scribeAttachShadow?: typeof Element.prototype.attachShadow };
  if (!proto.__scribeAttachShadow) {
    const original = proto.attachShadow;
    proto.__scribeAttachShadow = original;
    proto.attachShadow = function (this: Element, init: ShadowRootInit) {
      return original.call(this, this.classList?.contains("review-panel-add-comment-editor") ? { ...init, mode: "open" } : init);
    };
  }
  const buttons = () => Array.from(document.querySelectorAll("button"));
  // Every existing comment has a Reply box with the same editor; the new comment's box is the one in the
  // form with the Comment button.
  const commentForm = () => buttons().find((b) => (b.textContent || "").trim() === "Comment")?.closest("form") ?? null;
  const cancel = () => Array.from(commentForm()?.querySelectorAll("button") ?? []).find((b) => (b.textContent || "").trim() === "Cancel")?.click();
  cancel();
  await wait(200);

  main.focus();
  main.dispatch({ selection: { anchor: range.from, head: range.to }, scrollIntoView: true });
  // Generous waits: in a background tab Chrome runs timers about once a second.
  const add = await until(() => buttons().find((b) => b.getAttribute("aria-label") === "Add comment" && !b.disabled), 6000);
  if (!add) return { ok: false, reason: "no-button" };
  add.click();
  type Box = Element & { shadowRoot: ShadowRoot | null };
  const editor = await until(() => {
    const box = commentForm()?.querySelector(".review-panel-add-comment-editor") as Box | null;
    const content = box?.shadowRoot?.querySelector(".cm-content") as (Element & { cmView?: { view?: View } }) | null;
    const view = content?.cmView?.view;
    return view && view !== main ? { box, view } : null;
  }, 8000);
  if (!editor) {
    cancel();
    return { ok: false, reason: "no-box" };
  }
  editor.view.dispatch({ changes: { from: 0, to: editor.view.state.doc.length, insert: text } });
  const form = editor.box!.closest("form");
  const submit = await until(() => Array.from(form?.querySelectorAll("button") ?? []).find((b) => (b.textContent || "").trim() === "Comment" && !b.disabled) ?? null, 5000);
  if (!submit || main.state.doc.toString() !== before) {
    cancel();
    return { ok: false, reason: main.state.doc.toString() !== before ? "changed" : "not-posted" };
  }
  submit.click();
  const gone = await until(() => !document.contains(editor.box!) || !form?.isConnected, 10000);
  return gone ? { ok: true } : { ok: false, reason: "not-posted" };
}

/**
 * The text of the comments in the review panel, for checking one was posted. Runs in the page. The panel
 * only draws comments near the lines on screen, so it first scrolls the editor to `near` when given.
 */
export async function pageCommentsText(near?: string): Promise<string> {
  type View = { state: { doc: { toString(): string } }; dispatch(t: object): void };
  if (near) {
    const view = (window as unknown as { overleaf?: { unstable?: { store?: { get(k: string): unknown } } } }).overleaf?.unstable?.store?.get("editor.view") as View | undefined;
    const at = view?.state.doc.toString().indexOf(near) ?? -1;
    if (view && at >= 0) {
      view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return Array.from(document.querySelectorAll('[class*="review-panel-entry"]')).map((e) => (e as HTMLElement).innerText).join("\n");
}
