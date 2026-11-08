import { EyeOffIcon, MessageSquareTextIcon, PencilLineIcon } from "lucide-react";

import type { EngineState } from "@/lib/engine";
import type { Role, Settings } from "@/lib/settings";
import { ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/glasscn/ui/item";
import { SelectItem, SelectValue } from "@/components/glasscn/ui/select";
import { GlassItem } from "@/components/glasscn/ui/glasscn/glass-item";
import { GlassSelect, GlassSelectContent, GlassSelectTrigger } from "@/components/glasscn/ui/glasscn/glass-select";

import { Logo } from "./logos";
import { Hint, ListCard, ListRow, SectionLabel, SpeakerAvatar } from "./shared";

const ROLES = [
  { value: "edit", label: "Can edit", line: "Their requests change the files", icon: PencilLineIcon },
  { value: "comment", label: "Comments only", line: "Saved as comments, text unchanged", icon: MessageSquareTextIcon },
  { value: "ignore", label: "Ignore", line: "Scribe skips their lines", icon: EyeOffIcon },
];

function RoleSelect({ value, onChange, label }: { value: Role; onChange: (r: Role) => void; label: string }) {
  return (
    <GlassSelect items={ROLES.map(({ value, label }) => ({ value, label }))} onValueChange={(v) => v && onChange(v as Role)} value={value}>
      <GlassSelectTrigger aria-label={label} className="h-10 w-36 text-sm data-[size=default]:h-10">
        <SelectValue />
      </GlassSelectTrigger>
      <GlassSelectContent className="min-w-76" align="end">
        {ROLES.map((r) => (
          <SelectItem className="gap-3 py-2 pr-9" key={r.value} value={r.value}>
            <r.icon className="size-5 text-muted-foreground" />
            <div className="flex min-w-0 flex-col">
              <span className="text-[0.9375rem] text-foreground">{r.label}</span>
              <span className="text-muted-foreground text-xs">{r.line}</span>
            </div>
          </SelectItem>
        ))}
      </GlassSelectContent>
    </GlassSelect>
  );
}

export function PeopleTab(props: { state: EngineState; settings: Settings; update: (p: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => void }) {
  const { state, settings, update } = props;
  const names = Array.from(new Set([...Object.keys(state.speakers), ...Object.keys(settings.roles)]));
  const setRole = (name: string, role: Role) => update((s) => ({ roles: { ...s.roles, [name]: role } }));

  return (
    <section aria-label="People" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4">
      <div className="flex flex-col gap-2">
        <SectionLabel>People in this call</SectionLabel>
        <Hint className="flex items-center gap-1">
          <Logo className="size-4" name="meet" />
          Names come from Meet’s captions
        </Hint>
        {names.length ? (
          <ListCard label="People in this call">
            {names.map((name) => (
              <ListRow className="px-4 py-3.5" key={name}>
                <ItemMedia>
                  <SpeakerAvatar className="size-11" name={name} src={state.avatars[name]} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{name}</ItemTitle>
                  <ItemDescription>{state.speakers[name] ? `Spoke ${state.speakers[name]} times` : "Not heard yet"}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <RoleSelect label={`Role for ${name}`} onChange={(r) => setRole(name, r)} value={settings.roles[name] ?? settings.defaultRole} />
                </ItemActions>
              </ListRow>
            ))}
          </ListCard>
        ) : (
          <Hint>Nobody has spoken yet.</Hint>
        )}
        <GlassItem className="px-4 py-3.5" glassVariant="subtle">
          <ItemContent>
            <ItemTitle>Anyone new</ItemTitle>
            <ItemDescription>People not listed above</ItemDescription>
          </ItemContent>
          <ItemActions>
            <RoleSelect label="Role for new people" onChange={(r) => update({ defaultRole: r })} value={settings.defaultRole} />
          </ItemActions>
        </GlassItem>
      </div>

    </section>
  );
}
