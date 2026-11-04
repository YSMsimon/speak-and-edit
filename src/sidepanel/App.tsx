import { useCallback, useState } from "react";
import { toast } from "sonner";
import { AudioLinesIcon, FileTextIcon, PauseIcon, PlayIcon, SparklesIcon, UsersIcon } from "lucide-react";

import { FILE_LOGO, Logo } from "./logos";

import { cn } from "@/lib/utils";
import background from "@/assets/backgrounds/speak-dark.webp";
import logo from "@/assets/logo-128.png";
import { Tooltip, TooltipContent, TooltipProvider as GlassTooltipProvider, TooltipTrigger } from "@/components/glasscn/ui/tooltip";
import { GlassBadge } from "@/components/glasscn/ui/glasscn/glass-badge";
import { GlassCard } from "@/components/glasscn/ui/glasscn/glass-card";
import { GlassIcon } from "@/components/glasscn/ui/glasscn/glass-icon";
import { GlassToggleGroup, GlassToggleGroupItem } from "@/components/glasscn/ui/glasscn/glass-toggle-group";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlassButton } from "@/components/glasscn/ui/glasscn/glass-button";
import { listChatGptModels, MANAGE_USAGE_URL, signInWithChatGPT, type ChatGptModel } from "@/lib/ai/chatgpt";
import { getGoogleProfile, getGoogleToken } from "@/lib/google";
import type { Fix } from "@/lib/problems";
import { FixContext } from "./problem";

import { AiTab } from "./AiTab";
import { focusFile } from "@/lib/settings";

import { useAutoCaptureSync, useElapsed, useEngine, useRecorder, useSettings } from "./hooks";
import { DEMO, DEMO_SETTINGS, DEMO_STATE, DEMO_TAB } from "./demo";
import { LiveTab } from "./LiveTab";
import { OutputsTab } from "./OutputsTab";
import { PeopleTab } from "./PeopleTab";

type Tab = "live" | "outputs" | "ai" | "people";

const STATUS: Record<string, { label: string; live?: boolean }> = {
  none: { label: "No Meet tab" },
  loading: { label: "Reload Meet" },
  waiting: { label: "Not in a call" },
  "in-call": { label: "Captions off" },
  listening: { label: "Listening", live: true },
  ended: { label: "Call ended" },
  error: { label: "Problem" },
};

/** "v0.8 · 18:24": the version and when this build was made, so you can tell a reload took. */
function BuildStamp() {
  const version = chrome.runtime.getManifest().version.replace(/\.0$/, "");
  const built = new Date(typeof __SCRIBE_BUILT__ === "string" ? __SCRIBE_BUILT__ : Date.now());
  const time = built.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <span className="whitespace-nowrap font-normal text-[10px] text-muted-foreground/65 tabular-nums" title={`Speak and Edit ${chrome.runtime.getManifest().version}, built ${built.toLocaleString()}`}>
      v{version} · {time}
    </span>
  );
}

export function App() {
  const real = useSettings();
  const live = useEngine(real.ref, real.update);
  // Smoke builds can show made-up people and edits instead (sidepanel.html?demo=1), for screenshots.
  const settings = DEMO ? DEMO_SETTINGS : real.settings;
  const update = DEMO ? () => undefined : real.update;
  const state = DEMO ? DEMO_STATE : live.state;
  const { engine, meetTabId, setPaused, controlsRef } = live;
  const [tab, setTab] = useState<Tab>(DEMO ? DEMO_TAB : "live");
  // OpenAI asks apps to say once, after sign-in, that requests now use the ChatGPT plan.
  const [welcome, setWelcome] = useState(false);
  // Set by a "Continue with ChatGPT" fix button elsewhere; the AI model tab runs the sign-in.
  const [signInRequest, setSignInRequest] = useState(0);

  const connectChatGpt = useCallback(async (): Promise<ChatGptModel[]> => {
    const { email } = await signInWithChatGPT();
    const models = await listChatGptModels().catch(() => [] as ChatGptModel[]);
    update((s) => ({
      chatgptAccount: email ?? "ChatGPT account",
      provider: "chatgpt",
      models: { ...s.models, chatgpt: models.some((m) => m.id === s.models.chatgpt) ? s.models.chatgpt : (models[0]?.id ?? s.models.chatgpt) },
    }));
    setWelcome(true);
    return models;
  }, [update]);

  const open = (url: string) => void chrome.tabs.create({ url });
  const runFix = useCallback(
    (fix: Fix) => {
      switch (fix) {
        case "ai-tab":
          return setTab("ai");
        case "outputs-tab":
          return setTab("outputs");
        case "chatgpt-signin":
          setTab("ai");
          return setSignInRequest((n) => n + 1);
        case "chatgpt-plans":
          return open("https://chatgpt.com/pricing");
        case "manage-usage":
          return open(MANAGE_USAGE_URL);
        case "use-ollama":
          update({ provider: "ollama" });
          return void toast.success("Switched to Ollama");
        case "get-ollama":
          return open("https://ollama.com/download");
        case "google-signin":
          return void getGoogleToken(true).then(
            () => {
              toast.success("Signed in to Google");
              void engine.refreshFiles();
              void getGoogleProfile().then((p) => p?.name && engine.setSelf({ name: p.name, picture: p.picture }));
            },
            (e) => toast.error(e instanceof Error ? e.message : String(e))
          );
        case "reload-meet":
          if (meetTabId) void chrome.tabs.reload(meetTabId);
          return;
        case "retry":
          return;
      }
    },
    [engine, meetTabId, update]
  );

  const meet = state.meet;
  const inCall = meet?.status === "listening" || meet?.status === "in-call";
  const recorder = useRecorder(meetTabId, meet?.userName ?? "You", (r) => engine.addRecording(r));
  const elapsed = useElapsed(recorder.timing);
  // The control tool ("Scribe, pause the recording") reaches the recorder through this.
  controlsRef.current = { recording: recorder.control, recordingState: recorder.state };
  const focus = focusFile(settings);
  useAutoCaptureSync(meetTabId, settings.screen.autoCapture, inCall);
  const status: { label: string; live?: boolean } = (meet ? (meet.paused && meet.status === "listening" ? { label: "Paused" } : STATUS[meet.status]) : STATUS.none) ?? { label: "" };
  const detail =
    meet?.detail ??
    (!meet
      ? "Open a Google Meet call in this window."
      : meet.status === "waiting"
        ? "Scribe starts when you join the call."
        : meet.status === "in-call"
          ? "Turning on captions… If they don’t appear, press c in Meet."
          : null);

  return (
    <FixContext.Provider value={runFix}>
      <TooltipProvider>
        <GlassTooltipProvider>
          <div aria-hidden="true" className="fixed inset-0 -z-10 bg-black">
            <img alt="" className="size-full object-cover" src={background} />
          </div>
          <div className="h-svh w-full p-2 text-[13px] antialiased">
            <GlassCard className="glass-scope neon flex h-full w-full flex-col gap-0 overflow-hidden rounded-[24px] border-0 bg-black/70 py-0 text-foreground backdrop-blur-xl [--neon-opacity:0.6] dark:bg-black/70" glassVariant="frosted">
              <header className="grid shrink-0 grid-cols-[36px_minmax(0,1fr)_44px] items-center gap-x-2.5 gap-y-2 px-3.5 pt-3.5">
                <img alt="" className="size-9 shrink-0 object-contain drop-shadow-[0_0_12px_rgba(168,85,247,0.65)]" src={logo} />
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="whitespace-nowrap font-semibold text-[17px] leading-6 tracking-[-0.025em] text-white">Speak and Edit</span>
                  <GlassBadge className="neon neon-soft gap-1.5 rounded-full border-0 bg-gradient-to-br from-white/[0.09] to-sky-950/40 px-2.5 py-1 font-medium text-[12px] leading-4 text-white" glassVariant="liquid">
                    <span className={cn("size-[7px] shrink-0 rounded-full", status.live ? "animate-pulse bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.65)]" : "bg-muted-foreground")} />
                    {status.label}
                  </GlassBadge>
                  {recorder.timing && (
                    <GlassBadge className="neon neon-red neon-soft gap-1.5 rounded-full border-0 bg-red-950/20 px-2.5 py-1 text-[11px] leading-4 text-red-300 tabular-nums" glassVariant="liquid">
                      <span className={cn("size-1.5 rounded-full bg-red-500", !recorder.paused && "animate-pulse")} />
                      {recorder.paused ? `Recording paused ${elapsed}` : `Recording ${elapsed}`}
                    </GlassBadge>
                  )}
                  <BuildStamp />
                </div>
                <div className="col-start-3 row-span-2 row-start-1 self-start">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <GlassIcon
                          aria-label={meet?.paused ? "Resume listening" : "Pause listening"}
                          className="neon size-11 rounded-full border-0 bg-[radial-gradient(ellipse_at_65%_100%,rgba(56,189,248,0.3),transparent_65%),linear-gradient(145deg,rgba(139,92,246,0.2),rgba(15,23,42,0.6))] text-white [--neon-a:#a5b4fc] [--neon-b:#7dd3fc] [--neon-c:#818cf8] [--neon-glow:rgba(96,165,250,0.6)] [&_svg]:size-5 [&_svg]:fill-current [&_svg]:stroke-[2.5]"
                          disabled={!meetTabId || meet?.status !== "listening"}
                          onClick={() => void setPaused(!meet?.paused)}
                          size="md"
                        />
                      }
                    >
                      {meet?.paused ? <PlayIcon /> : <PauseIcon />}
                    </TooltipTrigger>
                    <TooltipContent>{meet?.paused ? "Resume listening" : "Pause listening"}</TooltipContent>
                  </Tooltip>
                </div>
                <div className="col-span-2 flex min-w-0 items-center gap-3 pl-1 text-[13px] leading-5 text-muted-foreground">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <Logo className="size-[18px] shrink-0" name="meet" />
                    <span className="truncate text-foreground/95">{meet?.title ?? "Google Meet"}</span>
                  </span>
                  {(() => {
                    const shown = focus ?? (settings.files.length === 1 ? settings.files[0]! : null);
                    const name = (id: string, fallback: string) => state.files[id]?.title ?? fallback;
                    return (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        {shown ? <Logo className="size-4 shrink-0" name={FILE_LOGO[shown.kind]} /> : <FileTextIcon className="size-4 shrink-0 text-[#9097b2]" />}
                        <span className="truncate">
                          {settings.files.length === 0
                            ? "No file"
                            : shown
                              ? `${name(shown.id, shown.title)}${settings.files.length > 1 ? ` · ${settings.files.length} files` : ""}`
                              : `${settings.files.length} files`}
                        </span>
                      </span>
                    );
                  })()}
                </div>
                {detail && <p className="col-span-3 px-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>}
              </header>

              <div className="shrink-0 px-3 pt-3.5 pb-2.5">
                <GlassToggleGroup
                  aria-label="Sections"
                  className="neon neon-soft h-[44px] w-full gap-0 rounded-full border-0 bg-[linear-gradient(110deg,rgba(76,29,149,0.14),rgba(8,13,25,0.6)_45%,rgba(45,212,191,0.08))] p-[3px]"
                  onValueChange={(v) => setTab(v as Tab)}
                  puckClassName="neon rounded-full border-0 bg-[linear-gradient(135deg,rgba(99,102,241,0.28),rgba(109,40,217,0.34)_60%,rgba(168,85,247,0.22))] backdrop-blur-xl"
                  value={tab}
                >
                  {(
                    [
                      ["live", "Live", AudioLinesIcon],
                      ["outputs", "Outputs", FileTextIcon],
                      ["ai", "AI", SparklesIcon],
                      ["people", "People", UsersIcon],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <GlassToggleGroupItem
                      className={cn(
                        "h-[38px] min-w-0 flex-1 gap-2 rounded-full px-2 py-0 text-[13px] font-medium transition-colors hover:bg-white/[0.04] hover:text-white",
                        tab === value ? "text-white" : "text-[#b6bdd3]"
                      )}
                      key={value}
                      value={value}
                    >
                      <Icon className={cn("size-[17px] shrink-0", tab === value ? "text-violet-300 drop-shadow-[0_0_6px_rgba(168,85,247,0.7)]" : "text-[#829cde]")} />
                      {label}
                    </GlassToggleGroupItem>
                  ))}
                </GlassToggleGroup>
              </div>

              {tab === "live" && <LiveTab engine={engine} recorder={{ ...recorder, elapsed }} settings={settings} state={state} update={update} />}
              {tab === "outputs" && <OutputsTab engine={engine} settings={settings} state={state} update={update} />}
              {tab === "ai" && <AiTab connectChatGpt={connectChatGpt} settings={settings} signInRequest={signInRequest} state={state} update={update} />}
              {tab === "people" && <PeopleTab settings={settings} state={state} update={update} />}
            </GlassCard>
          </div>
          <Toaster position="bottom-center" />
          <Dialog onOpenChange={setWelcome} open={welcome}>
            <DialogContent className="neon max-w-80 rounded-[22px] border-0 bg-[#0c0d19]/95 text-foreground backdrop-blur-xl">
              <DialogHeader>
                <DialogTitle>You’re using your ChatGPT plan</DialogTitle>
                <DialogDescription>Eligible usage in this app uses your ChatGPT plan. Manage usage in your ChatGPT settings.</DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <GlassButton className="rounded-full" glassVariant="subtle" onClick={() => open(MANAGE_USAGE_URL)} size="sm">
                  Manage usage
                </GlassButton>
                <GlassButton className="neon rounded-full" onClick={() => setWelcome(false)} size="sm">
                  Got it
                </GlassButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </GlassTooltipProvider>
      </TooltipProvider>
    </FixContext.Provider>
  );
}
