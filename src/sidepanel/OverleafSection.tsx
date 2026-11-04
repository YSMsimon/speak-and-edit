// Outputs › Overleaf: projects open in this Chrome, one click to add. Scribe edits through the project's
// tab, where you're already signed in to Overleaf, so there's no separate sign-in. Chrome asks once.
import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon, PlusIcon } from "lucide-react";

import type { FileRef } from "@/lib/files";
import { openOverleafTabs, overleafAccess } from "@/lib/overleaf/tab";
import { ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/glasscn/ui/item";
import { GlassButton } from "@/components/glasscn/ui/glasscn/glass-button";
import { GlassItem } from "@/components/glasscn/ui/glasscn/glass-item";

import { Logo } from "./logos";
import { ADD_BUTTON, ROW, TILE } from "./shared";

const PROJECTS = "https://www.overleaf.com/project";

export function OverleafSection(props: { connected: FileRef[]; onAdd: (f: FileRef) => Promise<void> }) {
  const [open, setOpen] = useState<{ id: string; title: string }[]>([]);
  const [denied, setDenied] = useState(false);

  const scan = useCallback(async () => setOpen(await openOverleafTabs()), []);

  useEffect(() => {
    void scan();
    const onChange = () => void scan();
    chrome.tabs.onUpdated.addListener(onChange);
    chrome.tabs.onRemoved.addListener(onChange);
    return () => {
      chrome.tabs.onUpdated.removeListener(onChange);
      chrome.tabs.onRemoved.removeListener(onChange);
    };
  }, [scan]);

  const ref = (p: { id: string; title: string }): FileRef => ({ id: `overleaf:${p.id}`, kind: "tex", title: p.title });
  const unused = open.filter((p) => !props.connected.some((f) => f.id === `overleaf:${p.id}`));

  // Chrome's prompt has to come straight from the click, before anything else waits.
  const add = (p: { id: string; title: string }) =>
    void overleafAccess(true).then((ok) => {
      setDenied(!ok);
      if (ok) return props.onAdd(ref(p)).then(scan);
    });

  return (
    <GlassItem className={ROW} glassVariant="subtle" size="sm">
      <ItemMedia className={TILE}>
        <Logo name="overleaf" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>Overleaf</ItemTitle>
        <ItemDescription className="truncate">
          {denied ? "Allow Overleaf when Chrome asks" : unused.length ? "Projects open in Chrome" : "Open a project to add it"}
        </ItemDescription>
      </ItemContent>
      {unused.length === 0 && (
        <ItemActions>
          <GlassButton className={ADD_BUTTON} glassVariant="subtle" onClick={() => void chrome.tabs.create({ url: PROJECTS })} size="xs">
            <ExternalLinkIcon />
            Open
          </GlassButton>
        </ItemActions>
      )}
      {unused.length > 0 && (
        <div className="flex basis-full flex-col gap-1 pl-[3.25rem]">
          {unused.map((p) => (
            <div className="flex items-center gap-2 text-xs" key={p.id}>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.title}</span>
              <GlassButton className="h-6 rounded-full px-2.5" glassVariant="subtle" onClick={() => add(p)} size="xs">
                <PlusIcon />
                Add
              </GlassButton>
            </div>
          ))}
        </div>
      )}
    </GlassItem>
  );
}
