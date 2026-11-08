import { useCallback, useEffect, useState } from "react";
import { browserAI } from "@browser-ai/core";
import { CheckIcon, ExternalLinkIcon, MicIcon, MonitorUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { pingModel } from "@/lib/ai/agent";
import { toast } from "sonner";

import { chatgptAccount, listChatGptModels, MANAGE_USAGE_URL, signOutChatGPT, type ChatGptModel } from "@/lib/ai/chatgpt";
import { checkProvider, modelFor, PROVIDER_LABEL, type Availability } from "@/lib/ai/providers";
import type { EngineState } from "@/lib/engine";
import { DEFAULT_SETTINGS, PROVIDER_IDS, type ProviderId, type Settings } from "@/lib/settings";
import { ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/glasscn/ui/item";
import { SelectItem, SelectValue } from "@/components/glasscn/ui/select";
import { GlassBadge } from "@/components/glasscn/ui/glasscn/glass-badge";
import { GlassButton } from "@/components/glasscn/ui/glasscn/glass-button";
import { GlassInput } from "@/components/glasscn/ui/glasscn/glass-input";
import { GlassItem } from "@/components/glasscn/ui/glasscn/glass-item";
import { GlassSelect, GlassSelectContent, GlassSelectTrigger } from "@/components/glasscn/ui/glasscn/glass-select";
import { Spinner } from "@/components/ui/spinner";

import { Logo, PROVIDER_LOGO } from "./logos";
import { ProblemCard } from "./problem";
import { Hint, SectionLabel } from "./shared";

/** One short line per provider. The setup details show only when a row is open. */
const BLURB: Record<ProviderId, string> = {
  chrome: "Gemini Nano, on this computer",
  chatgpt: "Plus or Pro",
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
  const [gptModels, setGptModels] = useState<ChatGptModel[]>([]);
  // A row opened without switching Scribe to it, e.g. after a failed sign-in.
  const [open, setOpen] = useState<ProviderId | null>(null);
  const signedIn = settings.chatgptAccount !== null;

  const refresh = useCallback(async () => {
    const out: Partial<Record<ProviderId, Availability>> = {};
    await Promise.all(PROVIDER_IDS.map(async (id) => (out[id] = await checkProvider(id, settings).catch((e) => ({ ok: false, detail: e instanceof Error ? e.message : String(e) })))));
    setStatus(out);
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

  const choose = (id: ProviderId) => {
    update({ provider: id });
    setOpen(null);
    void runTest(id);
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
    return (
      <GlassButton onClick={() => choose(id)} size="lg">
        Use
      </GlassButton>
    );
  };

  const setup = (id: ProviderId) => {
    if (id === "chrome") return busy === "chrome" && progress ? <Hint className="px-0">{progress}</Hint> : null;
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
        {row("chrome")}
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
            <ItemDescription className="line-clamp-2">One picture per request. ChatGPT and the built-in model see it themselves.</ItemDescription>
          </ItemContent>
        </GlassItem>
      </div>

    </section>
  );
}
