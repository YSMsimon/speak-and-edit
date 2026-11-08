import { FULL } from "./edition";

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
  | "use-ollama"
  | "get-ollama"
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
  "use-ollama": "Use Ollama",
  "get-ollama": "Get Ollama",
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
    problem: { severity: "error", title: "Couldn’t connect ChatGPT", body: "Using your plan needs ChatGPT Plus or Pro. If you have one, try again.", fixes: ["retry", "use-ollama"] },
  },
  { test: /needs ChatGPT Plus or Pro|subscription_sharing_user_not_eligible|can’t share its plan/i, problem: { severity: "error", title: "This ChatGPT account can’t be used", body: "Scribe needs ChatGPT Plus or Pro.", fixes: ["chatgpt-plans", "use-ollama"] } },
  { test: /didn’t allow Scribe|access_denied/i, problem: { severity: "warning", title: "Scribe wasn’t allowed", body: "You declined on ChatGPT’s page. Try again and allow it.", fixes: ["retry"] }, detail: false },
  { test: /plan usage wasn’t allowed|missing_scope/i, problem: { severity: "warning", title: "Plan use wasn’t allowed", body: "Sign in again and allow Scribe to use your plan.", fixes: ["chatgpt-signin"] }, detail: false },
  { test: /limit for Scribe is used up|usage_limit_exceeded/i, problem: { severity: "warning", title: "ChatGPT plan limit reached", body: "Scribe can use it again after the limit resets.", fixes: ["manage-usage", "use-ollama"] }, detail: false },
  { test: /plan usage is unavailable|usage_unavailable|user_unavailable/i, problem: { severity: "warning", title: "ChatGPT is busy", body: "Try again in a minute.", fixes: ["retry", "use-ollama"] } },
  { test: /sign-in ended|Sign in with ChatGPT (first|again)|signed_out|invalid_user/i, problem: { severity: "error", title: "ChatGPT sign-in ended", body: "Sign in again to keep using your plan.", fixes: ["chatgpt-signin", "use-ollama"] }, detail: false },
  { test: /^Not signed in\.?$/i, problem: { severity: "warning", title: "ChatGPT isn’t signed in", body: "Sign in to use your plan, or switch to a free model.", fixes: ["chatgpt-signin", "use-ollama"] }, detail: false },
  { test: /^Pick a model\.?$/i, problem: { severity: "warning", title: "Pick a ChatGPT model", fixes: ["ai-tab"] }, detail: false },
  { test: /sign-in tab was closed|sign-in timed out/i, problem: { severity: "info", title: "Sign-in stopped", body: "The ChatGPT tab closed before it finished.", fixes: ["retry"] }, detail: false },
  { test: /plan can’t do this request|unsupported_capability/i, problem: { severity: "error", title: "ChatGPT can’t do this request", body: "Try it with Ollama instead.", fixes: ["use-ollama"] } },

  // Ollama
  { test: /Ollama blocked Scribe|OLLAMA_ORIGINS|\b403\b.*ollama|ollama.*\b403\b/i, problem: { severity: "error", title: "Ollama is blocking Scribe", body: "Allow Scribe in Ollama with the steps just below, then restart Ollama.", fixes: ["ai-tab"] } },
  { test: /Can’t reach Ollama|localhost:11434|127\.0\.0\.1:11434/i, problem: { severity: "error", title: "Ollama isn’t running", body: "Open the Ollama app, then try again.", fixes: ["retry", "get-ollama"] } },
  { test: /isn’t on this computer/i, problem: { severity: "warning", title: "That model isn’t downloaded", body: "Pick one of Ollama’s cloud models.", fixes: ["ai-tab"] } },
  { test: /not included in your free usage|upgrade for included usage/i, problem: { severity: "warning", title: "Not in Ollama’s free plan", body: "Pick a model marked “tested with Scribe”, or add usage on ollama.com.", fixes: ["retry"] }, detail: false },
  { test: /\bunauthorized\b|sign in to ollama/i, problem: { severity: "error", title: "Sign in to Ollama", body: "Cloud models need the Ollama app signed in, from its menu.", fixes: ["retry"] } },

  // Your own API key
  { test: /needs permission to reach/i, problem: { severity: "warning", title: "Chrome hasn’t allowed this service yet", body: "Press Use or Test again and allow it when Chrome asks.", fixes: ["ai-tab"] }, detail: false },
  { test: /No key added yet|Not connected yet/i, problem: { severity: "info", title: "No key yet", body: "Add a key, or pick ChatGPT, Ollama or the built-in model.", fixes: ["ai-tab"] }, detail: false },
  { test: /incorrect api key|invalid[ _-]?api[ _-]?key|invalid x-api-key|api key not valid|authentication_error|No auth credentials|User not found/i, problem: { severity: "error", title: "That API key didn’t work", body: "Check it was copied in full, or make a new one.", fixes: ["ai-tab"] } },
  { test: /insufficient_quota|credit balance is too low|requires more credits|exceeded your current quota|402/i, problem: { severity: "error", title: "No credit left on that account", body: "Add credit with that service, or switch to a free model.", fixes: ["use-ollama", "ai-tab"] } },

  // Built-in model
  { test: /no built-in model/i, problem: { severity: "error", title: "This browser has no built-in AI", body: "Use Ollama or ChatGPT instead.", fixes: ["use-ollama"] }, detail: false },
  { test: /can’t run the built-in model/i, problem: { severity: "error", title: "This computer can’t run the built-in AI", body: "It needs a stronger graphics card or more memory.", fixes: ["use-ollama"] }, detail: false },
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

  // Overleaf
  { test: /needs your OK to use Overleaf/i, problem: { severity: "warning", title: "Chrome hasn’t allowed Overleaf yet", body: "Press Add in Outputs › Overleaf and allow it when Chrome asks.", fixes: ["outputs-tab"] }, detail: false },
  { test: /Sign in to Overleaf/i, problem: { severity: "error", title: "Overleaf isn’t signed in", body: "Sign in to Overleaf in this Chrome, then try again.", fixes: ["retry"] }, detail: false },
  { test: /isn’t a \.tex file/i, problem: { severity: "info", title: "Open a .tex file in Overleaf", fixes: [] } },
  { test: /Overleaf tab was closed|Overleaf project didn’t open|Overleaf editor closed|switched files in the Overleaf tab/i, problem: { severity: "warning", title: "Couldn’t reach the Overleaf project", body: "Check its tab, then try again.", fixes: ["retry"] } },

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

/**
 * The AI SDK reports "Failed to fetch" or a bare status with the request URL on the error, so the message alone
 * can't tell "Ollama isn't running" from "no internet". This puts the provider back into the message.
 */
export function normalizeError(e: unknown): string {
  const err = (e && typeof e === "object" && "lastError" in e && (e as { lastError?: unknown }).lastError) || e;
  const raw = textOf(err);
  const url = err && typeof err === "object" && "url" in err ? String((err as { url?: unknown }).url ?? "") : "";
  const status = err && typeof err === "object" && "statusCode" in err ? Number((err as { statusCode?: unknown }).statusCode) : undefined;
  if (/:11434\b/.test(url)) {
    let origin = url;
    try {
      origin = new URL(url).origin;
    } catch {
      // keep the raw URL
    }
    if (status === 403) return "Ollama blocked Scribe (403). Set OLLAMA_ORIGINS and restart Ollama.";
    if (status === 401) return "Sign in to Ollama: cloud models need the Ollama app signed in (unauthorized).";
    if (!status && /fetch|connect|network/i.test(raw)) return `Can’t reach Ollama at ${origin}.`;
  }
  return raw;
}

const textOf = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : String(e));

export function describeProblem(e: unknown, full: boolean = FULL): Problem {
  const raw = textOf(e).trim();
  for (const rule of RULES) {
    if (!rule.test.test(raw)) continue;
    const p = rule.problem;
    // "Needs more detail" problems are best told in Scribe's own words.
    const body = p.body ?? (p.severity === "info" && rule.detail !== false ? raw : undefined);
    const showDetail = rule.detail !== false && body !== raw;
    const problem: Problem = { ...p, body, ...(showDetail ? { detail: raw } : {}) };
    return full ? problem : forPublic(problem);
  }
  return { severity: "error", title: "Couldn’t do that", body: raw || "Something went wrong.", fixes: [] };
}

/**
 * The public edition has no Ollama and no API keys: the fallback is Chrome's built-in model, and when
 * that's what failed, ChatGPT.
 */
function forPublic(p: Problem): Problem {
  const builtInFailed = /built-in AI/.test(p.title);
  const fixes = p.fixes
    .filter((f) => f !== "get-ollama")
    .map((f): Fix => (f === "use-ollama" ? (builtInFailed ? "chatgpt-signin" : "use-builtin") : f))
    .filter((f, i, all) => all.indexOf(f) === i);
  const body = p.body
    ?.replace("Try it with Ollama instead.", "Try it with the built-in model instead.")
    .replace("Use Ollama or ChatGPT instead.", "Sign in with ChatGPT instead.")
    .replace("Add a key, or pick ChatGPT, Ollama or the built-in model.", "Sign in with ChatGPT, or use the built-in model.");
  return { ...p, fixes, ...(body !== undefined ? { body } : {}) };
}
