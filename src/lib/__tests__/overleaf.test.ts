import { describe, expect, it } from 'vitest';
import type { FileRef } from '../files';
import { appendComment, appendTo, commentOn, commentRange, replaceIn } from '../latex/tex';
import type { PageComment, PageWrite } from '../overleaf/page';
import { parseOverleafUrl, overleafTitle } from '../overleaf/tab';
import { overleafTarget, type OverleafIO } from '../targets/overleaf';
import type { ApplyOptions, WriteIntent } from '../targets/types';

const PAPER = String.raw`\documentclass{article}
\begin{document}

\section{Introduction}
Bees visit some flowers more than others.

\section{Results}
Accuracy was 30\% on the pilot.

\bibliography{refs}
\end{document}`;

const FILE: FileRef = { id: 'overleaf:0123456789abcdef01234567', kind: 'tex', title: 'Scribe test' };
const DIRECT: ApplyOptions = { landAs: 'direct', credit: 'Priya, 14:02: “add that”', withCredit: true };
const intent = (p: Partial<WriteIntent>): WriteIntent => ({ action: 'append', section: null, text: null, find: null, replaceWith: null, cells: [], ...p });

/** A pretend Overleaf tab: one file, and an optional typist who changes it between Scribe's read and write. */
function fakePage(start = PAPER, file = 'main.tex') {
  const page = { text: start, file, reads: 0, writes: 0, typeBetween: 0 };
  const io: OverleafIO = {
    read: async (id) => {
      expect(id).toBe('0123456789abcdef01234567');
      page.reads++;
      const snapshot = { text: page.text, file: page.file, tabId: 7 };
      if (page.typeBetween > 0) {
        page.typeBetween--;
        page.text = page.text.replace('Bees', 'Bees now');
      }
      return snapshot;
    },
    write: async (tabId, f, before, change): Promise<PageWrite> => {
      expect(tabId).toBe(7);
      if (f !== page.file) return { ok: false, reason: 'other-file' };
      if (before !== page.text) return { ok: false, reason: 'changed' };
      page.writes++;
      page.text = page.text.slice(0, change.from) + change.insert + page.text.slice(change.to);
      return { ok: true };
    },
  };
  return { page, target: overleafTarget(io) };
}

describe('Overleaf target', () => {
  it('reads the open file for the model, without the preamble', async () => {
    const { target } = fakePage();
    const ctx = await target.describe(FILE);
    expect(ctx.text).toContain('LaTeX file open: main.tex');
    expect(ctx.text).toContain('Section titles: Introduction | Results');
    expect(ctx.text).not.toContain('documentclass');
    expect(ctx.parts).toEqual(['Introduction', 'Results']);
  });

  it('adds escaped text under a section, credited in a % [Scribe] line', async () => {
    const { page, target } = fakePage();
    const r = await target.apply(FILE, intent({ section: 'Introduction', text: 'R&D spent $5 on 40% of runs' }), DIRECT);
    expect(r.status).toBe('applied');
    expect(r.where).toBe('Introduction');
    expect(page.text).toContain('R\\&D spent \\$5 on 40\\% of runs\n% [Scribe] Priya, 14:02: “add that”\n\n\\section{Results}');
    expect(page.writes).toBe(1);
  });

  it('changes "30%" when the source says 30\\%', async () => {
    const { page, target } = fakePage();
    const r = await target.apply(FILE, intent({ action: 'replace', section: 'Results', find: '30%', replaceWith: '35%' }), { ...DIRECT, withCredit: false });
    expect(r.remove).toBe('30\\%');
    expect(page.text).toContain('Accuracy was 35\\% on the pilot.');
  });

  it('lands as a comment line in Comments only, leaving the text alone', async () => {
    const { page, target } = fakePage();
    const r = await target.apply(FILE, intent({ action: 'replace', section: 'Results', find: '30%', replaceWith: '35%' }), { ...DIRECT, landAs: 'comment', withCredit: false });
    expect(r.status).toBe('commented');
    expect(page.text).toContain('Accuracy was 30\\% on the pilot.\n% [Scribe] Proposed: change “30%” to “35%”');
  });

  it('reads again and redoes the change when someone typed in between', async () => {
    const { page, target } = fakePage();
    page.typeBetween = 1;
    await target.apply(FILE, intent({ section: 'Results', text: 'Recall rose.' }), { ...DIRECT, withCredit: false });
    expect(page.reads).toBe(2);
    expect(page.text).toContain('Bees now visit');
    expect(page.text).toContain('Accuracy was 30\\% on the pilot.\n\nRecall rose.');
  });

  it('gives up after three tries if the file keeps changing', async () => {
    const { page, target } = fakePage();
    page.typeBetween = 99;
    await expect(target.apply(FILE, intent({ text: 'x' }), DIRECT)).rejects.toThrow(/kept changing/);
    expect(page.writes).toBe(0);
  });

  it('won’t write into a file that isn’t .tex', async () => {
    const { page, target } = fakePage(PAPER, 'refs.bib');
    await expect(target.apply(FILE, intent({ text: 'x' }), DIRECT)).rejects.toThrow(/isn’t a \.tex file/);
    expect(page.writes).toBe(0);
  });

  it('runs one edit at a time, so two quick requests both land', async () => {
    const { page, target } = fakePage();
    await Promise.all([
      target.apply(FILE, intent({ section: 'Introduction', text: 'First.' }), { ...DIRECT, withCredit: false }),
      target.apply(FILE, intent({ section: 'Introduction', text: 'Second.' }), { ...DIRECT, withCredit: false }),
    ]);
    expect(page.text).toContain('First.\n\nSecond.');
  });

  it('puts a screenshot in as its Drive link on a % [Scribe] line', async () => {
    const { page, target } = fakePage();
    const r = await target.insertMedia!(
      FILE,
      { kind: 'image', driveId: 'd1', link: 'https://drive.google.com/file/d/d1/view', width: 1, height: 1, caption: 'Shared screen, 14:05 (Priya)', title: 'Screen' },
      intent({ section: 'Results' }),
      { ...DIRECT, withCredit: false },
      null
    );
    expect(r.add).toMatch(/comment in the source/);
    expect(page.text).toContain('Accuracy was 30\\% on the pilot.\n% [Scribe] Screenshot: Shared screen, 14:05 (Priya) https://drive.google.com/file/d/d1/view\n');
  });
});

describe('Overleaf links and tab titles', () => {
  it('reads the project id from a link', () => {
    expect(parseOverleafUrl('https://www.overleaf.com/project/0123456789abcdef01234567')).toBe('0123456789abcdef01234567');
    expect(parseOverleafUrl('https://www.overleaf.com/project')).toBeNull();
    expect(parseOverleafUrl('https://docs.google.com/document/d/abc')).toBeNull();
  });
  it('cleans the tab title', () => {
    expect(overleafTitle('Scribe test - Online LaTeX Editor Overleaf')).toBe('Scribe test');
    expect(overleafTitle(undefined)).toBe('Overleaf project');
  });
});

describe('LaTeX helpers added for Overleaf', () => {
  it('appendComment lands at the end of the section, before blank lines', () => {
    const e = appendComment(PAPER, 'Introduction', 'Check this');
    expect(e.text).toContain('than others.\n% [Scribe] Check this\n\n\\section{Results}');
  });
  it('appendComment with no section lands before the bibliography', () => {
    const e = appendComment(PAPER, null, 'End note');
    expect(e.text).toContain('on the pilot.\n% [Scribe] End note\n\n\\bibliography{refs}');
  });
  it('comment and credit lines in a list are indented like its \\item lines', () => {
    const list = String.raw`\begin{document}
\section{Method}
\begin{itemize}
  \item Tomato bed
\end{itemize}
\end{document}`;
    expect(commentOn(list, 'Method', 'Tomato', 'Add the pepper bed too').text).toContain('  \\item Tomato bed\n  % [Scribe] Add the pepper bed too\n\\end{itemize}');
    expect(appendTo(list, 'Method', 'Herb bed', 'Simon, 14:00').text).toContain('  \\item Herb bed\n  % [Scribe] Simon, 14:00\n\\end{itemize}');
  });
  it('replaceIn prefers the words as said, then as LaTeX writes them', () => {
    expect(replaceIn(PAPER, null, 'pilot', 'main run').text).toContain('30\\% on the main run.');
    expect(replaceIn(PAPER, null, '30%', '31%').removed).toBe('30\\%');
  });
});

describe('"line 12" in an Overleaf project', () => {
  const FILE: FileRef = { id: 'overleaf:test', kind: 'tex', title: 'Paper' };
  const SRC = ['\\documentclass{article}', '\\begin{document}', '\\section{Introduction}', 'Bees visit some flowers more than others.', '\\end{document}'].join('\n');
  const io = (pdfLine?: OverleafIO['pdfLine']): OverleafIO => ({
    read: async () => ({ text: SRC, file: 'main.tex', tabId: 1 }),
    write: async () => ({ ok: true }) as PageWrite,
    ...(pdfLine ? { pdfLine } : {}),
  });

  it('uses the PDF line and finds its source line', async () => {
    const hit = await overleafTarget(io(async () => ({ text: 'Bees visit some flowers more than others.', page: 1 }))).lineRef!(FILE, { n: 12, source: false });
    expect(hit).toEqual({ label: 'line 12 of the PDF', pdfText: 'Bees visit some flowers more than others.', line: 4, text: 'Bees visit some flowers more than others.' });
  });

  it('means the editor’s line when the PDF has no line numbers, or isn’t open', async () => {
    expect(await overleafTarget(io(async () => ({ numbered: false }))).lineRef!(FILE, { n: 4, source: false })).toMatchObject({ line: 4, text: 'Bees visit some flowers more than others.' });
    expect(await overleafTarget(io()).lineRef!(FILE, { n: 3, source: false })).toMatchObject({ line: 3, text: '\\section{Introduction}' });
  });

  it('says not found when the PDF is numbered but doesn’t show that line', async () => {
    expect(await overleafTarget(io(async () => null)).lineRef!(FILE, { n: 400, source: false })).toBeNull();
  });
});

describe('real Overleaf comments', () => {
  it('anchors on the words, else the section heading, with the line', () => {
    const r = commentRange(PAPER, null, 'flowers more');
    expect(PAPER.slice(r.from, r.to)).toBe('flowers more');
    expect(r).toMatchObject({ line: 5, where: 'line 5' });
    const h = commentRange(PAPER, 'Results', null);
    expect(PAPER.slice(h.from, h.to)).toBe('\\section{Results}');
    expect(h.where).toBe('Results, line 7');
    expect(commentRange(PAPER, null, '30%').line).toBe(8);
    expect(() => commentRange(PAPER, null, 'butterflies')).toThrow(/Couldn’t find/);
  });

  it('posts through Overleaf’s comment box, with the credit, and leaves the text alone', async () => {
    const { page } = fakePage();
    const posted: { range: { from: number; to: number }; text: string }[] = [];
    const io: OverleafIO = {
      read: async () => ({ text: page.text, file: 'main.tex', tabId: 7 }),
      write: async () => {
        throw new Error('no text change expected');
      },
      comment: async (_tab, _file, before, range, text): Promise<PageComment> => {
        expect(before).toBe(page.text);
        posted.push({ range, text });
        return { ok: true };
      },
    };
    const out = await overleafTarget(io).apply(FILE, intent({ action: 'comment', find: 'flowers more', text: 'Which flowers?' }), DIRECT);
    expect(out).toMatchObject({ status: 'commented', where: 'line 5', add: 'Which flowers?' });
    expect(PAPER.slice(posted[0]!.range.from, posted[0]!.range.to)).toBe('flowers more');
    expect(posted[0]!.text).toBe('Which flowers? — Priya, 14:02: “add that”');
  });

  it('falls back to a % [Scribe] line, and says so, when the comment box won’t open', async () => {
    const { page, target: _t } = fakePage();
    const io: OverleafIO = {
      read: async () => ({ text: page.text, file: 'main.tex', tabId: 7 }),
      write: async (_tab, _f, before, change): Promise<PageWrite> => {
        if (before !== page.text) return { ok: false, reason: 'changed' };
        page.text = page.text.slice(0, change.from) + change.insert + page.text.slice(change.to);
        return { ok: true };
      },
      comment: async (): Promise<PageComment> => ({ ok: false, reason: 'no-box' }),
    };
    const out = await overleafTarget(io).apply(FILE, intent({ action: 'comment', find: 'flowers more', text: 'Which flowers?' }), DIRECT);
    expect(out.warning).toMatch(/comment box didn’t open/);
    expect(page.text).toMatch(/flowers more than others\.\n% \[Scribe\] Which flowers\?/);
  });

  it('tries again when the Overleaf page reloads mid-comment', async () => {
    let calls = 0;
    const io: OverleafIO = {
      read: async () => ({ text: PAPER, file: 'main.tex', tabId: 7 }),
      write: async () => ({ ok: true }) as PageWrite,
      comment: async (): Promise<PageComment> => {
        calls++;
        if (calls === 1) throw new Error('Frame with ID 0 was removed.');
        return { ok: true };
      },
    };
    const out = await overleafTarget(io).apply(FILE, intent({ action: 'comment', find: 'flowers more', text: 'Which flowers?' }), DIRECT);
    expect(out.status).toBe('commented');
    expect(out.warning).toBeUndefined();
    expect(calls).toBe(2);
  });
});

