import { useCallback, useEffect, useState } from "react";
import { browserAI } from "@browser-ai/core";
import { CheckIcon, ChevronDownIcon, ExternalLinkIcon, MicIcon, MonitorUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { pingModel } from "@/lib/ai/agent";
import { toast } from "sonner";

import { chatgptAccount, listChatGptModels, MANAGE_USAGE_URL, signOutChatGPT, type ChatGptModel } from "@/lib/ai/chatgpt";
import { connectOpenRouter } from "@/lib/ai/openrouter";
import { checkProvider, ensureAccess, isOllamaCloud, listOllamaCloudModels, listOllamaModels, modelFor, OLLAMA_CLOUD_MODELS, PROVIDER_LABEL, visionModelFor, visionModelName, type Availability, type OllamaModel } from "@/lib/ai/providers";
import type { EngineState } from "@/lib/engine";
import { ADVANCED_PROVIDERS, DEFAULT_SETTINGS, PROVIDER_IDS, type ProviderId, type Settings } from "@/lib/settings";
import { FULL } from "@/lib/edition";
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
import { Spinner } from "@/components/ui/spinner";

import { Logo, modelLogo, PROVIDER_LOGO } from "./logos";
import { ProblemCard } from "./problem";
import { Hint, SectionLabel, subtle } from "./shared";

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
  const [cloudModels, setCloudModels] = useState<OllamaModel[]>([]);
  // The shared-screen model gets the same automatic check as the main one: some cloud models aren't in Ollama's free plan.
  const [visionCheck, setVisionCheck] = useState<{ busy: boolean; error?: unknown } | null>(null);
  const checkVision = useCallback(
    async (model: string) => {
      setVisionCheck({ busy: true });
      try {
        await pingModel(visionModelFor("ollama", { ...settings, visionModels: { ...settings.visionModels, ollama: model } }));
        setVisionCheck(null);
      } catch (e) {
        setVisionCheck({ busy: false, error: e });
      }
    },
    [settings]
  );
  // Opening the tab checks a shared-screen model Scribe wasn't tested with.
  const visionNow = visionModelName("ollama", settings);
  useEffect(() => {
    if (FULL && !OLLAMA_CLOUD_MODELS.includes(visionNow)) void checkVision(visionNow);
    // Once per model, not on every settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visionNow]);
  const [gptModels, setGptModels] = useState<ChatGptModel[]>([]);
  // A row opened without switching Scribe to it, e.g. after a failed sign-in.
  const [open, setOpen] = useState<ProviderId | null>(null);
  const signedIn = settings.chatgptAccount !== null;

  const refresh = useCallback(async () => {
    const out: Partial<Record<ProviderId, Availability>> = {};
    await Promise.all(PROVIDER_IDS.map(async (id) => (out[id] = await checkProvider(id, settings).catch((e) => ({ ok: false, detail: e instanceof Error ? e.message : String(e) })))));
    setStatus(out);
    if (FULL) {
      listOllamaModels(settings.ollamaUrl).then(setOllamaModels, () => setOllamaModels([]));
      listOllamaCloudModels().then(setCloudModels, () => undefined);
    }
    // The sign-in can end on its own (a refresh token expires); keep the panel honest about it.
    if (settings.chatgptAccount !== null && !(await chatgptAccount())) update({ chatgptAccount: null });
  }, [settings, update]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (signedIn) listChatGptModels().then(setGptModels, () => setGptModels([]));
  }, [signedIn]);

  /**
   * A real test request, run by itself whenever a provider is picked, its model changes or a key is
   * added: there is no Test button. Success turns the dot green; a failure shows in the row.
   * The built-in model may download the first time; picking it is the click Chrome asks for.
   */
  const runTest = async (id: ProviderId, s: Settings = settings) => {
    setBusy(id);
    setFailure(null);
    try {
      if (id === "chrome") {
        await browserAI("text").createSessionWithProgress((p: number) => setProgress(`Downloading the model… ${Math.round(p * 100)}%`));
      }
      const out = await pingModel(modelFor(id, s));
      setStatus((st) => ({ ...st, [id]: { ok: true, detail: `Works. Read a test request as: ${out}` } }));
    } catch (e) {
      setFailure({ id, error: e });
      setOpen(id);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const setModel = (id: ProviderId, model: string) => {
    update((s) => ({ models: { ...s.models, [id]: model } }));
    if (settings.provider === id) void runTest(id, { ...settings, models: { ...settings.models, [id]: model } });
  };

  /** Key providers: test once the key or model field is left, if Chrome already allows that service. */
  const testKey = (id: ProviderId) => {
    if (settings.provider !== id || !settings.keys[id]) return;
    void ensureAccess(id, false).then((ok) => {
      if (ok) void runTest(id);
    });
  };


  // The three Scribe was tested with first, then every other cloud model, then the ones on this computer.
  const cloudNames = cloudModels.map((m) => m.name).sort((a, b) => a.localeCompare(b));
  const ollamaChoices = Array.from(new Set([...OLLAMA_CLOUD_MODELS, ...cloudNames, ...ollamaModels, settings.models.ollama]));
  const visionChoices = Array.from(
    new Set([
      ...OLLAMA_CLOUD_MODELS.filter((m) => cloudModels.length === 0 ? m.startsWith("gemma") : cloudModels.some((c) => c.name === m && c.vision)),
      ...cloudModels.filter((m) => m.vision).map((m) => m.name).sort((a, b) => a.localeCompare(b)),
      ...ollamaModels.filter((m) => !isOllamaCloud(m)),
      visionModelName("ollama", settings),
    ])
  );
  const shortName = (m: string) => m.replace(/[-:]cloud$/, "");
  const ollamaLabel = (m: string) => (isOllamaCloud(m) ? `${shortName(m)} · cloud` : `${m} · on this computer`);
  const modelLine = (m: string) =>
    isOllamaCloud(m)
      ? ["Cloud", OLLAMA_CLOUD_MODELS.includes(m) && "tested with Scribe", cloudModels.find((c) => c.name === m)?.vision && "reads pictures"].filter(Boolean).join(" · ")
      : "On this computer";
  /** One menu option, laid out like the rows elsewhere: logo, name, a short line. */
  const modelOption = (m: string) => (
    <SelectItem className="gap-3 py-2 pr-9" key={m} value={m}>
      <Logo className="size-6" name={modelLogo(m)} />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[0.9375rem] text-foreground">{isOllamaCloud(m) ? shortName(m) : m}</span>
        <span className="truncate text-muted-foreground text-xs">{modelLine(m)}</span>
      </div>
    </SelectItem>
  );

  const choose = (id: ProviderId) => {
    update({ provider: id });
    setOpen(null);
    void runTest(id);
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
      const models = await props.connectChatGpt();
      setGptModels(models);
      setOpen(null);
      const model = models.some((m) => m.id === settings.models.chatgpt) ? settings.models.chatgpt : (models[0]?.id ?? settings.models.chatgpt);
      void runTest("chatgpt", { ...settings, provider: "chatgpt", chatgptAccount: "signed in", models: { ...settings.models, chatgpt: model } });
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

  const action = (id: ProviderId, full = false) => {
    if (settings.provider === id) {
      return (
        <GlassBadge className="h-7 gap-1.5 px-3 text-sm" glassVariant="liquid">
          {busy === id ? <Spinner /> : <CheckIcon />}
          {busy === id ? "Checking" : "In use"}
        </GlassBadge>
      );
    }
    if (id === "chatgpt" && !signedIn) {
      return (
        <GlassButton className={full ? "w-full" : undefined} disabled={busy !== null} onClick={() => void connectChatGpt()} size="lg">
          <Logo className="size-4" name="chatgpt" />
          {busy === "chatgpt" ? "Signing in…" : "Continue with ChatGPT"}
        </GlassButton>
      );
    }
    if (id === "openrouter" && !settings.keys.openrouter) {
      return (
        <GlassButton disabled={busy !== null} onClick={connectRouter} size="lg">
          {busy === "openrouter" ? "Connecting…" : "Connect"}
        </GlassButton>
      );
    }
    if (ADVANCED_PROVIDERS.includes(id) && !settings.keys[id]) {
      return (
        <GlassButton onClick={() => setOpen(open === id ? null : id)} size="lg">
          Add key
        </GlassButton>
      );
    }
    return (
      <GlassButton onClick={() => (ADVANCED_PROVIDERS.includes(id) ? useKeyProvider(id) : choose(id))} size="lg">
        Use
      </GlassButton>
    );
  };

  const keySetup = (id: ProviderId) => (
    <div className="flex flex-col gap-1.5">
      <GlassInput
        aria-label={`${PROVIDER_LABEL[id]} API key`}
        autoComplete="off"
        className="h-10 text-sm"
        onBlur={() => testKey(id)}
        onChange={(e) => setKey(id, e.target.value)}
        placeholder={id === "openrouter" ? "Connected key, or paste one" : "Paste API key"}
        type="password"
        value={settings.keys[id] ?? ""}
      />
      <GlassInput aria-label={`${PROVIDER_LABEL[id]} model`} className="h-10 font-mono text-sm" onBlur={() => testKey(id)} onChange={(e) => update((s) => ({ models: { ...s.models, [id]: e.target.value } }))} value={settings.models[id]} />
      {KEY_HELP[id] && <Hint className="px-0">{KEY_HELP[id]}</Hint>}
    </div>
  );

  const setup = (id: ProviderId) => {
    if (id === "chrome") return busy === "chrome" && progress ? <Hint className="px-0">{progress}</Hint> : null;
    if (id === "ollama") {
      const problem = [failure?.id === "ollama" ? String(failure.error instanceof Error ? failure.error.message : failure.error) : "", status.ollama && !status.ollama.ok ? status.ollama.detail : ""].join(" ");
      const blocked = /403|blocked|OLLAMA_ORIGINS/i.test(problem);
      const unreachable = /Can’t reach Ollama|Failed to fetch|NetworkError/i.test(problem);
      return (
        <div className="flex flex-col gap-2">
          <GlassSelect items={ollamaChoices.map((m) => ({ value: m, label: ollamaLabel(m) }))} onValueChange={(v) => v && setModel("ollama", String(v))} value={settings.models.ollama}>
            <GlassSelectTrigger aria-label="Ollama model" className="h-11 w-full text-sm data-[size=default]:h-11">
              <Logo className="size-5" name={modelLogo(settings.models.ollama)} />
              <SelectValue />
            </GlassSelectTrigger>
            <GlassSelectContent className="max-h-96">{ollamaChoices.map(modelOption)}</GlassSelectContent>
          </GlassSelect>
          {blocked && (
            <>
              <EnvironmentVariables className={cn("rounded-xl", subtle)} defaultShowValues>
                <EnvironmentVariablesHeader className="px-3 py-2">
                  <EnvironmentVariablesTitle className="text-sm">Allow Scribe in Ollama</EnvironmentVariablesTitle>
                </EnvironmentVariablesHeader>
                <EnvironmentVariablesContent>
                  <EnvironmentVariable className="flex-col items-start gap-1 px-3 py-2" name="OLLAMA_ORIGINS" value={`chrome-extension://${chrome.runtime.id}`}>
                    <EnvironmentVariableName className="text-sm" />
                    <div className="flex w-full items-center justify-between gap-2">
                      <EnvironmentVariableValue className="truncate text-sm" />
                      <EnvironmentVariableCopyButton />
                    </div>
                  </EnvironmentVariable>
                </EnvironmentVariablesContent>
              </EnvironmentVariables>
              <Hint className="px-0">
                On a Mac: <code>launchctl setenv OLLAMA_ORIGINS chrome-extension://{chrome.runtime.id}</code>, then quit and reopen Ollama. Don’t use * here: it lets every website reach Ollama.
              </Hint>
            </>
          )}
          {unreachable && (
            <GlassInput aria-label="Ollama address" className="h-10 font-mono text-sm" onBlur={() => void refresh()} onChange={(e) => update({ ollamaUrl: e.target.value.trim() })} value={settings.ollamaUrl} />
          )}
        </div>
      );
    }
    if (ADVANCED_PROVIDERS.includes(id)) return keySetup(id);
    if (!signedIn) return failure?.id === "chatgpt" ? <ProblemCard onRetry={() => void connectChatGpt()} problem={failure.error} /> : null;
    return (
      <div className="flex flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-sm">
          <span className="truncate">Using ChatGPT plan · {settings.chatgptAccount}</span>
          <button className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline" onClick={openUsage} type="button">
            Manage usage
            <ExternalLinkIcon className="size-3" />
          </button>
        </p>
        {gptModels.length > 0 && (
          <GlassSelect items={gptModels.map((m) => ({ value: m.id, label: m.name }))} onValueChange={(v) => v && setModel("chatgpt", String(v))} value={settings.models.chatgpt}>
            <GlassSelectTrigger aria-label="ChatGPT model" className="h-11 w-full text-sm data-[size=default]:h-11">
              <SelectValue />
            </GlassSelectTrigger>
            <GlassSelectContent>
              {gptModels.map((m) => (
                <SelectItem className="py-2" key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </GlassSelectContent>
          </GlassSelect>
        )}
        <div className="flex gap-1.5">
          <GlassButton disabled={busy !== null} glassVariant="subtle" onClick={() => void disconnectChatGpt()} size="lg">
            Sign out
          </GlassButton>
        </div>
      </div>
    );
  };

  const row = (p: ProviderId) => {
    const selected = settings.provider === p;
    const expanded = selected || open === p;
    const st = status[p];
    return (
      <GlassItem
        className={cn("gap-3.5 px-4 py-3.5", selected && "bg-white/55 dark:bg-white/[0.12]")}
        glassVariant="subtle"
        key={p}
      >
        <ItemMedia className="[&_svg]:!size-9">
          <Logo name={PROVIDER_LOGO[p]} />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="flex items-center gap-1.5">
            {PROVIDER_LABEL[p]}
            {st && <span aria-label={st.ok ? "Ready" : "Not ready"} className={cn("size-2 rounded-full", st.ok ? "bg-green-500" : "bg-muted-foreground/40")} title={st.ok ? "Ready" : st.detail} />}
          </ItemTitle>
          <ItemDescription className="line-clamp-2">
            {BLURB[p]}
          </ItemDescription>
        </ItemContent>
        {p === "chatgpt" && !signedIn ? <div className="basis-full pt-1">{action(p, true)}</div> : <ItemActions>{action(p)}</ItemActions>}
        {expanded && (
          <div className="basis-full pt-1">
            {failure?.id === p && p !== "chatgpt" ? (
              <ProblemCard className="mb-2" onRetry={() => void runTest(p)} problem={failure.error} />
            ) : (
              st && !st.ok && p !== "chatgpt" && <ProblemCard className="mb-2" onRetry={() => void runTest(p)} problem={st.detail} />
            )}
            {failure?.id === "chatgpt" && p === "chatgpt" && signedIn && <ProblemCard className="mb-2" onRetry={() => void runTest(p)} problem={failure.error} />}
            {setup(p)}
          </div>
        )}
      </GlassItem>
    );
  };

  return (
    <section aria-label="AI model" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4">
      <div className="flex flex-col gap-2">
        <SectionLabel>Your subscription</SectionLabel>
        {row("chatgpt")}
        <SectionLabel>Free</SectionLabel>
        {FULL ? (["ollama", "chrome"] as const).map(row) : row("chrome")}
        {FULL && (
          <Collapsible defaultOpen={ADVANCED_PROVIDERS.includes(settings.provider)}>
            <CollapsibleTrigger asChild>
              <button className="group flex w-full items-center gap-1 px-1 pt-1 font-medium text-foreground/80 text-sm uppercase tracking-wide" type="button">
                Use your own API key
                <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 flex flex-col gap-2">
              <Hint>For developers and teams. Keys stay in this browser and go only to that service. Scribe asks Chrome for each service's permission when you first use it.</Hint>
              {ADVANCED_PROVIDERS.map(row)}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Listening and seeing</SectionLabel>
        <GlassItem className="gap-3.5 px-4 py-3.5" glassVariant="subtle">
          <ItemMedia className="[&_svg]:!size-8">
            <MicIcon />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>Wake word</ItemTitle>
            <ItemDescription className="truncate">“{settings.wakeWord}, add …”</ItemDescription>
          </ItemContent>
          <ItemActions>
            <GlassInput aria-label="Wake word" className="h-10 w-28 text-sm" onChange={(e) => update({ wakeWord: e.target.value.replace(/\s+/g, "") || "Scribe" })} value={settings.wakeWord} />
          </ItemActions>
        </GlassItem>
        <GlassItem className="gap-3.5 px-4 py-3.5" glassVariant="subtle">
          <ItemMedia className="[&_svg]:!size-8">
            <MonitorUpIcon />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>Reads the shared screen</ItemTitle>
            <ItemDescription className={FULL ? "truncate" : "line-clamp-2"}>{FULL ? "One picture per request" : "One picture per request. ChatGPT and the built-in model see it themselves."}</ItemDescription>
          </ItemContent>
          {FULL && (
            <div className="basis-full pt-1">
              <GlassSelect
                items={visionChoices.map((m) => ({ value: m, label: ollamaLabel(m) }))}
                onValueChange={(v) => {
                  if (!v) return;
                  update({ visionModels: { ...settings.visionModels, ollama: String(v) } });
                  void checkVision(String(v));
                }}
                value={visionModelName("ollama", settings)}
              >
                <GlassSelectTrigger aria-label="Ollama model for the shared screen" className="h-11 w-full text-sm data-[size=default]:h-11">
                  <Logo className="size-5" name={modelLogo(visionModelName("ollama", settings))} />
                  <SelectValue />
                </GlassSelectTrigger>
                <GlassSelectContent className="max-h-96">{visionChoices.map(modelOption)}</GlassSelectContent>
              </GlassSelect>
              {visionCheck?.busy && <Hint className="px-0 pt-1">Checking this model…</Hint>}
              {visionCheck?.error != null && <ProblemCard className="mt-2" onRetry={() => void checkVision(visionNow)} problem={visionCheck.error} />}
              <Hint className="px-0 pt-1">Ollama uses this one. ChatGPT and the built-in model see pictures themselves. Screenshots and recordings don’t use the AI.</Hint>
            </div>
          )}
        </GlassItem>
      </div>

    </section>
  );
}
