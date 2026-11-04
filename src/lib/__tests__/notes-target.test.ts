import { describe, expect, it } from 'vitest';
import type { FileRef } from '../files';
import { newMeetingNote } from '../notes/markdown';
import { notesTarget } from '../targets/notes';

/** Just enough of Chrome's FileSystemDirectoryHandle for the vault code, in memory. */
function memoryDir(files = new Map<string, string>(), prefix = ''): FileSystemDirectoryHandle {
  const dir = {
    kind: 'directory',
    name: prefix || 'Vault',
    getDirectoryHandle: async (name: string) => memoryDir(files, `${prefix}${name}/`),
    getFileHandle: async (name: string, o?: { create?: boolean }) => {
      const path = `${prefix}${name}`;
      if (!files.has(path) && !o?.create) throw new DOMException('not found', 'NotFoundError');
      return {
        kind: 'file',
        getFile: async () => ({ text: async () => files.get(path) ?? '' }),
        createWritable: async () => {
          let buf = '';
          return { write: async (d: string) => void (buf += d), close: async () => void files.set(path, buf) };
        },
      };
    },
  };
  return dir as unknown as FileSystemDirectoryHandle;
}

const files = new Map<string, string>([['Meetings/2026-11-01 Weekly sync.md', newMeetingNote('Weekly sync', new Date('2026-11-01'))]]);
const NOTE: FileRef = { id: 'note:Meetings/2026-11-01 Weekly sync.md', kind: 'note', title: 'Weekly sync', vault: 'Vault' };
const target = notesTarget({ root: async () => memoryDir(files) });
const text = () => files.get('Meetings/2026-11-01 Weekly sync.md')!;
const opts = { landAs: 'direct' as const, credit: 'Sarah, 14:21: “add Postgres”', withCredit: true };

describe('Obsidian note target', () => {
  it('describes the note for the model', async () => {
    const ctx = await target.describe(NOTE);
    expect(ctx.parts).toEqual(['Weekly sync', 'Decisions', 'Action items', 'Open questions', 'Notes']);
  });

  it('adds under a heading with hidden credit, then changes it, then comments', async () => {
    const a = await target.apply(NOTE, { action: 'append', section: 'Decisions', text: 'Use Postgres 16', find: null, replaceWith: null, cells: [] }, opts);
    expect(a).toMatchObject({ where: 'Decisions', add: 'Use Postgres 16', status: 'applied' });
    expect(text()).toContain('## Decisions\nUse Postgres 16 %% Sarah, 14:21: “add Postgres” %%\n');
    const r = await target.apply(NOTE, { action: 'replace', section: 'Decisions', text: null, find: 'Postgres 16', replaceWith: 'MySQL 8', cells: [] }, opts);
    expect(r).toMatchObject({ remove: 'Postgres 16', add: 'MySQL 8' });
    const c = await target.apply(NOTE, { action: 'comment', section: null, text: 'Check with Wei', find: 'MySQL', replaceWith: null, cells: [] }, opts);
    expect(c.status).toBe('commented');
    expect(text()).toContain('Use MySQL 8 %% Sarah, 14:21: “add Postgres” %%\n> [!comment] Check with Wei (Sarah, 14:21: “add Postgres”)');
  });

  it('Comments only leaves the text alone and writes a proposal as a callout', async () => {
    const before = text();
    await target.apply(NOTE, { action: 'append', section: 'Notes', text: 'Beta in March', find: null, replaceWith: null, cells: [] }, { ...opts, landAs: 'comment' });
    expect(text()).toContain('> [!comment] Proposed: Beta in March');
    expect(text().replace('\n> [!comment] Proposed: Beta in March (Sarah, 14:21: “add Postgres”)', '')).toBe(before);
  });

  it('screenshots link to the Drive original under a new Shared screen heading', async () => {
    await target.insertMedia!(NOTE, { kind: 'image', driveId: 'd1', link: 'https://drive.google.com/file/d/d1/view', width: 1, height: 1, caption: 'Shared screen, 14:32 (Priya)', title: 'x' }, { action: 'append', section: null, text: null, find: null, replaceWith: null, cells: [] }, { ...opts, withCredit: false }, null);
    expect(text()).toContain('## Shared screen\n[Screenshot: Shared screen, 14:32 (Priya)](https://drive.google.com/file/d/d1/view)');
  });

  it('Record all writes the Transcript, and parallel writes never lose lines', async () => {
    await Promise.all([
      target.appendTranscript(NOTE, ['A (14:00): one']),
      target.apply(NOTE, { action: 'append', section: 'Action items', text: 'Simon: staging by Friday', find: null, replaceWith: null, cells: [] }, { ...opts, withCredit: false }),
      target.appendTranscript(NOTE, ['B (14:01): two']),
    ]);
    expect(text()).toContain('## Transcript\nA (14:00): one\nB (14:01): two');
    expect(text()).toContain('## Action items\nSimon: staging by Friday');
  });
});
