import { describe, expect, it } from 'vitest';
import { buildOutline, closestLines } from '../docs/outline';
import { planEdit } from '../docs/plan';
import { lineFor } from '../targets/docs';
import { NeedsChoice } from '../targets/types';
import { applyToText, makeDoc } from './fixtures';

// Simon's "ai edits" doc on 2026-11-01, as Record all wrote it.
const AI_EDITS = [
  '## Shared screen',
  'Shared screen, 17:40 (Simon)',
  '## Transcript',
  'You (17:51): So basically.',
  'Simon Y (17:55): Screen, say, subscribe. Add this table to the task she subscribe. Screenshot goes into task sheet. Turn on and save each new slide.',
  'Simon Y (17:55): listen to task sheet, turn on, save each new slide up to switch slide. I’m curious screen passing on 3 seconds on each.',
];
const doc = makeDoc(AI_EDITS);
const outline = buildOutline(doc);

describe('Finding the line someone named out loud', () => {
  it('ranks the doc’s lines by the words Meet heard, misheard ones included', () => {
    const ranked = closestLines(outline, 'Listen to task. She turn on Savage, new slide');
    expect(ranked[0]!.paragraph.text).toMatch(/^Simon Y \(17:55\): listen to task sheet/);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it('asks which line when two lines are close, offering the real lines', () => {
    let err: unknown;
    try {
      lineFor(outline, 'Listen to task. She turn on Savage, new slide');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NeedsChoice);
    const { question, options } = err as NeedsChoice;
    expect(question).toBe('Which line did you mean?');
    expect(options[0]).toMatch(/^Simon Y \(17:55\): listen to task sheet/);
    expect(options.every((o) => o.length <= 90)).toBe(true);
  });

  it('takes a clear winner straight away, covering the whole line', () => {
    const r = lineFor(outline, 'listen to task sheet turn on save each new slide up to switch slide');
    const text = applyToText(doc, []);
    expect(text.slice(r.startIndex - 1, r.endIndex - 1)).toMatch(/^Simon Y \(17:55\): listen to task sheet.*each\.$/);
  });

  it('says so when nothing in the doc is like it', () => {
    expect(() => lineFor(outline, 'quarterly revenue forecast for Europe')).toThrow('Couldn’t find a line like');
  });
});

describe('Transcript stays Record all’s', () => {
  it('adds a note with no section at the end of the doc, but before Transcript', () => {
    const plan = planEdit(outline, { kind: 'append', section: null, text: 'Delete the test lines later' });
    if (!plan.ok) throw new Error(plan.error);
    expect(applyToText(doc, plan.requests)).toContain('Shared screen, 17:40 (Simon)\nDelete the test lines later\nTranscript');
  });
});
