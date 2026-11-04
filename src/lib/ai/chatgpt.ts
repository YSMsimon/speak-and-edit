// Sign in with ChatGPT: the user's Plus or Pro plan pays for Scribe's requests, so there is no API key.
// Protocol: https://developers.openai.com/siwc/token-sharing-open-source
//
// Two deliberate departures from OpenAI's docs, because Scribe is a browser extension, not a desktop app
// (Simon's call, 2026-11-01):
//  - The docs want a listener on 127.0.0.1 to receive the sign-in. An extension can't listen on a port, so
//    Scribe opens the sign-in in a tab and reads the code from the tab's address when it lands on
//    127.0.0.1. PKCE means the code is useless to anything else that sees it.
//  - The docs want tokens kept out of browser storage. They're kept in chrome.storage.local, which web
//    pages can't read, under their own key, separate from settings.

const AUTH = "https://auth.openai.com/api/accounts";
const DISCOVERY = "https://auth.openai.com/.well-known/openid-configuration";
export const RESOURCE = "https://api.openai.com/v1";
export const SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const REDIRECT = "http://127.0.0.1:1455/auth/callback";
export const MANAGE_USAGE_URL = "https://chatgpt.com/settings/usage";
const DYNAMIC_CLIENT = "dynamic_agent_client";
const STORE_KEY = "scribe.chatgpt";

export interface ChatGptTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: number;
  scopes: string[];
}

export interface ChatGptStore {
  /** One per install, chosen before the first sign-in and kept after sign-out. */
  hostId?: string;
  /** Issued by OpenAI at the first sign-in (oaiapp_…). Reused for later sign-ins. */
  clientId?: string;
  account?: { email: string | null; subject: string };
  tokens?: ChatGptTokens;
}

export class ChatGptError extends Error {
  constructor(message: string, readonly code?: string, readonly signInAgain = false) {
    super(message);
  }
}

// ---------- pure helpers (tested) ----------

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function randomUrlSafe(byteLength = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export function authorizeUrl(a: { clientId?: string; hostId: string; challenge: string; state: string; nonce: string; idTokenHint?: string }): string {
  const p = new URLSearchParams();
  p.set("client_id", a.clientId ?? DYNAMIC_CLIENT);
  // Only on the first registration, per the docs.
  if (!a.clientId) p.set("agent_name_hint", "Scribe");
  p.set("ext_agent_host_id", a.hostId);
  if (a.clientId && a.idTokenHint) p.set("id_token_hint", a.idTokenHint);
  p.set("response_type", "code");
  p.set("redirect_uri", REDIRECT);
  p.set("scope", SCOPE);
  p.set("resource", RESOURCE);
  p.set("state", a.state);
  p.set("nonce", a.nonce);
  p.set("code_challenge", a.challenge);
  p.set("code_challenge_method", "S256");
  return `${AUTH}/authorize?${p.toString()}`;
}

/** Reads the 127.0.0.1 address the sign-in landed on. Throws a readable error for every failure case. */
export function parseCallback(url: string, state: string, knownClientId?: string): { code: string; clientId: string } {
  const q = new URL(url).searchParams;
  if (q.get("state") !== state) throw new ChatGptError("The sign-in reply didn’t match. Try again.");
  const error = q.get("error");
  if (error === "access_denied") throw new ChatGptError("You didn’t allow Scribe to use your ChatGPT plan.", error);
  if (error) throw new ChatGptError(`ChatGPT sign-in failed: ${q.get("error_description") ?? error}`, error);
  const code = q.get("code");
  if (!code) throw new ChatGptError("ChatGPT didn’t send a sign-in code. Try again.");
  const issued = q.get("client_id");
  if (knownClientId) {
    if (issued && issued !== knownClientId) throw new ChatGptError("ChatGPT answered for a different app registration. Try again.");
    return { code, clientId: knownClientId };
  }
  if (!issued || issued === DYNAMIC_CLIENT) throw new ChatGptError("ChatGPT didn’t finish registering Scribe. Try again.");
  return { code, clientId: issued };
}

/** Claims Scribe checks. The ID token comes straight from the token endpoint over TLS (OIDC Core 3.1.3.7), so its signature isn't checked; Scribe only shows the email from it. */
export function readIdToken(idToken: string, expect: { clientId: string; nonce?: string; now: number }): { email: string | null; subject: string } {
  const part = idToken.split(".")[1];
  if (!part) throw new ChatGptError("ChatGPT sent an unreadable sign-in token.");
  const bin = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
  const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as {
    sub?: string;
    aud?: string | string[];
    exp?: number;
    nonce?: string;
    email?: string;
  };
  const aud = Array.isArray(json.aud) ? json.aud : [json.aud];
  if (!json.sub || !aud.includes(expect.clientId)) throw new ChatGptError("ChatGPT’s sign-in token was for a different app.");
  if (expect.nonce && json.nonce !== expect.nonce) throw new ChatGptError("ChatGPT’s sign-in token didn’t match this sign-in.");
  if (json.exp && json.exp * 1000 < expect.now - 60_000) throw new ChatGptError("ChatGPT’s sign-in token had expired. Try again.");
  return { email: json.email ?? null, subject: json.sub };
}

/** Fields the ChatGPT-plan route rejects (preview limitations). */
const UNSUPPORTED = [
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "prompt",
  "prompt_cache_retention",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
  "previous_response_id",
  "service_tier",
];

type InputItem = { type?: string; role?: string; content?: unknown };

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : "")).join("")
      : "";

/** Turns the AI SDK's Responses request into one the ChatGPT-plan route accepts. */
export function planBody(original: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { ...original };
  for (const k of UNSUPPORTED) delete body[k];
  const input = Array.isArray(body.input) ? (body.input as InputItem[]) : [];
  // System items are rejected; their text goes into instructions instead.
  const system = input.filter((i) => i.role === "system").map((i) => textOf(i.content));
  body.input = input.filter((i) => i.role !== "system");
  const instructions = [typeof body.instructions === "string" ? body.instructions : "", ...system].filter(Boolean).join("\n\n");
  if (instructions) body.instructions = instructions;
  else delete body.instructions;
  body.store = false;
  body.stream = true;
  return body;
}

const FRIENDLY: Record<string, string> = {
  subscription_sharing_usage_limit_exceeded: `Your ChatGPT plan’s limit for Scribe is used up for now. Manage usage: ${MANAGE_USAGE_URL}`,
  subscription_sharing_user_not_eligible: "This ChatGPT account can’t share its plan with apps. It needs ChatGPT Plus or Pro.",
  subscription_sharing_usage_unavailable: "ChatGPT plan usage is unavailable right now. Try again in a minute.",
  subscription_sharing_user_unavailable: "ChatGPT plan usage is unavailable right now. Try again in a minute.",
  subscription_sharing_invalid_user: "Sign in with ChatGPT again, in the AI model tab.",
  subscription_sharing_route_not_supported: "ChatGPT plan usage doesn’t support this request.",
};

export function friendlyError(code: string | undefined, param: string | undefined, fallback: string): string {
  if (code === "subscription_sharing_unsupported_capability") return `Your ChatGPT plan can’t do this request${param ? ` (${param})` : ""}.`;
  return (code && FRIENDLY[code]) || fallback;
}

const errorResponse = (status: number, code: string | undefined, message: string) =>
  new Response(JSON.stringify({ error: { message, type: "chatgpt_plan", code: code ?? null } }), { status, headers: { "Content-Type": "application/json" } });

const STATUS: Record<string, number> = {
  subscription_sharing_usage_limit_exceeded: 429,
  subscription_sharing_user_not_eligible: 403,
  subscription_sharing_usage_unavailable: 503,
  subscription_sharing_user_unavailable: 503,
  subscription_sharing_unsupported_capability: 400,
  subscription_sharing_invalid_user: 401,
  subscription_sharing_route_not_supported: 403,
};

/** Reads the event stream to the end and returns the finished response as one JSON body, as a non-streamed call would. */
export async function collectStream(res: Response): Promise<Response> {
  const text = await res.text();
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    let event: { type?: string; response?: { error?: { code?: string; message?: string; param?: string } } };
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    if (event.type === "response.completed" && event.response) {
      return new Response(JSON.stringify(event.response), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (event.type === "response.failed") {
      const e = event.response?.error;
      return errorResponse(STATUS[e?.code ?? ""] ?? 502, e?.code, friendlyError(e?.code, e?.param, e?.message ?? "ChatGPT couldn’t answer."));
    }
    if (event.type === "response.incomplete") return errorResponse(502, "incomplete", "ChatGPT stopped before finishing the answer.");
  }
  return errorResponse(502, "no_completion", "ChatGPT stopped before finishing the answer.");
}

/** Rewrites an error the route sent before streaming into one with a readable message. */
async function readableError(res: Response): Promise<Response> {
  const raw = await res.text();
  let code: string | undefined;
  let param: string | undefined;
  let message = raw.slice(0, 300) || `ChatGPT returned ${res.status}.`;
  try {
    const j = JSON.parse(raw) as { error?: { code?: string; param?: string; message?: string }; detail?: string };
    code = j.error?.code;
    param = j.error?.param;
    message = j.error?.message ?? j.detail ?? message;
  } catch {
    // not JSON
  }
  if (!code && res.status === 401) code = "subscription_sharing_invalid_user";
  return errorResponse(res.status, code, friendlyError(code, param, message));
}

// ---------- storage and tokens ----------

export async function loadStore(): Promise<ChatGptStore> {
  return ((await chrome.storage.local.get(STORE_KEY))[STORE_KEY] as ChatGptStore | undefined) ?? {};
}

async function saveStore(s: ChatGptStore): Promise<void> {
  await chrome.storage.local.set({ [STORE_KEY]: s });
}

function toTokens(j: Record<string, unknown>, now: number, previous?: ChatGptTokens): ChatGptTokens {
  const scopes = typeof j.scope === "string" ? j.scope.split(/[\s+]+/).filter(Boolean) : (previous?.scopes ?? []);
  return {
    accessToken: String(j.access_token),
    refreshToken: String(j.refresh_token ?? previous?.refreshToken ?? ""),
    idToken: typeof j.id_token === "string" ? j.id_token : previous?.idToken,
    expiresAt: now + Number(j.expires_in ?? 3600) * 1000,
    scopes,
  };
}

async function postForm(url: string, fields: Record<string, string>): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

/** Opens the ChatGPT sign-in in a tab and resolves with the 127.0.0.1 address it lands on. */
function waitForRedirect(url: string, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let tabId: number | undefined;
    const matches = (u: string | undefined) => !!u && u.startsWith(REDIRECT) && u.includes(`state=${encodeURIComponent(state)}`);
    const finish = (fn: () => void) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
      fn();
    };
    const onUpdated = (id: number, info: { url?: string }, tab: chrome.tabs.Tab) => {
      const u = info.url ?? tab.pendingUrl ?? tab.url;
      if (!matches(u)) return;
      finish(() => resolve(u!));
      void chrome.tabs.remove(id).catch(() => undefined);
    };
    const onRemoved = (id: number) => {
      if (id === tabId) finish(() => reject(new ChatGptError("The sign-in tab was closed before it finished.")));
    };
    const timer = setTimeout(() => finish(() => reject(new ChatGptError("ChatGPT sign-in timed out. Try again."))), 10 * 60_000);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.create({ url }).then(
      (t) => (tabId = t.id),
      (e) => finish(() => reject(e))
    );
  });
}

/** The whole sign-in. Returns the signed-in account's email. */
export async function signInWithChatGPT(): Promise<{ email: string | null }> {
  const store = await loadStore();
  const hostId = store.hostId ?? `urn:uuid:${crypto.randomUUID()}`;
  if (!store.hostId) await saveStore({ ...store, hostId });
  const verifier = randomUrlSafe(32);
  const state = randomUrlSafe(16);
  const nonce = randomUrlSafe(16);
  const url = authorizeUrl({ clientId: store.clientId, hostId, challenge: await pkceChallenge(verifier), state, nonce, idTokenHint: store.tokens?.idToken });
  const { code, clientId } = parseCallback(await waitForRedirect(url, state), state, store.clientId);
  // Keep the issued registration even if the rest fails, so the next try reuses it.
  if (!store.clientId) await saveStore({ ...(await loadStore()), hostId, clientId });

  const now = Date.now();
  const r = await postForm(`${AUTH}/oauth/token`, { grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT, resource: RESOURCE });
  if (!r.ok) {
    const desc = typeof r.json.error_description === "string" ? `: ${r.json.error_description}` : "";
    throw new ChatGptError(`ChatGPT sign-in failed (${String(r.json.error ?? r.status)}${desc}).`, String(r.json.error ?? ""));
  }
  const tokens = toTokens(r.json, now);
  if (!tokens.scopes.includes("chatgpt.tokens.use.direct")) {
    throw new ChatGptError("Signed in, but ChatGPT plan usage wasn’t allowed. Sign in again and allow it.", "missing_scope");
  }
  const account = tokens.idToken ? readIdToken(tokens.idToken, { clientId, nonce, now }) : { email: null, subject: "" };
  await saveStore({ hostId, clientId, account, tokens });
  return { email: account.email };
}

let refreshing: Promise<string> | null = null;

const TERMINAL = ["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"];

/** A valid access token, refreshed when it's within a minute of expiring. One refresh at a time, since refresh tokens rotate. */
export async function accessToken(): Promise<string> {
  const store = await loadStore();
  const t = store.tokens;
  if (!t || !store.clientId) throw new ChatGptError("Sign in with ChatGPT first, in the AI model tab.", "signed_out", true);
  if (t.expiresAt - 60_000 > Date.now()) return t.accessToken;
  refreshing ??= (async () => {
    try {
      const now = Date.now();
      const r = await postForm(`${AUTH}/oauth/token`, { grant_type: "refresh_token", client_id: store.clientId!, refresh_token: t.refreshToken, resource: RESOURCE });
      if (!r.ok) {
        const code = String(r.json.error ?? "");
        if (TERMINAL.includes(code) || r.status === 400 || r.status === 401) {
          await saveStore({ hostId: store.hostId, clientId: store.clientId, account: store.account });
          throw new ChatGptError("Your ChatGPT sign-in ended. Sign in again in the AI model tab.", code, true);
        }
        throw new ChatGptError(`Couldn’t renew the ChatGPT sign-in (${code || r.status}). Try again in a minute.`, code);
      }
      const tokens = toTokens(r.json, now, t);
      await saveStore({ ...(await loadStore()), tokens });
      return tokens.accessToken;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** fetch for the AI SDK's OpenAI provider: adds the plan's token, shapes the body, and turns the stream back into one answer. */
export async function chatgptFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!/\/responses$/.test(url) || (init.method ?? "GET").toUpperCase() !== "POST" || typeof init.body !== "string") {
    return fetch(input, { ...init, headers });
  }
  const original = JSON.parse(init.body) as Record<string, unknown>;
  const res = await fetch(url, { ...init, headers, body: JSON.stringify(planBody(original)) });
  if (!res.ok) return readableError(res);
  // Scribe only makes non-streamed calls; a streamed caller gets the raw stream.
  return original.stream === true ? res : collectStream(res);
}

export interface ChatGptModel {
  id: string;
  name: string;
}

/** Models this account's plan can use, in the server's order. */
export async function listChatGptModels(): Promise<ChatGptModel[]> {
  const res = await fetch(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new ChatGptError(`Couldn’t list ChatGPT models (${res.status}).`);
  const j = (await res.json()) as { models?: { slug?: string; display_name?: string; visibility?: string }[]; data?: { id: string }[] };
  if (j.models) return j.models.filter((m) => m.visibility === "list" && m.slug).map((m) => ({ id: m.slug!, name: m.display_name ?? m.slug! }));
  return (j.data ?? []).map((m) => ({ id: m.id, name: m.id }));
}

/** Signs out: revokes the refresh token at OpenAI, then forgets the tokens. Keeps the install ID and registration. */
export async function signOutChatGPT(): Promise<{ revoked: boolean }> {
  const store = await loadStore();
  let revoked = false;
  if (store.tokens?.refreshToken && store.clientId) {
    try {
      const d = (await (await fetch(DISCOVERY)).json()) as { revocation_endpoint?: string };
      if (d.revocation_endpoint) {
        const r = await postForm(d.revocation_endpoint, { token: store.tokens.refreshToken, token_type_hint: "refresh_token", client_id: store.clientId });
        revoked = r.ok;
      }
    } catch {
      revoked = false;
    }
  }
  await saveStore({ hostId: store.hostId, clientId: store.clientId });
  return { revoked };
}

export async function chatgptAccount(): Promise<{ email: string | null } | null> {
  const s = await loadStore();
  return s.tokens ? { email: s.account?.email ?? null } : null;
}
