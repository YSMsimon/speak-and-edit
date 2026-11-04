import { describe, expect, it } from 'vitest';
import { appendTo, appendTranscript, commentOn, describeNote, newMeetingNote, replaceIn, sections } from '../notes/markdown';

const NOTE = newMeetingNote('Weekly sync', new Date('2026-11-01T18:00:00Z'));
const WITH_ITEMS = NOTE.replace('## Decisions\n', '## Decisions\n- Use Kafka for events\n').replace('## Notes\n', '## Notes\nBeta: November 10\n');

describe('Markdown notes', () => {
  it('a new meeting note has frontmatter and the four sections', () => {
    expect(NOTE.startsWith('---\ntype: meeting\ncreated: 2026-11-01\ntags: [meeting]\n---\n')).toBe(true);
    expect(sections(NOTE).map((s) => s.title)).toEqual(['Weekly sync', 'Decisions', 'Action items', 'Open questions', 'Notes']);
  });

  it('appends under a section, keeps bullets, adds hidden credit, and keeps a blank line before the next heading', () => {
    const r = appendTo(WITH_ITEMS, 'Decisions', 'Use Postgres 16 for the event store', 'Sarah, 14:21: “add Postgres”');
    expect(r.text).toContain('## Decisions\n- Use Kafka for events\n- Use Postgres 16 for the event store %% Sarah, 14:21: “add Postgres” %%\n\n## Action items');
    expect(r).toMatchObject({ where: 'Decisions', added: 'Use Postgres 16 for the event store' });
  });

  it('appends under an empty section', () => {
    const r = appendTo(NOTE, 'Action items', 'Simon sets up staging by Friday');
    expect(r.text).toContain('## Action items\nSimon sets up staging by Friday\n\n## Open questions');
  });

  it('with no section, adds at the end of the note but before Transcript', () => {
    const withTranscript = appendTranscript(WITH_ITEMS, ['Simon (17:51): So basically.']);
    const r = appendTo(withTranscript, null, 'Delete the test lines later');
    expect(r.text).toMatch(/Beta: November 10\nDelete the test lines later\n\n## Transcript\nSimon \(17:51\): So basically\./);
  });

  it('replaces text in a section, exact first, then ignoring case', () => {
    expect(replaceIn(WITH_ITEMS, 'Notes', 'november 10', 'November 17').text).toContain('Beta: November 17');
    expect(() => replaceIn(WITH_ITEMS, 'Decisions', 'Beta', 'x')).toThrow('Couldn’t find “Beta” in Decisions.');
  });

  it('comments as a callout right under the line', () => {
    const r = commentOn(WITH_ITEMS, null, 'beta', 'Check this with Wei', 'Simon, 18:00');
    expect(r.text).toContain('Beta: November 10\n> [!comment] Check this with Wei (Simon, 18:00)');
  });

  it('Record all creates Transcript once, then appends to it', () => {
    const once = appendTranscript(NOTE, ['A (1:00): one']);
    const twice = appendTranscript(once, ['B (1:01): two']);
    expect(twice.match(/## Transcript/g)).toHaveLength(1);
    expect(twice.trimEnd().endsWith('A (1:00): one\nB (1:01): two')).toBe(true);
  });

  it('describes the note for the model without the frontmatter', () => {
    const d = describeNote(WITH_ITEMS);
    expect(d.parts).toContain('Decisions');
    expect(d.text).not.toContain('type: meeting');
    expect(d.text).toContain('- Use Kafka for events');
  });

  it('ignores headings inside code blocks', () => {
    expect(sections('# A\n```\n# not a heading\n```\n## B').map((s) => s.title)).toEqual(['A', 'B']);
  });
});
