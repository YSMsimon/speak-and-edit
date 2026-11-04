// Word-level segments for AI Elements' Transcription component.
export function toSegments(text: string) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => ({ text: word, startSecond: i, endSecond: i + 1 }));
}
