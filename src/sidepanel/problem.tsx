// The one way Scribe shows a problem: glasscn's Glass Alert with a severity icon, a short title,
// one line, fix buttons, and the raw message under Details. Used inline, as the Live banner,
// and as the card under a line that failed. See lib/problems.ts for the wording.
import { createContext, useContext, type ReactNode } from "react";
import { ChevronDownIcon, InfoIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { describeProblem, FIX_LABEL, type Fix, type Problem, type Severity } from "@/lib/problems";
import { AlertAction, AlertDescription, AlertTitle } from "@/components/glasscn/ui/alert";
import { GlassAlert } from "@/components/glasscn/ui/glasscn/glass-alert";
import { GlassButton } from "@/components/glasscn/ui/glasscn/glass-button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** App-level handlers for fix buttons (switch tab, sign in, use Ollama…). "retry" is handled by each caller. */
export const FixContext = createContext<(fix: Fix) => void>(() => undefined);

const ICON: Record<Severity, typeof TriangleAlertIcon> = { error: TriangleAlertIcon, warning: TriangleAlertIcon, info: InfoIcon };

const TONE: Record<Severity, string> = {
  error: "neon neon-red bg-[linear-gradient(135deg,rgba(248,113,113,0.10),transparent_55%,rgba(244,63,94,0.06))]",
  warning: "neon neon-amber bg-[linear-gradient(135deg,rgba(251,191,36,0.09),transparent_55%,rgba(245,158,11,0.05))]",
  info: "border-white/[0.10]",
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
    <GlassAlert
      className={cn(
        "relative !flex items-start gap-3 rounded-2xl border-white/[0.06] bg-white/[0.045] p-3.5 text-[13px] text-white/95 backdrop-blur-xl",
        props.onDismiss && "pr-11",
        TONE[p.severity],
        props.className,
      )}
      glassVariant="subtle"
      role={p.severity === "info" ? "status" : "alert"}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
          p.severity === "error" && "border-red-400/20 bg-red-400/[0.09] text-red-400",
          p.severity === "warning" && "border-amber-400/20 bg-amber-400/[0.09] text-amber-300",
          p.severity === "info" && "border-white/10 bg-white/[0.06] text-violet-200/80",
        )}
      >
        <Icon className="size-5 drop-shadow-[0_0_7px_currentColor]" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <AlertTitle className="mb-1 text-[14px] leading-5 font-semibold tracking-[-0.015em] text-white/95">
          {p.title}
        </AlertTitle>
        <AlertDescription className="flex flex-col gap-2.5 text-[13px] leading-5 text-[#b9b6cd]">
          {p.body && <span>{p.body}</span>}
          {props.children}
          {(fixes.length > 0 || p.detail) && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {fixes.map((f, i) => (
                <GlassButton
                  className={cn(
                    "h-8 rounded-full border-white/10 bg-white/[0.05] px-3.5 text-[13px] font-medium text-white/90 transition-colors hover:bg-white/[0.10]",
                    i === 0 && "neon border-transparent bg-violet-500/[0.13] text-white hover:bg-violet-500/20",
                  )}
                  glassVariant="subtle"
                  key={f}
                  onClick={() => (f === "retry" ? props.onRetry?.() : runFix(f))}
                  size="xs"
                >
                  {FIX_LABEL[f]}
                </GlassButton>
              ))}
              {p.detail && (
                <Collapsible className="w-full">
                  <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-md py-0.5 text-xs text-[#9692ac] transition-colors hover:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60">
                    Details
                    <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <code className="mt-2 block select-text whitespace-pre-wrap break-words rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 font-mono text-[11px] leading-relaxed text-[#b9b6cd]">{p.detail}</code>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </AlertDescription>
      </div>
      {props.onDismiss && (
        <AlertAction className="absolute top-2.5 right-2.5">
          <GlassButton
            aria-label="Dismiss"
            className="size-6 rounded-full border border-white/[0.08] bg-white/[0.04] text-white/50 hover:bg-white/[0.09] hover:text-white/90 [&_svg]:size-3.5"
            glassVariant="subtle"
            onClick={props.onDismiss}
            size="icon-xs"
          >
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
