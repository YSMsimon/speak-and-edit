import { describe, expect, it } from 'vitest';
import { buildOutline, describeOutline, findSection } from '../docs/outline';
import { fillCredit, planEdit, sectionAnchor } from '../docs/plan';
import { applyToText, makeDoc, SPEC } from './fixtures';

const doc = makeDoc(SPEC);
const outline = buildOutline(doc);

describe('outline', () => {
  it('splits the doc into heading sections', () => {
    expect(outline.sections.map((s) => s.title)).toEqual(['Q4 Platform Spec', 'Decisions', 'Open questions', 'Timeline']);
    expect(findSection(outline, 'timeline')?.paragraphs.map((p) => p.text.trim())).toEqual(['Beta: November 10', 'Launch: November 24']);
    expect(findSection(outline, 'Open Questions')?.paragraphs).toEqual([]);
  });

  it('describes the doc for the model', () => {
    expect(describeOutline(outline)).toContain('### Decisions\n- Use Kafka for events');
  });
});

describe('planEdit', () => {
  it('appends after the last item of a section and keeps it a bullet', () => {
    const plan = planEdit(outline, { kind: 'append', section: 'Decisions', text: 'Use Postgres 16 for the event store.' });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // The text, then a reset so it doesn't copy the style before it (an italic caption, say).
    expect(plan.requests).toHaveLength(2);
    expect(plan.requests[1]).toEqual({ updateTextStyle: { range: plan.anchor, textStyle: {}, fields: 'bold,italic,underline,strikethrough,link' } });
    expect(applyToText(doc, plan.requests)).toContain('Use Kafka for events\nUse Postgres 16 for the event store.\nOpen questions');
  });

  it('appends under an empty heading as body text, not another heading', () => {
    const plan = planEdit(outline, { kind: 'append', section: 'Open questions', text: 'Who owns on-call for the migration weekend?' });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(applyToText(doc, plan.requests)).toContain('Open questions\nWho owns on-call for the migration weekend?\nTimeline');
    expect(plan.requests).toContainEqual(expect.objectContaining({ updateParagraphStyle: expect.objectContaining({ paragraphStyle: { namedStyleType: 'NORMAL_TEXT' } }) }));
  });

  it('anchors the comment on exactly the inserted text', () => {
    const plan = planEdit(outline, { kind: 'append', section: 'Decisions', text: 'Ship Friday' });
    if (!plan.ok) throw new Error(plan.error);
    const after = applyToText(doc, plan.requests);
    expect(after.slice(plan.anchor.startIndex - 1, plan.anchor.endIndex - 1)).toBe('Ship Friday');
  });

  it('replaces text found in the section', () => {
    const plan = planEdit(outline, { kind: 'replace', section: 'Timeline', find: 'November 24', replaceWith: 'December 8' });
    if (!plan.ok) throw new Error(plan.error);
    expect(applyToText(doc, plan.requests)).toContain('Launch: December 8\n');
    expect(plan.summary).toEqual({ remove: 'November 24', add: 'December 8' });
  });

  it('says so when the text to replace is not there', () => {
    const plan = planEdit(outline, { kind: 'replace', section: 'Timeline', find: 'March 3', replaceWith: 'April 1' });
    expect(plan).toEqual({ ok: false, error: 'Couldn’t find “March 3” in Timeline.' });
  });

  it('appends to the end of the doc when no section matches', () => {
    const plan = planEdit(outline, { kind: 'append', section: null, text: 'Next sync Tuesday' });
    if (!plan.ok) throw new Error(plan.error);
    expect(applyToText(doc, plan.requests).endsWith('Launch: November 24\nNext sync Tuesday\n')).toBe(true);
  });
});

describe('comments', () => {
  it('anchors a section comment on the heading text without its newline', () => {
    const r = sectionAnchor(outline, 'Timeline')!;
    const text = applyToText(doc, []);
    expect(text.slice(r.startIndex - 1, r.endIndex - 1)).toBe('Timeline');
  });

  it('fills the credit line', () => {
    expect(fillCredit('{name}, {time}: “{quote}”', { name: 'Sarah Chen', time: '14:21', quote: 'add Postgres' })).toBe('Sarah Chen, 14:21: “add Postgres”');
  });
});
