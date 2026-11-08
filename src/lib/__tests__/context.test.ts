import { describe, expect, it } from 'vitest';
import { budgetFor, earlierBlock, knownWindow, linesToFold, tokens, type Line } from '../ai/context';

const T0 = new Date(2026, 10, 6, 14, 0).getTime();
const line = (i: number, speaker: string, text: string): Line => ({ id: `m.${i}`, speaker, text, at: T0 + i * 60_000 });

describe('tokens', () => {
  it('counts about 4 characters a token, and one per CJK character', () => {
    expect(tokens('abcdefgh')).toBe(2);
    expect(tokens('预算是四万')).toBe(5);
  });
});

describe('budgetFor', () => {
  it('is 10% of the window, capped at 16k', () => {
    expect(budgetFor(131_072)).toBe(13_107);
    expect(budgetFor(1_000_000)).toBe(16_000);
    expect(budgetFor(4_096)).toBe(409);
  });
});

describe('knownWindow', () => {
  it('gives ChatGPT models a large window and the built-in model 4k', () => {
    expect(knownWindow('chatgpt', 'gpt-5.4-mini')).toBe(128_000);
    expect(knownWindow('chrome', 'text')).toBe(4_096);
  });
});

describe('earlierBlock', () => {
  const lines = [
    line(0, 'Priya', 'The pilot budget is 40 thousand dollars.'),
    ...Array.from({ length: 30 }, (_, i) => line(i + 1, i % 2 ? 'Marco' : 'Lena', `Filler remark number ${i} about the schedule.`)),
  ];

  it('is empty with nothing to add', () => {
    expect(earlierBlock([], { budget: 1000 })).toBe('');
  });

  it('keeps everything, in order, when it fits', () => {
    const b = earlierBlock(lines, { budget: 10_000 });
    expect(b.indexOf('Priya')).toBeLessThan(b.indexOf('number 29'));
    expect(b).not.toContain('left out');
  });

  it('with a small budget, keeps the line the request points at plus the newest others', () => {
    const b = earlierBlock(lines, { budget: 80, query: 'add what Priya said about the budget to decisions' });
    expect(b).toContain('40 thousand');
    expect(b).toContain('number 29');
    expect(b).not.toContain('number 3 ');
    expect(b).toMatch(/other lines left out/);
    // Shown in the order it was said: the matched old line comes first.
    expect(b.indexOf('40 thousand')).toBeLessThan(b.indexOf('number 29'));
  });

  it('puts the summary first', () => {
    const b = earlierBlock(lines.slice(20), { budget: 10_000, summary: '- Pilot budget: 40k (Priya)' });
    expect(b.startsWith('Summary of what came before')).toBe(true);
    expect(b).toContain('Earlier lines, exact words');
  });

  it('never goes over the budget', () => {
    const b = earlierBlock(lines, { budget: 120, query: 'budget' });
    expect(tokens(b)).toBeLessThan(120 + 40);
  });
});

describe('linesToFold', () => {
  const lines = Array.from({ length: 40 }, (_, i) => line(i, 'Lena', `Remark ${i} about the launch plan and the dates.`));
  it('folds nothing while it fits', () => {
    expect(linesToFold(lines, 100_000)).toEqual([]);
  });
  it('folds the oldest lines until half the budget is left', () => {
    const fold = linesToFold(lines, 200);
    expect(fold[0]!.id).toBe('m.0');
    const rest = lines.slice(fold.length);
    const left = rest.reduce((n, l) => n + tokens(`14:00 ${l.speaker}: ${l.text}`) + 1, 0);
    expect(left).toBeLessThanOrEqual(100);
  });
});
