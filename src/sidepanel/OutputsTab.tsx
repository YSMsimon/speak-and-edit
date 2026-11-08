import { useCallback, useEffect, useState } from "react";
import {
  AnchorIcon,
  CrosshairIcon,
  DownloadIcon,
  ExternalLinkIcon,
  HistoryIcon,
  MessageSquareQuoteIcon,
  PlusIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  Trash2Icon,
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
import { GlassItem } from "@/components/glasscn/ui/glasscn/glass-item";
import { GlassSelect, GlassSelectContent, GlassSelectTrigger } from "@/components/glasscn/ui/glasscn/glass-select";
import { GlassSeparator } from "@/components/glasscn/ui/glasscn/glass-separator";
import { LiquidSwitch } from "@/components/glasscn/ui/glasscn/liquid-switch";

import { FILE_LOGO, Logo } from "./logos";
import { toast } from "sonner";
import { deleteAllMeetings, listMeetings } from "@/lib/sessions";
import { interactionLog } from "./log";

import { FULL } from "@/lib/edition";
import { ObsidianSection } from "./ObsidianSection";
import { OverleafSection } from "./OverleafSection";
import { ProblemCard } from "./problem";
import { ChoiceRow, Hint, PickList, SectionLabel } from "./shared";

/** The square tile every logo and icon sits in, so rows line up. */
function Tile({ children }: { children: React.ReactNode }) {
  // The logo sits bare, a size up: no box behind it (his call, 2026-11-04).
  return <ItemMedia className="[&_svg]:!size-9">{children}</ItemMedia>;
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
  const [busy, setBusy] = useState<string | null>(null);
  // A failure stays inline under the files until dismissed or the next try; successes are toasts.
  const [problem, setProblem] = useState<{ error: unknown; retry?: () => void } | null>(null);
  const googleReady = hasGoogleClient();
  // Whether Google gives Scribe a token without asking: signed in, as far as Scribe can tell.
  const [googleIn, setGoogleIn] = useState<boolean | null>(null);
  useEffect(() => {
    if (googleReady) void getGoogleToken(false).then(() => setGoogleIn(true), () => setGoogleIn(false));
  }, [googleReady]);
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
      setGoogleIn(true);
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
    <GlassItem className="gap-3.5 px-4 py-3.5" glassVariant="subtle">
      <Tile>{icon}</Tile>
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="truncate">{line}</ItemDescription>
      </ItemContent>
      {(control || after) && (
        <div className="basis-full pt-1">
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
        <GlassSelectTrigger aria-label={label} className="h-11 w-full text-sm data-[size=default]:h-11">
          {current && <Logo className="size-5" name={FILE_LOGO[current.kind]} />}
          <SelectValue />
        </GlassSelectTrigger>
        <GlassSelectContent>
          {extra && (
            <SelectItem className="gap-3 py-2 pr-9" value={extra.value}>
              <CrosshairIcon className="size-6 text-muted-foreground" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[0.9375rem] text-foreground">{extra.label}</span>
                <span className="truncate text-muted-foreground text-xs">Scribe picks per request</span>
              </div>
            </SelectItem>
          )}
          {files.map((f) => (
            <SelectItem className="gap-3 py-2 pr-9" key={f.id} value={f.id}>
              <Logo className="size-6" name={FILE_LOGO[f.kind]} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[0.9375rem] text-foreground">{fileName(f)}</span>
                <span className="truncate text-muted-foreground text-xs">{KIND_LABEL[f.kind]}</span>
              </div>
            </SelectItem>
          ))}
        </GlassSelectContent>
      </GlassSelect>
    );
  };

  return (
    <section aria-label="Outputs" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Files</SectionLabel>
          {settings.files.length > 0 && (
            <GlassButton
              aria-label="Read files again"
              disabled={busy !== null}
              glassVariant="subtle"
              onClick={() => run("refresh", async () => void (await engine.refreshFiles()))}
              className="rounded-full" size="icon-lg"
              title="Read files again"
            >
              <RefreshCwIcon className={cn(busy === "refresh" && "animate-spin")} />
            </GlassButton>
          )}
        </div>
        {!googleReady && (
          <GlassAlert glassVariant="subtle">
            <AlertTitle>Google sign-in isn’t set up in this build</AlertTitle>
            <AlertDescription className="text-sm">
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
                    <GlassItem className="gap-x-3.5 gap-y-2 rounded-none border-0 px-4 py-3.5 shadow-none" glassVariant="clear">
                      <Tile>
                        <Logo name={FILE_LOGO[f.kind]} />
                      </Tile>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate">{fileName(f)}</span>
                          {focus?.id === f.id && settings.files.length > 1 && <GlassBadge className="h-6 px-2.5 text-sm" glassVariant="liquid">Working on</GlassBadge>}
                        </ItemTitle>
                      </ItemContent>
                      <ItemActions>
                        <GlassButton aria-label={`Open ${f.title}`} glassVariant="subtle" onClick={() => void chrome.tabs.create({ url: fileUrl(f) })} className="rounded-full" size="icon-lg">
                          <ExternalLinkIcon />
                        </GlassButton>
                        <GlassButton aria-label={`Disconnect ${f.title}`} glassVariant="subtle" onClick={() => removeFile(f.id)} className="rounded-full" size="icon-lg">
                          <XIcon />
                        </GlassButton>
                      </ItemActions>
                      {/* Sections and problems use the row's full width, under the title. */}
                      {(parts.length > 0 || info?.error) && (
                        <div className="flex basis-full flex-col gap-1.5 pl-[3.125rem]">
                          {info?.error && <ProblemCard onRetry={() => void engine.refreshFiles()} problem={info.error} />}
                          {parts.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {parts.slice(0, 4).map((p) => (
                                <GlassBadge className="h-6 px-2.5 text-sm" glassVariant="subtle" key={p}>
                                  <AnchorIcon />
                                  {p}
                                </GlassBadge>
                              ))}
                              {parts.length > 4 && <GlassBadge className="h-6 px-2.5 text-sm" glassVariant="subtle">+{parts.length - 4}</GlassBadge>}
                            </div>
                          )}
                        </div>
                      )}
                    </GlassItem>
                  </div>
                );
              })}
            </ItemGroup>
          </GlassCard>
        ) : (
          <Hint>No files yet. Open a Google Doc, Sheet or Slides file in this window and it appears here.</Hint>
        )}

        {googleReady && openTabs.length > 0 && (
          <>
            <SectionLabel>Open in this window</SectionLabel>
            <PickList
              items={openTabs.map((t) => ({
                key: t.id,
                logo: <Logo name={FILE_LOGO[t.kind]} />,
                title: t.title,
                description: `${KIND_LABEL[t.kind]} · open in a tab`,
                action: (
                  <GlassButton disabled={busy !== null} onClick={() => addFile({ id: t.id, kind: t.kind, title: t.title })} size="lg">
                    <PlusIcon />
                    {busy === `add-${t.id}` ? "Adding…" : "Add"}
                  </GlassButton>
                ),
              }))}
              label="Google files open in this window"
            />
          </>
        )}

        {problem && <ProblemCard onDismiss={() => setProblem(null)} onRetry={problem.retry} problem={problem.error} />}

        {/* Full edition only (lib/edition.ts). */}
        {FULL && <ObsidianSection connected={settings.files} meetingTitle={state.meet?.title ?? null} onAdd={addLocal} />}
        {FULL && <OverleafSection connected={settings.files} onAdd={addLocal} />}

        {googleReady && (
          <GlassItem className="gap-3.5 px-4 py-3.5" glassVariant="subtle">
            <Tile>
              <Logo name="google" />
            </Tile>
            <ItemContent className="min-w-0">
              <ItemTitle>Google account</ItemTitle>
              <ItemDescription className="flex items-center gap-1">
                {googleIn === false ? (
                  "Signed out. Docs, Sheets and Slides need it"
                ) : (
                  <>
                    <ShieldCheckIcon className="size-4 shrink-0" />
                    Edits use your name
                  </>
                )}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              {googleIn === false ? (
                <GlassButton
                  disabled={busy !== null}
                  onClick={() =>
                    run("signin", async () => {
                      await getGoogleToken(true);
                      setGoogleIn(true);
                      void engine.refreshFiles();
                      return "Signed in to Google";
                    })
                  }
                  size="lg"
                >
                  Sign in
                </GlassButton>
              ) : (
                <GlassButton
                  disabled={busy !== null}
                  glassVariant="subtle"
                  onClick={() =>
                    run("signout", async () => {
                      const { revoked } = await signOutGoogle();
                      setGoogleIn(false);
                      return revoked ? "Signed out of Google" : "Signed out here. Google didn’t confirm; you can also remove Scribe at myaccount.google.com › Security";
                    })
                  }
                  size="lg"
                >
                  Sign out
                </GlassButton>
              )}
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
        <GlassItem className="gap-3.5 px-4 py-3.5" glassVariant="subtle">
          <Tile>
            <MessageSquareQuoteIcon />
          </Tile>
          <ItemContent className="min-w-0">
            <ItemTitle>Credit each change</ItemTitle>
            <ItemDescription className="truncate">Who asked, as a note</ItemDescription>
          </ItemContent>
          <ItemActions>
            <LiquidSwitch
              className="h-7 w-12"
              aria-label="Credit each change"
              checked={settings.outputs.docComments}
              onCheckedChange={(v: boolean) => update({ outputs: { ...settings.outputs, docComments: v } })}
            />
          </ItemActions>
        </GlassItem>
        <SavedMeetings engine={engine} />
      </div>
    </section>
  );
}

/**
 * Meetings are saved on this computer (never synced) and kept 30 days. One button deletes them all,
 * this one included; the first click only asks.
 */
/** The AI log as a .jsonl file, for scripts/eval-report.mjs. Saved by the browser like any download. */
async function exportLog() {
  const text = await interactionLog.exportJsonl();
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-ndjson" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `speak-and-edit-ai-log-${new Date().toISOString().slice(0, 10)}.jsonl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function SavedMeetings({ engine }: { engine: Engine }) {
  const [count, setCount] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    void listMeetings().then((all) => setCount(all.filter((m) => m.lines > 0).length));
  }, []);
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(t);
  }, [asking]);
  const remove = async () => {
    setAsking(false);
    const n = await deleteAllMeetings();
    await interactionLog.clear();
    engine.clearMeeting();
    setCount(0);
    toast.success(n ? `Deleted ${n} saved ${n === 1 ? "meeting" : "meetings"}` : "Nothing was saved");
  };
  return (
    <GlassItem className="gap-3.5 px-4 py-3.5" glassVariant="subtle">
      <Tile>
        <HistoryIcon />
      </Tile>
      <ItemContent className="min-w-0">
        <ItemTitle>Saved meetings{count ? ` (${count})` : ""}</ItemTitle>
        <ItemDescription className="line-clamp-2">Meetings and the AI log, on this computer, kept 30 days</ItemDescription>
      </ItemContent>
      <ItemActions>
        <GlassButton aria-label="Export the AI log" className="rounded-full" glassVariant="subtle" onClick={() => void exportLog()} size="icon-lg" title="Export the AI log">
          <DownloadIcon />
        </GlassButton>
        <GlassButton aria-label={asking ? "Delete all saved meetings, this one too" : "Delete saved meetings"} glassVariant="subtle" onClick={() => (asking ? void remove() : setAsking(true))} size="lg">
          <Trash2Icon />
          {asking ? "Delete all?" : "Delete"}
        </GlassButton>
      </ItemActions>
    </GlassItem>
  );
}
