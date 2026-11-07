import { describe, expect, it } from 'vitest';
import { QUIET_MS, quietMs, remainderAfter, Segmenter, type Utterance } from '../segmenter';

function fakeTimers() {
  let t = 0;
  let pending: { fn: () => void; at: number } | null = null;
  return {
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        pending = { fn, at: t + ms };
        return pending;
      },
      clearTimeout: (h: unknown) => {
        if (h === pending) pending = null;
      },
      now: () => t,
    },
    advance(ms: number) {
      t += ms;
      if (pending && pending.at <= t) {
        const p = pending;
        pending = null;
        p.fn();
      }
    },
  };
}

describe('Segmenter', () => {
  it('emits a line after the speaker pauses', () => {
    const out: Utterance[] = [];
    const ft = fakeTimers();
    const seg = new Segmenter((u) => out.push(u), () => {}, 1200, ft.timers);
    seg.update('b1', 'Sarah', 'Scribe add');
    seg.update('b1', 'Sarah', 'Scribe add to decisions');
    ft.advance(1000);
    expect(out).toHaveLength(0);
    seg.update('b1', 'Sarah', 'Scribe add to decisions use Postgres');
    ft.advance(1300);
    expect(out.map((u) => u.text)).toEqual(['Scribe add to decisions use Postgres']);
  });

  it('only sends the new part when the same person keeps talking', () => {
    const out: string[] = [];
    const ft = fakeTimers();
    const seg = new Segmenter((u) => out.push(u.text), () => {}, 1200, ft.timers);
    seg.update('b1', 'Wei', 'Agreed.');
    ft.advance(1300);
    seg.update('b1', 'Wei', 'Agreed. Postgres 16, we already run it.');
    ft.advance(1300);
    expect(out).toEqual(['Agreed.', 'Postgres 16, we already run it.']);
  });

  it('flushes the previous speaker when a new block starts', () => {
    const out: string[] = [];
    const ft = fakeTimers();
    const seg = new Segmenter((u) => out.push(`${u.speaker}: ${u.text}`), () => {}, 1200, ft.timers);
    seg.update('b1', 'Sarah', 'Ship it Friday');
    seg.update('b2', 'Marcus', 'No, Monday');
    expect(out).toEqual(['Sarah: Ship it Friday']);
    ft.advance(1300);
    expect(out).toEqual(['Sarah: Ship it Friday', 'Marcus: No, Monday']);
  });

  it('copes with Meet revising words it already sent', () => {
    expect(remainderAfter('Scribe add', 'Scribe, add to decisions')).toBe('Scribe, add to decisions');
    expect(remainderAfter('We should ship', 'We should ship Friday then')).toBe('Friday then');
    expect(remainderAfter('We should shipp it', 'We should ship it Friday')).toBe('ship it Friday');
  });
});

describe('How long Scribe waits before a line counts as finished', () => {
  it('waits for Meet to close the sentence, longer when the words are unfinished', () => {
    expect(quietMs('Scribe, add Postgres 16 to Decisions.')).toBe(QUIET_MS.sentenceEnd);
    expect(quietMs('What did we decide about billing?')).toBe(QUIET_MS.sentenceEnd);
    expect(quietMs('we went with Stripe')).toBe(QUIET_MS.open);
    expect(quietMs('Scribe,')).toBe(QUIET_MS.unfinished);
    expect(quietMs('Scribe, add Postgres 16 to')).toBe(QUIET_MS.unfinished);
    expect(quietMs('the launch is in December and')).toBe(QUIET_MS.unfinished);
    expect(quietMs('so um')).toBe(QUIET_MS.unfinished);
    expect(QUIET_MS).toEqual({ sentenceEnd: 1500, open: 4000, unfinished: 5000 });
  });

  it('keeps a request that runs over two sentences together', () => {
    const out: string[] = [];
    const ft = fakeTimers();
    const seg = new Segmenter((u) => out.push(u.text), () => {}, undefined, ft.timers);
    seg.update('b1', 'Simon', 'Scribe, add to decisions.');
    ft.advance(1200); // a breath before the rest
    expect(out).toEqual([]);
    seg.update('b1', 'Simon', "Scribe, add to decisions. We're using Postgres 16.");
    ft.advance(1499);
    expect(out).toEqual([]);
    ft.advance(1);
    expect(out).toEqual(["Scribe, add to decisions. We're using Postgres 16."]);
  });

  it('waits for Meet’s full stop: the wait starts again when it appears', () => {
    const out: string[] = [];
    const ft = fakeTimers();
    const seg = new Segmenter((u) => out.push(u.text), () => {}, undefined, ft.timers);
    seg.update('b1', 'Simon', 'Scribe, add Postgres 16 to decisions');
    ft.advance(800); // Meet adds the full stop a moment after the speaker stops
    seg.update('b1', 'Simon', 'Scribe, add Postgres 16 to decisions.');
    ft.advance(1499);
    expect(out).toEqual([]);
    ft.advance(1);
    expect(out).toEqual(['Scribe, add Postgres 16 to decisions.']);
  });

  it('still finishes a phrase Meet never punctuates, after 4 s', () => {
    const out: string[] = [];
    const ft = fakeTimers();
    const seg = new Segmenter((u) => out.push(u.text), () => {}, undefined, ft.timers);
    seg.update('b1', 'Simon', 'Scribe pause');
    ft.advance(3999);
    expect(out).toEqual([]);
    ft.advance(1);
    expect(out).toEqual(['Scribe pause']);
  });

  it('holds an unfinished request through a long pause', () => {
    const out: string[] = [];
    const ft = fakeTimers();
    const seg = new Segmenter((u) => out.push(u.text), () => {}, undefined, ft.timers);
    seg.update('b1', 'Simon', 'Scribe, add Postgres 16 to');
    ft.advance(4500);
    expect(out).toEqual([]); // still thinking of the section
    seg.update('b1', 'Simon', 'Scribe, add Postgres 16 to Decisions.');
    ft.advance(1500);
    expect(out).toEqual(['Scribe, add Postgres 16 to Decisions.']);
  });
});
