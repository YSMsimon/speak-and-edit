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
      <GlassItem className="gap-3 px-3 py-3" glassVariant="subtle" size="sm">
        <ItemMedia className="[&_svg]:!size-7">
          <Logo name="obsidian" />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>Obsidian</ItemTitle>
          <ItemDescription className="truncate">{vault ? `Vault: ${vault.name}` : "Notes in a folder on this computer"}</ItemDescription>
        </ItemContent>
        <ItemActions>
          {!vault ? (
            <GlassButton onClick={choose} size="xs">
              <FolderOpenIcon />
              Choose vault
            </GlassButton>
          ) : !allowed ? (
            <GlassButton onClick={allow} size="xs">
              Allow
            </GlassButton>
          ) : (
            <GlassButton onClick={() => void create()} size="xs">
              <PlusIcon />
              New note
            </GlassButton>
          )}
        </ItemActions>
        {vault && allowed && (
          <div className="flex basis-full flex-col gap-1 pl-11">
            {unused.map((p) => (
              <div className="flex items-center gap-2 text-xs" key={p}>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.replace(`${NOTES_FOLDER}/`, "").replace(/\.md$/, "")}</span>
                <GlassButton glassVariant="subtle" onClick={() => void props.onAdd(ref(vault, p))} size="xs">
                  Add
                </GlassButton>
              </div>
            ))}
            <button className="self-start text-muted-foreground text-xs underline-offset-2 hover:underline" onClick={choose} type="button">
              Change vault
            </button>
          </div>
        )}
      </GlassItem>
      {problem != null && <ProblemCard onDismiss={() => setProblem(null)} problem={problem} />}
    </div>
  );
}
