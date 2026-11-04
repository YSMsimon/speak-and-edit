
import type { EngineState } from "@/lib/engine";
import type { Role, Settings } from "@/lib/settings";
import { ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/glasscn/ui/item";
import { SelectItem, SelectValue } from "@/components/glasscn/ui/select";
import { GlassCard } from "@/components/glasscn/ui/glasscn/glass-card";
import { GlassItem } from "@/components/glasscn/ui/glasscn/glass-item";
import { GlassSelect, GlassSelectContent, GlassSelectTrigger } from "@/components/glasscn/ui/glasscn/glass-select";
import { GlassSeparator } from "@/components/glasscn/ui/glasscn/glass-separator";

import { Logo } from "./logos";
import { Hint, SectionLabel, SpeakerAvatar } from "./shared";

const ROLES = [
  { value: "edit", label: "Can edit" },
  { value: "comment", label: "Comments only" },
  { value: "ignore", label: "Ignore" },
];

function RoleSelect({ value, onChange, label }: { value: Role; onChange: (r: Role) => void; label: string }) {
  return (
    <GlassSelect items={ROLES} onValueChange={(v) => v && onChange(v as Role)} value={value}>
      <GlassSelectTrigger aria-label={label} className="w-36" size="sm">
        <SelectValue />
      </GlassSelectTrigger>
      <GlassSelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r.value} value={r.value}>
            {r.label}
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
          <Logo className="size-3.5" name="meet" />
          Names come from Meet’s captions
        </Hint>
        {names.length ? (
          <GlassCard className="gap-0 py-1" glassVariant="subtle">
            {names.map((name, i) => (
              <div key={name}>
                {i > 0 && <GlassSeparator className="mx-3" glassVariant="subtle" />}
                <GlassItem className="rounded-none border-0 px-3 py-3 shadow-none" glassVariant="clear" size="sm">
                  <ItemMedia>
                    <SpeakerAvatar className="size-10" name={name} src={state.avatars[name]} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{name}</ItemTitle>
                    <ItemDescription>{state.speakers[name] ? `Spoke ${state.speakers[name]} times` : "Not heard yet"}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <RoleSelect label={`Role for ${name}`} onChange={(r) => setRole(name, r)} value={settings.roles[name] ?? settings.defaultRole} />
                  </ItemActions>
                </GlassItem>
              </div>
            ))}
          </GlassCard>
        ) : (
          <Hint>Nobody has spoken yet.</Hint>
        )}
        <GlassItem className="py-3" glassVariant="subtle" size="sm">
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
