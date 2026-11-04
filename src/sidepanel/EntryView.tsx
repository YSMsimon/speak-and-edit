import { CheckIcon, ClockIcon, FilmIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Engine, Entry, Proposal } from "@/lib/engine";
import type { WriteIntent } from "@/lib/targets/types";
import { KIND_LABEL, type FileKind } from "@/lib/files";
import { GlassButton } from "@/components/glasscn/ui/glasscn/glass-button";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import { Image } from "@/components/ai-elements/image";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Question, QuestionActions, QuestionOption, QuestionOptions, QuestionPrompt, QuestionSubmit } from "@/components/ai-elements/question";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput, ToolStatusOrb } from "@/components/ai-elements/tool";
import type { ToolPart } from "@/components/ai-elements/tool";

import { describeProblem, type Problem } from "@/lib/problems";

import { FILE_LOGO, Logo } from "./logos";
import { ProblemCard } from "./problem";
import { SpeakerAvatar, timeOf } from "./shared";

/** Every card under a line: dark glass, a thin neon edge in the colour of its state. */
const CARD = "mb-0 min-w-0 rounded-2xl border-0 bg-[linear-gradient(115deg,rgba(139,92,246,0.10),rgba(255,255,255,0.045)_45%,rgba(45,212,191,0.07))] text-[13px] text-white/95 backdrop-blur-xl";
const HEADER = "min-h-[54px] w-full gap-2.5 rounded-2xl py-2.5 pl-3 pr-12 text-left [&>svg]:hidden [&_[data-slot=badge]]:hidden [&_.truncate]:whitespace-normal";
const CONTENT = "space-y-3 border-t border-white/[0.07] p-3 text-[13px] [&_pre]:rounded-xl [&_pre]:border-white/[0.06] [&_pre]:bg-black/20 [&_pre]:text-xs";
const CONFIRMATION = "rounded-xl border border-white/[0.08] bg-black/20 p-3 text-[12px] leading-relaxed";
const SECONDARY_ACTION = "h-8 rounded-full border-white/15 bg-white/[0.045] px-4 text-xs text-white/80 hover:bg-white/[0.09]";
const PRIMARY_ACTION = "neon neon-green h-8 rounded-full border-0 bg-emerald-400/[0.12] px-4 text-xs text-emerald-100 hover:bg-emerald-400/20";

/** The app's logo in a small glass tile, at the start of a card. */
function FileTile({ kind }: { kind: FileKind }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <Logo className="size-6" name={FILE_LOGO[kind]} />
    </span>
  );
}

const LABELS: Record<string, string> = { decision: "Decision", action_item: "Action item", open_question: "Open question", fact: "Fact" };

export function describeWrite(w: WriteIntent): Record<string, unknown> {
  return {
    ...(w.section ? { section: w.section } : {}),
    ...(w.find ? { change: w.find } : {}),
    ...(w.replaceWith ? { to: w.replaceWith } : {}),
    ...(w.text ? { text: w.text } : {}),
    ...(w.cells.length ? { cells: Object.fromEntries(w.cells.map((c) => [c.column, c.value])) } : {}),
    ...(w.rows?.length ? { rows: w.rows.map((r) => Object.fromEntries(r.map((c) => [c.column, c.value]))) } : {}),
  };
}

const EMPTY = new Uint8Array();

/** A still of the shared screen, from its data URL. */
function Still({ dataUrl, alt, className }: { dataUrl: string; alt: string; className?: string }) {
  const [head = "", base64 = ""] = dataUrl.split(",");
  const mediaType = /^data:([^;,]+)/.exec(head)?.[1] ?? "image/jpeg";
  return <Image alt={alt} base64={base64} className={cn("max-w-full rounded-xl border border-white/10", className)} mediaType={mediaType} uint8Array={EMPTY} />;
}

/** What a proposal will add, when it's a picture or a recording. */
function MediaPreview({ p }: { p: Proposal }) {
  if (p.media?.preview) return <Still alt={p.media.caption} dataUrl={p.media.preview} />;
  if (p.media) {
    return (
      <p className="flex items-center gap-2 text-xs leading-relaxed text-slate-400">
        <FilmIcon className="size-3.5 shrink-0" />
        {p.media.caption}
      </p>
    );
  }
  if (p.seen) return <Still alt="The shared screen Scribe read" className="max-h-28 w-auto opacity-90" dataUrl={p.seen} />;
  return null;
}

/** A note on a change that did go through: a known problem keeps its wording, anything else is plain info. */
function asNote(text: string): Problem {
  const p = describeProblem(text);
  return p.title === "Couldn’t do that" ? { severity: "info", title: "Note", body: text, fixes: [] } : p;
}

export function proposalTitle(p: Proposal): string {
  const where = p.write.section ? ` › ${p.write.section}` : "";
  if (p.media) return `Add ${p.media.kind === "image" ? "screenshot" : "recording"} to ${p.file.title}${where}`;
  const verb = { append: "Add to", replace: "Change in", comment: "Comment on", new_slide: "New slide in" }[p.write.action];
  return `${LABELS[p.label ?? ""] ? `${LABELS[p.label ?? ""]}: ` : ""}${verb} ${p.file.title}${where}`;
}

function ActionView({ entry, engine }: { entry: Entry; engine: Engine }) {
  const a = entry.action;
  switch (a.kind) {
    case "skipped":
    case "ignored":
      // Nothing was done, so there's nothing to show: the line itself stays in the list.
      return null;
    case "pending":
      return (
        <div className={cn(CARD, "neon neon-amber neon-soft flex items-center gap-3 px-3 py-2.5")}>
          <ClockIcon aria-hidden="true" className="size-4 shrink-0 text-amber-200/80" />
          <Shimmer as="p" className="text-[13px]">
            {`${a.step}…`}
          </Shimmer>
        </div>
      );
    case "error":
      // Spoken and typed lines can run again; a screenshot or recording can't be redone.
      return (
        <div className={cn(CARD, "neon neon-red [&>div]:m-0 [&>div]:rounded-2xl [&>div]:border-0 [&>div]:bg-transparent [&_button]:rounded-full")}>
          <ProblemCard onRetry={entry.source ? undefined : () => engine.retry(entry.id)} problem={a.message} />
        </div>
      );
    case "discarded":
      return <p className="flex items-center gap-1.5 px-1 py-1 text-xs text-slate-400"><XIcon className="size-3.5" />Discarded</p>;
    case "transcript":
      return (
        <div className={cn(CARD, "neon flex flex-wrap items-center gap-2.5 px-3 py-2.5", a.status === "written" ? "neon-green" : a.status === "failed" ? "neon-red" : "neon-amber")}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-black/20">
            <Logo className="size-6" name="doc" />
          </span>
          <span className="min-w-0 flex-1 text-[13px] font-medium leading-5">
            {a.status === "waiting" && `Transcript, ${a.fileTitle}: waiting`}
            {a.status === "queued" && `Transcript, ${a.fileTitle}…`}
            {a.status === "written" && `Transcript, ${a.fileTitle}`}
            {a.status === "failed" && `Transcript failed: ${a.message ?? ""}`}
          </span>
          <ToolStatusOrb state={a.status === "written" ? "output-available" : a.status === "failed" ? "output-error" : "approval-requested"} />
          {a.status === "waiting" && (
            <span className="flex w-full justify-end gap-2 border-t border-white/[0.07] pt-2.5">
              <GlassButton className={PRIMARY_ACTION} glassVariant="subtle" onClick={() => engine.approve(entry.id)} size="xs">
                Add
              </GlassButton>
              <GlassButton className={SECONDARY_ACTION} glassVariant="subtle" onClick={() => engine.discard(entry.id)} size="xs">
                Skip
              </GlassButton>
            </span>
          )}
        </div>
      );
    case "control": {
      const ok = a.failed.length === 0;
      return (
        <Tool className={cn(CARD, "neon neon-soft", ok ? "neon-violet" : "neon-red")} defaultOpen={!ok || a.done.length > 1}>
          <ToolHeader
            className={HEADER}
            compact
            icon={
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-violet-300/15 bg-violet-400/10">
                <SlidersHorizontalIcon className="size-4 text-violet-200" />
              </span>
            }
            state={ok ? "output-available" : "output-error"}
            subtitle="Settings"
            title={a.done[0] ?? "Couldn’t change that"}
            type="tool-set_scribe"
          />
          <ToolContent className={CONTENT}>
            <ToolInput input={a.params} />
            <ToolOutput
              errorText={a.failed.join(" ") || undefined}
              output={
                a.done.length ? (
                  <ul className="space-y-1.5 p-2.5 text-[13px] leading-relaxed">
                    {a.done.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                ) : undefined
              }
            />
          </ToolContent>
        </Tool>
      );
    }
    case "answer":
      return (
        <Message className="w-full max-w-full gap-1.5" from="assistant">
          <div className="flex items-center gap-2 px-1 text-xs text-slate-400">
            <span className="font-medium text-violet-200">Scribe</span>
          </div>
          <MessageContent className={cn(CARD, "neon neon-violet w-full rounded-2xl px-3.5 py-3 text-[13px] leading-[1.55]")}>
            <p>{a.answer}</p>
          </MessageContent>
        </Message>
      );
    case "clarify":
      return (
        <Question
          className={cn(CARD, "neon neon-violet neon-soft space-y-3 p-3")}
          onSubmit={(resp) => {
            const v = resp.selectedValues[0];
            if (v) engine.answerClarify(entry.id, v);
          }}
        >
          <QuestionPrompt className="text-[13px] font-medium leading-relaxed">{a.question}</QuestionPrompt>
          <QuestionOptions className="gap-2">
            {a.options.map((o) => (
              <QuestionOption className="rounded-xl border-white/10 bg-white/[0.04] text-[13px]" key={o} value={o}>
                {o}
              </QuestionOption>
            ))}
          </QuestionOptions>
          <QuestionActions>
            <QuestionSubmit className="neon neon-violet h-8 rounded-full border-0 bg-violet-400/15 px-4 text-xs text-violet-100">Send</QuestionSubmit>
          </QuestionActions>
        </Question>
      );
    case "proposal": {
      const p = a.proposal;
      return (
        <Tool className={cn(CARD, "neon neon-amber neon-soft")} defaultOpen>
            <ToolHeader className={HEADER} compact icon={<FileTile kind={p.file.kind} />} state="approval-requested" subtitle={`Waiting for you · ${KIND_LABEL[p.file.kind]}`} title={proposalTitle(p)} type="tool-scribe" />
          <ToolContent className={CONTENT}>
            <MediaPreview p={p} />
            <ToolInput input={{ file: p.file.title, ...describeWrite(p.write) }} />
            <Confirmation approval={{ id: entry.id }} className={CONFIRMATION} state="approval-requested">
              <ConfirmationTitle className="text-xs leading-relaxed text-slate-300">
                <ConfirmationRequest>
                  {p.media?.kind === "image" && p.file.kind !== "sheet"
                    ? "Nothing is saved until you approve. The picture is then public for a few seconds while Google copies it."
                    : "Nothing is written until you approve."}
                </ConfirmationRequest>
              </ConfirmationTitle>
              <ConfirmationActions className="mt-3 gap-2">
                <ConfirmationAction className={SECONDARY_ACTION} onClick={() => engine.discard(entry.id)} variant="outline">
                  Discard
                </ConfirmationAction>
                <ConfirmationAction className={PRIMARY_ACTION} onClick={() => engine.approve(entry.id)}>Approve</ConfirmationAction>
              </ConfirmationActions>
            </Confirmation>
          </ToolContent>
        </Tool>
      );
    }
    case "written": {
      const { proposal: p, result: r } = a;
      const waiting = r.status === "waiting" && !a.decision;
      const state: ToolPart["state"] = waiting ? "approval-requested" : a.decision === "rejected" ? "output-denied" : "output-available";
      const approval = waiting ? { id: entry.id } : { id: entry.id, approved: a.decision !== "rejected" };
      const verb =
        r.status === "commented"
          ? "Comment on"
          : r.status === "waiting"
            ? "Suggestion in"
            : p.media
              ? p.media.kind === "image"
                ? "Screenshot in"
                : "Recording in"
              : r.remove
                ? "Changed in"
                : "Added to";
      const tone = waiting ? "neon-amber" : a.decision === "rejected" ? "neon-red" : "neon-green";
      return (
        <Tool className={cn(CARD, "neon", tone)} defaultOpen={waiting}>
            <ToolHeader className={HEADER} compact icon={<FileTile kind={p.file.kind} />} state={state} subtitle={KIND_LABEL[p.file.kind]} title={`${verb} ${p.file.title} › ${r.where}`} type="tool-scribe" />
          <ToolContent className={CONTENT}>
            <MediaPreview p={p} />
            <ToolInput input={{ ...(r.remove ? { remove: r.remove } : {}), add: r.add, requested_by: `${p.speaker}, ${timeOf(p.at).slice(0, 5)}` }} />
            {r.status === "waiting" && (
              <Confirmation approval={approval} className={CONFIRMATION} state={state}>
                <ConfirmationTitle className="text-xs leading-relaxed text-slate-300">
                  <ConfirmationRequest>A suggestion in the doc. Accept here or in Docs.</ConfirmationRequest>
                  <ConfirmationAccepted>
                    <span className="inline-flex items-center gap-1.5">
                      <CheckIcon className="size-4 text-emerald-300" />
                      Accepted
                    </span>
                  </ConfirmationAccepted>
                  <ConfirmationRejected>
                    <span className="inline-flex items-center gap-1.5">
                      <XIcon className="size-4 text-red-300" />
                      Rejected. Doc unchanged
                    </span>
                  </ConfirmationRejected>
                </ConfirmationTitle>
                <ConfirmationActions className="mt-3 gap-2">
                  <ConfirmationAction className={SECONDARY_ACTION} onClick={() => engine.decide(entry.id, false)} variant="outline">
                    Reject
                  </ConfirmationAction>
                  <ConfirmationAction className={PRIMARY_ACTION} onClick={() => engine.decide(entry.id, true)}>Accept</ConfirmationAction>
                </ConfirmationActions>
              </Confirmation>
            )}
            {a.warning && <ProblemCard problem={asNote(a.warning)} />}
          </ToolContent>
        </Tool>
      );
    }
  }
}

export function EntryView({ entry, engine, me, avatar }: { entry: Entry; engine: Engine; me: string | null; avatar?: string }) {
  const wake = entry.addressed && !entry.typed;
  return (
    <div className="flex items-start gap-3 py-1.5">
      <SpeakerAvatar className="mt-0.5 size-8 shrink-0 rounded-full ring-1 ring-white/20 shadow-[0_0_16px_-6px_rgba(139,92,246,0.45)] [&_[data-slot=avatar-fallback]]:text-base" name={entry.speaker} src={avatar} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Message className="w-full max-w-full gap-1" from="assistant">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 px-0.5 text-[11px] leading-5 text-slate-400">
            <span className="font-medium text-[13px] text-white/95">{entry.speaker}</span>
            <time className="tabular-nums">{timeOf(entry.at).slice(0, 5)}</time>
            {entry.typed && <span>typed</span>}
          </div>
          <MessageContent className="w-fit max-w-full rounded-2xl border border-white/[0.13] bg-[linear-gradient(125deg,rgba(167,139,250,0.12),rgba(148,163,184,0.08)_55%,rgba(96,165,250,0.10))] px-3 py-2 text-[14px] leading-[1.45] text-white/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] backdrop-blur-md">
            <p className={cn("break-words", wake && "font-medium")}>{entry.text}</p>
          </MessageContent>
        </Message>
        <ActionView engine={engine} entry={entry} />
      </div>
    </div>
  );
}
