// Outputs › Obsidian: choose the vault folder once, then create a meeting note or add existing ones.
// Notes are Markdown files on this computer; nothing to sign in to.
import { useCallback, useEffect, useState } from "react";
import { FolderOpenIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import type { FileRef } from "@/lib/files";
import { newMeetingNote } from "@/lib/notes/markdown";
import { listNotes, loadVault, noteExists, pickVault, safeName, vaultAccess, writeNote } from "@/lib/notes/vault";
import { ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/glasscn/ui/item";
import { GlassButton } from "@/components/glasscn/ui/glasscn/glass-button";
import { GlassItem } from "@/components/glasscn/ui/glasscn/glass-item";

import { Logo } from "./logos";
import { PickList } from "./shared";
import { ProblemCard } from "./problem";

/** Where Scribe keeps meeting notes inside the vault. */
export const NOTES_FOLDER = "Meetings";

export function ObsidianSection(props: { connected: FileRef[]; meetingTitle: string | null; onAdd: (f: FileRef) => Promise<void> }) {
  const [vault, setVault] = useState<FileSystemDirectoryHandle | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [problem, setProblem] = useState<unknown>(null);

  const refresh = useCallback(async (h: FileSystemDirectoryHandle | null) => {
    setVault(h);
    const ok = h ? await vaultAccess(h, false) : false;
    setAllowed(ok);
    setNotes(h && ok ? (await listNotes(h, NOTES_FOLDER)).slice(0, 6) : []);
  }, []);

  useEffect(() => {
    void loadVault().then(refresh, () => refresh(null));
  }, [refresh]);

  const ref = (h: FileSystemDirectoryHandle, path: string): FileRef => ({ id: `note:${path}`, kind: "note", title: path.split("/").pop()!.replace(/\.md$/, ""), vault: h.name });

  const choose = () =>
    void pickVault().then(
      (h) => refresh(h).then(() => toast.success(`Using the “${h.name}” vault`)),
      (e) => e?.name !== "AbortError" && setProblem(e)
    );

  const allow = () => vault && void vaultAccess(vault, true).then(() => refresh(vault));

  const create = async () => {
    if (!vault) return;
    setProblem(null);
    try {
      const day = new Date().toISOString().slice(0, 10);
      const title = props.meetingTitle?.trim() || "Meeting";
      let path = `${NOTES_FOLDER}/${day} ${safeName(title)}.md`;
      for (let n = 2; await noteExists(vault, path); n++) path = `${NOTES_FOLDER}/${day} ${safeName(title)} ${n}.md`;
      await writeNote(vault, path, newMeetingNote(title, new Date()));
      await props.onAdd(ref(vault, path));
      await refresh(vault);
    } catch (e) {
      setProblem(e);
    }
  };

  const unused = notes.filter((p) => !props.connected.some((f) => f.id === `note:${p}`));

  return (
    <div className="flex flex-col gap-2">
      <GlassItem className="gap-3.5 px-4 py-3.5" glassVariant="subtle">
        <ItemMedia className="[&_svg]:!size-9">
          <Logo name="obsidian" />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>Obsidian</ItemTitle>
          <ItemDescription className="line-clamp-2">{vault ? `Vault: ${vault.name}` : "Notes in a folder on this computer"}</ItemDescription>
        </ItemContent>
        <ItemActions>
          {!vault ? (
            <GlassButton onClick={choose} size="lg">
              <FolderOpenIcon />
              Choose vault
            </GlassButton>
          ) : !allowed ? (
            <GlassButton onClick={allow} size="lg">
              Allow
            </GlassButton>
          ) : (
            <>
              <GlassButton aria-label="Change vault" className="rounded-full" glassVariant="subtle" onClick={choose} size="icon-lg" title="Change vault">
                <FolderOpenIcon />
              </GlassButton>
              <GlassButton onClick={() => void create()} size="lg">
                <PlusIcon />
                New note
              </GlassButton>
            </>
          )}
        </ItemActions>
      </GlassItem>
      {vault && allowed && unused.length > 0 && (
        <PickList
          items={unused.map((p) => {
            const parts = p.replace(/\.md$/, "").split("/");
            return {
              key: p,
              logo: <Logo name="obsidian" />,
              title: parts.pop() ?? p,
              description: `Obsidian note · ${parts.join("/") || vault.name}`,
              action: (
                <GlassButton onClick={() => void props.onAdd(ref(vault, p))} size="lg">
                  <PlusIcon />
                  Add
                </GlassButton>
              ),
            };
          })}
          label="Notes in your vault"
        />
      )}
      {problem != null && <ProblemCard onDismiss={() => setProblem(null)} problem={problem} />}
    </div>
  );
}
