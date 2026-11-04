// "Connect OpenRouter" without pasting a key: OAuth with PKCE.
// https://openrouter.ai/docs/use-cases/oauth-pkce

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function connectOpenRouter(): Promise<string> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const callback = chrome.identity.getRedirectURL("openrouter");
  const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=S256`;

  const redirected = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const code = redirected ? new URL(redirected).searchParams.get("code") : null;
  if (!code) throw new Error("OpenRouter didn’t return a code. Try again.");

  const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  if (!res.ok) throw new Error(`OpenRouter returned ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { key?: string };
  if (!data.key) throw new Error("OpenRouter returned no key.");
  return data.key;
}
