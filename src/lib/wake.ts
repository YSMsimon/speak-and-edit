// Detects whether a caption line is addressed to Scribe ("Scribe, add ...").
// Meet's captions mangle names, so the match is fuzzy: small edit distance,
// optional "hey"/"ok" in front, and trailing punctuation ignored.

const FILLERS = new Set(["hey", "ok", "okay", "hi", "so", "um", "uh", "and", "yo", "alright"]);

export function editDistance(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

const normalize = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function isWakeToken(token: string, wakeWord: string): boolean {
  const t = normalize(token);
  const w = normalize(wakeWord);
  if (!t || !w) return false;
  if (t === w) return true;
  const allowed = w.length <= 4 ? 0 : w.length <= 6 ? 1 : 2;
  if (editDistance(t, w) <= allowed) return true;
  // Meet hears "Scribe!" as "Subscribe!". Accept a short prefix only when the word is used to address
  // someone (followed by , ! . ? or :), so "subscribe to the newsletter" doesn't wake Scribe.
  return t.length > w.length && t.length - w.length <= 3 && t.endsWith(w) && /[,!.?:]$/.test(token.trim());
}

export interface WakeResult {
  addressed: boolean;
  /** The request with the wake word and leading punctuation removed. */
  command: string;
  /** The line was only the wake word ("Scribe,"): the request is probably in the speaker's next line. */
  wakeOnly?: boolean;
}

export function detectWake(text: string, wakeWord: string): WakeResult {
  const tokens = text.trim().split(/\s+/);
  // Look at the first few words only: "Hey Scribe, ..." or "Scribe ...".
  for (let i = 0; i < Math.min(tokens.length, 3); i++) {
    const tok = tokens[i]!;
    if (isWakeToken(tok, wakeWord)) {
      const command = tokens
        .slice(i + 1)
        .join(" ")
        .replace(/^[\s,.:;!?-]+/, "")
        .trim();
      return command.length > 0 ? { addressed: true, command } : { addressed: false, command: "", wakeOnly: true };
    }
    if (!FILLERS.has(normalize(tok))) break;
  }
  return { addressed: false, command: "" };
}

/**
 * "Scribe, resume" while paused. Checked here, without the AI, because nothing said
 * during a pause is sent to the model.
 */
export function isResume(command: string): boolean {
  return /^(please\s+)?(resume|unpause|continue|start listening|keep listening|listen again|you can listen|wake up)\b/i.test(command.trim());
}

/**
 * A request to change Scribe itself. In Record all, spoken lines go to the transcript
 * without the AI; these still go to the AI so Scribe can be switched out of Record all by voice.
 */
export function looksLikeControl(command: string): boolean {
  const c = command.toLowerCase();
  return (
    /\b(switch|change|go|turn|set|use|move)\b.*\b(mode|commands?|smart|record all|auto|ask)\b/.test(c) ||
    /\b(commands?|smart|record all|auto|ask before writing)\s+mode\b/.test(c) ||
    /^(please\s+)?(pause|stop listening|resume|unpause|mute)\b/.test(c) ||
    /\b(start|stop|pause|resume|end)\s+(the\s+)?(video\s+)?recording\b/.test(c) ||
    /\bwork(ing)? (on|in)\b/.test(c) ||
    /\b(ask before writing|approve (changes|edits) first|edit directly|direct edits?)\b/.test(c)
  );
}
