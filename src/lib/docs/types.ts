// The subset of the Google Docs API v1 shapes Scribe reads and writes.
// Field names follow https://developers.google.com/workspace/docs/api/reference/rest/v1/documents

export interface DocTextRun {
  content?: string;
  suggestedInsertionIds?: string[];
  suggestedDeletionIds?: string[];
}

export interface DocParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: DocTextRun;
}

export interface DocParagraph {
  elements?: DocParagraphElement[];
  paragraphStyle?: { namedStyleType?: string };
  bullet?: unknown;
}

export interface DocStructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: DocParagraph;
  table?: unknown;
  sectionBreak?: unknown;
}

export interface GoogleDoc {
  documentId: string;
  title: string;
  revisionId?: string;
  body?: { content?: DocStructuralElement[] };
}

export interface Range {
  startIndex: number;
  endIndex: number;
}

export interface Dimension {
  magnitude: number;
  unit: "PT";
}

export type DocRequest =
  | { insertText: { location: { index: number }; text: string } }
  | { deleteContentRange: { range: Range } }
  | { updateParagraphStyle: { range: Range; paragraphStyle: { namedStyleType: string }; fields: string } }
  | { insertComment: { content: string; range: Range } }
  | { insertInlineImage: { location: { index: number }; uri: string; objectSize?: { width?: Dimension; height?: Dimension } } }
  | { deleteParagraphBullets: { range: Range } }
  | { updateTextStyle: { range: Range; textStyle: { italic?: boolean; link?: { url: string } }; fields: string } }
  | { addCommentReply: { suggestionId?: string; commentId?: string; post: { content: string } } }
  | { acceptSuggestion: { suggestionId: string } }
  | { rejectSuggestion: { suggestionId: string } };

export interface WriteControl {
  writeMode?: "EDIT" | "SUGGEST";
  requiredRevisionId?: string;
  targetRevisionId?: string;
}

export interface SuggestionResponse {
  createdSuggestionIds?: string[];
  acceptedSuggestionIds?: string[];
  rejectedSuggestionIds?: string[];
}

export interface BatchUpdateResponse {
  documentId: string;
  replies?: Record<string, unknown>[];
  writeControl?: WriteControl;
  suggestionResponses?: SuggestionResponse[];
  commentUpdateState?: "COMMENT_UPDATE_STATE_UNSPECIFIED" | "NO_UPDATES_REQUESTED" | "ALL_SAVED" | "ALL_FAILED_UNKNOWN_REASON";
}
