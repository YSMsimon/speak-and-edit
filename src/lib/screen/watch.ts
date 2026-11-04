// Decides when the shared screen shows something new enough to save.
// Each sample is a tiny grayscale copy of the frame (32×18). A frame is saved
// when it has stopped moving (two samples in a row nearly match) and it differs
// enough from the last saved one. A playing video never stops moving, so it is
// never saved frame by frame; a cursor moving over a slide is too small to count.

export const SAMPLE_W = 32;
export const SAMPLE_H = 18;

/** RGBA pixels → grayscale values 0..255. */
export function signature(rgba: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) out.push(0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!);
  return out;
}

/** Mean absolute difference, 0 (same) to 1 (opposite). */
export function difference(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length / 255;
}

export interface WatchOptions {
  /** Two samples closer than this count as "not moving". */
  still: number;
  /** A still frame this different from the last saved one is new. */
  change: number;
  /** Minimum time between two saves. */
  minGapMs: number;
}

export const DEFAULT_WATCH: WatchOptions = { still: 0.012, change: 0.05, minGapMs: 4000 };

export class SlideWatcher {
  private last: number[] | null = null;
  private saved: number[] | null = null;
  private savedAt = -Infinity;

  constructor(private o: WatchOptions = DEFAULT_WATCH) {}

  /** Feed one sample. Returns true when this frame should be saved. */
  push(sig: number[], now: number): boolean {
    const prev = this.last;
    this.last = sig;
    if (!prev || difference(prev, sig) > this.o.still) return false;
    if (now - this.savedAt < this.o.minGapMs) return false;
    if (this.saved && difference(this.saved, sig) <= this.o.change) return false;
    this.saved = sig;
    this.savedAt = now;
    return true;
  }

  reset() {
    this.last = null;
    this.saved = null;
    this.savedAt = -Infinity;
  }
}
