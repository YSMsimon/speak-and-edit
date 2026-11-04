import { EyeOffIcon, MessageCircleIcon, MicIcon, PencilIcon, UserPlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { EngineState } from "@/lib/engine";
import type { Role, Settings } from "@/lib/settings";
import { ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/glasscn/ui/item";
import { GlassItem } from "@/components/glasscn/ui/glasscn/glass-item";
import { GlassToggleGroup, GlassToggleGroupItem } from "@/components/glasscn/ui/glasscn/glass-toggle-group";

import { Logo } from "./logos";
import { Hint, ROW, SectionLabel, SpeakerAvatar } from "./shared";

const ROLES = [
  { value: "edit", label: "Can edit", icon: PencilIcon },
  { value: "comment", label: "Comments only", icon: MessageCircleIcon },
  { value: "ignore", label: "Ignore", icon: EyeOffIcon },
] as const;

/** Each role's colour: the picker's chosen segment and the ring round the person's photo. */
const PUCK: Record<Role, string> = {
  edit: "neon neon-violet rounded-[13px] bg-gradient-to-br from-violet-500/45 to-indigo-500/20 dark:from-violet-500/45 dark:to-indigo-500/20",
  comment: "neon neon-teal rounded-[13px] bg-gradient-to-br from-cyan-400/35 to-teal-500/15 dark:from-cyan-400/35 dark:to-teal-500/15",
  ignore: "neon neon-amber rounded-[13px] bg-gradient-to-br from-amber-400/40 to-orange-500/20 dark:from-amber-400/40 dark:to-orange-500/20",
};
const RING: Record<Role, string> = {
  edit: "ring-violet-400/90 shadow-[0_0_18px_-5px_rgba(167,139,250,0.65)]",
  comment: "ring-cyan-300/90 shadow-[0_0_18px_-5px_rgba(103,232,249,0.6)]",
  ignore: "ring-amber-300/90 shadow-[0_0_18px_-5px_rgba(252,211,77,0.6)]",
};

function RolePicker({ value, onChange, label }: { value: Role; onChange: (r: Role) => void; label: string }) {
  return (
    <GlassToggleGroup
      aria-label={label}
      className="h-11 shrink-0 gap-0 rounded-[14px] border border-white/[0.16] bg-white/[0.055] p-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
      onValueChange={(v) => onChange(v as Role)}
      puckClassName={PUCK[value]}
      value={value}
    >
      {ROLES.map((r) => (
        <GlassToggleGroupItem
          aria-label={r.label}
          className="h-11 min-w-0 flex-1 rounded-[13px] bg-transparent px-3.5 py-2 text-[#aaaac2] transition-colors hover:bg-white/[0.04] hover:text-white data-[state=on]:bg-transparent data-[state=on]:text-white data-[pressed]:bg-transparent data-[pressed]:text-white dark:data-[state=on]:bg-transparent"
          key={r.value}
          value={r.value}
        >
          <r.icon className="size-[19px]" strokeWidth={1.8} />
        </GlassToggleGroupItem>
      ))}
    </GlassToggleGroup>
  );
}

export function PeopleTab(props: { state: EngineState; settings: Settings; update: (p: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => void }) {
  const { state, settings, update } = props;
  const names = Array.from(new Set([...Object.keys(state.speakers), ...Object.keys(settings.roles)]));
  const setRole = (name: string, role: Role) => update((s) => ({ roles: { ...s.roles, [name]: role } }));

  return (
    <section aria-label="People" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-4 text-[#f4f2fc]">
      <SectionLabel end={<Logo className="size-3.5" name="meet" />}>People in this call</SectionLabel>
      {names.length ? (
        names.map((name) => {
          const role = settings.roles[name] ?? settings.defaultRole;
          return (
            <GlassItem
              className={cn(
                ROW,
                "neon neon-soft min-h-[92px] shrink-0 flex-nowrap gap-3.5 rounded-2xl border-transparent bg-[linear-gradient(115deg,rgba(139,92,246,0.10),rgba(255,255,255,0.025)_45%,rgba(45,212,191,0.045))] px-3.5 py-3.5 backdrop-blur-xl",
              )}
              glassVariant="subtle"
              key={name}
              size="sm"
            >
              <ItemMedia className="shrink-0">
                <SpeakerAvatar className={cn("size-14 rounded-full ring-2 ring-offset-2 ring-offset-[#13121f]", RING[role])} large name={name} src={state.avatars[name]} />
              </ItemMedia>
              <ItemContent className="min-w-0 gap-1">
                <ItemTitle className="block truncate text-[15px] font-semibold leading-5 tracking-[-0.02em]">{name}</ItemTitle>
                <ItemDescription className="flex items-center gap-1 text-[12px] leading-[18px] text-[#9997b4]">
                  <MicIcon className="size-3.5 shrink-0" strokeWidth={1.7} />
                  {state.speakers[name] ? `spoke ${state.speakers[name]} times` : "not heard yet"}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="shrink-0">
                <RolePicker label={`Role for ${name}`} onChange={(r) => setRole(name, r)} value={role} />
              </ItemActions>
            </GlassItem>
          );
        })
      ) : (
        <Hint>Nobody has spoken yet.</Hint>
      )}
      <GlassItem
        className={cn(
          ROW,
          "neon neon-soft min-h-[92px] shrink-0 flex-nowrap gap-3.5 rounded-2xl border-transparent bg-[linear-gradient(115deg,rgba(56,189,248,0.10),rgba(139,92,246,0.055)_45%,rgba(251,191,36,0.035))] px-3.5 py-3.5 backdrop-blur-xl",
        )}
        glassVariant="subtle"
        size="sm"
      >
        <ItemMedia className="shrink-0">
          <span className={cn("flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/25 via-indigo-500/15 to-cyan-400/10 text-violet-200 ring-2 ring-offset-2 ring-offset-[#13121f]", RING[settings.defaultRole])}>
            <UserPlusIcon className="size-6" strokeWidth={1.7} />
          </span>
        </ItemMedia>
        <ItemContent className="min-w-0 gap-1">
          <ItemTitle className="text-[15px] font-semibold leading-5 tracking-[-0.02em]">Anyone new</ItemTitle>
          <ItemDescription className="text-[12px] leading-[18px] text-[#9997b4]">People not listed above</ItemDescription>
        </ItemContent>
        <ItemActions className="shrink-0">
          <RolePicker label="Role for new people" onChange={(r) => update({ defaultRole: r })} value={settings.defaultRole} />
        </ItemActions>
      </GlassItem>
      <Hint className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-1 pt-2 text-[11px] leading-4 text-[#9997b4]">
        {ROLES.map((r) => (
          <span className="inline-flex items-center gap-1.5" key={r.value}>
            <r.icon className="size-3" strokeWidth={1.7} />
            {r.label}
          </span>
        ))}
      </Hint>
    </section>
  );
}
