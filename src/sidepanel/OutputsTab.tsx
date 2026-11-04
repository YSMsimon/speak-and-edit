import { useCallback, useEffect, useState } from "react";
import {
  ChevronDownIcon,
  CrosshairIcon,
  ExternalLinkIcon,
  PlusIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Engine, EngineState } from "@/lib/engine";
import { fileUrl, KIND_LABEL, parseGoogleUrl, TAB_PATTERNS, titleFromTab, type FileKind, type FileRef } from "@/lib/files";
import { getGoogleToken, hasGoogleClient, signOutGoogle } from "@/lib/google";
import { captureFile, focusFile, transcriptFile, type Settings } from "@/lib/settings";
import { AlertDescription, AlertTitle } from "@/components/glasscn/ui/alert";
import { ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/glasscn/ui/item";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RadioGroup } from "@/components/glasscn/ui/radio-group";
import { SelectItem, SelectValue } from "@/components/glasscn/ui/select";
import { GlassAlert } from "@/components/glasscn/ui/glasscn/glass-alert";
import { GlassBadge } from "@/components/glasscn/ui/glasscn/glass-badge";
import { GlassButton } from "@/components/glasscn/ui/glasscn/glass-button";
import { GlassInput } from "@/components/glasscn/ui/glasscn/glass-input";
import { GlassItem } from "@/components/glasscn/ui/glasscn/glass-item";
import { GlassSelect, GlassSelectContent, GlassSelectTrigger } from "@/components/glasscn/ui/glasscn/glass-select";
import { LiquidSwitch } from "@/components/glasscn/ui/glasscn/liquid-switch";

import { FILE_LOGO, Logo } from "./logos";
import { toast } from "sonner";

import { ObsidianSection } from "./ObsidianSection";
import { OverleafSection } from "./OverleafSection";
import { ProblemCard } from "./problem";
import { ADD_BUTTON, ChoiceRow, Hint, ROW, SectionLabel, TILE } from "./shared";

function Tile({ children }: { children: React.ReactNode }) {
  return (
    <ItemMedia className={cn(TILE, "size-10 rounded-xl border-white/[0.07] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] [&_svg:not([class*='size-'])]:size-6")}>
      {children}
    </ItemMedia>
  );
}

/** Round glass icon button for a row (open, remove). */
const ROUND = "size-8 shrink-0 rounded-full border border-white/[0.14] bg-white/[0.055] text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-white/[0.12] [&_svg]:size-4";

function fileTint(kind: FileKind) {
  if (kind === "doc") return "neon-teal";
  if (kind === "note") return "neon-violet";
  if (FILE_LOGO[kind] === "slides") return "neon-amber";
  return "neon-green";
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
    <GlassItem className={cn(ROW, "gap-x-3 gap-y-2.5 border-white/[0.08] bg-white/[0.035] p-3")} glassVariant="subtle" size="sm">
      <Tile>{icon}</Tile>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="text-[13px] font-medium text-slate-100">{title}</ItemTitle>
        <ItemDescription className="truncate text-xs text-slate-400">{line}</ItemDescription>
      </ItemContent>
      {(control || after) && (
        <div className="min-w-0 basis-full">
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
        <GlassSelectTrigger
          aria-label={label}
          className="neon min-h-14 w-full gap-3 rounded-2xl border-0 bg-[linear-gradient(115deg,rgba(99,102,241,0.13),rgba(13,148,136,0.07)_55%,rgba(255,255,255,0.06))] px-3 py-2.5 text-[13px] text-slate-100 [&>svg]:size-4 [&>svg]:text-slate-300"
          size="sm"
        >
          {current && (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.035]">
              <Logo className="size-6" name={FILE_LOGO[current.kind]} />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 overflow-hidden text-left [&>span]:max-w-full [&>span]:truncate">
            <SelectValue />
            {current && <span className="text-xs font-normal text-slate-400">{KIND_LABEL[current.kind]}</span>}
          </span>
        </GlassSelectTrigger>
        <GlassSelectContent className="rounded-2xl border-white/10 bg-[#14141f] p-1.5 text-[13px] text-slate-100 shadow-xl">
          {extra && <SelectItem className="rounded-lg" value={extra.value}>{extra.label}</SelectItem>}
          {files.map((f) => (
            <SelectItem className="gap-2 rounded-lg py-2" key={f.id} value={f.id}>
              <Logo className="size-4" name={FILE_LOGO[f.kind]} />
              {fileName(f)}
            </SelectItem>
          ))}
        </GlassSelectContent>
      </GlassSelect>
    );
  };

  return (
    <section aria-label="Outputs" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-1 pb-5 text-[13px] text-slate-100 [scrollbar-width:thin]">
      <div className="flex flex-col gap-2">
        <SectionLabel end={settings.files.length > 0 ? `${settings.files.length} connected` : undefined}>Connected files</SectionLabel>
        {!googleReady && (
          <GlassAlert className="rounded-2xl border-white/10 bg-white/[0.04]" glassVariant="subtle">
            <AlertTitle>Google sign-in isn’t set up in this build</AlertTitle>
            <AlertDescription className="text-xs">
              Add a Google OAuth client ID to the extension’s <code>.env</code> as <code>WXT_GOOGLE_CLIENT_ID</code>, then rebuild.
            </AlertDescription>
          </GlassAlert>
        )}

        {settings.files.length > 0 ? (
          settings.files.map((f) => {
            const info = state.files[f.id];
            return (
              <GlassItem
                className={cn(
                  ROW,
                  "neon min-h-[58px] flex-nowrap gap-3 rounded-2xl border-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.075),rgba(255,255,255,0.025)_55%,rgba(255,255,255,0.055))] px-3 py-2.5",
                  fileTint(f.kind)
                )}
                glassVariant="subtle"
                key={f.id}
                size="sm"
              >
                <Tile>
                  <Logo name={FILE_LOGO[f.kind]} />
                </Tile>
                <ItemContent className="min-w-0 gap-0.5">
                  <ItemTitle className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] leading-5 font-medium tracking-[-0.015em] text-slate-50">
                    <span className="truncate">{fileName(f)}</span>
                    {focus?.id === f.id && settings.files.length > 1 && (
                      <GlassBadge className="neon neon-violet neon-soft shrink-0 rounded-full px-2 py-0 text-[10px] leading-4 font-medium" glassVariant="liquid">
                        Working on
                      </GlassBadge>
                    )}
                  </ItemTitle>
                  <ItemDescription className="truncate text-xs leading-4 text-slate-400">{KIND_LABEL[f.kind]}</ItemDescription>
                  {info?.error && <ProblemCard className="mt-1.5" onRetry={() => void engine.refreshFiles()} problem={info.error} />}
                </ItemContent>
                <ItemActions className="shrink-0 gap-2">
                  <GlassButton aria-label={`Open ${f.title}`} className={ROUND} glassVariant="subtle" onClick={() => void chrome.tabs.create({ url: fileUrl(f) })} size="icon-sm">
                    <ExternalLinkIcon />
                  </GlassButton>
                  <GlassButton aria-label={`Disconnect ${f.title}`} className={ROUND} glassVariant="subtle" onClick={() => removeFile(f.id)} size="icon-sm">
                    <XIcon />
                  </GlassButton>
                </ItemActions>
              </GlassItem>
            );
          })
        ) : (
          <Hint>No files yet. Add one that’s open, or paste a link.</Hint>
        )}

        {googleReady &&
          openTabs.map((t) => (
            <GlassItem className={cn(ROW, "neon neon-soft min-h-[58px] flex-nowrap border-0 bg-white/[0.04]", fileTint(t.kind))} glassVariant="subtle" key={t.id} size="sm">
              <Tile>
                <Logo name={FILE_LOGO[t.kind]} />
              </Tile>
              <ItemContent className="min-w-0 gap-0.5">
                <ItemTitle className="truncate text-[14px] leading-5 font-medium text-slate-100">{t.title}</ItemTitle>
                <ItemDescription className="truncate text-xs text-slate-400">Open in Chrome</ItemDescription>
              </ItemContent>
              <ItemActions className="shrink-0">
                <GlassButton className={cn(ADD_BUTTON, "h-8 gap-1.5 bg-white/[0.06] px-3.5 text-[13px]", fileTint(t.kind))} disabled={busy !== null} glassVariant="subtle" onClick={() => addFile({ id: t.id, kind: t.kind, title: t.title })} size="xs">
                  <PlusIcon className="size-4" />
                  {busy === `add-${t.id}` ? "Adding…" : "Add"}
                </GlassButton>
              </ItemActions>
            </GlassItem>
          ))}

        {googleReady && (
          <form
            className="mt-1 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = parseGoogleUrl(link);
              if (!parsed) return setProblem({ error: { severity: "info", title: "That isn’t a Google file link", body: "Paste the full link of a Google Doc, Sheet or Slides file.", fixes: [] } });
              setLink("");
              void addFile({ ...parsed, title: KIND_LABEL[parsed.kind] });
            }}
          >
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center gap-1">
                <Logo className="size-3.5" name="doc" />
                <Logo className="size-3.5" name="sheet" />
                <Logo className="size-3.5" name="slides" />
              </span>
              <GlassInput aria-label="Link to a Google Doc, Sheet or Slides file" className="h-9 rounded-full border-white/[0.12] bg-white/[0.035] pl-[4.6rem] text-xs text-slate-100 placeholder:text-slate-500 focus-visible:ring-violet-400/40" glassVariant="subtle" onChange={(e) => setLink(e.target.value)} placeholder="Paste a link" value={link} />
            </div>
            <GlassButton className={cn(ADD_BUTTON, "h-8 bg-white/[0.055] text-xs")} disabled={busy !== null || !link.trim()} glassVariant="subtle" size="xs" type="submit">
              Add
            </GlassButton>
            {settings.files.length > 0 && (
              <GlassButton
                aria-label="Read files again"
                className={ROUND}
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
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Other apps</SectionLabel>
        <ObsidianSection connected={settings.files} meetingTitle={state.meet?.title ?? null} onAdd={addLocal} />
        <OverleafSection connected={settings.files} onAdd={addLocal} />
      </div>

      {settings.files.length > 1 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Work on</SectionLabel>
          <div className="flex items-center gap-2 px-1">
            <CrosshairIcon className="size-4 shrink-0 text-slate-400" />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <span className="text-xs text-slate-300">Which file gets the edits</span>
              <span className="text-[11px] text-slate-500">For requests that name no file</span>
            </div>
          </div>
          {fileSelect("File to work on", settings.files, focus?.id ?? "any", (v) => update({ focusFileId: v === "any" ? null : v }), { value: "any", label: "Any file" })}
        </div>
      )}

      <GlassItem
        className={cn(ROW, "neon min-h-[62px] flex-nowrap gap-3 rounded-2xl border-0 bg-[linear-gradient(115deg,rgba(45,212,191,0.07),rgba(139,92,246,0.10)_55%,rgba(245,158,11,0.06))] px-3 py-3")}
        glassVariant="subtle"
        size="sm"
      >
        <Tile>
          <UsersRoundIcon className="size-6 text-slate-300" />
        </Tile>
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle className="text-[14px] leading-5 font-medium tracking-[-0.015em] text-slate-50">Credit each change</ItemTitle>
          <ItemDescription className="truncate text-xs text-slate-400">Who said it, as a note</ItemDescription>
        </ItemContent>
        <ItemActions className="shrink-0">
          <LiquidSwitch
            aria-label="Credit each change"
            checked={settings.outputs.docComments}
            className="rounded-full shadow-[0_0_18px_-7px_rgba(168,85,247,0.7)]"
            onCheckedChange={(v: boolean) => update({ outputs: { ...settings.outputs, docComments: v } })}
          />
        </ItemActions>
      </GlassItem>

      <Collapsible className="flex flex-col gap-2">
        <CollapsibleTrigger className="group flex items-center gap-2 rounded-lg px-1 py-1 text-[13px] font-medium text-slate-400 transition-colors hover:text-slate-200">
          <SlidersHorizontalIcon className="size-3.5 text-muted-foreground" />
          More settings
          <ChevronDownIcon className="ml-auto size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2">
          <RadioGroup className="gap-2" onValueChange={(v) => update({ commentsOnly: v === "comment" })} value={settings.commentsOnly ? "comment" : "edit"}>
            <ChoiceRow description="Auto or Ask before writing, set on Live" id="land-edit" title="Edit the file" value="edit" />
            <ChoiceRow description="A comment, cell note or speaker note. Text unchanged" id="land-comment" title="Comments only" value="comment" />
          </RadioGroup>
          {docs.length > 0 &&
            pickRow(
              <ScrollTextIcon />,
              "Record all",
              transcript ? `Transcript goes in ${fileName(transcript)}` : "Every line, word for word",
              docs.length > 1 ? fileSelect("Doc for Record all", docs, transcriptId, (v) => update({ transcriptFileId: v })) : null
            )}
          {settings.files.length > 0 &&
            pickRow(
              <Logo name="drive" />,
              "Screenshots and recordings",
              "Originals stay in your Drive",
              fileSelect("File for screenshots and recordings", settings.files, capture?.id, (v) => update({ screen: { ...settings.screen, targetFileId: v } })),
              <Hint className="px-0 pt-2 leading-relaxed">Pictures are public for a few seconds while Google copies them, then private again.</Hint>
            )}
          {googleReady && (
            <GlassItem className={cn(ROW, "flex-nowrap bg-white/[0.035]")} glassVariant="subtle" size="sm">
              <Tile>
                <Logo name="google" />
              </Tile>
              <ItemContent className="min-w-0 gap-0.5">
                <ItemTitle className="text-[13px] font-medium">Google account</ItemTitle>
                <ItemDescription className="flex items-center gap-1 truncate text-xs text-slate-400">
                  <ShieldCheckIcon className="size-3 shrink-0" />
                  Edits use your name
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <GlassButton className="h-7 rounded-full border border-white/10 bg-white/[0.05] px-3" glassVariant="subtle" onClick={() => run("signout", async () => { await signOutGoogle(); return "Signed out of Google"; })} size="xs">
                  Sign out
                </GlassButton>
              </ItemActions>
            </GlassItem>
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
