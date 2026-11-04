import { useCallback, useState } from "react";
import { toast } from "sonner";
import { FileTextIcon, PauseIcon, PlayIcon } from "lucide-react";

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

/** "v0.9 · 18:24": the version and when this build was made, so you can tell a reload took. */
function BuildStamp() {
  const version = chrome.runtime.getManifest().version.replace(/\.0$/, "");
  const built = new Date(typeof __SCRIBE_BUILT__ === "string" ? __SCRIBE_BUILT__ : Date.now());
  const time = built.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <span className="font-normal text-[11px] text-muted-foreground tabular-nums" title={`Speak and Edit ${chrome.runtime.getManifest().version}, built ${built.toLocaleString()}`}>
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
        <div className="h-svh w-full p-2">
        <GlassCard className="glass-scope h-full w-full gap-0 overflow-hidden rounded-[24px] py-0 text-foreground dark:bg-black/60" glassVariant="frosted">
          <header className="flex items-start justify-between gap-2 px-4 pt-4">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2 font-semibold">
                <img alt="" className="size-5 shrink-0" src={logo} />
                Speak and Edit
                <BuildStamp />
                <GlassBadge className="gap-1.5" glassVariant="liquid">
                  <span className={cn("size-1.5 rounded-full", status.live ? "animate-pulse bg-red-500" : "bg-muted-foreground")} />
                  {status.label}
                </GlassBadge>
                {recorder.timing && (
                  <GlassBadge className="gap-1.5 text-red-700 tabular-nums dark:text-red-300" glassVariant="liquid">
                    <span className={cn("size-1.5 rounded-full bg-red-500", !recorder.paused && "animate-pulse")} />
                    {recorder.paused ? `Recording paused ${elapsed}` : `Recording ${elapsed}`}
                  </GlassBadge>
                )}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 font-medium">
                <Logo className="size-4" name="meet" />
                <span className="truncate">{meet?.title ?? "Google Meet"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">
                {(() => {
                  const shown = focus ?? (settings.files.length === 1 ? settings.files[0]! : null);
                  const name = (id: string, fallback: string) => state.files[id]?.title ?? fallback;
                  return (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      {shown ? <Logo className="size-3.5" name={FILE_LOGO[shown.kind]} /> : <FileTextIcon className="size-3" />}
                      <span className="truncate">
                        {settings.files.length === 0
                          ? "No file connected"
                          : shown
                            ? `${name(shown.id, shown.title)}${settings.files.length > 1 ? ` · ${settings.files.length} files` : ""}`
                            : `${settings.files.length} files connected`}
                      </span>
                    </span>
                  );
                })()}
              </div>
              {detail && <p className="text-muted-foreground text-xs">{detail}</p>}
            </div>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <GlassIcon
                      aria-label={meet?.paused ? "Resume listening" : "Pause listening"}
                      disabled={!meetTabId || meet?.status !== "listening"}
                      onClick={() => void setPaused(!meet?.paused)}
                      size="sm"
                    />
                  }
                >
                  {meet?.paused ? <PlayIcon /> : <PauseIcon />}
                </TooltipTrigger>
                <TooltipContent>{meet?.paused ? "Resume listening" : "Pause listening"}</TooltipContent>
              </Tooltip>
            </div>
          </header>

          <div className="flex justify-center px-3 pt-3 pb-2">
            <GlassToggleGroup aria-label="Scribe sections" onValueChange={(v) => setTab(v as Tab)} value={tab}>
              <GlassToggleGroupItem className="px-3 py-1.5" value="live">
                Live
              </GlassToggleGroupItem>
              <GlassToggleGroupItem className="px-3 py-1.5" value="outputs">
                Outputs
              </GlassToggleGroupItem>
              <GlassToggleGroupItem className="px-3 py-1.5" value="ai">
                AI model
              </GlassToggleGroupItem>
              <GlassToggleGroupItem className="px-3 py-1.5" value="people">
                People
              </GlassToggleGroupItem>
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
          <DialogContent className="max-w-80">
            <DialogHeader>
              <DialogTitle>You’re using your ChatGPT plan</DialogTitle>
              <DialogDescription>Eligible usage in this app uses your ChatGPT plan. Manage usage in your ChatGPT settings.</DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <GlassButton glassVariant="subtle" onClick={() => open(MANAGE_USAGE_URL)} size="sm">
                Manage usage
              </GlassButton>
              <GlassButton onClick={() => setWelcome(false)} size="sm">
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
