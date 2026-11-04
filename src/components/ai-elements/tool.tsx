"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose mb-4 w-full rounded-md border", className)}
    {...props}
  />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: string;
  className?: string;
  /** local patch: shown instead of the wrench, e.g. the file's logo. */
  icon?: ReactNode;
  /** local patch: a second, smaller line under the title. */
  subtitle?: string;
  /** local patch: the state as a round icon on the right, instead of the badge and chevron. */
  compact?: boolean;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | {
      type: DynamicToolUIPart["type"];
      state: DynamicToolUIPart["state"];
      toolName: string;
    }
);

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (status: ToolPart["state"]) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

/** local patch: the round state icon of a compact header. */
const compactTone: Record<ToolPart["state"], string> = {
  "approval-requested": "bg-amber-400/15 text-amber-200 ring-amber-300/45 shadow-[0_0_16px_-4px_rgba(251,191,36,0.55)]",
  "approval-responded": "bg-sky-400/15 text-sky-200 ring-sky-300/45",
  "input-available": "bg-white/10 text-muted-foreground ring-white/20",
  "input-streaming": "bg-white/10 text-muted-foreground ring-white/20",
  "output-available": "bg-emerald-400/20 text-emerald-200 ring-emerald-300/55 shadow-[0_0_16px_-3px_rgba(52,211,153,0.65),inset_0_0_10px_rgba(52,211,153,0.15)]",
  "output-denied": "bg-orange-400/15 text-orange-200 ring-orange-300/45 shadow-[0_0_16px_-4px_rgba(251,146,60,0.5)]",
  "output-error": "bg-red-400/15 text-red-200 ring-red-300/50 shadow-[0_0_16px_-4px_rgba(248,113,113,0.55)]",
};
const compactIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-3.5" />,
  "approval-responded": <CheckIcon className="size-3.5" />,
  "input-available": <ClockIcon className="size-3.5 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-3.5" />,
  "output-available": <CheckIcon className="size-3.5" strokeWidth={3} />,
  "output-denied": <XIcon className="size-3.5" />,
  "output-error": <XIcon className="size-3.5" />,
};

/** local patch: the compact round state icon, for rows that have no ToolHeader. */
export const ToolStatusOrb = ({ state, className }: { state: ToolPart["state"]; className?: string }) => (
  <span aria-label={statusLabels[state]} className={cn("flex size-7 shrink-0 items-center justify-center rounded-full ring-1", compactTone[state], className)} title={statusLabels[state]}>
    {compactIcons[state]}
  </span>
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  icon,
  subtitle,
  compact,
  ...props
}: ToolHeaderProps) => {
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-4 p-3",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon ?? <WrenchIcon className="size-4 text-muted-foreground" />}
        {subtitle ? (
          <span className="flex min-w-0 flex-col text-left">
            <span className="truncate font-medium text-sm">{title ?? derivedName}</span>
            <span className="truncate text-muted-foreground text-xs">{subtitle}</span>
          </span>
        ) : (
          <span className="font-medium text-sm">{title ?? derivedName}</span>
        )}
        {!compact && getStatusBadge(state)}
      </div>
      {compact ? (
        <span aria-label={statusLabels[state]} className={cn("flex size-7 shrink-0 items-center justify-center rounded-full ring-1", compactTone[state])} title={statusLabels[state]}>
          {compactIcons[state]}
        </span>
      ) : (
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      )}
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/50 text-foreground"
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
