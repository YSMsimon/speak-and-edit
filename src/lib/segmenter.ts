// Turns Meet's live caption updates into final utterances.
//
// Meet keeps rewriting the current caption block while someone talks. We emit
// a final utterance when the block goes quiet (idleMs with no change), when a
// different block starts (new speaker), or when the page asks us to flush.
// Only the part not yet emitted is sent, so a long monologue arrives as
// several utterances instead of one at the very end.

export interface Utterance {
  blockId: string;
  speaker: string;
  text: string;
  at: number;
}

export interface LiveCaption {
  blockId: string;
  speaker: string;
  text: string;
}

interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** Text of `text` that comes after what was already emitted, cut at a word start. */
export function remainderAfter(emitted: string, text: string): string {
  if (!emitted) return text.trim();
  if (text.startsWith(emitted)) return text.slice(emitted.length).trim();
  // Meet revised earlier words. Keep the common prefix, then back up to a word start.
  let i = 0;
  while (i < emitted.length && i < text.length && emitted[i] === text[i]) i++;
  while (i > 0 && !/\s/.test(text[i - 1] ?? "")) i--;
  return text.slice(i).trim();
}

/**
 * How long the captions must stay unchanged before a line counts as finished, decided from its last words.
 *
 * Why not one shorter number: inside a speaker's turn, 56–60% of pauses last 0.5 s or more and 28–31% last
 * 1 s or more (Heldner & Edlund 2010, Journal of Phonetics 38); in spontaneous speech 2.8% last over 2 s
 * (Campione & Véronis 2002). Any fixed wait short enough to feel quick cuts sentences in half, and a cut
 * request loses its second half (it has no wake word). So Scribe is quick only when the words say the
 * sentence is over, and patient when they say it isn't, as text-aware endpointers do.
 */
export const QUIET_MS = {
  /** Meet put a full stop or question mark at the end: it already heard the sentence end. */
  done: 700,
  /** No clue either way. */
  normal: 1200,
  /** Ends in a comma, or in a word that can't end a request ("add … to", "and", "um"). */
  unfinished: 2000,
};

const UNFINISHED_WORDS = new Set(
  "and or but so then to the a an of in on at for with from into onto under about like than that this these those is are was be add put change move mark make set switch replace remove um uh er erm hmm".split(" ")
);

export function quietMs(text: string): number {
  const t = text.trim();
  if (!t) return QUIET_MS.normal;
  if (/[,:;–—-]$/.test(t)) return QUIET_MS.unfinished;
  if (/[.?!]["”’)]?$/.test(t)) return QUIET_MS.done;
  const last = (t.split(/\s+/).pop() ?? "").toLowerCase().replace(/[^\p{L}']/gu, "");
  return UNFINISHED_WORDS.has(last) ? QUIET_MS.unfinished : QUIET_MS.normal;
}

export class Segmenter {
  private current: { blockId: string; speaker: string; text: string; emitted: string } | null = null;
  private timer: unknown = null;
  private timers: Timers;

  constructor(
    private onFinal: (u: Utterance) => void,
    private onPartial: (p: LiveCaption | null) => void,
    /** A fixed wait, or (the default) one chosen from the words so far. */
    private idleMs: number | ((text: string) => number) = quietMs,
    timers: Partial<Timers> = {}
  ) {
    this.timers = { ...defaultTimers, ...timers };
  }

  update(blockId: string, speaker: string, text: string) {
    const cur = this.current;
    if (!cur || cur.blockId !== blockId) {
      this.flush();
      this.current = { blockId, speaker, text, emitted: "" };
    } else {
      // Meet drops a very long caption and starts over; treat that as a new block.
      if (text.length < cur.text.length - 250) {
        this.flush();
        cur.emitted = "";
      }
      cur.text = text;
      cur.speaker = speaker || cur.speaker;
    }
    const live = remainderAfter(this.current!.emitted, this.current!.text);
    this.onPartial(live ? { blockId, speaker: this.current!.speaker, text: live } : null);
    this.arm(live);
  }

  /** Emit whatever has not been emitted yet. */
  flush() {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    const cur = this.current;
    if (!cur) return;
    const rest = remainderAfter(cur.emitted, cur.text);
    cur.emitted = cur.text;
    if (rest && cur.speaker) {
      this.onFinal({ blockId: cur.blockId, speaker: cur.speaker, text: rest, at: this.timers.now() });
    }
    this.onPartial(null);
  }

  private arm(live: string) {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    const ms = typeof this.idleMs === "function" ? this.idleMs(live) : this.idleMs;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.flush();
    }, ms);
  }
}
