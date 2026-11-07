// Google sign-in (chrome.identity) and the HTTP calls to Docs, Sheets and Slides.

import { buildOutline, type Outline } from "./docs/outline";
import type { BatchUpdateResponse, DocRequest, GoogleDoc, WriteControl } from "./docs/types";

export const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/drive.file",
  // Your name and photo, so your own lines say "Simon Yang" instead of Meet's "You".
  "https://www.googleapis.com/auth/userinfo.profile",
];

export interface GoogleProfile {
  name: string | null;
  picture: string | null;
}

/** The signed-in Google account's name and photo, or null if Scribe isn't signed in yet. Never prompts. */
export async function getGoogleProfile(): Promise<GoogleProfile | null> {
  try {
    const token = await getGoogleToken(false);
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const j = (await res.json()) as { name?: string; picture?: string };
    return { name: j.name?.trim() || null, picture: j.picture ?? null };
  } catch {
    return null;
  }
}

export class GoogleError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: string) {
    super(message);
  }
}

export function hasGoogleClient(): boolean {
  return Boolean(chrome.runtime.getManifest().oauth2?.client_id);
}

/** Set by Sign out, cleared by the next sign-in: until then nothing opens Google's sign-in window by itself. */
const SIGNED_OUT = "scribe.google.signedOut";

export async function isGoogleSignedOut(): Promise<boolean> {
  return Boolean((await chrome.storage.local.get(SIGNED_OUT))[SIGNED_OUT]);
}

export async function getGoogleToken(interactive: boolean): Promise<string> {
  if (!hasGoogleClient()) {
    throw new GoogleError("Google sign-in isn’t set up in this build. Add WXT_GOOGLE_CLIENT_ID to .env and rebuild.");
  }
  const result = await chrome.identity.getAuthToken({ interactive, scopes: SCOPES });
  const token = typeof result === "string" ? result : result?.token;
  if (!token) throw new GoogleError("Google sign-in was cancelled.");
  if (interactive) await chrome.storage.local.remove(SIGNED_OUT);
  return token;
}

/**
 * A token for an API call: quietly when Google allows it, otherwise Google's sign-in window.
 * After Sign out, never the window by itself: the person signs in again from Outputs.
 */
export async function googleToken(): Promise<string> {
  try {
    return await getGoogleToken(false);
  } catch (e) {
    if (await isGoogleSignedOut()) throw new GoogleError("You signed out of Google. Sign in again in Outputs.");
    return getGoogleToken(true);
  }
}

/**
 * Signs out for real: Google withdraws Scribe's access (so a quiet token can't come back), and
 * Chrome forgets its copies. The next sign-in asks again.
 */
export async function signOutGoogle(): Promise<{ revoked: boolean }> {
  await chrome.storage.local.set({ [SIGNED_OUT]: true });
  let revoked = false;
  try {
    const token = await getGoogleToken(false);
    const res = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    revoked = res.ok;
    await chrome.identity.removeCachedAuthToken({ token });
  } catch {
    // No token to withdraw: already signed out.
    revoked = true;
  }
  await chrome.identity.clearAllCachedAuthTokens().catch(() => undefined);
  return { revoked };
}

/** How long to wait before retry n (0-based) after Google says "too many requests". */
export const backoff = (attempt: number, retryAfter: string | null) => {
  const s = Number(retryAfter);
  return Number.isFinite(s) && s > 0 ? Math.min(s, 60) * 1000 : [2000, 5000, 12000, 25000][attempt] ?? 25000;
};
export const RETRIES = 4;

/**
 * Authenticated JSON call to any Google API. Retries once with a fresh token on 401, and
 * waits and retries on 429 / 503 (Sheets allows 60 reads per minute per person).
 */
export async function googleFetch<T>(url: string, init: RequestInit = {}, retried = false, attempt = 0): Promise<T> {
  const token = await googleToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (res.status === 401 && !retried) {
    await chrome.identity.removeCachedAuthToken({ token });
    return googleFetch<T>(url, init, true, attempt);
  }
  if ((res.status === 429 || res.status === 503) && attempt < RETRIES) {
    await new Promise((r) => setTimeout(r, backoff(attempt, res.headers.get("Retry-After"))));
    return googleFetch<T>(url, init, retried, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    let message = `Google returned ${res.status}.`;
    try {
      message = JSON.parse(body)?.error?.message ?? message;
    } catch {
      // keep default
    }
    if (res.status === 403 && /insufficient|scope/i.test(message)) {
      message = "Scribe needs one more Google permission for this file type. Sign out of Google in Outputs, then sign in again.";
    }
    throw new GoogleError(message, res.status, body);
  }
  return (await res.json()) as T;
}

/* ---------- Docs ---------- */

export async function fetchDoc(docId: string): Promise<GoogleDoc> {
  // SUGGESTIONS_INLINE is the only view whose indexes are valid for later writes.
  const url = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}?suggestionsViewMode=SUGGESTIONS_INLINE`;
  return googleFetch<GoogleDoc>(url);
}

export async function fetchOutline(docId: string): Promise<Outline> {
  return buildOutline(await fetchDoc(docId));
}

export async function batchUpdate(docId: string, requests: DocRequest[], writeControl?: WriteControl): Promise<BatchUpdateResponse> {
  const url = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`;
  return googleFetch<BatchUpdateResponse>(url, { method: "POST", body: JSON.stringify({ requests, ...(writeControl ? { writeControl } : {}) }) });
}

export const isRevisionConflict = (e: unknown) =>
  e instanceof GoogleError && e.status === 400 && /revision/i.test(e.message);
