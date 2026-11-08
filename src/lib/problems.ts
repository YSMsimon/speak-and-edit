// Every failure Scribe shows, turned into one shape: a short title, one line on what to do,
// and the buttons that fix it. The raw message is kept for "Details".
//
// Where problems appear (see README › Errors):
//  - inline, in the row or bar that failed (AI model rows, file rows, the shared-screen bar), until fixed;
//  - a banner at the top of Live, one at a time, for anything that stops Scribe working;
//  - a card in the conversation, under the line that failed;
//  - a toast (two lines, no buttons) only for confirmations, never for a problem that needs a fix.

export type Severity = "error" | "warning" | "info";

export type Fix =
  | "retry"
  | "ai-tab"
  | "outputs-tab"
  | "chatgpt-signin"
  | "chatgpt-plans"
  | "manage-usage"
  | "use-builtin"
  | "google-signin"
  | "reload-meet";

export const FIX_LABEL: Record<Fix, string> = {
  retry: "Try again",
  "ai-tab": "Open AI model",
  "outputs-tab": "Open Outputs",
  "chatgpt-signin": "Continue with ChatGPT",
  "chatgpt-plans": "See ChatGPT plans",
  "manage-usage": "Manage usage",
  "use-builtin": "Use the built-in model",
  "google-signin": "Sign in to Google",
  "reload-meet": "Reload Meet",
};

export interface Problem {
  severity: Severity;
  title: string;
  /** One line: why, or what to do. */
  body?: string;
  fixes: Fix[];
  /** The original message, for Details. Omitted when it adds nothing. */
  detail?: string;
}

interface Rule {
  test: RegExp;
  problem: Omit<Problem, "detail">;
  /** Show the raw message under Details. Default true. */
  detail?: boolean;
}

// Order matters: the first match wins.
const RULES: Rule[] = [
  // ChatGPT sign-in and plan
  {
    test: /invalid_grant|sign-in failed|didn’t finish registering|sign-in reply didn’t match|unreadable sign-in token|sign-in token (was for|didn’t match|had expired)|different app registration/i,
    problem: { severity: "error", title: "Couldn’t connect ChatGPT", body: "Using your plan needs ChatGPT Plus or Pro. If you have one, try again.", fixes: ["retry", "use-builtin"] },
  },
  { test: /needs ChatGPT Plus or Pro|subscription_sharing_user_not_eligible|can’t share its plan/i, problem: { severity: "error", title: "This ChatGPT account can’t be used", body: "Scribe needs ChatGPT Plus or Pro.", fixes: ["chatgpt-plans", "use-builtin"] } },
  { test: /didn’t allow Scribe|access_denied/i, problem: { severity: "warning", title: "Scribe wasn’t allowed", body: "You declined on ChatGPT’s page. Try again and allow it.", fixes: ["retry"] }, detail: false },
  { test: /plan usage wasn’t allowed|missing_scope/i, problem: { severity: "warning", title: "Plan use wasn’t allowed", body: "Sign in again and allow Scribe to use your plan.", fixes: ["chatgpt-signin"] }, detail: false },
  { test: /limit for Scribe is used up|usage_limit_exceeded/i, problem: { severity: "warning", title: "ChatGPT plan limit reached", body: "Scribe can use it again after the limit resets.", fixes: ["manage-usage", "use-builtin"] }, detail: false },
  { test: /plan usage is unavailable|usage_unavailable|user_unavailable/i, problem: { severity: "warning", title: "ChatGPT is busy", body: "Try again in a minute.", fixes: ["retry", "use-builtin"] } },
  { test: /sign-in ended|Sign in with ChatGPT (first|again)|signed_out|invalid_user/i, problem: { severity: "error", title: "ChatGPT sign-in ended", body: "Sign in again to keep using your plan.", fixes: ["chatgpt-signin", "use-builtin"] }, detail: false },
  { test: /^Not signed in\.?$/i, problem: { severity: "warning", title: "ChatGPT isn’t signed in", body: "Sign in to use your plan, or switch to a free model.", fixes: ["chatgpt-signin", "use-builtin"] }, detail: false },
  { test: /^Pick a model\.?$/i, problem: { severity: "warning", title: "Pick a ChatGPT model", fixes: ["ai-tab"] }, detail: false },
  { test: /sign-in tab was closed|sign-in timed out/i, problem: { severity: "info", title: "Sign-in stopped", body: "The ChatGPT tab closed before it finished.", fixes: ["retry"] }, detail: false },
  { test: /plan can’t do this request|unsupported_capability/i, problem: { severity: "error", title: "ChatGPT can’t do this request", body: "Try it with the built-in model instead.", fixes: ["use-builtin"] } },

  // Built-in model
  { test: /no built-in model/i, problem: { severity: "error", title: "This browser has no built-in AI", body: "Sign in with ChatGPT instead.", fixes: ["chatgpt-signin"] }, detail: false },
  { test: /can’t run the built-in model/i, problem: { severity: "error", title: "This computer can’t run the built-in AI", body: "It needs a stronger graphics card or more memory. Or sign in with ChatGPT.", fixes: ["chatgpt-signin"] }, detail: false },
  { test: /one-time download|Downloading the model/i, problem: { severity: "info", title: "The built-in AI needs a download", body: "Press Test in AI model to start it.", fixes: ["ai-tab"] }, detail: false },

  // AI in general
  { test: /No AI is ready/i, problem: { severity: "error", title: "No AI model is ready", body: "Pick one and press Test.", fixes: ["ai-tab"] }, detail: false },
  { test: /didn’t return a usable answer|no JSON object/i, problem: { severity: "warning", title: "The AI’s answer didn’t make sense", body: "Try again, or pick a stronger model.", fixes: ["retry", "ai-tab"] } },
  { test: /Reading the screen failed/i, problem: { severity: "error", title: "Couldn’t read the screen", body: "The AI model has to be able to see pictures.", fixes: ["retry", "ai-tab"] } },

  // Google
  { test: /signed out of Google/i, problem: { severity: "info", title: "Signed out of Google", body: "Sign in to keep editing Docs, Sheets and Slides.", fixes: ["google-signin"] }, detail: false },
  { test: /Google sign-in was cancelled/i, problem: { severity: "info", title: "Google sign-in was cancelled", fixes: ["google-signin"] }, detail: false },
  { test: /Google sign-in isn’t set up/i, problem: { severity: "error", title: "Google sign-in isn’t set up", body: "This build has no Google client ID. See the README.", fixes: [] } },
  { test: /one more Google permission|insufficient.*scope/i, problem: { severity: "error", title: "Google needs one more permission", body: "Sign in to Google again and allow everything Scribe asks for.", fixes: ["google-signin"] } },
  { test: /invalid authentication credentials|Google returned 401|UNAUTHENTICATED/i, problem: { severity: "error", title: "Google sign-in expired", body: "Sign in again to keep editing your files.", fixes: ["google-signin"] } },
  { test: /caller does not have permission|PERMISSION_DENIED|Google returned 403/i, problem: { severity: "error", title: "You can’t edit this file", body: "Ask its owner for edit access, or switch to Comments only.", fixes: ["outputs-tab"] } },
  { test: /entity was not found|NOT_FOUND|Google returned 404/i, problem: { severity: "error", title: "File not found", body: "It may have been deleted, or you lost access.", fixes: ["outputs-tab"] } },
  { test: /Quota exceeded|RESOURCE_EXHAUSTED|Google returned 429/i, problem: { severity: "warning", title: "Google is slowing Scribe down", body: "Too many changes at once. Wait a minute and try again.", fixes: ["retry"] } },
  { test: /doc kept changing|file kept changing/i, problem: { severity: "warning", title: "The file kept changing", body: "Someone was typing at the same spot. Try again.", fixes: ["retry"] }, detail: false },

  // Files and Meet
  { test: /Connect a Google (file|Doc)/i, problem: { severity: "info", title: "No file connected", body: "Connect a Doc, Sheet or Slides file first.", fixes: ["outputs-tab"] }, detail: false },
  { test: /Reload the Meet tab/i, problem: { severity: "error", title: "Scribe lost the Meet tab", body: "Reload Meet so Scribe can reach it again.", fixes: ["reload-meet"] }, detail: false },
  { test: /Open the Meet call first|no Meet call/i, problem: { severity: "info", title: "No Meet call open", body: "Open a Google Meet call in this window.", fixes: [] }, detail: false },
  { test: /Nobody is sharing/i, problem: { severity: "info", title: "Nobody is sharing their screen", fixes: [] }, detail: false },

  // Shared screen and recording
  { test: /Recording was cancelled/i, problem: { severity: "info", title: "Recording was cancelled", fixes: [] }, detail: false },
  { test: /needs a click to record/i, problem: { severity: "warning", title: "Recording needs a click", body: "Press Record, or click Scribe’s icon while on the Meet tab.", fixes: [] }, detail: false },
  { test: /Couldn’t start recording/i, problem: { severity: "error", title: "Couldn’t start recording", fixes: ["retry"] } },
  { test: /Sharing is turned off|Couldn’t share the picture/i, problem: { severity: "warning", title: "Your Google account blocks link sharing", body: "The picture was added as a link instead.", fixes: [] } },
  { test: /couldn’t copy the picture/i, problem: { severity: "error", title: "Google couldn’t copy the picture", body: "Try again in a moment.", fixes: ["retry"] } },
  { test: /still public in Drive/i, problem: { severity: "warning", title: "A picture is still public", body: "Open it in Drive and turn link sharing off.", fixes: [] } },

  // Requests that need more detail
  { test: /didn’t say which|is in \d+ rows|Couldn’t find “/i, problem: { severity: "info", title: "Scribe needs more detail", fixes: [] } },
  { test: /comments only, so they can’t change/i, problem: { severity: "info", title: "Comments only", fixes: [] } },

  // Connection
  { test: /Failed to fetch|NetworkError|network (error|down)|ERR_INTERNET|Load failed/i, problem: { severity: "error", title: "No connection", body: "Check your internet, then try again.", fixes: ["retry"] } },
];

/** The AI SDK wraps retried errors; the last one says what went wrong. */
export function normalizeError(e: unknown): string {
  const err = (e && typeof e === "object" && "lastError" in e && (e as { lastError?: unknown }).lastError) || e;
  return textOf(err);
}

const textOf = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : String(e));

export function describeProblem(e: unknown): Problem {
  const raw = textOf(e).trim();
  for (const rule of RULES) {
    if (!rule.test.test(raw)) continue;
    const p = rule.problem;
    // "Needs more detail" problems are best told in Scribe's own words.
    const body = p.body ?? (p.severity === "info" && rule.detail !== false ? raw : undefined);
    const showDetail = rule.detail !== false && body !== raw;
    return { ...p, body, ...(showDetail ? { detail: raw } : {}) };
  }
  return { severity: "error", title: "Couldn’t do that", body: raw || "Something went wrong.", fixes: [] };
}
