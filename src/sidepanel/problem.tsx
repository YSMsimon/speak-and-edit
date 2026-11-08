// The one way Scribe shows a problem: glasscn's Glass Alert with a severity icon, a short title,
// one line, fix buttons, and the raw message under Details. Used inline, as the Live banner,
// and as the card under a line that failed. See lib/problems.ts for the wording.
import { createContext, useContext, type ReactNode } from "react";
import { ChevronDownIcon, CircleAlertIcon, InfoIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { describeProblem, FIX_LABEL, type Fix, type Problem, type Severity } from "@/lib/problems";
import { AlertAction, AlertDescription, AlertTitle } from "@/components/glasscn/ui/alert";
import { GlassAlert } from "@/components/glasscn/ui/glasscn/glass-alert";
import { GlassButton } from "@/components/glasscn/ui/glasscn/glass-button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** App-level handlers for fix buttons (switch tab, sign in, use the built-in model…). "retry" is handled by each caller. */
export const FixContext = createContext<(fix: Fix) => void>(() => undefined);

const ICON: Record<Severity, typeof CircleAlertIcon> = { error: CircleAlertIcon, warning: TriangleAlertIcon, info: InfoIcon };

const TONE: Record<Severity, string> = {
  error: "*:[svg]:!text-red-600 dark:*:[svg]:!text-red-400 [&_[data-slot=alert-title]]:text-red-900 dark:[&_[data-slot=alert-title]]:text-red-200",
  warning: "*:[svg]:!text-amber-600 dark:*:[svg]:!text-amber-400 [&_[data-slot=alert-title]]:text-amber-950 dark:[&_[data-slot=alert-title]]:text-amber-100",
  info: "*:[svg]:!text-muted-foreground",
};

export function ProblemCard(props: {
  problem: Problem | unknown;
  /** Shown as the "Try again" button when the problem offers it. */
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const runFix = useContext(FixContext);
  const p = isProblem(props.problem) ? props.problem : describeProblem(props.problem);
  const Icon = ICON[p.severity];
  const fixes = p.fixes.filter((f) => f !== "retry" || props.onRetry);
  return (
    <GlassAlert className={cn("rounded-xl px-3 py-2.5 text-sm", props.onDismiss && "pr-9", TONE[p.severity], props.className)} glassVariant="subtle" role={p.severity === "info" ? "status" : "alert"}>
      <Icon />
      <AlertTitle className="text-sm">{p.title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2 text-sm">
        {p.body && <span>{p.body}</span>}
        {props.children}
        {(fixes.length > 0 || p.detail) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {fixes.map((f, i) => (
              <GlassButton glassVariant={i === 0 ? "liquid-refract" : "subtle"} key={f} onClick={() => (f === "retry" ? props.onRetry?.() : runFix(f))} size="default">
                {FIX_LABEL[f]}
              </GlassButton>
            ))}
            {p.detail && (
              <Collapsible className="w-full">
                <CollapsibleTrigger className="group inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground">
                  Details
                  <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <code className="mt-1 block select-text whitespace-pre-wrap break-words rounded-md bg-black/5 px-2 py-1.5 font-mono text-xs dark:bg-white/5">{p.detail}</code>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}
      </AlertDescription>
      {props.onDismiss && (
        <AlertAction className="top-1.5 right-1.5">
          <GlassButton aria-label="Dismiss" glassVariant="subtle" onClick={props.onDismiss} size="icon-sm">
            <XIcon />
          </GlassButton>
        </AlertAction>
      )}
    </GlassAlert>
  );
}

function isProblem(x: unknown): x is Problem {
  return !!x && typeof x === "object" && "title" in x && "severity" in x && "fixes" in x;
}
