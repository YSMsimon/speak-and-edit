import { CameraIcon, CheckIcon, CircleIcon, HandIcon, HistoryIcon, KeyboardIcon, ListChecksIcon, MessageSquareTextIcon, MonitorUpIcon, PauseIcon, PlayIcon, ScrollTextIcon, SparklesIcon, SquareIcon, XIcon, ZapIcon, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Engine, EngineState } from "@/lib/engine";
import type { Settings } from "@/lib/settings";
import { toSegments } from "@/lib/segments";
import { GlassButton } from "@/components/glasscn/ui/glasscn/glass-button";
import { LiquidSwitch } from "@/components/glasscn/ui/glasscn/liquid-switch";
import { Checkpoint, CheckpointIcon } from "@/components/ai-elements/checkpoint";
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
import { Fragment, useState } from "react";

import { FILE_LOGO, Logo } from "./logos";
import { useProviderHealth } from "./hooks";
import { ProblemCard } from "./problem";
import { SpeakerAvatar, subtle } from "./shared";

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
  "rounded-xl border border-white/30 bg-white/60 text-foreground shadow-2xl ring-1 ring-white/20 dark:border-white/10 dark:bg-black/55 dark:ring-white/10",
  "[&_[role=menuitemradio]:focus]:bg-white/70 dark:[&_[role=menuitemradio]:focus]:bg-white/12"
);

/** A picker in the input's footer: icon and name on the button; a title, icon and one line per option in the menu. */
function FooterPicker<T extends string>(props: { label: string; value: T; choices: Choice<T>[]; onChange: (v: T) => void; note?: string | null }) {
  const { label, value, choices, onChange, note } = props;
  const current = choices.find((c) => c.value === value) ?? choices[0]!;
  const Icon = current.icon;
  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger aria-label={`${label}: ${current.title}`} className="h-9 gap-2 px-3 text-[0.9375rem] text-muted-foreground">
        <Icon className="size-4" />
        {current.short ?? current.title}
      </PromptInputActionMenuTrigger>
      <PromptInputActionMenuContent className={cn(MENU_GLASS, "w-64 p-1.5")} collisionPadding={8} side="top" sticky="always">
        <DropdownMenuLabel className="px-2 pt-1.5 pb-1">{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup onValueChange={(v) => onChange(v as T)} value={value}>
          {choices.map((c) => (
            <DropdownMenuRadioItem className="items-start gap-2.5 rounded-lg px-2 py-2" key={c.value} value={c.value}>
              <c.icon className="mt-0.5 size-4" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{c.title}</span>
                <span className="text-muted-foreground text-sm">{c.line}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {note && <p className="px-2 pt-1 pb-1.5 text-muted-foreground text-sm">{note}</p>}
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
    <section aria-label="Live" className="flex min-h-0 flex-1 flex-col gap-2.5 px-3 pb-3">
      {inCall && (
        <div className={cn("flex flex-col gap-2 rounded-xl px-3 py-2.5 text-[0.9375rem]", subtle)}>
          <div className="flex items-center gap-2">
            <MonitorUpIcon className="size-5 shrink-0" />
            <span className={cn("min-w-0 flex-1", !screen && "text-muted-foreground")}>
              {screen ? `${screen.presenter ?? "Someone"} is sharing` : "Nobody is sharing"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {screen && (
              <GlassButton glassVariant="subtle" onClick={() => engine.takeScreenshot()} size="lg">
                <CameraIcon />
                Screenshot
              </GlassButton>
            )}
            <GlassButton
              aria-label={recorder.timing ? "Stop recording" : "Record the call"}
              glassVariant="subtle"
              onClick={() => (recorder.timing ? recorder.stop() : recorder.start())}
              size="lg"
            >
              {recorder.timing ? <SquareIcon className="fill-current" /> : <CircleIcon className="fill-red-500 text-red-500" />}
              {recorder.timing ? `Stop ${recorder.elapsed}` : "Record"}
            </GlassButton>
            {recorder.timing && (
              <GlassButton
                aria-label={recorder.paused ? "Resume recording" : "Pause recording"}
                glassVariant="subtle"
                onClick={() => (recorder.paused ? recorder.resume() : recorder.pause())}
                size="lg"
              >
                {recorder.paused ? <PlayIcon /> : <PauseIcon />}
                {recorder.paused ? "Resume" : "Pause"}
              </GlassButton>
            )}
          </div>
          <label className="flex items-center gap-2" htmlFor="auto-capture-switch">
            <LiquidSwitch
              aria-label="Save each new slide"
              checked={settings.screen.autoCapture}
              id="auto-capture-switch"
              onCheckedChange={(v: boolean) => update({ screen: { ...settings.screen, autoCapture: v } })}
            />
            <span className={cn(settings.screen.autoCapture ? "text-foreground" : "text-muted-foreground")}>Save each new slide</span>
          </label>
          {recorder.timing && <p className="text-muted-foreground">Meet doesn’t announce this. Tell people you’re recording.</p>}
          {recorder.error && <ProblemCard className="mt-0.5" onRetry={recorder.start} problem={recorder.error} />}
        </div>
      )}

      {notice && notice !== dismissed && <ProblemCard onDismiss={() => setDismissed(notice)} problem={notice} />}

      {pending.length > 0 && (
        <Queue className={cn("rounded-2xl px-2 pt-1.5 pb-1.5", subtle)}>
          <QueueSection>
            <div className="flex items-center justify-between gap-2">
              <QueueSectionTrigger className="bg-transparent px-2 py-1.5 text-sm">
                <QueueSectionLabel count={pending.length} icon={<ListChecksIcon className="size-4" />} label="waiting for you" />
              </QueueSectionTrigger>
              {approvals > 1 && (
                <GlassButton glassVariant="subtle" onClick={() => engine.approveAll()} size="lg">
                  Approve all ({approvals})
                </GlassButton>
              )}
            </div>
            <QueueSectionContent>
              <QueueList className="max-h-32">
                {pending.map(({ e, text, where, kind, approve }) => (
                  <QueueItem key={e.id}>
                    <div className="flex items-center gap-2">
                      <QueueItemIndicator />
                      <QueueItemContent>{text}</QueueItemContent>
                      <QueueItemActions>
                        <QueueItemAction aria-label={approve ? "Approve" : "Accept"} onClick={() => (approve ? engine.approve(e.id) : engine.decide(e.id, true))}>
                          <CheckIcon className="size-4" />
                        </QueueItemAction>
                        <QueueItemAction aria-label={approve ? "Discard" : "Reject"} onClick={() => (approve ? engine.discard(e.id) : engine.decide(e.id, false))}>
                          <XIcon className="size-4" />
                        </QueueItemAction>
                      </QueueItemActions>
                    </div>
                    <QueueItemDescription className="flex items-center gap-1">
                      <Logo className="size-4" name={FILE_LOGO[kind]} />
                      {approve ? where : `Suggestion in ${where}`}
                    </QueueItemDescription>
                  </QueueItem>
                ))}
              </QueueList>
            </QueueSectionContent>
          </QueueSection>
        </Queue>
      )}

      <Conversation className={cn("min-h-0 flex-1 rounded-2xl", subtle)}>
        <ConversationContent className="gap-5 p-3">
          {state.entries.length === 0 && !state.partial ? (
            // AI Elements' empty state, at the panel's own sizes instead of its small defaults.
            <ConversationEmptyState className="gap-4">
              <Logo className="size-14" name="meet" />
              <div className="space-y-1.5">
                <h3 className="font-semibold text-xl">No lines yet</h3>
                <p className="text-base text-muted-foreground">
                  {state.meet?.status === "listening"
                    ? settings.listenMode === "commands"
                      ? `Listening. Say “${settings.wakeWord}, …”`
                      : "Listening"
                    : "Join a Google Meet call to start"}
                </p>
              </div>
            </ConversationEmptyState>
          ) : (
            state.entries.map((e, i) => (
              <Fragment key={e.id}>
                {e.missed && !state.entries[i - 1]?.missed && (
                  <Checkpoint>
                    <CheckpointIcon>
                      <HistoryIcon className="size-4 shrink-0" />
                    </CheckpointIcon>
                    <span className="shrink-0 px-1 text-sm">Heard while the panel was closed, not run</span>
                  </Checkpoint>
                )}
                <EntryView avatar={state.avatars[e.speaker]} engine={engine} entry={e} me={me} />
              </Fragment>
            ))
          )}
          {state.partial && (
            <div className="flex flex-col gap-1.5 rounded-xl bg-background/50 p-2.5">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <SpeakerAvatar name={state.partial.speaker} src={state.avatars[state.partial.speaker]} />
                <span className="font-medium text-foreground">{state.partial.speaker}</span>
                <span>is speaking</span>
              </div>
              <Transcription currentTime={Number.MAX_SAFE_INTEGER} segments={toSegments(state.partial.text)}>
                {(segment, index) => <TranscriptionSegment index={index} key={index} segment={segment} />}
              </Transcription>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput className={cn("rounded-2xl", subtle)} onSubmit={(m: PromptInputMessage) => submit(m.text)}>
        {typing && (
          <PromptInputBody>
            <PromptInputTextarea
              autoFocus
              className="min-h-10 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Escape") setTyping(false);
              }}
              placeholder="Type a request…"
            />
          </PromptInputBody>
        )}
        <PromptInputFooter className="py-1.5">
          <PromptInputTools>
            <FooterPicker choices={modes(settings.wakeWord)} label="Listening mode" onChange={(v) => update({ listenMode: v })} value={settings.listenMode} />
            <FooterPicker
              choices={APPROVALS}
              label="When Scribe edits"
              note={settings.commentsOnly ? "Comments only is on in Outputs, so the text never changes." : null}
              onChange={(v) => update({ approval: v })}
              value={settings.approval}
            />
          </PromptInputTools>
          {typing ? (
            <div className="flex items-center gap-1">
              <PromptInputButton aria-label="Close" onClick={() => setTyping(false)} tooltip="Close (Esc)">
                <XIcon className="size-4" />
              </PromptInputButton>
              <PromptInputSubmit size="icon-sm" />
            </div>
          ) : (
            <PromptInputButton aria-label="Type a request" onClick={() => setTyping(true)} tooltip="Type a request">
              <KeyboardIcon className="size-4" />
            </PromptInputButton>
          )}
        </PromptInputFooter>
      </PromptInput>
    </section>
  );
}
