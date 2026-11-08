import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { glassVariantStyles } from "@/components/glasscn/lib/glass-variants";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/glasscn/ui/avatar";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/glasscn/ui/item";
import { GlassCard } from "@/components/glasscn/ui/glasscn/glass-card";
import { GlassItem } from "@/components/glasscn/ui/glasscn/glass-item";
import { GlassSeparator } from "@/components/glasscn/ui/glasscn/glass-separator";
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
    <Avatar className={cn("size-8", className)}>
      {src && <AvatarImage alt="" referrerPolicy="no-referrer" src={src} />}
      <AvatarFallback className={cn("text-xs font-medium text-white", colorFor(name))}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="px-1 font-medium text-foreground/80 text-sm uppercase tracking-wide">{children}</h3>;
}

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("px-1 text-muted-foreground text-sm", className)}>{children}</p>;
}

export function ChoiceRow(props: { value: string; id: string; title: string; badge?: ReactNode; description: ReactNode; children?: ReactNode }) {
  const { value, id, title, badge, description, children } = props;
  return (
    <GlassItem
      className="cursor-pointer items-start has-data-checked:bg-white/55 dark:has-data-checked:bg-white/[0.12]"
      glassVariant="subtle"
      render={<label htmlFor={id} />}
    >
      <ItemMedia className="pt-0.5">
        <GlassRadioGroupItem className="size-5" id={id} value={value} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="flex flex-wrap items-center gap-1.5">
          {title}
          {badge}
        </ItemTitle>
        <ItemDescription className="line-clamp-none">{description}</ItemDescription>
        {children}
      </ItemContent>
    </GlassItem>
  );
}

export interface PickItem {
  key: string;
  logo: ReactNode;
  title: string;
  description: string;
  action: ReactNode;
}

/**
 * Rows on one glass card: shadcn/ui's Item group (ItemGroup with Items between separators) on a glasscn
 * GlassCard. The card is the only surface. Rows are shadcn's default Item, which is transparent, so no band
 * of the card shows above, below or around a row. The Files list, People and every pick list use this.
 */
export function ListCard({ label, children }: { label?: string; children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <GlassCard aria-label={label} className="gap-0 py-0" glassVariant="subtle">
      <ItemGroup className="gap-0">
        {rows.map((row, i) => (
          <Fragment key={isValidElement(row) && row.key != null ? row.key : i}>
            {/* w-auto: the separator's own w-full plus the margins would run past the card's edge. */}
            {i > 0 && <GlassSeparator className="mx-4 data-horizontal:w-auto" glassVariant="subtle" />}
            {row}
          </Fragment>
        ))}
      </ItemGroup>
    </GlassCard>
  );
}

/** One row of a ListCard. */
export function ListRow({ className, ...props }: ComponentProps<typeof Item>) {
  return <Item className={cn("rounded-none text-foreground", className)} role="listitem" {...props} />;
}

/** Things to add (open tabs): rows on a ListCard, like the Files list. */
export function PickList({ items, label }: { items: PickItem[]; label: string }) {
  return (
    <ListCard label={label}>
      {items.map((it) => (
        <ListRow className="gap-3.5 px-4 py-3" key={it.key}>
          <ItemMedia className="[&_svg]:!size-8">{it.logo}</ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="line-clamp-2 [overflow-wrap:anywhere]" title={it.title}>
              {it.title}
            </ItemTitle>
            <ItemDescription className="truncate">{it.description}</ItemDescription>
          </ItemContent>
          <ItemActions>{it.action}</ItemActions>
        </ListRow>
      ))}
    </ListCard>
  );
}

export const timeOf = (t: number) => new Date(t).toTimeString().slice(0, 8);
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
