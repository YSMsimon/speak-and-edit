import type { GoogleDoc } from '../docs/types';

// Builds a Docs API document from simple lines, with real UTF-16 indexes.
// "# " = HEADING_1, "## " = HEADING_2, "- " = bullet, anything else = body text.
export function makeDoc(lines: string[], revisionId = 'rev1'): GoogleDoc {
  const content: NonNullable<GoogleDoc['body']>['content'] = [{ startIndex: 0, endIndex: 1, sectionBreak: {} }];
  let i = 1;
  for (const line of lines) {
    let style = 'NORMAL_TEXT';
    let text = line;
    let bullet = false;
    if (line.startsWith('## ')) { style = 'HEADING_2'; text = line.slice(3); }
    else if (line.startsWith('# ')) { style = 'HEADING_1'; text = line.slice(2); }
    else if (line.startsWith('- ')) { bullet = true; text = line.slice(2); }
    const full = `${text}\n`;
    content!.push({
      startIndex: i,
      endIndex: i + full.length,
      paragraph: {
        elements: [{ startIndex: i, endIndex: i + full.length, textRun: { content: full } }],
        paragraphStyle: { namedStyleType: style },
        ...(bullet ? { bullet: {} } : {}),
      },
    });
    i += full.length;
  }
  return { documentId: 'doc1', title: 'Q4 Platform Spec', revisionId, body: { content } };
}

export const SPEC = [
  '# Q4 Platform Spec',
  '## Decisions',
  '- Use Kafka for events',
  '## Open questions',
  '## Timeline',
  'Beta: November 10',
  'Launch: November 24',
];

/** Applies insertText / insertInlineImage / deleteContentRange to plain text, to check the planned indexes. */
export function applyToText(doc: GoogleDoc, requests: any[]): string {
  let text = (doc.body?.content ?? []).map((e) => (e.paragraph?.elements ?? []).map((x) => x.textRun?.content ?? '').join('')).join('');
  const toStr = (idx: number) => idx - 1; // body starts at index 1 after the section break
  for (const r of requests) {
    if (r.insertText) {
      const at = toStr(r.insertText.location.index);
      text = text.slice(0, at) + r.insertText.text + text.slice(at);
    } else if (r.insertInlineImage) {
      // A picture takes one index; show it as ▣.
      const at = toStr(r.insertInlineImage.location.index);
      text = `${text.slice(0, at)}▣${text.slice(at)}`;
    } else if (r.deleteContentRange) {
      const { startIndex, endIndex } = r.deleteContentRange.range;
      text = text.slice(0, toStr(startIndex)) + text.slice(toStr(endIndex));
    }
  }
  return text;
}

/** The text a Docs range covers, in text from applyToText. */
export const slice = (text: string, r: { startIndex: number; endIndex: number }) => text.slice(r.startIndex - 1, r.endIndex - 1);
