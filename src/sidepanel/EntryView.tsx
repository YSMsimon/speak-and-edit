import { CheckIcon, ClockIcon, FilmIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Engine, Entry, Proposal } from "@/lib/engine";
import type { WriteIntent } from "@/lib/targets/types";
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
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import type { ToolPart } from "@/components/ai-elements/tool";

import { describeProblem, type Problem } from "@/lib/problems";

import { FILE_LOGO, Logo } from "./logos";
import { ProblemCard } from "./problem";
import { SpeakerAvatar, subtle, timeOf } from "./shared";

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
  return <Image alt={alt} base64={base64} className={cn("border border-border/50", className)} mediaType={mediaType} uint8Array={EMPTY} />;
}

/** What a proposal will add, when it's a picture or a recording. */
function MediaPreview({ p }: { p: Proposal }) {
  if (p.media?.preview) return <Still alt={p.media.caption} dataUrl={p.media.preview} />;
  if (p.media) {
    return (
      <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <FilmIcon className="size-3.5" />
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
        <Shimmer as="p" className="text-sm">
          {`${a.step}…`}
        </Shimmer>
      );
    case "error":
      // Spoken and typed lines can run again; a screenshot or recording can't be redone.
      return <ProblemCard onRetry={entry.source ? undefined : () => engine.retry(entry.id)} problem={a.message} />;
    case "discarded":
      return <p className="flex items-center gap-1.5 text-muted-foreground text-xs"><XIcon className="size-3.5" />Discarded</p>;
    case "transcript":
      return (
        <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
          {a.status === "written" ? <CheckIcon className="size-3.5 text-green-600" /> : a.status === "failed" ? <XIcon className="size-3.5 text-destructive" /> : <ClockIcon className="size-3.5" />}
          <Logo className="size-3.5" name="doc" />
          <span>
            {a.status === "waiting" && `Transcript, ${a.fileTitle}: waiting`}
            {a.status === "queued" && `Transcript, ${a.fileTitle}…`}
            {a.status === "written" && `Transcript, ${a.fileTitle}`}
            {a.status === "failed" && `Transcript failed: ${a.message ?? ""}`}
          </span>
          {a.status === "waiting" && (
            <span className="flex gap-1">
              <GlassButton glassVariant="subtle" onClick={() => engine.approve(entry.id)} size="xs">
                Add
              </GlassButton>
              <GlassButton glassVariant="subtle" onClick={() => engine.discard(entry.id)} size="xs">
                Skip
              </GlassButton>
            </span>
          )}
        </div>
      );
    case "control": {
      const ok = a.failed.length === 0;
      return (
        <Tool className={cn("mb-0 rounded-xl", subtle)} defaultOpen={!ok || a.done.length > 1}>
          <ToolHeader
            className="p-2.5 text-left"
            icon={<SlidersHorizontalIcon className="size-6 text-muted-foreground" />}
            state={ok ? "output-available" : "output-error"}
            title={`Scribe: ${a.done[0] ?? "couldn’t change that"}`}
            type="tool-set_scribe"
          />
          <ToolContent className="space-y-3 p-3">
            <ToolInput input={a.params} />
            <ToolOutput
              errorText={a.failed.join(" ") || undefined}
              output={
                a.done.length ? (
                  <ul className="space-y-1 p-2.5">
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
        <Message from="assistant">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span className="font-medium text-foreground">Scribe</span>
          </div>
          <MessageContent className={cn("rounded-xl px-3 py-2", subtle)}>
            <p>{a.answer}</p>
          </MessageContent>
        </Message>
      );
    case "clarify":
      return (
        <Question
          className={cn("rounded-xl p-3", subtle)}
          onSubmit={(resp) => {
            const v = resp.selectedValues[0];
            if (v) engine.answerClarify(entry.id, v);
          }}
        >
          <QuestionPrompt>{a.question}</QuestionPrompt>
          <QuestionOptions>
            {a.options.map((o) => (
              <QuestionOption key={o} value={o}>
                {o}
              </QuestionOption>
            ))}
          </QuestionOptions>
          <QuestionActions>
            <QuestionSubmit>Send</QuestionSubmit>
          </QuestionActions>
        </Question>
      );
    case "proposal": {
      const p = a.proposal;
      return (
        <Tool className={cn("mb-0 rounded-xl", subtle)} defaultOpen>
          <ToolHeader className="p-2.5 text-left" icon={<Logo className="size-6" name={FILE_LOGO[p.file.kind]} />} state="approval-requested" title={proposalTitle(p)} type="tool-scribe" />
          <ToolContent className="space-y-3 p-3">
            <MediaPreview p={p} />
            <ToolInput input={{ file: p.file.title, ...describeWrite(p.write) }} />
            <Confirmation approval={{ id: entry.id }} className="bg-background/40" state="approval-requested">
              <ConfirmationTitle>
                <ConfirmationRequest>
                  {p.media?.kind === "image" && p.file.kind !== "sheet"
                    ? "Nothing is saved until you approve. The picture is then public for a few seconds while Google copies it."
                    : "Nothing is written until you approve."}
                </ConfirmationRequest>
              </ConfirmationTitle>
              <ConfirmationActions>
                <ConfirmationAction onClick={() => engine.discard(entry.id)} variant="outline">
                  Discard
                </ConfirmationAction>
                <ConfirmationAction onClick={() => engine.approve(entry.id)}>Approve</ConfirmationAction>
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
          ? "Comment"
          : r.status === "waiting"
            ? "Suggestion"
            : p.media
              ? p.media.kind === "image"
                ? "Screenshot"
                : "Recording"
              : r.remove
                ? "Changed"
                : "Added";
      return (
        <Tool className={cn("mb-0 rounded-xl", subtle)} defaultOpen={waiting}>
          <ToolHeader className="p-2.5 text-left" icon={<Logo className="size-6" name={FILE_LOGO[p.file.kind]} />} state={state} title={`${verb}: ${p.file.title} › ${r.where}`} type="tool-scribe" />
          <ToolContent className="space-y-3 p-3">
            <MediaPreview p={p} />
            <ToolInput input={{ ...(r.remove ? { remove: r.remove } : {}), add: r.add, requested_by: `${p.speaker}, ${timeOf(p.at).slice(0, 5)}` }} />
            {r.status === "waiting" && (
              <Confirmation approval={approval} className="bg-background/40" state={state}>
                <ConfirmationTitle>
                  <ConfirmationRequest>A suggestion in the doc. Accept here or in Docs.</ConfirmationRequest>
                  <ConfirmationAccepted>
                    <span className="inline-flex items-center gap-1.5">
                      <CheckIcon className="size-4 text-green-600" />
                      Accepted
                    </span>
                  </ConfirmationAccepted>
                  <ConfirmationRejected>
                    <span className="inline-flex items-center gap-1.5">
                      <XIcon className="size-4 text-destructive" />
                      Rejected. Doc unchanged
                    </span>
                  </ConfirmationRejected>
                </ConfirmationTitle>
                <ConfirmationActions>
                  <ConfirmationAction onClick={() => engine.decide(entry.id, false)} variant="outline">
                    Reject
                  </ConfirmationAction>
                  <ConfirmationAction onClick={() => engine.decide(entry.id, true)}>Accept</ConfirmationAction>
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
  const mine = entry.typed || (me !== null && entry.speaker === me);
  const wake = entry.addressed && !entry.typed;
  return (
    <div className="flex flex-col gap-2">
      <Message from={mine ? "user" : "assistant"}>
        <div className={cn("flex items-center gap-2 text-muted-foreground text-xs", mine && "justify-end")}>
          <SpeakerAvatar name={entry.speaker} src={avatar} />
          <span className="font-medium text-foreground text-sm">{entry.speaker}</span>
          <time className="tabular-nums">{timeOf(entry.at)}</time>
          {entry.typed && <span>typed</span>}
        </div>
        <MessageContent className="text-[15px]">
          <p className={cn(wake && "font-medium")}>{entry.text}</p>
        </MessageContent>
      </Message>
      <ActionView engine={engine} entry={entry} />
    </div>
  );
}
