"use client";

import * as React from "react";

import { type FrostGlassVariant, type FrostGlassVariantProp, glassVariantStyles } from "@/components/glasscn/lib/glass-variants";
import { cn } from "@/components/glasscn/lib/utils";

import { Select, SelectContent, SelectTrigger } from "../select";
import { LiquidGlass } from "./liquid-glass";

const GlassSelectVariantContext = React.createContext<FrostGlassVariant>("liquid-refract");

type GlassSelectProps = React.ComponentProps<typeof Select> & FrostGlassVariantProp;

function GlassSelect({ glassVariant = "liquid-refract", ...props }: GlassSelectProps) {
  return (
    <GlassSelectVariantContext.Provider value={glassVariant}>
      <Select data-slot="glass-select" {...props} />
    </GlassSelectVariantContext.Provider>
  );
}

function GlassSelectTrigger({ className, ...props }: React.ComponentProps<typeof SelectTrigger>) {
  const variant = React.useContext(GlassSelectVariantContext);

  const baseStyles =
    "border-white/40 bg-white/40 text-foreground shadow-[0_8px_30px_rgba(255,255,255,0.08)] data-placeholder:text-foreground/75 dark:data-placeholder:text-foreground/60 dark:border-white/12 dark:bg-black/40";

  if (variant === "liquid-refract") {
    return (
      <LiquidGlass className={cn("rounded-lg", className)}>
        <SelectTrigger
          data-slot="glass-select-trigger"
          className={cn("bg-transparent border-0 shadow-none", baseStyles, className)}
          {...props}
        />
      </LiquidGlass>
    );
  }

  return (
    <SelectTrigger
      data-slot="glass-select-trigger"
      className={cn(glassVariantStyles[variant], baseStyles, className)}
      {...props}
    />
  );
}

function GlassSelectContent({ className, ...props }: React.ComponentProps<typeof SelectContent>) {
  const variant = React.useContext(GlassSelectVariantContext);

  return (
    <SelectContent
      data-slot="glass-select-content"
      // local patch: open under the trigger instead of over it, near-solid dark glass (nothing shows through), the trigger's width.
      // Also padding (p-1.5, like the Live tab's menus) so the highlighted row and its text don't touch the border:
      // shadcn/ui pads its select list, and this copy had lost that.
      alignItemWithTrigger={false}
      sideOffset={6}
      className={cn(
        variant !== "liquid-refract" && glassVariantStyles[variant],
        "min-w-[var(--anchor-width)] rounded-xl border border-white/30 bg-white/80 p-1.5 text-foreground shadow-2xl ring-1 ring-white/20 backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/95 dark:ring-white/10",
        "[&_[data-slot=select-item]]:rounded-lg [&_[data-slot=select-item]]:pl-2.5",
        "[&_[data-slot=select-item]:focus]:bg-white/70 [&_[data-slot=select-item]:focus]:text-black dark:[&_[data-slot=select-item]:focus]:bg-white/12 dark:[&_[data-slot=select-item]:focus]:text-white",
        className,
      )}
      {...props}
    />
  );
}

export { GlassSelect, GlassSelectContent, GlassSelectTrigger };
