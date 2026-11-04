import { useCallback, useEffect, useState } from "react";
import { browserAI } from "@browser-ai/core";
import { CheckIcon, ChevronDownIcon, ExternalLinkIcon, EyeIcon, KeyRoundIcon, MicIcon, ShieldCheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { pingModel } from "@/lib/ai/agent";
import { toast } from "sonner";

import { chatgptAccount, listChatGptModels, MANAGE_USAGE_URL, signOutChatGPT, type ChatGptModel } from "@/lib/ai/chatgpt";
import { connectOpenRouter } from "@/lib/ai/openrouter";
import { checkProvider, ensureAccess, isOllamaCloud, listOllamaModels, modelFor, OLLAMA_CLOUD_MODELS, PROVIDER_LABEL, sendsOffDevice, visionModelName, type Availability } from "@/lib/ai/providers";
import type { EngineState } from "@/lib/engine";
import { ADVANCED_PROVIDERS, DEFAULT_SETTINGS, PROVIDER_IDS, type ProviderId, type Settings } from "@/lib/settings";
import { ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/glasscn/ui/item";
import { SelectItem, SelectValue } from "@/components/glasscn/ui/select";
import { GlassBadge } from "@/components/glasscn/ui/glasscn/glass-badge";
import { GlassButton } from "@/components/glasscn/ui/glasscn/glass-button";
import { GlassInput } from "@/components/glasscn/ui/glasscn/glass-input";
import { GlassItem } from "@/components/glasscn/ui/glasscn/glass-item";
import { GlassSelect, GlassSelectContent, GlassSelectTrigger } from "@/components/glasscn/ui/glasscn/glass-select";
import {
  EnvironmentVariable,
  EnvironmentVariableCopyButton,
  EnvironmentVariableName,
  EnvironmentVariables,
  EnvironmentVariablesContent,
  EnvironmentVariablesHeader,
  EnvironmentVariablesTitle,
  EnvironmentVariableValue,
} from "@/components/ai-elements/environment-variables";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { Logo, PROVIDER_LOGO } from "./logos";
import { ProblemCard } from "./problem";
import { Hint, SectionLabel, subtle, TILE } from "./shared";

/** One short line per provider. The setup details show only when a row is open. */
const BLURB: Record<ProviderId, string> = {
  chrome: "Gemini Nano, on this computer",
  ollama: "Free cloud models",
  chatgpt: "Plus or Pro",
  openrouter: "Sign in, free models",
  anthropic: "Your API key",
  openai: "Your API key",
  gemini: "Your API key, free tier",
  groq: "Your API key, free tier",
};

/** Where to get a key. OpenRouter needs none: Connect signs in and makes one. */
const KEY_HELP: Partial<Record<ProviderId, string>> = {
  anthropic: "console.anthropic.com → API keys",
  openai: "platform.openai.com → API keys",
  gemini: "aistudio.google.com → Get API key (free tier)",
  groq: "console.groq.com → API keys (free tier)",
  openrouter: "Or paste a key from openrouter.ai/keys",
};

const openUsage = () => void chrome.tabs.create({ url: MANAGE_USAGE_URL });

export function AiTab(props: {
  state: EngineState;
  settings: Settings;
  update: (p: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => void;
  /** Signs in and shows OpenAI's first-use notice (App owns both). */
  connectChatGpt: () => Promise<ChatGptModel[]>;
  /** Bumped when a "Continue with ChatGPT" fix button elsewhere asks for a sign-in. */
  signInRequest: number;
}) {
  const { state, settings, update } = props;
  const [status, setStatus] = useState<Partial<Record<ProviderId, Availability>>>({});
  // The last failure per row, shown inline until the next try. Successes are toasts.
  const [failure, setFailure] = useState<{ id: ProviderId; error: unknown } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [gptModels, setGptModels] = useState<ChatGptModel[]>([]);
  // A row opened without switching Scribe to it, e.g. after a failed sign-in.
  const [open, setOpen] = useState<ProviderId | null>(null);
  const signedIn = settings.chatgptAccount !== null;

  const refresh = useCallback(async () => {
    const out: Partial<Record<ProviderId, Availability>> = {};
    await Promise.all(PROVIDER_IDS.map(async (id) => (out[id] = await checkProvider(id, settings).catch((e) => ({ ok: false, detail: e instanceof Error ? e.message : String(e) })))));
    setStatus(out);
    listOllamaModels(settings.ollamaUrl).then(setOllamaModels, () => setOllamaModels([]));
    // The sign-in can end on its own (a refresh token expires); keep the panel honest about it.
    if (settings.chatgptAccount !== null && !(await chatgptAccount())) update({ chatgptAccount: null });
  }, [settings, update]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (signedIn) listChatGptModels().then(setGptModels, () => setGptModels([]));
  }, [signedIn]);

  const runTest = async (id: ProviderId) => {
    setBusy(id);
    setFailure(null);
    try {
      if (id === "chrome") {
        // First use downloads the model; this click counts as the user gesture Chrome requires.
        await browserAI("text").createSessionWithProgress((p: number) => setProgress(`Downloading the model… ${Math.round(p * 100)}%`));
      }
      const out = await pingModel(modelFor(id, settings));
      toast.success(`${PROVIDER_LABEL[id]} works`, { description: `Read a test request as: ${out}` });
    } catch (e) {
      setFailure({ id, error: e });
      setOpen(id);
    } finally {
      setBusy(null);
      setProgress(null);
      void refresh();
    }
  };

  const setModel = (id: ProviderId, model: string) => update((s) => ({ models: { ...s.models, [id]: model } }));

  const testRow = (id: ProviderId) => (
    <div className="mt-1 flex flex-col gap-2">
      <div className="flex">
        <GlassButton className="h-7 rounded-full border-white/15 bg-white/[0.06] px-3 text-xs" disabled={busy !== null} onClick={() => runTest(id)} size="xs">
          {busy === id ? "Testing…" : "Test"}
        </GlassButton>
      </div>
      {busy === id && progress && <Hint className="px-0">{progress}</Hint>}
    </div>
  );

  const resolved = state.provider;
  const offDevice = sendsOffDevice(resolved ?? settings.provider, settings);
  const ollamaChoices = Array.from(new Set([...OLLAMA_CLOUD_MODELS, ...ollamaModels, settings.models.ollama]));

  const choose = (id: ProviderId) => {
    update({ provider: id });
    setOpen(null);
  };

  /** Key providers: Chrome asks for that one service's permission first (from this click), then Scribe uses it. */
  const useKeyProvider = (id: ProviderId) => {
    void ensureAccess(id).then((ok) => {
      if (ok) return choose(id);
      setOpen(id);
      setFailure({ id, error: `Scribe needs permission to reach ${PROVIDER_LABEL[id]}. Press Use again and allow it.` });
    });
  };

  const setKey = (id: ProviderId, key: string) => update((s) => ({ keys: { ...s.keys, [id]: key.trim() || undefined } }));

  const connectRouter = () => {
    const allowed = ensureAccess("openrouter");
    setBusy("openrouter");
    setFailure(null);
    void allowed
      .then(async (ok) => {
        if (!ok) throw new Error("Scribe needs permission to reach OpenRouter. Press Connect again and allow it.");
        setKey("openrouter", await connectOpenRouter());
        choose("openrouter");
        toast.success("Connected to OpenRouter", { description: "The key is stored only in this browser." });
      })
      .catch((e) => {
        setOpen("openrouter");
        setFailure({ id: "openrouter", error: e });
      })
      .finally(() => setBusy(null));
  };

  const connectChatGpt = async () => {
    setBusy("chatgpt");
    setFailure(null);
    try {
      setGptModels(await props.connectChatGpt());
      setOpen(null);
    } catch (e) {
      setOpen("chatgpt");
      setFailure({ id: "chatgpt", error: e });
    } finally {
      setBusy(null);
    }
  };

  // A fix button elsewhere ("ChatGPT sign-in ended") asked for a sign-in.
  useEffect(() => {
    if (props.signInRequest > 0) void connectChatGpt();
    // Only when the request number changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.signInRequest]);

  const disconnectChatGpt = async () => {
    setBusy("chatgpt");
    try {
      const { revoked } = await signOutChatGPT();
      update((s) => ({ chatgptAccount: null, provider: s.provider === "chatgpt" ? DEFAULT_SETTINGS.provider : s.provider }));
      if (revoked) toast.success("Signed out of ChatGPT");
      else toast.warning("Signed out here", { description: "ChatGPT didn’t confirm it. You can also disconnect Scribe in ChatGPT’s settings." });
    } finally {
      setBusy(null);
    }
  };

  const action = (id: ProviderId) => {
    if (settings.provider === id) {
      return (
        <GlassBadge className="neon neon-green neon-soft gap-1 rounded-full border-transparent px-2 py-1 text-[11px]" glassVariant="liquid">
          <CheckIcon className="size-3 text-emerald-300" />
          In use
        </GlassBadge>
      );
    }
    if (id === "chatgpt" && !signedIn) {
      return (
        <GlassButton className="neon neon-teal neon-soft rounded-full px-3" disabled={busy !== null} onClick={() => void connectChatGpt()} size="xs">
          <Logo className="size-3.5" name="chatgpt" />
          {busy === "chatgpt" ? "Signing in…" : "Continue with ChatGPT"}
        </GlassButton>
      );
    }
    if (id === "openrouter" && !settings.keys.openrouter) {
      return (
        <GlassButton className="neon neon-soft rounded-full px-3" disabled={busy !== null} onClick={connectRouter} size="xs">
          {busy === "openrouter" ? "Connecting…" : "Connect"}
        </GlassButton>
      );
    }
    if (ADVANCED_PROVIDERS.includes(id) && !settings.keys[id]) {
      return (
        <GlassButton className="neon neon-soft rounded-full px-3" onClick={() => setOpen(open === id ? null : id)} size="xs">
          Add key
        </GlassButton>
      );
    }
    return (
      <GlassButton className="neon neon-soft rounded-full px-3" onClick={() => (ADVANCED_PROVIDERS.includes(id) ? useKeyProvider(id) : choose(id))} size="xs">
        Use
      </GlassButton>
    );
  };

  const keySetup = (id: ProviderId) => (
    <div className="flex flex-col gap-2">
      <GlassInput
        aria-label={`${PROVIDER_LABEL[id]} API key`}
        autoComplete="off"
        className="h-9 rounded-xl border-white/15 bg-white/[0.05] text-xs"
        onChange={(e) => setKey(id, e.target.value)}
        placeholder={id === "openrouter" ? "Connected key, or paste one" : "Paste API key"}
        type="password"
        value={settings.keys[id] ?? ""}
      />
      <GlassInput aria-label={`${PROVIDER_LABEL[id]} model`} className="h-9 rounded-xl border-white/15 bg-white/[0.05] font-mono text-xs" onChange={(e) => setModel(id, e.target.value)} value={settings.models[id]} />
      {KEY_HELP[id] && <Hint className="px-0 leading-relaxed">{KEY_HELP[id]}</Hint>}
      <div className="flex">
        <GlassButton
          className="h-7 rounded-full px-3"
          disabled={busy !== null || !settings.keys[id]}
          onClick={() => {
            // Ask for the permission from the click, then test.
            void ensureAccess(id).then((ok) => (ok ? runTest(id) : setFailure({ id, error: `Scribe needs permission to reach ${PROVIDER_LABEL[id]}.` })));
          }}
          size="xs"
        >
          {busy === id ? "Testing…" : "Test"}
        </GlassButton>
      </div>
    </div>
  );

  const setup = (id: ProviderId) => {
    if (id === "chrome") return testRow("chrome");
    if (id === "ollama") {
      return (
        <div className="flex flex-col gap-2.5">
          <GlassSelect
            items={ollamaChoices.map((m) => ({ value: m, label: `${m}${isOllamaCloud(m) ? " · cloud, free" : " · on this computer"}` }))}
            onValueChange={(v) => v && setModel("ollama", String(v))}
            value={settings.models.ollama}
          >
            <GlassSelectTrigger aria-label="Ollama model" className="h-10 w-full rounded-[14px] border-white/20 bg-white/[0.07] px-3 text-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" size="sm">
              <Logo className="size-5 shrink-0" name="ollama" />
              <SelectValue />
            </GlassSelectTrigger>
            <GlassSelectContent>
              {ollamaChoices.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                  {isOllamaCloud(m) ? " · cloud, free" : " · on this computer"}
                </SelectItem>
              ))}
            </GlassSelectContent>
          </GlassSelect>
          <Collapsible>
            <CollapsibleTrigger asChild>
              <GlassButton className="group rounded-full text-xs" glassVariant="subtle" size="xs">
                Can’t connect?
                <ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" />
              </GlassButton>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 flex flex-col gap-2">
              <Hint className="px-0 leading-relaxed">Cloud models need you signed in from the Ollama app’s menu. A 403 means Ollama doesn’t allow Scribe yet:</Hint>
              <EnvironmentVariables className={cn("rounded-xl", subtle)} defaultShowValues>
                <EnvironmentVariablesHeader className="px-3 py-2">
                  <EnvironmentVariablesTitle className="text-xs">Allow Scribe in Ollama</EnvironmentVariablesTitle>
                </EnvironmentVariablesHeader>
                <EnvironmentVariablesContent>
                  <EnvironmentVariable className="flex-col items-start gap-1 px-3 py-2" name="OLLAMA_ORIGINS" value={`chrome-extension://${chrome.runtime.id}`}>
                    <EnvironmentVariableName className="text-xs" />
                    <div className="flex w-full items-center justify-between gap-2">
                      <EnvironmentVariableValue className="truncate text-xs" />
                      <EnvironmentVariableCopyButton />
                    </div>
                  </EnvironmentVariable>
                </EnvironmentVariablesContent>
              </EnvironmentVariables>
              <Hint className="px-0 leading-relaxed">
                On a Mac: <code className="break-all">launchctl setenv OLLAMA_ORIGINS chrome-extension://{chrome.runtime.id}</code>, then quit and reopen Ollama. Don’t use * here: it lets every website reach Ollama.
              </Hint>
              <GlassInput aria-label="Ollama address" className="h-9 rounded-xl border-white/15 bg-white/[0.05] font-mono text-xs" onChange={(e) => update({ ollamaUrl: e.target.value.trim() })} value={settings.ollamaUrl} />
            </CollapsibleContent>
          </Collapsible>
          {testRow("ollama")}
        </div>
      );
    }
    if (ADVANCED_PROVIDERS.includes(id)) return keySetup(id);
    if (!signedIn) return failure?.id === "chatgpt" ? <ProblemCard onRetry={() => void connectChatGpt()} problem={failure.error} /> : null;
    return (
      <div className="flex flex-col gap-2.5">
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs leading-relaxed text-muted-foreground">
          <span className="truncate">Using ChatGPT plan · {settings.chatgptAccount}</span>
          <button className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline" onClick={openUsage} type="button">
            Manage usage
            <ExternalLinkIcon className="size-3" />
          </button>
        </p>
        {gptModels.length > 0 && (
          <GlassSelect items={gptModels.map((m) => ({ value: m.id, label: m.name }))} onValueChange={(v) => v && setModel("chatgpt", String(v))} value={settings.models.chatgpt}>
            <GlassSelectTrigger aria-label="ChatGPT model" className="h-10 w-full rounded-[14px] border-white/20 bg-white/[0.07] px-3 text-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" size="sm">
              <Logo className="size-6 shrink-0 text-teal-300" name="chatgpt" />
              <SelectValue />
            </GlassSelectTrigger>
            <GlassSelectContent>
              {gptModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </GlassSelectContent>
          </GlassSelect>
        )}
        <div className="flex gap-2">
          <GlassButton className="h-7 rounded-full border-white/15 bg-white/[0.06] px-3" disabled={busy !== null} onClick={() => runTest("chatgpt")} size="xs">
            {busy === "chatgpt" ? "Working…" : "Test"}
          </GlassButton>
          <GlassButton className="h-7 rounded-full px-3" disabled={busy !== null} glassVariant="subtle" onClick={() => void disconnectChatGpt()} size="xs">
            Sign out
          </GlassButton>
        </div>
      </div>
    );
  };

  /** The provider's problem, if any, then its setup: shown for the chosen one, or one opened after a failure. */
  const details = (p: ProviderId) => (
    <>
      {failure?.id === p && p !== "chatgpt" ? (
        <ProblemCard onRetry={() => void runTest(p)} problem={failure.error} />
      ) : (
        status[p] && !status[p]!.ok && p !== "chatgpt" && <ProblemCard onRetry={() => void runTest(p)} problem={status[p]!.detail} />
      )}
      {failure?.id === "chatgpt" && p === "chatgpt" && signedIn && <ProblemCard onRetry={() => void runTest(p)} problem={failure.error} />}
      {setup(p)}
    </>
  );

  /** "Use your own API key" rows: logo, name, one line, an action; setup underneath when open. */
  const row = (p: ProviderId) => {
    const selected = settings.provider === p;
    const expanded = selected || open === p;
    const st = status[p];
    return (
      <GlassItem className={cn("gap-3 rounded-[18px] border-white/[0.13] bg-white/[0.045] px-3 py-3", selected && "neon neon-soft border-transparent bg-white/[0.07]")} glassVariant="subtle" key={p} size="sm">
        <ItemMedia className={cn(TILE, "border-white/[0.12] bg-white/[0.04]")}>
          <Logo name={PROVIDER_LOGO[p]} />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="flex items-center gap-1.5 text-[13px]">
            {PROVIDER_LABEL[p]}
            {st && <span aria-label={st.ok ? "Ready" : "Not ready"} className={cn("size-1.5 rounded-full", st.ok ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" : "bg-muted-foreground/40")} title={st.ok ? "Ready" : st.detail} />}
          </ItemTitle>
          <ItemDescription className="truncate text-xs">{BLURB[p]}</ItemDescription>
        </ItemContent>
        <ItemActions>{action(p)}</ItemActions>
        {expanded && <div className="flex min-w-0 basis-full flex-col gap-2 border-t border-white/10 pt-3">{details(p)}</div>}
      </GlassItem>
    );
  };

  const MAIN = ["chatgpt", "ollama", "chrome"] as const;
  const CARD_LINE: Record<(typeof MAIN)[number], string> = {
    chatgpt: signedIn ? "Your plan" : "Plus or Pro",
    ollama: "Free · cloud models",
    chrome: "On this device",
  };
  const CARD_NAME: Record<(typeof MAIN)[number], string> = { chatgpt: "ChatGPT", ollama: "Ollama", chrome: "Chrome AI" };
  const pick = (p: (typeof MAIN)[number]) => (p === "chatgpt" && !signedIn ? void connectChatGpt() : choose(p));
  const shown = MAIN.find((p) => open === p) ?? MAIN.find((p) => settings.provider === p) ?? null;

  return (
    <section aria-label="AI model" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 pt-1 pb-5 text-[13px] text-[#f4f3fa]">
      <div className="grid shrink-0 grid-cols-3 gap-2">
        {MAIN.map((p) => {
          const selected = settings.provider === p;
          const st = status[p];
          return (
            <button
              aria-pressed={selected}
              className={cn(
                "relative flex min-h-[132px] min-w-0 flex-col items-center justify-center gap-2 rounded-[18px] border border-white/20 bg-[linear-gradient(135deg,rgba(116,108,160,0.14),rgba(15,20,29,0.55)_55%,rgba(92,105,144,0.16))] px-2 pt-3.5 pb-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl transition-colors hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-400 disabled:opacity-50",
                selected && "neon border-transparent bg-[linear-gradient(135deg,rgba(79,94,197,0.22),rgba(7,28,35,0.75)_50%,rgba(124,77,143,0.2))] shadow-[0_0_24px_-8px_rgba(168,85,247,0.6)]"
              )}
              disabled={busy !== null && busy !== p}
              key={p}
              onClick={() => pick(p)}
              type="button"
            >
              {st?.ok && <span aria-label="Ready" className="absolute top-2.5 right-2.5 size-1.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.9)]" />}
              <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-[14px]", p === "chatgpt" && "text-teal-300")}>
                <Logo className="size-10" name={PROVIDER_LOGO[p]} />
              </span>
              <span className="text-[14px] leading-5 font-semibold tracking-[-0.025em]">{CARD_NAME[p]}</span>
              {p === "chatgpt" && !signedIn ? (
                <span className="neon neon-teal flex min-h-7 w-full items-center justify-center rounded-full bg-teal-400/[0.12] px-2 py-1 text-[11px] font-medium text-white">{busy === "chatgpt" ? "Signing in…" : "Sign in"}</span>
              ) : (
                <span className="flex min-h-7 w-full items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.035] px-1 py-1 text-[11px] leading-tight text-[#bbbcca]">{CARD_LINE[p]}</span>
              )}
            </button>
          );
        })}
      </div>

      {shown && (shown !== "chatgpt" || signedIn || failure?.id === "chatgpt") && (
        <div className="flex shrink-0 flex-col gap-3 rounded-[18px] border border-white/20 bg-[linear-gradient(115deg,rgba(69,105,134,0.17),rgba(24,25,37,0.6)_50%,rgba(116,84,137,0.2))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl">
          <div className="flex items-center gap-2 text-xs text-[#bbbcca]">
            <Logo className="size-4" name={PROVIDER_LOGO[shown]} />
            {PROVIDER_LABEL[shown]}
            {settings.provider === shown && (
              <span className="ml-auto inline-flex items-center gap-1 text-foreground">
                <CheckIcon className="size-3.5 text-green-400" />
                In use
              </span>
            )}
          </div>
          {details(shown)}
        </div>
      )}

      <Collapsible className="shrink-0" defaultOpen={ADVANCED_PROVIDERS.includes(settings.provider)}>
        <CollapsibleTrigger asChild>
          <button className="group flex min-h-11 w-full items-center gap-3 rounded-[17px] border border-white/20 bg-[linear-gradient(115deg,rgba(111,94,158,0.17),rgba(25,29,37,0.5)_55%,rgba(124,106,74,0.13))] px-4 py-3 text-left text-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-violet-400" type="button">
            <KeyRoundIcon className="size-5 shrink-0 text-[#c3bfd9]" />
            <span className="flex-1 font-medium">Use your own API key</span>
            <ChevronDownIcon className="size-4 text-[#bbbcca] transition-transform group-data-[state=open]:rotate-180" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2.5 flex flex-col gap-2">
          <Hint className="px-2 leading-relaxed">For developers and teams. Keys stay in this browser and go only to that service. Chrome asks for each service’s permission when you first use it.</Hint>
          {ADVANCED_PROVIDERS.map(row)}
        </CollapsibleContent>
      </Collapsible>

      <p className={cn("flex shrink-0 items-start gap-2 px-2 py-1 text-[11px] leading-relaxed", offDevice ? "text-amber-200/90" : "text-green-200/90")}>
        <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" />
        {offDevice
          ? settings.listenMode === "smart"
            ? "Smart mode sends every line, plus an outline of your files, to this model’s servers."
            : "Requests and an outline of your files go to this model’s servers."
          : "Nothing leaves this computer except the edits."}
      </p>

      <div className="flex shrink-0 flex-col gap-2">
        <SectionLabel>Listening and seeing</SectionLabel>
        <div className="rounded-[19px] border border-white/20 bg-[linear-gradient(120deg,rgba(79,91,160,0.18),rgba(14,39,46,0.35)_48%,rgba(116,87,66,0.17))] px-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl">
          <GlassItem className="gap-3 rounded-none border-0 bg-transparent px-0 py-3.5 shadow-none backdrop-blur-none" glassVariant="subtle" size="sm">
            <ItemMedia className="flex size-10 shrink-0 items-center justify-center text-[#ddd8f5]">
              <MicIcon className="size-6" />
            </ItemMedia>
            <ItemContent className="min-w-0 gap-1.5">
              <ItemTitle className="text-[13px] font-medium text-[#c3c1d1]">Wake word</ItemTitle>
              <GlassInput aria-label="Wake word" className="h-10 w-full rounded-[13px] border-white/20 bg-white/[0.06] px-3 text-[14px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" onChange={(e) => update({ wakeWord: e.target.value.replace(/\s+/g, "") || "Scribe" })} value={settings.wakeWord} />
              <ItemDescription className="truncate text-xs text-[#b5b2c9]">“{settings.wakeWord}, add …”</ItemDescription>
            </ItemContent>
          </GlassItem>
          <GlassItem className="gap-3 rounded-none border-0 border-t border-white/20 bg-transparent px-0 py-3.5 shadow-none backdrop-blur-none" glassVariant="subtle" size="sm">
            <ItemMedia className="flex size-10 shrink-0 items-center justify-center text-[#ddddea]">
              <EyeIcon className="size-6" />
            </ItemMedia>
            <ItemContent className="min-w-0 gap-1">
              <ItemTitle className="text-[13px] font-medium">Reads the shared screen</ItemTitle>
              <ItemDescription className="truncate text-xs text-[#b5b2c9]">One picture per request</ItemDescription>
            </ItemContent>
            <div className="min-w-0 basis-full">
              <GlassSelect
                items={ollamaChoices.map((m) => ({ value: m, label: m }))}
                onValueChange={(v) => v && update({ visionModels: { ...settings.visionModels, ollama: String(v) } })}
                value={visionModelName("ollama", settings)}
              >
                <GlassSelectTrigger aria-label="Ollama model for the shared screen" className="h-10 w-full rounded-[13px] border-white/20 bg-white/[0.06] px-3 text-[13px]" size="sm">
                  <Logo className="size-4" name="ollama" />
                  <SelectValue />
                </GlassSelectTrigger>
                <GlassSelectContent>
                  {ollamaChoices.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </GlassSelectContent>
              </GlassSelect>
              <Hint className="px-0 pt-2 text-[11px] leading-relaxed">Ollama uses this one. ChatGPT and the built-in model see pictures themselves.</Hint>
            </div>
          </GlassItem>
        </div>
      </div>
    </section>
  );
}
