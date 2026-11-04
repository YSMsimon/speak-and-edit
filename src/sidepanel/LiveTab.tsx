import { CameraIcon, CheckIcon, ChevronDownIcon, CircleIcon, HandIcon, KeyboardIcon, ListChecksIcon, MessageSquareTextIcon, MonitorUpIcon, PauseIcon, PlayIcon, ScrollTextIcon, SparklesIcon, SquareIcon, XIcon, ZapIcon, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Engine, EngineState } from "@/lib/engine";
import type { Settings } from "@/lib/settings";
import { toSegments } from "@/lib/segments";
import { GlassButton } from "@/components/glasscn/ui/glasscn/glass-button";
import { LiquidSwitch } from "@/components/glasscn/ui/glasscn/liquid-switch";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { glassVariantStyles } from "@/components/glasscn/lib/glass-variants";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  Queue,
  QueueItem,
  QueueItemAction,
  QueueItemActions,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue";
import { Transcription, TranscriptionSegment } from "@/components/ai-elements/transcription";

import { EntryView, proposalTitle } from "./EntryView";
import { useState } from "react";

import { FILE_LOGO, Logo } from "./logos";
import { useProviderHealth } from "./hooks";
import { ProblemCard } from "./problem";
import { SpeakerAvatar } from "./shared";

interface Choice<T extends string> {
  value: T;
  icon: LucideIcon;
  title: string;
  /** What the button says when this is chosen. Defaults to the title. */
  short?: string;
  line: string;
}

const modes = (w: string): Choice<Settings["listenMode"]>[] => [
  { value: "commands", icon: MessageSquareTextIcon, title: "Commands", line: `Only lines that start with “${w}, …”` },
  { value: "smart", icon: SparklesIcon, title: "Smart", line: "Records decisions, tasks and open questions" },
  { value: "record", icon: ScrollTextIcon, title: "Record all", line: "Every line into the doc’s Transcript. No AI" },
];

const APPROVALS: Choice<Settings["approval"]>[] = [
  { value: "auto", icon: ZapIcon, title: "Auto", line: "Edits go straight into the file" },
  { value: "manual", icon: HandIcon, title: "Ask before writing", short: "Ask first", line: "Docs get suggestions. The rest waits for Approve" },
];

/** glasscn's popup look (as in Glass Select), on the AI Elements menu. */
const MENU_GLASS = cn(
  glassVariantStyles.frosted,
  "rounded-[20px] border border-white/15 bg-[#10121e]/95 text-slate-100 shadow-[0_12px_40px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.04] backdrop-blur-2xl",
  "[&_[role=menuitemradio]:focus]:bg-violet-400/[0.12]"
);

/** A picker in the input's footer: icon and name on the button; a title, icon and one line per option in the menu. */
function FooterPicker<T extends string>(props: { label: string; value: T; choices: Choice<T>[]; onChange: (v: T) => void; note?: string | null; glow?: boolean }) {
  const { label, value, choices, onChange, note, glow } = props;
  const current = choices.find((c) => c.value === value) ?? choices[0]!;
  const Icon = current.icon;
  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger
        aria-label={`${label}: ${current.title}`}
        className={cn(
          "h-10 shrink-0 gap-2 rounded-full border border-white/[0.16] bg-[linear-gradient(135deg,rgba(139,157,209,0.12),rgba(16,24,42,0.6))] px-3.5 text-[13px] font-medium text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-colors hover:bg-white/[0.1] [&_svg]:shrink-0",
          glow && "neon neon-violet border-transparent bg-[linear-gradient(120deg,rgba(124,58,237,0.25),rgba(30,35,65,0.6),rgba(34,211,238,0.1))] text-violet-50"
        )}
        size="sm"
      >
        <Icon className={cn("size-[18px] text-slate-400", glow && "text-violet-300 drop-shadow-[0_0_6px_rgba(192,132,252,0.7)]")} />
        {current.short ?? current.title}
        <ChevronDownIcon className="ml-1 size-3.5 text-slate-400" />
      </PromptInputActionMenuTrigger>
      <PromptInputActionMenuContent className={cn(MENU_GLASS, "w-64 p-2")} collisionPadding={8} side="top" sticky="always">
        <DropdownMenuLabel className="px-2 pt-1.5 pb-2 text-[13px]">{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup onValueChange={(v) => onChange(v as T)} value={value}>
          {choices.map((c) => (
            <DropdownMenuRadioItem className="items-start gap-2.5 rounded-xl px-2 py-2.5" key={c.value} value={c.value}>
              <c.icon className="mt-0.5 size-4 text-violet-300" />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-[13px] font-medium">{c.title}</span>
                <span className="text-xs leading-relaxed text-slate-400">{c.line}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {note && <p className="px-2 pt-2 pb-1.5 text-xs leading-relaxed text-slate-400">{note}</p>}
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}

export interface RecorderControls {
  timing: { start: number } | null;
  paused: boolean;
  error: string | null;
  elapsed: string;
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
}

export function LiveTab(props: {
  engine: Engine;
  state: EngineState;
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  recorder: RecorderControls;
}) {
  const { engine, state, settings, update, recorder } = props;
  const inCall = state.meet?.status === "listening" || state.meet?.status === "in-call";
  const screen = state.meet?.screen ?? null;
  // Your name from your Google account, else the one Meet showed in the lobby.
  const me = state.self?.name ?? state.meet?.userName ?? null;
  // Scribe is voice-first: the text box stays hidden behind a keyboard button, for when Meet mishears
  // or you can't speak aloud. Sending closes it again.
  const [typing, setTyping] = useState(false);
  const submit = (text: string) => {
    const t = text.trim();
    if (t) engine.addLine(me ?? "You", t, Date.now(), true);
    setTyping(false);
  };
  const fileErrors = Object.values(state.files).map((f) => f.error).filter(Boolean);
  // The banner: one problem at a time that stops Scribe working. Dismissed until the message changes.
  const health = useProviderHealth(settings);
  const notice = health ?? state.providerError ?? fileErrors[0] ?? null;
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Everything that needs a person: manual approvals, transcript lines on hold, and Docs suggestions.
  const pending = state.entries.flatMap((e) => {
    const a = e.action;
    if (a.kind === "proposal") return [{ e, text: a.proposal.write.text ?? a.proposal.write.replaceWith ?? e.text, where: proposalTitle(a.proposal), kind: a.proposal.file.kind, approve: true }];
    if (a.kind === "transcript" && a.status === "waiting") return [{ e, text: e.text, where: `Transcript · ${e.speaker}`, kind: "doc" as const, approve: true }];
    if (a.kind === "written" && a.result.status === "waiting" && !a.decision) return [{ e, text: a.result.add, where: `${a.proposal.file.title} › ${a.result.where}`, kind: a.proposal.file.kind, approve: false }];
    return [];
  });
  const approvals = pending.filter((p) => p.approve).length;

  return (
    <section aria-label="Live" className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 text-[13px] text-slate-100">
      {inCall && (
        <div className="flex shrink-0 flex-col gap-2 text-xs">
          <div className="neon neon-soft flex min-h-11 flex-wrap items-center gap-x-2 gap-y-2 rounded-full bg-[linear-gradient(110deg,rgba(108,64,166,0.16),rgba(17,29,43,0.65)_48%,rgba(70,81,105,0.2))] p-1.5 backdrop-blur-xl">
            <GlassButton
              aria-label={recorder.timing ? "Stop recording" : "Record the call"}
              className="h-8 shrink-0 gap-2 rounded-full border-white/[0.14] bg-[linear-gradient(135deg,rgba(255,255,255,0.07),rgba(139,92,246,0.12))] px-3 text-[13px] font-medium text-slate-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              glassVariant="subtle"
              onClick={() => (recorder.timing ? recorder.stop() : recorder.start())}
              size="xs"
            >
              {recorder.timing ? <SquareIcon className="size-3.5 fill-current" /> : <CircleIcon className="size-4 fill-red-500 text-red-500 drop-shadow-[0_0_7px_rgba(239,68,68,0.8)]" />}
              {recorder.timing ? `Stop ${recorder.elapsed}` : "Record"}
            </GlassButton>
            {recorder.timing && (
              <GlassButton
                aria-label={recorder.paused ? "Resume recording" : "Pause recording"}
                className="h-8 shrink-0 gap-1.5 rounded-full border-white/10 bg-white/[0.05] px-2.5 text-xs"
                glassVariant="subtle"
                onClick={() => (recorder.paused ? recorder.resume() : recorder.pause())}
                size="xs"
              >
                {recorder.paused ? <PlayIcon className="size-3.5" /> : <PauseIcon className="size-3.5" />}
                {recorder.paused ? "Resume" : "Pause"}
              </GlassButton>
            )}
            {screen && (
              <GlassButton className="h-8 shrink-0 gap-1.5 rounded-full border-white/10 bg-white/[0.05] px-2.5 text-xs" glassVariant="subtle" onClick={() => engine.takeScreenshot()} size="xs">
                <CameraIcon className="size-3.5" />
                Screenshot
              </GlassButton>
            )}
            <span className="min-w-0 flex-1 truncate text-slate-400">
              {screen && (
                <span className="inline-flex items-center gap-1">
                  <MonitorUpIcon className="size-3.5 shrink-0" />
                  {`${screen.presenter ?? "Someone"} is sharing`}
                </span>
              )}
            </span>
            <label className="ml-auto flex shrink-0 items-center gap-2.5 border-l border-white/[0.08] pr-1.5 pl-3" htmlFor="auto-capture-switch">
              <span className={cn("text-[12px] leading-5", settings.screen.autoCapture ? "text-slate-100" : "text-slate-400")}>Save each new slide</span>
              <LiquidSwitch
                aria-label="Save each new slide"
                checked={settings.screen.autoCapture}
                id="auto-capture-switch"
                onCheckedChange={(v: boolean) => update({ screen: { ...settings.screen, autoCapture: v } })}
                size="sm"
              />
            </label>
          </div>
          {recorder.timing && <p className="px-3 text-xs leading-relaxed text-slate-400">Meet doesn’t announce this. Tell people you’re recording.</p>}
          {recorder.error && <ProblemCard className="mt-0.5" onRetry={recorder.start} problem={recorder.error} />}
        </div>
      )}

      {notice && notice !== dismissed && <ProblemCard onDismiss={() => setDismissed(notice)} problem={notice} />}

      {pending.length > 0 && (
        <Queue className={cn("neon neon-amber neon-soft shrink-0 rounded-[22px] border-transparent bg-[linear-gradient(125deg,rgba(107,73,42,0.14),rgba(20,24,38,0.75),rgba(49,65,77,0.16))] px-2 py-2 backdrop-blur-xl")}>
          <QueueSection>
            <div className="flex items-center justify-between gap-2">
              <QueueSectionTrigger className="rounded-full bg-transparent px-2 py-1.5 text-[13px] text-slate-200 hover:bg-white/[0.04]">
                <QueueSectionLabel count={pending.length} icon={<ListChecksIcon className="size-4 text-amber-300" />} label="waiting for you" />
              </QueueSectionTrigger>
              {approvals > 1 && (
                <GlassButton className="neon neon-amber neon-soft h-7 rounded-full border-transparent bg-amber-300/[0.06] px-3 text-xs text-amber-100" glassVariant="subtle" onClick={() => engine.approveAll()} size="xs">
                  Approve all ({approvals})
                </GlassButton>
              )}
            </div>
            <QueueSectionContent>
              <QueueList className="max-h-32 space-y-1 pt-1">
                {pending.map(({ e, text, where, kind, approve }) => (
                  <QueueItem className="rounded-2xl px-2 py-2 hover:bg-white/[0.04]" key={e.id}>
                    <div className="flex items-center gap-2">
                      <QueueItemIndicator className="border-amber-300/50" />
                      <QueueItemContent className="text-[13px] leading-5 text-slate-200">{text}</QueueItemContent>
                      <QueueItemActions className="gap-1.5">
                        <QueueItemAction aria-label={approve ? "Approve" : "Accept"} className="size-7 rounded-full border border-emerald-300/20 bg-emerald-400/[0.12] text-emerald-300 hover:bg-emerald-400/20" onClick={() => (approve ? engine.approve(e.id) : engine.decide(e.id, true))}>
                          <CheckIcon className="size-3.5" />
                        </QueueItemAction>
                        <QueueItemAction aria-label={approve ? "Discard" : "Reject"} className="size-7 rounded-full border border-white/10 bg-white/[0.05] text-slate-400 hover:bg-red-400/10 hover:text-red-300" onClick={() => (approve ? engine.discard(e.id) : engine.decide(e.id, false))}>
                          <XIcon className="size-3.5" />
                        </QueueItemAction>
                      </QueueItemActions>
                    </div>
                    <QueueItemDescription className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                      <Logo className="size-3.5 shrink-0" name={FILE_LOGO[kind]} />
                      {approve ? where : `Suggestion in ${where}`}
                    </QueueItemDescription>
                  </QueueItem>
                ))}
              </QueueList>
            </QueueSectionContent>
          </QueueSection>
        </Queue>
      )}

      <Conversation className="min-h-0 flex-1 border-0 bg-transparent shadow-none">
        <ConversationContent className="gap-5 px-1 py-2.5">
          {state.entries.length === 0 && !state.partial ? (
            <ConversationEmptyState
              className="gap-3 text-slate-400 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-slate-100 [&_p]:text-[13px]"
              description={
                state.meet?.status === "listening"
                  ? settings.listenMode === "commands"
                    ? `Listening. Say “${settings.wakeWord}, …”`
                    : "Listening"
                  : "Join a Google Meet call to start"
              }
              icon={<Logo className="size-8" name="meet" />}
              title="No lines yet"
            />
          ) : (
            state.entries.map((e) => <EntryView avatar={state.avatars[e.speaker]} engine={engine} entry={e} key={e.id} me={me} />)
          )}
          {state.partial && (
            <div className="flex gap-2.5">
              <SpeakerAvatar className="mt-0.5 size-8 ring-1 ring-white/25 shadow-[0_0_15px_-5px_rgba(139,92,246,0.6)]" name={state.partial.speaker} src={state.avatars[state.partial.speaker]} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-baseline gap-2 text-xs text-slate-500">
                  <span className="text-[13px] font-medium text-slate-100">{state.partial.speaker}</span>
                  <span>is speaking</span>
                </div>
                <div className="w-fit max-w-full rounded-[18px] border border-white/[0.16] bg-[linear-gradient(120deg,rgba(118,101,170,0.17),rgba(36,66,82,0.2))] px-3.5 py-2.5 text-sm leading-relaxed text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md">
                  <Transcription currentTime={Number.MAX_SAFE_INTEGER} segments={toSegments(state.partial.text)}>
                    {(segment, index) => <TranscriptionSegment index={index} key={index} segment={segment} />}
                  </Transcription>
                </div>
              </div>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton className="neon neon-soft rounded-full border-transparent bg-[#141827]/90 text-slate-200 backdrop-blur-xl" />
      </Conversation>

      <PromptInput
        className="shrink-0 rounded-[26px] [&_[data-slot=input-group]]:rounded-[26px] [&_[data-slot=input-group]]:border-white/[0.08] [&_[data-slot=input-group]]:bg-[linear-gradient(120deg,rgba(88,55,132,0.08),rgba(8,15,26,0.3),rgba(38,94,127,0.08))] [&_[data-slot=input-group]]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] [&_[data-slot=input-group]]:backdrop-blur-xl"
        onSubmit={(m: PromptInputMessage) => submit(m.text)}
      >
        {typing && (
          <PromptInputBody>
            <PromptInputTextarea
              autoFocus
              className="min-h-10 px-4 pt-3 text-sm text-slate-100 placeholder:text-slate-500"
              onKeyDown={(e) => {
                if (e.key === "Escape") setTyping(false);
              }}
              placeholder="Type a request…"
            />
          </PromptInputBody>
        )}
        <PromptInputFooter className="gap-2 px-1.5 py-1.5">
          <PromptInputTools className="min-w-0 gap-2">
            <FooterPicker choices={modes(settings.wakeWord)} glow label="Listening mode" onChange={(v) => update({ listenMode: v })} value={settings.listenMode} />
            <FooterPicker
              choices={APPROVALS}
              label="When Scribe edits"
              note={settings.commentsOnly ? "Comments only is on in Outputs, so the text never changes." : null}
              onChange={(v) => update({ approval: v })}
              value={settings.approval}
            />
          </PromptInputTools>
          {typing ? (
            <div className="flex shrink-0 items-center gap-1">
              <PromptInputButton aria-label="Close" className="size-8 rounded-full text-slate-400 hover:bg-white/[0.08] hover:text-slate-100" onClick={() => setTyping(false)} tooltip="Close (Esc)">
                <XIcon className="size-4" />
              </PromptInputButton>
              <PromptInputSubmit className="neon neon-violet rounded-full border-transparent bg-violet-500/20 text-violet-100" size="icon-sm" />
            </div>
          ) : (
            <PromptInputButton aria-label="Type a request" className="size-10 shrink-0 rounded-full border border-violet-200/25 bg-[linear-gradient(135deg,rgba(173,157,204,0.18),rgba(66,71,114,0.2))] text-violet-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_15px_-8px_rgba(167,139,250,0.45)] backdrop-blur-xl hover:bg-white/[0.12]" onClick={() => setTyping(true)} tooltip="Type a request">
              <KeyboardIcon className="size-5" />
            </PromptInputButton>
          )}
        </PromptInputFooter>
      </PromptInput>
    </section>
  );
}
