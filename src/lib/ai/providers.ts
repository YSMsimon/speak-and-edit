// One place that turns the user's AI choice into a model the AI SDK can call.
// No API keys: the browser's built-in model, or the user's own ChatGPT plan through Sign in with ChatGPT.

import { createOpenAI } from "@ai-sdk/openai";
import { browserAI, doesBrowserSupportBrowserAI } from "@browser-ai/core";
import type { LanguageModel } from "ai";

import type { AiModel, Reasoning } from "./agent";
import { chatgptAccount, chatgptFetch } from "./chatgpt";

import type { ProviderChoice, ProviderId, Settings } from "../settings";

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  chrome: "Built into the browser",
  chatgpt: "ChatGPT",
};

/** True when lines leave this computer with the current choice. */
export function sendsOffDevice(id: ProviderId | null, _s: Settings): boolean {
  return id === "chatgpt";
}

/**
 * Both providers enforce a JSON schema. ChatGPT falls back to the keys in the prompt if its plan rejects
 * schemas (agent.ts).
 */
export function modelFor(id: ProviderId, s: Settings): AiModel {
  const reasoning = lowestReasoning(id, s.models[id] ?? "");
  return { model: languageModelFor(id, s), mode: "strict", ...(reasoning ? { reasoning } : {}) };
}

/**
 * The least thinking each model takes. Scribe's jobs are short (pick an action, a section, a line), and
 * on its test cases the lowest level was as accurate and much faster (2026-11-07, 32 cases twice each;
 * gpt-5-mini 64/64 either way, median 18.8 s → 5.5 s). gpt-5.1 and later already default to none.
 * Chrome's built-in model has no such setting. A model that refuses the setting gets the request again
 * without it (agent.ts).
 */
export function lowestReasoning(id: ProviderId, model: string): Reasoning | undefined {
  if (id === "chrome") return undefined;
  const m = model.toLowerCase();
  if (/codex|^o\d/.test(m)) return "low";
  if (/^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/.test(m)) return "minimal";
  return /^gpt-[5-9]/.test(m) ? "none" : undefined;
}

/**
 * The model that reads the shared screen. Both providers see pictures with their normal model; Chrome's
 * built-in model takes them as is (@browser-ai/core asks Chrome for image input when a prompt has one).
 */
export function visionModelName(id: ProviderId, s: Settings): string {
  return s.models[id];
}

export function visionModelFor(id: ProviderId, s: Settings): AiModel {
  return modelFor(id, s);
}

function languageModelFor(id: ProviderId, s: Settings): LanguageModel {
  switch (id) {
    case "chrome":
      return browserAI("text");
    case "chatgpt":
      // The plan's token replaces an API key; chatgptFetch adds it and shapes each request.
      return createOpenAI({ apiKey: "chatgpt-plan", fetch: chatgptFetch }).responses(s.models.chatgpt);
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

export async function checkChatGpt(s: Settings): Promise<Availability> {
  const account = await chatgptAccount();
  if (!account) return { ok: false, detail: "Not signed in." };
  if (!s.models.chatgpt) return { ok: false, detail: "Pick a model." };
  return { ok: true, detail: `${account.email ?? "Signed in"} · ${s.models.chatgpt}` };
}

export async function checkProvider(id: ProviderId, s: Settings): Promise<Availability> {
  return id === "chrome" ? checkChrome() : checkChatGpt(s);
}

/** The provider to use. There's no "Auto" any more, so this is the user's choice. */
export async function resolveProvider(choice: ProviderChoice, _s: Settings): Promise<ProviderId | null> {
  return choice;
}
