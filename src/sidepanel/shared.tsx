import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { glassVariantStyles } from "@/components/glasscn/lib/glass-variants";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/glasscn/ui/avatar";
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/glasscn/ui/item";
import { GlassItem } from "@/components/glasscn/ui/glasscn/glass-item";
import { GlassRadioGroupItem } from "@/components/glasscn/ui/glasscn/glass-radio-group";

/** glasscn's own surface style, applied to AI Elements containers. */
export const subtle = glassVariantStyles.subtle;

// Initials sit on a gradient in the logo's family of colours.
const COLORS = ["from-violet-500 to-indigo-600", "from-sky-500 to-blue-700", "from-teal-400 to-cyan-700", "from-amber-400 to-orange-600", "from-fuchsia-500 to-violet-700", "from-emerald-400 to-teal-700", "from-rose-400 to-pink-700", "from-indigo-400 to-purple-700"];

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

export function colorFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** The speaker's Google photo when Meet shows one, otherwise their initials. */
export function SpeakerAvatar({ name, src, className, large }: { name: string; src?: string; className?: string; large?: boolean }) {
  return (
    <Avatar className={cn("size-5", className)}>
      {src && <AvatarImage alt="" referrerPolicy="no-referrer" src={src} />}
      <AvatarFallback className={cn("bg-gradient-to-br font-semibold text-white", large ? "text-base" : "text-xs", colorFor(name))}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

export function SectionLabel({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-1">
      <h3 className="font-medium text-[13px] text-foreground/90">{children}</h3>
      {end && <span className="text-muted-foreground text-xs">{end}</span>}
    </div>
  );
}

/** A row of a list: dark glass, rounded, roomy. */
export const ROW = "gap-3 rounded-2xl border-white/[0.09] bg-white/[0.045] px-3 py-2.5";

/** The square glass tile every logo and icon sits in, so rows line up. */
export const TILE = "flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.07] [&_svg:not([class*='size-'])]:size-5";

/** The main action of a row ("Add", "Choose vault"): a glass pill with the logo's neon edge. */
export const ADD_BUTTON = "neon neon-soft h-7 rounded-full px-3";

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("px-1 text-muted-foreground text-xs", className)}>{children}</p>;
}

export function ChoiceRow(props: { value: string; id: string; title: string; badge?: ReactNode; description: ReactNode; children?: ReactNode }) {
  const { value, id, title, badge, description, children } = props;
  return (
    <GlassItem className="items-start has-data-checked:bg-white/55 dark:has-data-checked:bg-white/[0.12]" glassVariant="subtle" size="sm">
      <ItemMedia className="pt-0.5">
        <GlassRadioGroupItem id={id} value={value} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>
          <label className="flex cursor-pointer flex-wrap items-center gap-1.5" htmlFor={id}>
            {title}
            {badge}
          </label>
        </ItemTitle>
        <ItemDescription className="line-clamp-none">{description}</ItemDescription>
        {children}
      </ItemContent>
    </GlassItem>
  );
}

export const timeOf = (t: number) => new Date(t).toTimeString().slice(0, 8);
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
