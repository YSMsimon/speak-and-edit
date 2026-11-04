// Google Sheets: append rows, change cells, and leave credit as cell notes.
// Sheets has no suggestion mode, so writes land directly. When a cell is
// overwritten, its old value goes into the note so the change can be undone.

import type { FileRef } from "../files";
import { clip, squash, type ApplyOptions, type ApplyResult, type FileContext, type Target, type WriteIntent } from "./types";

export type FetchJson = <T>(url: string, init?: RequestInit) => Promise<T>;

interface Spreadsheet {
  properties?: { title?: string };
  sheets?: { properties?: { sheetId?: number; title?: string } }[];
}
interface Tab {
  sheetId: number;
  title: string;
}

const API = "https://sheets.googleapis.com/v4/spreadsheets";
/** Screenshots and recordings get their own tab, so they don't mix into a task table. */
export const CAPTURES_TAB = "Scribe captures";
const MAX_TABS = 3;
const MAX_ROWS = 40;

/** 'My Tab' → "'My Tab'" (A1 notation needs quotes around most names). */
const quoteTab = (t: string) => `'${t.replace(/'/g, "''")}'`;

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function pickTab(tabs: Tab[], name: string | null): Tab | undefined {
  if (!name) return tabs[0];
  const want = squash(name);
  return tabs.find((t) => squash(t.title) === want) ?? tabs.find((t) => squash(t.title).includes(want)) ?? tabs[0];
}

export function columnIndex(header: string[], column: string): number {
  const want = squash(column);
  const exact = header.findIndex((h) => squash(h) === want);
  if (exact >= 0) return exact;
  return header.findIndex((h) => squash(h).includes(want) || (want.includes(squash(h)) && squash(h).length > 0));
}

/** A row aligned to the header. Values for unknown columns go into the first empty slots after the header. */
export function rowFromCells(header: string[], cells: { column: string; value: string }[], text: string | null): string[] {
  if (!cells.length) return [text ?? ""];
  const row: string[] = new Array(Math.max(header.length, 1)).fill("");
  const extra: string[] = [];
  for (const c of cells) {
    const i = columnIndex(header, c.column);
    if (i >= 0) row[i] = c.value;
    else extra.push(c.value);
  }
  for (const v of extra) {
    const slot = row.findIndex((x) => x === "");
    if (slot >= 0) row[slot] = v;
    else row.push(v);
  }
  return row;
}

/** 1-based sheet rows of every data row containing `find`. */
export function findRows(rows: string[][], find: string): number[] {
  const want = find.toLowerCase().trim();
  const out: number[] = [];
  for (let i = 1; i < rows.length; i++) if ((rows[i] ?? []).some((c) => c.toLowerCase().includes(want))) out.push(i + 1);
  return out;
}

/** 1-based sheet row of the first data row containing `find`, or -1. */
export function findRow(rows: string[][], find: string): number {
  const want = find.toLowerCase().trim();
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i] ?? []).some((c) => c.toLowerCase().includes(want))) return i + 1;
  }
  return -1;
}

export function sheetsTarget(fetchJson: FetchJson): Target {
  const tabsOf = async (file: FileRef) => {
    const s = await fetchJson<Spreadsheet>(`${API}/${file.id}?fields=properties.title,sheets.properties(sheetId,title)`);
    const tabs: Tab[] = (s.sheets ?? []).map((x) => ({ sheetId: x.properties?.sheetId ?? 0, title: x.properties?.title ?? "Sheet1" }));
    return { title: s.properties?.title ?? file.title, tabs };
  };
  const rowsOf = async (file: FileRef, tab: Tab) => {
    const r = await fetchJson<{ values?: string[][] }>(`${API}/${file.id}/values/${encodeURIComponent(`${quoteTab(tab.title)}!A1:Z${MAX_ROWS}`)}`);
    return r.values ?? [];
  };
  const noteOf = async (file: FileRef, tab: Tab, a1: string): Promise<string> => {
    const r = await fetchJson<{ sheets?: { data?: { rowData?: { values?: { note?: string }[] }[] }[] }[] }>(
      `${API}/${file.id}?ranges=${encodeURIComponent(`${quoteTab(tab.title)}!${a1}`)}&fields=sheets(data(rowData(values(note))))`
    );
    return r.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.note ?? "";
  };
  const setNote = async (file: FileRef, tab: Tab, row: number, col: number, note: string) => {
    await fetchJson(`${API}/${file.id}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateCells: {
              range: { sheetId: tab.sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: col, endColumnIndex: col + 1 },
              rows: [{ values: [{ note }] }],
              fields: "note",
            },
          },
        ],
      }),
    });
  };
  const addNote = async (file: FileRef, tab: Tab, row: number, col: number, text: string) => {
    const a1 = `${columnLetter(col)}${row}`;
    const old = await noteOf(file, tab, a1).catch(() => "");
    await setNote(file, tab, row, col, old ? `${old}\n\n${text}` : text);
  };

  /** Appends rows and returns the 1-based number of the first new row. */
  const appendRows = async (file: FileRef, tab: Tab, values: string[][], fallback: number): Promise<number> => {
    const res = await fetchJson<{ updates?: { updatedRange?: string } }>(
      `${API}/${file.id}/values/${encodeURIComponent(`${quoteTab(tab.title)}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: JSON.stringify({ values }) }
    );
    const m = /![A-Z]+(\d+)/.exec(res.updates?.updatedRange ?? "");
    return m?.[1] ? Number(m[1]) : fallback;
  };

  return {
    async describe(file): Promise<FileContext> {
      const { title, tabs } = await tabsOf(file);
      const parts: string[] = [];
      // One read for every tab: Sheets allows 60 reads per minute per person.
      const shown = tabs.slice(0, MAX_TABS);
      const ranges = shown.map((t) => `ranges=${encodeURIComponent(`${quoteTab(t.title)}!A1:Z${MAX_ROWS}`)}`).join("&");
      const batch = shown.length
        ? await fetchJson<{ valueRanges?: { values?: string[][] }[] }>(`${API}/${file.id}/values:batchGet?${ranges}`)
        : { valueRanges: [] };
      for (const [i, tab] of shown.entries()) {
        const rows = batch.valueRanges?.[i]?.values ?? [];
        parts.push(`Tab “${tab.title}” (columns: ${(rows[0] ?? []).join(" | ") || "none yet"})`);
        rows.slice(1, 16).forEach((r, i) => parts.push(`  row ${i + 2}: ${r.join(" | ")}`));
      }
      return { title, text: clip(parts.join("\n"), 2000), parts: tabs.map((t) => t.title) };
    },

    async apply(file, w: WriteIntent, o: ApplyOptions): Promise<ApplyResult> {
      const { tabs } = await tabsOf(file);
      const tab = pickTab(tabs, w.section);
      if (!tab) throw new Error("The sheet has no tabs.");
      const rows = await rowsOf(file, tab);
      const header = rows[0] ?? [];
      const direct = o.landAs === "suggest" ? "Sheets can’t take suggestions, so this was written directly." : undefined;

      // A comment, or an edit the settings say to save as a comment: a note on the matching row.
      if (w.action === "comment" || o.landAs === "comment") {
        const row = w.find ? findRow(rows, w.find) : -1;
        const r = row > 0 ? row : 1;
        const body = w.action === "comment" ? (w.text ?? "") : `Proposed: ${w.text ?? `${w.find} → ${w.replaceWith}`}`;
        await addNote(file, tab, r, 0, [body, o.credit].filter(Boolean).join("\n— "));
        return { where: `${tab.title} A${r}`, add: body, status: "commented", suggestionIds: [] };
      }

      if (w.action === "replace") {
        // Models sometimes name the row only through its cells: {Task: "Write the spec", Status: "Done"}.
        let key = w.find?.trim() || null;
        let updates = w.cells;
        if (!key) {
          const named = w.cells.find((c) => c.value.trim() && findRow(rows, c.value) > 0);
          if (named) {
            key = named.value;
            updates = w.cells.filter((c) => c !== named);
          }
        }
        if (!key) throw new Error("The request didn’t say which row to change.");
        const matches = findRows(rows, key);
        if (!matches.length) throw new Error(`Couldn’t find “${key}” in ${tab.title}.`);
        // Never guess between rows: changing the wrong task is worse than asking.
        if (matches.length > 1) {
          const names = matches.slice(0, 4).map((r) => rows[r - 1]?.[0] || `row ${r}`);
          throw new Error(`“${key}” is in ${matches.length} rows (${names.join(", ")}${matches.length > 4 ? ", …" : ""}). Say which one.`);
        }
        const row = matches[0]!;
        const cells = rows[row - 1] ?? [];
        // The cell to change is the first one whose value actually differs.
        const target =
          updates.find((c) => {
            const i = columnIndex(header, c.column);
            return i < 0 || (cells[i] ?? "").trim() !== c.value.trim();
          }) ?? updates[0];
        let col = target ? columnIndex(header, target.column) : -1;
        if (col < 0) col = cells.findIndex((c) => c.toLowerCase().includes(key!.toLowerCase()));
        if (col < 0) col = 0;
        const value = target?.value ?? w.replaceWith ?? "";
        const old = cells[col] ?? "";
        const a1 = `${columnLetter(col)}${row}`;
        await fetchJson(`${API}/${file.id}/values/${encodeURIComponent(`${quoteTab(tab.title)}!${a1}`)}?valueInputOption=USER_ENTERED`, {
          method: "PUT",
          body: JSON.stringify({ values: [[value]] }),
        });
        if (o.withCredit) await addNote(file, tab, row, col, `${o.credit}${old ? `\nWas: ${old}` : ""}`).catch(() => undefined);
        return { where: `${tab.title} ${a1}`, remove: old || undefined, add: value, status: "applied", suggestionIds: [], warning: direct };
      }

      // append (and new_slide, which means nothing here): add one row, or several.
      const newRows = (w.rows?.length ? w.rows.map((r) => rowFromCells(header, r, null)) : [rowFromCells(header, w.cells, w.text)]).filter((r) =>
        r.some((c) => c.trim())
      );
      if (!newRows.length) throw new Error("Nothing to add.");
      const at = await appendRows(file, tab, newRows, rows.length + 1);
      if (o.withCredit) await addNote(file, tab, at, 0, o.credit).catch(() => undefined);
      const where = newRows.length > 1 ? `${tab.title} rows ${at}–${at + newRows.length - 1}` : `${tab.title} row ${at}`;
      return { where, add: newRows.map((r) => r.filter(Boolean).join(" | ")).join("; "), status: "applied", suggestionIds: [], warning: direct };
    },

    async insertMedia(file, m, w, o) {
      const noun = m.kind === "image" ? "Screenshot" : "Recording";
      const { tabs } = await tabsOf(file);
      if (o.landAs === "comment") {
        const tab = pickTab(tabs, w.section);
        if (!tab) throw new Error("The sheet has no tabs.");
        await addNote(file, tab, 1, 0, [`${noun}: ${m.caption}\n${m.link}`, o.withCredit ? o.credit : ""].filter(Boolean).join("\n— "));
        return { where: `${tab.title} A1`, add: `${noun}: ${m.caption}`, status: "commented", suggestionIds: [] };
      }
      let tab = tabs.find((t) => squash(t.title) === squash(CAPTURES_TAB));
      if (!tab) {
        const r = await fetchJson<{ replies?: { addSheet?: { properties?: { sheetId?: number; title?: string } } }[] }>(`${API}/${file.id}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CAPTURES_TAB } } }] }),
        });
        const props = r.replies?.[0]?.addSheet?.properties;
        tab = { sheetId: props?.sheetId ?? 0, title: props?.title ?? CAPTURES_TAB };
        await fetchJson(`${API}/${file.id}/values/${encodeURIComponent(`${quoteTab(tab.title)}!A1:C1`)}?valueInputOption=RAW`, {
          method: "PUT",
          body: JSON.stringify({ values: [["What", "Caption", "Link"]] }),
        });
      }
      const link = `=HYPERLINK("${m.link.replace(/"/g, "%22")}", "Open in Drive")`;
      const at = await appendRows(file, tab, [[noun, m.caption, link]], 2);
      if (o.withCredit) await addNote(file, tab, at, 0, o.credit).catch(() => undefined);
      return {
        where: `${tab.title} row ${at}`,
        add: `${noun}: ${m.caption}`,
        status: "applied",
        suggestionIds: [],
        warning: m.kind === "image" ? "Sheets can’t hold a copied picture, so this row links to the original in your Drive." : undefined,
      };
    },
  };
}
