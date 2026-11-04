import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { glassVariantStyles } from "@/components/glasscn/lib/glass-variants";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/glasscn/ui/avatar";
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/glasscn/ui/item";
import { GlassItem } from "@/components/glasscn/ui/glasscn/glass-item";
import { GlassRadioGroupItem } from "@/components/glasscn/ui/glasscn/glass-radio-group";

/** glasscn's own surface style, applied to AI Elements containers. */
export const subtle = glassVariantStyles.subtle;

const COLORS = ["bg-blue-600", "bg-orange-700", "bg-teal-700", "bg-violet-600", "bg-rose-700", "bg-emerald-700", "bg-sky-700", "bg-amber-700"];

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
export function SpeakerAvatar({ name, src, className }: { name: string; src?: string; className?: string }) {
  return (
    <Avatar className={cn("size-5", className)}>
      {src && <AvatarImage alt="" referrerPolicy="no-referrer" src={src} />}
      <AvatarFallback className={cn("text-[10px] font-medium text-white", colorFor(name))}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="px-1 font-medium text-foreground/80 text-xs uppercase tracking-wide">{children}</h3>;
}

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
