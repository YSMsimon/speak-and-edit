// How much of the meeting goes into each request to the model.
//
// Every request always gets the last 6 lines, as before. On top of that, a budget of about 10% of the
// chosen model's context window, capped at 16k tokens, holds older lines: first the lines that match
// the request (a name, a topic), then the newest of the rest. When the meeting no longer fits, Scribe
// folds the oldest lines into a short running summary (engine.ts), which comes first.
//
// The cap is for speed and cost, not space: an hour of talk is about 12k tokens, and each request
// reads the whole budget again before it answers.

import type { ProviderId, Settings } from "../settings";

/** The newest lines, sent word for word with every request. */
export const RECENT_LINES = 6;
const SHARE = 0.1;
const CAP = 16_000;

const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/g;

/** A rough token count without a tokenizer: about 4 characters a token, one per Chinese, Japanese or Korean character. */
export function tokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  return Math.ceil((text.length - cjk) / 4 + cjk);
}

/** Tokens for older lines and the summary: 10% of the window, at most 16k. */
export function budgetFor(window: number): number {
  return Math.min(Math.floor(window * SHARE), CAP);
}

/** The model's context window: Chrome's built-in model is small, ChatGPT's models are large. */
export function knownWindow(id: ProviderId, _model: string): number {
  // Gemini Nano: a few thousand tokens per session.
  return id === "chrome" ? 4_096 : 128_000;
}

export async function contextWindow(id: ProviderId, s: Settings): Promise<number> {
  return knownWindow(id, s.models[id] ?? "");
}

export interface Line {
  id: string;
  speaker: string;
  text: string;
  at: number;
}

const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);
export const lineText = (l: Line) => `${clock(l.at)} ${l.speaker}: ${l.text}`;

// Words that say what to do or where, not what about.
const STOP = new Set(
  (
    "about above after again also another anything around away back because been before being both cannot could didn does doing done down during each earlier else ever every from have having here into just know later like made make many more most much must need never next only other over please really right said same saying says should since some something still such sure tell than that their them then there these they thing things think this those though through told under until very want wanted were what when where which while will with would your yours " +
    "scribe add adding append insert write note notes doc docs document file files sheet sheets slide slides deck section mentioned talked talking"
  ).split(" ")
);

function keywords(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  return [...new Set(words.filter((w) => w.length >= 4 && !STOP.has(w)))];
}

/** Speakers the request names, by full name or first name. */
function named(query: string, speakers: string[]): Set<string> {
  const q = ` ${query.toLowerCase()} `;
  const out = new Set<string>();
  for (const s of speakers) {
    const full = s.toLowerCase();
    const first = full.split(/\s+/)[0] ?? "";
    if (q.includes(full) || (first.length >= 2 && new RegExp(`[^\\p{L}]${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\p{L}]`, "u").test(q))) out.add(s);
  }
  return out;
}

/**
 * The "Earlier in the meeting" block: the summary, then older lines picked to fit the budget,
 * shown in the order they were said. `lines` are the lines older than the last 6 and newer
 * than the summary. Empty when there is nothing to add.
 */
export function earlierBlock(lines: Line[], opts: { budget: number; query?: string; summary?: string | null }): string {
  const parts: string[] = [];
  let used = 0;
  if (opts.summary) {
    const block = `Summary of what came before (Scribe's notes, not exact words):\n${opts.summary}`;
    parts.push(block);
    used += tokens(block);
  }
  const picked = new Set<number>();
  const take = (i: number, limit: number) => {
    if (picked.has(i)) return true;
    const t = tokens(lineText(lines[i]!)) + 1;
    if (used + t > limit) return false;
    picked.add(i);
    used += t;
    return true;
  };
  if (opts.query) {
    const words = keywords(opts.query);
    const who = named(opts.query, [...new Set(lines.map((l) => l.speaker))]);
    const scored = lines
      .map((l, i) => {
        const text = l.text.toLowerCase();
        return { i, score: (who.has(l.speaker) ? 2 : 0) + words.filter((w) => text.includes(w)).length };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.i - a.i);
    for (const x of scored) take(x.i, opts.budget * 0.6);
  }
  for (let i = lines.length - 1; i >= 0; i--) if (!take(i, opts.budget)) break;
  if (picked.size) {
    const order = [...picked].sort((a, b) => a - b);
    const skipped = lines.length - picked.size;
    const head = skipped > 0 ? `Earlier lines, exact words (${skipped} other lines left out):` : "Earlier lines, exact words:";
    parts.push(`${head}\n${order.map((i) => lineText(lines[i]!)).join("\n")}`);
  }
  return parts.join("\n\n");
}

/**
 * Which of the older lines to fold into the summary: the oldest ones, until what is left
 * fits in half the budget. Nothing while everything still fits.
 */
export function linesToFold(lines: Line[], budget: number): Line[] {
  let total = lines.reduce((n, l) => n + tokens(lineText(l)) + 1, 0);
  if (total <= budget) return [];
  const out: Line[] = [];
  for (const l of lines) {
    if (total <= budget / 2) break;
    out.push(l);
    total -= tokens(lineText(l)) + 1;
  }
  return out;
}
