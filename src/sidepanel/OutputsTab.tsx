import { useCallback, useEffect, useState } from "react";
import {
  AnchorIcon,
  CrosshairIcon,
  ExternalLinkIcon,
  MessageSquareQuoteIcon,
  PlusIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Engine, EngineState } from "@/lib/engine";
import { fileUrl, KIND_LABEL, parseGoogleUrl, TAB_PATTERNS, titleFromTab, type FileKind, type FileRef } from "@/lib/files";
import { getGoogleToken, hasGoogleClient, signOutGoogle } from "@/lib/google";
import { captureFile, focusFile, transcriptFile, type Settings } from "@/lib/settings";
import { AlertDescription, AlertTitle } from "@/components/glasscn/ui/alert";
import { ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/glasscn/ui/item";
import { RadioGroup } from "@/components/glasscn/ui/radio-group";
import { SelectItem, SelectValue } from "@/components/glasscn/ui/select";
import { GlassAlert } from "@/components/glasscn/ui/glasscn/glass-alert";
import { GlassBadge } from "@/components/glasscn/ui/glasscn/glass-badge";
import { GlassButton } from "@/components/glasscn/ui/glasscn/glass-button";
import { GlassCard } from "@/components/glasscn/ui/glasscn/glass-card";
import { GlassInput } from "@/components/glasscn/ui/glasscn/glass-input";
import { GlassItem } from "@/components/glasscn/ui/glasscn/glass-item";
import { GlassSelect, GlassSelectContent, GlassSelectTrigger } from "@/components/glasscn/ui/glasscn/glass-select";
import { GlassSeparator } from "@/components/glasscn/ui/glasscn/glass-separator";
import { LiquidSwitch } from "@/components/glasscn/ui/glasscn/liquid-switch";

import { FILE_LOGO, Logo } from "./logos";
import { toast } from "sonner";

import { ObsidianSection } from "./ObsidianSection";
import { OverleafSection } from "./OverleafSection";
import { ProblemCard } from "./problem";
import { ChoiceRow, Hint, SectionLabel } from "./shared";

/** The square tile every logo and icon sits in, so rows line up. */
function Tile({ children }: { children: React.ReactNode }) {
  return <ItemMedia className="size-8 rounded-lg bg-white/70 dark:bg-white/10 [&_svg:not([class*='size-'])]:size-4">{children}</ItemMedia>;
}

interface OpenTab {
  id: string;
  kind: FileKind;
  title: string;
}

function useOpenGoogleFiles() {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const scan = useCallback(async () => {
    const found = await chrome.tabs.query({ url: TAB_PATTERNS, currentWindow: true });
    const seen = new Set<string>();
    const out: OpenTab[] = [];
    for (const t of found) {
      const parsed = t.url ? parseGoogleUrl(t.url) : null;
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      out.push({ ...parsed, title: titleFromTab(t.title) });
    }
    setTabs(out);
  }, []);
  useEffect(() => {
    void scan();
    const onChange = () => void scan();
    chrome.tabs.onUpdated.addListener(onChange);
    chrome.tabs.onRemoved.addListener(onChange);
    chrome.tabs.onActivated.addListener(onChange);
    return () => {
      chrome.tabs.onUpdated.removeListener(onChange);
      chrome.tabs.onRemoved.removeListener(onChange);
      chrome.tabs.onActivated.removeListener(onChange);
    };
  }, [scan]);
  return tabs;
}

export function OutputsTab(props: { engine: Engine; state: EngineState; settings: Settings; update: (p: Partial<Settings>) => void }) {
  const { engine, state, settings, update } = props;
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // A failure stays inline under the files until dismissed or the next try; successes are toasts.
  const [problem, setProblem] = useState<{ error: unknown; retry?: () => void } | null>(null);
  const googleReady = hasGoogleClient();
  const openTabs = useOpenGoogleFiles().filter((t) => !settings.files.some((f) => f.id === t.id));
  // Record all can write to a Doc or an Obsidian note.
  const docs = settings.files.filter((f) => f.kind === "doc" || f.kind === "note");
  const transcriptId = transcriptFile(settings)?.id;

  const run = async (label: string, fn: () => Promise<string | void>, retry?: () => void) => {
    setBusy(label);
    setProblem(null);
    try {
      const out = await fn();
      if (out) toast.success(out);
    } catch (e) {
      setProblem({ error: e, retry });
    } finally {
      setBusy(null);
    }
  };

  const addFile = (file: FileRef): Promise<void> =>
    run(`add-${file.id}`, async () => {
      await getGoogleToken(true);
      update({ files: [...settings.files.filter((f) => f.id !== file.id), file] });
      await engine.refreshFiles();
      const info = engine.getState().files[file.id];
      if (info?.error) {
        update({ files: settings.files.filter((f) => f.id !== file.id) });
        throw new Error(`Couldn’t open “${file.title}”: ${info.error}`);
      }
      if (info?.title && info.title !== file.title) {
        update({ files: [...settings.files.filter((f) => f.id !== file.id), { ...file, title: info.title }] });
      }
      return `Connected “${info?.title ?? file.title}”`;
    }, () => void addFile(file));

  /** Obsidian notes and Overleaf projects: no Google sign-in; read once to check it opens. */
  const addLocal = (file: FileRef): Promise<void> =>
    run(`add-${file.id}`, async () => {
      update({ files: [...settings.files.filter((f) => f.id !== file.id), file] });
      await engine.refreshFiles();
      const info = engine.getState().files[file.id];
      if (info?.error) {
        update({ files: settings.files.filter((f) => f.id !== file.id) });
        throw new Error(`Couldn’t open “${file.title}”: ${info.error}`);
      }
      return `Connected “${file.title}”`;
    });

  const removeFile = (id: string) => {
    update({
      files: settings.files.filter((f) => f.id !== id),
      transcriptFileId: settings.transcriptFileId === id ? null : settings.transcriptFileId,
      focusFileId: settings.focusFileId === id ? null : settings.focusFileId,
    });
    engine.invalidate(id);
    void engine.refreshFiles();
  };

  const fileName = (f: FileRef) => state.files[f.id]?.title ?? f.title;
  const focus = focusFile(settings);
  const capture = captureFile(settings);
  const transcript = docs.find((d) => d.id === transcriptId);

  /** A compact row: logo or icon, a title, at most one short line, and a control. */
  const pickRow = (icon: React.ReactNode, title: string, line: string, control: React.ReactNode, after?: React.ReactNode) => (
    <GlassItem className="gap-3 px-3" glassVariant="subtle" size="sm">
      <Tile>{icon}</Tile>
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="truncate">{line}</ItemDescription>
      </ItemContent>
      {(control || after) && (
        <div className="basis-full pl-11">
          {control}
          {after}
        </div>
      )}
    </GlassItem>
  );

  const fileSelect = (label: string, files: FileRef[], value: string | undefined, onChange: (v: string) => void, extra?: { value: string; label: string }) => {
    const current = files.find((f) => f.id === value);
    return (
      <GlassSelect items={[...(extra ? [extra] : []), ...files.map((f) => ({ value: f.id, label: fileName(f) }))]} onValueChange={(v) => v && onChange(String(v))} value={value}>
        <GlassSelectTrigger aria-label={label} size="sm">
          {current && <Logo className="size-4" name={FILE_LOGO[current.kind]} />}
          <SelectValue />
        </GlassSelectTrigger>
        <GlassSelectContent>
          {extra && <SelectItem value={extra.value}>{extra.label}</SelectItem>}
          {files.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              <Logo className="size-4" name={FILE_LOGO[f.kind]} />
              {fileName(f)}
            </SelectItem>
          ))}
        </GlassSelectContent>
      </GlassSelect>
    );
  };

  return (
    <section aria-label="Outputs" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4">
      <div className="flex flex-col gap-2">
        <SectionLabel>Files</SectionLabel>
        {!googleReady && (
          <GlassAlert glassVariant="subtle">
            <AlertTitle>Google sign-in isn’t set up in this build</AlertTitle>
            <AlertDescription className="text-xs">
              Add a Google OAuth client ID to the extension’s <code>.env</code> as <code>WXT_GOOGLE_CLIENT_ID</code>, then rebuild.
            </AlertDescription>
          </GlassAlert>
        )}

        {settings.files.length > 0 ? (
          <GlassCard className="gap-0 py-1" glassVariant="subtle">
            <ItemGroup className="gap-0">
              {settings.files.map((f, i) => {
                const info = state.files[f.id];
                const parts = info?.parts ?? [];
                return (
                  <div key={f.id}>
                    {i > 0 && <GlassSeparator className="mx-3" glassVariant="subtle" />}
                    <GlassItem className="items-start gap-3 rounded-none border-0 px-3 shadow-none" glassVariant="clear" size="sm">
                      <Tile>
                        <Logo name={FILE_LOGO[f.kind]} />
                      </Tile>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate">{fileName(f)}</span>
                          {focus?.id === f.id && settings.files.length > 1 && <GlassBadge glassVariant="liquid">Working on</GlassBadge>}
                        </ItemTitle>
                        {info?.error && <ProblemCard className="mt-1.5" onRetry={() => void engine.refreshFiles()} problem={info.error} />}
                        {parts.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {parts.slice(0, 4).map((p) => (
                              <GlassBadge glassVariant="subtle" key={p}>
                                <AnchorIcon />
                                {p}
                              </GlassBadge>
                            ))}
                            {parts.length > 4 && <GlassBadge glassVariant="subtle">+{parts.length - 4}</GlassBadge>}
                          </div>
                        )}
                      </ItemContent>
                      <ItemActions>
                        <GlassButton aria-label={`Open ${f.title}`} glassVariant="subtle" onClick={() => void chrome.tabs.create({ url: fileUrl(f) })} size="icon-xs">
                          <ExternalLinkIcon />
                        </GlassButton>
                        <GlassButton aria-label={`Disconnect ${f.title}`} glassVariant="subtle" onClick={() => removeFile(f.id)} size="icon-xs">
                          <XIcon />
                        </GlassButton>
                      </ItemActions>
                    </GlassItem>
                  </div>
                );
              })}
            </ItemGroup>
          </GlassCard>
        ) : (
          <Hint>No files yet. Add one that’s open, or paste a link.</Hint>
        )}

        {googleReady && openTabs.length > 0 && (
          <>
            <SectionLabel>Open in this window</SectionLabel>
            {openTabs.map((t) => (
              <GlassItem className="gap-3 px-3" glassVariant="subtle" key={t.id} size="sm">
                <Tile>
                  <Logo name={FILE_LOGO[t.kind]} />
                </Tile>
                <ItemContent className="min-w-0">
                  <ItemTitle className="truncate">{t.title}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <GlassButton disabled={busy !== null} onClick={() => addFile({ id: t.id, kind: t.kind, title: t.title })} size="xs">
                    <PlusIcon />
                    {busy === `add-${t.id}` ? "Adding…" : "Add"}
                  </GlassButton>
                </ItemActions>
              </GlassItem>
            ))}
          </>
        )}

        {googleReady && (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = parseGoogleUrl(link);
              if (!parsed) return setProblem({ error: { severity: "info", title: "That isn’t a Google file link", body: "Paste the full link of a Google Doc, Sheet or Slides file.", fixes: [] } });
              setLink("");
              void addFile({ ...parsed, title: KIND_LABEL[parsed.kind] });
            }}
          >
            <span className="flex shrink-0 items-center gap-1 px-1">
              <Logo className="size-4" name="doc" />
              <Logo className="size-4" name="sheet" />
              <Logo className="size-4" name="slides" />
            </span>
            <GlassInput aria-label="Link to a Google Doc, Sheet or Slides file" className="h-8 text-xs" onChange={(e) => setLink(e.target.value)} placeholder="Paste a link" value={link} />
            <GlassButton disabled={busy !== null || !link.trim()} size="sm" type="submit">
              Add
            </GlassButton>
            {settings.files.length > 0 && (
              <GlassButton
                aria-label="Read files again"
                disabled={busy !== null}
                glassVariant="subtle"
                onClick={() => run("refresh", async () => void (await engine.refreshFiles()))}
                size="icon-sm"
                title="Read files again"
                type="button"
              >
                <RefreshCwIcon className={cn(busy === "refresh" && "animate-spin")} />
              </GlassButton>
            )}
          </form>
        )}
        {problem && <ProblemCard onDismiss={() => setProblem(null)} onRetry={problem.retry} problem={problem.error} />}

        <ObsidianSection connected={settings.files} meetingTitle={state.meet?.title ?? null} onAdd={addLocal} />
        <OverleafSection connected={settings.files} onAdd={addLocal} />

        {googleReady && (
          <GlassItem className="gap-3 px-3" glassVariant="subtle" size="sm">
            <Tile>
              <Logo name="google" />
            </Tile>
            <ItemContent className="min-w-0">
              <ItemTitle>Google account</ItemTitle>
              <ItemDescription className="flex items-center gap-1 truncate">
                <ShieldCheckIcon className="size-3 shrink-0" />
                Edits use your name
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <GlassButton glassVariant="subtle" onClick={() => run("signout", async () => { await signOutGoogle(); return "Signed out of Google"; })} size="xs">
                Sign out
              </GlassButton>
            </ItemActions>
          </GlassItem>
        )}
      </div>

      {settings.files.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Where things go</SectionLabel>
          {settings.files.length > 1 &&
            pickRow(
              <CrosshairIcon />,
              "Work on",
              "For requests that name no file",
              fileSelect("File to work on", settings.files, focus?.id ?? "any", (v) => update({ focusFileId: v === "any" ? null : v }), { value: "any", label: "Any file" })
            )}
          {docs.length > 0 &&
            pickRow(
              <ScrollTextIcon />,
              "Record all",
              transcript ? `Transcript goes in ${fileName(transcript)}` : "Every line, word for word",
              docs.length > 1 ? fileSelect("Doc for Record all", docs, transcriptId, (v) => update({ transcriptFileId: v })) : null
            )}
          {pickRow(
            <Logo name="drive" />,
            "Screenshots and recordings",
            "Originals stay in your Drive",
            fileSelect("File for screenshots and recordings", settings.files, capture?.id, (v) => update({ screen: { ...settings.screen, targetFileId: v } })),
            <Hint className="px-0 pt-1">Pictures are public for a few seconds while Google copies them, then private again.</Hint>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionLabel>How changes land</SectionLabel>
        <RadioGroup className="gap-2" onValueChange={(v) => update({ commentsOnly: v === "comment" })} value={settings.commentsOnly ? "comment" : "edit"}>
          <ChoiceRow description="Auto or Ask before writing, set on Live" id="land-edit" title="Edit the file" value="edit" />
          <ChoiceRow description="A comment, cell note or speaker note. Text unchanged" id="land-comment" title="Comments only" value="comment" />
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Also</SectionLabel>
        <GlassItem className="gap-3 px-3" glassVariant="subtle" size="sm">
          <Tile>
            <MessageSquareQuoteIcon />
          </Tile>
          <ItemContent className="min-w-0">
            <ItemTitle>Credit each change</ItemTitle>
            <ItemDescription className="truncate">Who asked, as a note</ItemDescription>
          </ItemContent>
          <ItemActions>
            <LiquidSwitch
              aria-label="Credit each change"
              checked={settings.outputs.docComments}
              onCheckedChange={(v: boolean) => update({ outputs: { ...settings.outputs, docComments: v } })}
            />
          </ItemActions>
        </GlassItem>
      </div>
    </section>
  );
}
