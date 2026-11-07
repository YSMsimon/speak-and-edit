// One place that turns the user's AI choice into a model the AI SDK can call.
// No API keys: the browser's built-in model, Ollama (free cloud models through the Ollama app),
// or the user's own ChatGPT plan through Sign in with ChatGPT.

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { browserAI, doesBrowserSupportBrowserAI } from "@browser-ai/core";
import type { LanguageModel } from "ai";

import type { AiModel } from "./agent";
import { chatgptAccount, chatgptFetch } from "./chatgpt";

import type { ProviderChoice, ProviderId, Settings } from "../settings";

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  chrome: "Built into the browser",
  ollama: "Ollama",
  chatgpt: "ChatGPT",
  openrouter: "OpenRouter",
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI",
  gemini: "Gemini",
  groq: "Groq",
};

/** Services under "Use your own API key". Their addresses are optional permissions, asked for only when used. */
export const PROVIDER_ORIGINS: Partial<Record<ProviderId, string[]>> = {
  openrouter: ["https://openrouter.ai/*"],
  anthropic: ["https://api.anthropic.com/*"],
  // Already allowed for Sign in with ChatGPT.
  openai: ["https://api.openai.com/*"],
  gemini: ["https://generativelanguage.googleapis.com/*"],
  groq: ["https://api.groq.com/*"],
};

/** True when Scribe may reach the provider. Asks Chrome when it may not; call this straight from a click. */
export async function ensureAccess(id: ProviderId, ask = true): Promise<boolean> {
  const origins = PROVIDER_ORIGINS[id];
  if (!origins) return true;
  // request() must run straight from the click (no await before it). It returns true at once if already granted.
  return ask ? chrome.permissions.request({ origins }) : chrome.permissions.contains({ origins });
}

/** Providers that send lines to someone else's servers and bill the user (or their plan). */
const CLOUD: ProviderId[] = ["chatgpt", "openrouter", "anthropic", "openai", "gemini", "groq"];

/** Free models that run on Ollama's servers through the Ollama app. Nothing is downloaded. */
export const OLLAMA_CLOUD_MODELS = ["gpt-oss:120b-cloud", "gemma4:31b-cloud", "gpt-oss:20b-cloud"];

/** The Ollama app names its cloud copies "gpt-oss:120b-cloud", or "glm-5.3:cloud" when there's no size tag. */
export const isOllamaCloud = (model: string) => /[-:]cloud$/.test(model);
export const cloudName = (name: string) => (name.includes(":") ? `${name}-cloud` : `${name}:cloud`);

export interface OllamaModel {
  name: string;
  /** It can read a picture of the shared screen. */
  vision: boolean;
}

let cloudList: { at: number; models: OllamaModel[] } | null = null;

/**
 * Every model Ollama runs on its own servers, from its public list (ollama.com/api/tags), named the
 * way the Ollama app expects. Only chat models. Falls back to the three Scribe was tested with.
 */
export async function listOllamaCloudModels(fetcher: typeof fetch = fetch): Promise<OllamaModel[]> {
  if (cloudList && Date.now() - cloudList.at < 10 * 60_000) return cloudList.models;
  try {
    const res = await fetcher("https://ollama.com/api/tags");
    if (!res.ok) throw new Error(`ollama.com returned ${res.status}`);
    const list = ((await res.json()) as { models?: { name: string; capabilities?: string[] }[] }).models ?? [];
    const models = list
      .filter((m) => !m.capabilities || m.capabilities.includes("completion"))
      .map((m) => ({ name: cloudName(m.name), vision: m.capabilities?.includes("vision") ?? false }));
    if (models.length) {
      cloudList = { at: Date.now(), models };
      return models;
    }
  } catch {
    // Offline, or the list moved: the tested three still work.
  }
  return OLLAMA_CLOUD_MODELS.map((name) => ({ name, vision: name.startsWith("gemma") }));
}

/** True when lines leave this computer with the current choice. */
export function sendsOffDevice(id: ProviderId | null, s: Settings): boolean {
  if (!id) return false;
  if (id === "ollama") return isOllamaCloud(s.models.ollama);
  return CLOUD.includes(id);
}

/** Providers whose APIs enforce a JSON schema. The rest get the keys in the prompt. ChatGPT falls back to the prompt route if its plan rejects schemas. */
const STRICT: ProviderId[] = ["chrome", "chatgpt", "openai", "anthropic", "gemini", "groq"];

export function modelFor(id: ProviderId, s: Settings): AiModel {
  return { model: languageModelFor(id, s), mode: STRICT.includes(id) ? "strict" : "prompt" };
}

/** The model that reads the shared screen: the provider's vision model if one is set, else its normal model.
 * Chrome's built-in model takes pictures as is (@browser-ai/core asks Chrome for image input when a prompt has one). */
export function visionModelName(id: ProviderId, s: Settings): string {
  return s.visionModels[id]?.trim() || s.models[id];
}

export function visionModelFor(id: ProviderId, s: Settings): AiModel {
  return modelFor(id, { ...s, models: { ...s.models, [id]: visionModelName(id, s) } });
}

/**
 * fetch for Ollama that says what went wrong in Scribe's words. The AI SDK passes a refused connection
 * through as a bare "Failed to fetch", which can't be told apart from being offline.
 */
export function ollamaFetch(baseUrl: string, inner: typeof fetch = fetch): typeof fetch {
  const origin = baseUrl.replace(/\/+$/, "");
  return async (input, init) => {
    let res: Response;
    try {
      res = await inner(input, init);
    } catch (e) {
      if (e instanceof TypeError) throw new Error(`Can’t reach Ollama at ${origin}.`);
      throw e;
    }
    if (res.status === 403) throw new Error("Ollama blocked Scribe (403). Set OLLAMA_ORIGINS and restart Ollama.");
    if (res.status === 401) throw new Error("Sign in to Ollama: cloud models need the Ollama app signed in (unauthorized).");
    return res;
  };
}

function languageModelFor(id: ProviderId, s: Settings): LanguageModel {
  const model = s.models[id];
  const key = s.keys[id] ?? "";
  switch (id) {
    case "chrome":
      return browserAI("text");
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: `${s.ollamaUrl.replace(/\/+$/, "")}/v1`,
        fetch: ollamaFetch(s.ollamaUrl),
      }).chatModel(model);
    case "chatgpt":
      // The plan's token replaces an API key; chatgptFetch adds it and shapes each request.
      return createOpenAI({ apiKey: "chatgpt-plan", fetch: chatgptFetch }).responses(model);
    case "openrouter":
      return createOpenAICompatible({ name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKey: key, headers: { "X-Title": "Scribe" } }).chatModel(model);
    case "groq":
      return createOpenAICompatible({ name: "groq", baseURL: "https://api.groq.com/openai/v1", apiKey: key, supportsStructuredOutputs: true }).chatModel(model);
    case "gemini":
      return createOpenAICompatible({ name: "gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: key, supportsStructuredOutputs: true }).chatModel(model);
    case "openai":
      return createOpenAI({ apiKey: key }).chat(model);
    case "anthropic":
      // Anthropic rejects browser requests unless the caller opts in.
      return createAnthropic({ apiKey: key, headers: { "anthropic-dangerous-direct-browser-access": "true" } })(model);
  }
}

export type Availability = { ok: true; detail: string } | { ok: false; detail: string; fix?: string };

export async function checkChrome(): Promise<Availability> {
  if (!doesBrowserSupportBrowserAI()) {
    return { ok: false, detail: "This browser has no built-in model.", fix: "Use Chrome 138+ on a desktop with 22 GB free disk and a GPU with more than 4 GB, or 16 GB RAM." };
  }
  const state = await browserAI("text").availability();
  if (state === "available") return { ok: true, detail: "Ready on this device." };
  if (state === "downloadable" || state === "downloading") {
    return { ok: false, detail: state === "downloading" ? "Downloading the model…" : "The model needs a one-time download.", fix: "Press Test to start the download." };
  }
  return { ok: false, detail: "Chrome says this device can’t run the built-in model." };
}

export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/tags`);
  if (res.status === 403) throw new Error("Ollama blocked Scribe (403). Set OLLAMA_ORIGINS and restart Ollama.");
  if (!res.ok) throw new Error(`Ollama returned ${res.status}.`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name);
}

export async function checkOllama(s: Settings): Promise<Availability> {
  try {
    const models = await listOllamaModels(s.ollamaUrl);
    const model = s.models.ollama;
    // Cloud models don't show up in the local list until used, and need no download.
    if (isOllamaCloud(model)) return { ok: true, detail: `${model} on Ollama’s servers. Needs the Ollama app signed in.` };
    if (!models.includes(model)) return { ok: false, detail: `${model} isn’t on this computer.`, fix: "Pick one of Ollama’s cloud models, or a model you already have." };
    return { ok: true, detail: `${s.ollamaUrl} · ${model}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/403/.test(msg)) return { ok: false, detail: msg, fix: "OLLAMA_ORIGINS" };
    return { ok: false, detail: `Can’t reach Ollama at ${s.ollamaUrl}.`, fix: "Start the Ollama app; Scribe checks again by itself." };
  }
}

export async function checkChatGpt(s: Settings): Promise<Availability> {
  const account = await chatgptAccount();
  if (!account) return { ok: false, detail: "Not signed in." };
  if (!s.models.chatgpt) return { ok: false, detail: "Pick a model." };
  return { ok: true, detail: `${account.email ?? "Signed in"} · ${s.models.chatgpt}` };
}

export async function checkProvider(id: ProviderId, s: Settings): Promise<Availability> {
  if (id === "chrome") return checkChrome();
  if (id === "ollama") return checkOllama(s);
  if (id === "chatgpt") return checkChatGpt(s);
  if (!s.keys[id]) return { ok: false, detail: id === "openrouter" ? "Not connected yet." : "No key added yet." };
  if (!(await ensureAccess(id, false))) return { ok: false, detail: `Scribe needs permission to reach ${PROVIDER_LABEL[id]}.` };
  return { ok: true, detail: `${s.models[id]} · key added` };
}

/** The provider to use. There's no "Auto" any more, so this is the user's choice. */
export async function resolveProvider(choice: ProviderChoice, _s: Settings): Promise<ProviderId | null> {
  return choice;
}
