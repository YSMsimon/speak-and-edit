import { describe, expect, it } from 'vitest';
import { appendTo, commentOn, describeTex, diffOne, escapeTex, lineReference, matchSourceLine, replaceIn, sections } from '../latex/tex';

const PAPER = String.raw`\documentclass{article}
\usepackage{graphicx}
\title{Scribe test}
\begin{document}
\maketitle

\section{Introduction}
Bees visit some flowers more than others.

\section{Method}
\subsection{Datasets}
We use the spring survey.
\begin{itemize}
  \item Tomato bed
\end{itemize}

\section{Results}

\bibliographystyle{plain}
\bibliography{refs}
\end{document}`;

describe('LaTeX editing (Overleaf)', () => {
  it('finds sections and subsections, stopping before the bibliography and \\end{document}', () => {
    const s = sections(PAPER);
    expect(s.map((x) => x.title)).toEqual(['Introduction', 'Method', 'Datasets', 'Results']);
    const lines = PAPER.split('\n');
    expect(lines[s[3]!.end]).toBe('\\bibliographystyle{plain}');
  });

  it('escapes LaTeX special characters in new text', () => {
    expect(escapeTex('R&D costs 50% of $10 for item_1 #2')).toBe('R\\&D costs 50\\% of \\$10 for item\\_1 \\#2');
    expect(escapeTex('already \\& escaped')).toBe('already \\& escaped');
  });

  it('adds a paragraph at the end of a section, with credit as a LaTeX comment', () => {
    const r = appendTo(PAPER, 'Introduction', 'Bees skip 54% of pale flowers & most weeds.', 'Simon, 14:21');
    expect(r.text).toContain('Bees visit some flowers more than others.\n\nBees skip 54\\% of pale flowers \\& most weeds.\n% [Scribe] Simon, 14:21\n\n\\section{Method}');
    expect(r.where).toBe('Introduction');
  });

  it('adds \\item lines inside a list that ends the section', () => {
    const r = appendTo(PAPER, 'Datasets', 'Pepper bed');
    expect(r.text).toContain('  \\item Tomato bed\n  \\item Pepper bed\n\\end{itemize}');
  });

  it('fills an empty section and never lands after the bibliography', () => {
    const r = appendTo(PAPER, 'Results', 'Clover gets 93% of visits.');
    expect(r.text).toContain('\\section{Results}\nClover gets 93\\% of visits.\n\n\\bibliographystyle{plain}');
    const none = appendTo(PAPER, null, 'A note with no section.');
    expect(none.text.indexOf('A note with no section.')).toBeLessThan(none.text.indexOf('\\bibliographystyle'));
  });

  it('replaces text in a section and skips comment lines', () => {
    const r = replaceIn(PAPER, 'Datasets', 'spring survey', 'spring and summer surveys');
    expect(r.text).toContain('We use the spring and summer surveys.');
    expect(() => replaceIn(PAPER, 'Results', 'spring survey', 'x')).toThrow('Couldn’t find “spring survey” in Results.');
  });

  it('comments with a % [Scribe] line under the line it is about', () => {
    const r = commentOn(PAPER, null, 'than others', 'Cite Ji et al. here', 'Simon, 14:22');
    expect(r.text).toContain('Bees visit some flowers more than others.\n% [Scribe] Cite Ji et al. here (Simon, 14:22)');
  });

  it('describes the body for the model, without the preamble or comments', () => {
    const d = describeTex(PAPER);
    expect(d.parts).toEqual(['Introduction', 'Method', 'Datasets', 'Results']);
    expect(d.text).not.toContain('usepackage');
  });

  it('turns an edit into one small change so the editor keeps cursors and collaborators', () => {
    const after = appendTo(PAPER, 'Results', 'X.').text;
    const d = diffOne(PAPER, after)!;
    expect(PAPER.slice(0, d.from) + d.insert + PAPER.slice(d.to)).toBe(after);
    expect(d.to - d.from).toBe(0);
    expect(d.insert).toBe('X.\n');
    expect(diffOne(PAPER, PAPER)).toBeNull();
  });
});

describe('where a comment line goes', () => {
  it('says the source line, since a % line shows only in the source', () => {
    const doc = ['\\documentclass{article}', '\\begin{document}', 'Bees visit some flowers more often.', '\\end{document}'].join('\n');
    expect(commentOn(doc, null, null, 'Check this').where).toBe('line 3, right after \\begin{document}');
    expect(commentOn(doc, null, 'flowers', 'Cite it').where).toBe('line 4');
  });
});

describe('"line 12" in a request about a paper', () => {
  const src = [
    '\\documentclass{article}',
    '\\usepackage{lineno}',
    '\\begin{document}',
    '\\section{Introduction}',
    'Bees visit some flowers more often than others \\citep{field2026}, and the reasons are not obvious.',
    'In their auto modes, the counting tools let a helper approve each visit without asking the gardener.',
    '% a note to self',
    '\\end{document}',
  ].join('\n');

  it('reads the line number, and "source line" for the editor', () => {
    expect(lineReference('for line 12, make a comment saying cut this')).toEqual({ n: 12, source: false });
    expect(lineReference('comment on source line 40')).toEqual({ n: 40, source: true });
    expect(lineReference('add a timeline section')).toBeNull();
    // How Meet's captions often write "line 21".
    expect(lineReference('Add online 21 to the leader later.')).toEqual({ n: 21, source: false });
    expect(lineReference('Blind 21.')).toEqual({ n: 21, source: false });
  });

  it('finds the source line a PDF line came from, across hyphens and LaTeX commands', () => {
    expect(matchSourceLine(src, 'tools let a helper ap-')).toEqual({ line: 6, text: src.split('\n')[5] });
    expect(matchSourceLine(src, 'prove each visit without asking the gardener.')?.line).toBe(6);
    expect(matchSourceLine(src, 'often than others (Field, 2026), and the reasons')?.line).toBe(5);
    expect(matchSourceLine(src, '1 Introduction')?.line).toBe(4);
    expect(matchSourceLine(src, 'nothing like any of it')).toBeNull();
  });
});
