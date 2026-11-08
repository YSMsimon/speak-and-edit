// End-to-end smoke test. Real engine, real AI (the provider in your saved settings),
// real Google Docs / Sheets / Slides / Drive calls, on brand-new files in a new
// "Scribe smoke test …" folder. Every check reads the file back from Google.
// What it can't reach: Meet itself (captions, finding the shared screen, tab capture).
// Stills come from a fixed picture and the recording from a generated video.
// Nothing is deleted; the folder stays in your Drive for you to look at.

import { resolveProvider, modelFor, visionModelFor, visionModelName } from "@/lib/ai/providers";
import type { ProviderId } from "@/lib/settings";
import { buildOutline, findSection, type Outline } from "@/lib/docs/outline";
import { sharePublicly, upload, type DriveIO } from "@/lib/drive";
import { defaultAi, Engine, type Entry, type EngineDeps } from "@/lib/engine";
import type { FileRef } from "@/lib/files";
import { batchUpdate, fetchDoc, fetchOutline, getGoogleToken, googleFetch, isRevisionConflict } from "@/lib/google";
import type { Frame } from "@/lib/messages";
import { DEFAULT_SETTINGS, loadSettings, type Settings } from "@/lib/settings";
import { docsTarget } from "@/lib/targets/docs";
import { sheetsTarget } from "@/lib/targets/sheets";
import { slidesTarget } from "@/lib/targets/slides";
import tablePng from "./shared-table.png?inline";

type Status = "pass" | "fail" | "soft" | "info";
interface Result {
  id: string;
  name: string;
  status: Status;
  detail: string;
  ms: number;
}

const DRIVE = "https://www.googleapis.com/drive/v3";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const SLIDES = "https://slides.googleapis.com/v1/presentations";
const SPEAKER = "Simon";

const results: Result[] = [];
const out = document.getElementById("log")!;
const w = window as unknown as { smoke: { state: string; results: Result[]; links: Record<string, string>; summary?: string } };
w.smoke = { state: "starting", results, links: {} };

// Each line also goes to a local log (http://127.0.0.1:8792), so a run can be followed from a terminal.
let seq = 0;
function print(line: string, cls: Status = "info") {
  const span = document.createElement("span");
  span.className = cls;
  span.textContent = `${line}\n`;
  out.appendChild(span);
  fetch("http://127.0.0.1:8792/log", { method: "POST", body: `${String(++seq).padStart(3, "0")} ${line}` }).catch(() => undefined);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lower = (s: string) => s.toLowerCase();
const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");

class Fail extends Error {}
function expect(cond: unknown, why: string): asserts cond {
  if (!cond) throw new Fail(why);
}

async function check(id: string, name: string, fn: () => Promise<string | void>, soft = false) {
  const t0 = performance.now();
  try {
    const detail = (await fn()) ?? "";
    results.push({ id, name, status: "pass", detail, ms: Math.round(performance.now() - t0) });
    print(`PASS ${id} ${name}${detail ? ` — ${detail}` : ""}`, "pass");
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const status: Status = soft && e instanceof Fail ? "soft" : "fail";
    results.push({ id, name, status, detail, ms: Math.round(performance.now() - t0) });
    print(`${status === "soft" ? "SOFT" : "FAIL"} ${id} ${name} — ${detail}`, status);
  }
}

/* ---------- reading Google files back ---------- */

const driveIO: DriveIO = { token: () => getGoogleToken(false), fetch: (i, init) => fetch(i, init) };

async function readDoc(id: string) {
  const d = (await fetchDoc(id)) as unknown as {
    body?: { content?: { paragraph?: { elements?: { textRun?: { content?: string; suggestedInsertionIds?: string[]; suggestedDeletionIds?: string[] }; inlineObjectElement?: unknown }[] } }[] };
    inlineObjects?: Record<string, unknown>;
  };
  let text = "";
  let suggestions = 0;
  for (const el of d.body?.content ?? []) {
    for (const pe of el.paragraph?.elements ?? []) {
      text += pe.textRun?.content ?? (pe.inlineObjectElement ? "▣" : "");
      if (pe.textRun?.suggestedInsertionIds?.length || pe.textRun?.suggestedDeletionIds?.length) suggestions++;
    }
  }
  const outline = buildOutline(d as never);
  return { text, suggestions, images: Object.keys(d.inlineObjects ?? {}).length, outline };
}

const sectionText = (o: Outline, title: string) => {
  const s = findSection(o, title);
  return s ? s.paragraphs.map((p) => p.text).join("") : "";
};

async function comments(fileId: string): Promise<string[]> {
  const r = await googleFetch<{ comments?: { content?: string; replies?: { content?: string }[] }[] }>(
    `${DRIVE}/files/${fileId}/comments?fields=comments(content,replies(content))&pageSize=100`
  );
  return (r.comments ?? []).flatMap((c) => [c.content ?? "", ...(c.replies ?? []).map((x) => x.content ?? "")]);
}

async function isPrivate(fileId: string): Promise<boolean> {
  const r = await googleFetch<{ permissions?: { type?: string }[] }>(`${DRIVE}/files/${fileId}/permissions?fields=permissions(type,role)`);
  return !(r.permissions ?? []).some((p) => p.type === "anyone");
}

async function folderFiles(folder: string) {
  const q = encodeURIComponent(`'${folder}' in parents and trashed=false`);
  const r = await googleFetch<{ files?: { id: string; name: string; mimeType: string }[] }>(`${DRIVE}/files?q=${q}&fields=files(id,name,mimeType)&pageSize=200`);
  return r.files ?? [];
}

async function sheetTabs(id: string) {
  const r = await googleFetch<{ sheets?: { properties?: { title?: string; sheetId?: number } }[] }>(`${SHEETS}/${id}?fields=sheets.properties(sheetId,title)`);
  return (r.sheets ?? []).map((s) => s.properties?.title ?? "");
}

async function sheetRows(id: string, tab: string): Promise<string[][]> {
  const r = await googleFetch<{ values?: string[][] }>(`${SHEETS}/${id}/values/${encodeURIComponent(`'${tab}'!A1:Z200`)}`);
  return r.values ?? [];
}

async function sheetNote(id: string, tab: string, a1: string): Promise<string> {
  const r = await googleFetch<{ sheets?: { data?: { rowData?: { values?: { note?: string }[] }[] }[] }[] }>(
    `${SHEETS}/${id}?ranges=${encodeURIComponent(`'${tab}'!${a1}`)}&fields=sheets(data(rowData(values(note))))`
  );
  return r.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.note ?? "";
}

interface SlideInfo {
  text: string;
  notes: string;
  images: number;
  videos: number;
}

type ShapeEl = { shape?: { placeholder?: { type?: string }; text?: { textElements?: { textRun?: { content?: string } }[] } }; image?: unknown; video?: unknown; objectId?: string };

async function readDeck(id: string): Promise<SlideInfo[]> {
  const p = await googleFetch<{ slides?: { pageElements?: ShapeEl[]; slideProperties?: { notesPage?: { pageElements?: ShapeEl[] } } }[] }>(`${SLIDES}/${id}`);
  const textOf = (els: ShapeEl[] = []) => els.map((e) => (e.shape?.text?.textElements ?? []).map((t) => t.textRun?.content ?? "").join("")).join("\n");
  return (p.slides ?? []).map((s) => ({
    text: textOf(s.pageElements),
    notes: textOf(s.slideProperties?.notesPage?.pageElements),
    images: (s.pageElements ?? []).filter((e) => e.image).length,
    videos: (s.pageElements ?? []).filter((e) => e.video).length,
  }));
}

/** The Drive file id in a written card's "· https://drive.google.com/file/d/ID/view". */
const driveIdIn = (s: string) => /\/file\/d\/([\w-]+)/.exec(s)?.[1] ?? null;

/* ---------- making the test files ---------- */

async function createInDrive(name: string, mimeType: string, parent?: string): Promise<string> {
  const r = await googleFetch<{ id: string }>(`${DRIVE}/files?fields=id`, {
    method: "POST",
    body: JSON.stringify({ name, mimeType, ...(parent ? { parents: [parent] } : {}) }),
  });
  return r.id;
}

async function setUpDoc(id: string) {
  const lines: [string, string][] = [
    ["Scribe Smoke Test Doc", "HEADING_1"],
    ["Decisions", "HEADING_2"],
    ["Use MySQL for the database", "NORMAL_TEXT"],
    ["Action items", "HEADING_2"],
    ["Open questions", "HEADING_2"],
    ["Notes", "HEADING_2"],
    ["Launch date is December 1", "NORMAL_TEXT"],
  ];
  const text = lines.map(([t]) => t).join("\n");
  const requests: unknown[] = [{ insertText: { location: { index: 1 }, text } }];
  let i = 1;
  for (const [t, style] of lines) {
    requests.push({ updateParagraphStyle: { range: { startIndex: i, endIndex: i + t.length + 1 }, paragraphStyle: { namedStyleType: style }, fields: "namedStyleType" } });
    i += t.length + 1;
  }
  await batchUpdate(id, requests as never);
}

async function setUpSheet(id: string): Promise<string> {
  const tab = (await sheetTabs(id))[0] ?? "Sheet1";
  await googleFetch(`${SHEETS}/${id}/values/${encodeURIComponent(`'${tab}'!A1:D2`)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [["Task", "Owner", "Status", "Due"], ["Write the spec", "Alex", "In progress", "Nov 5"]] }),
  });
  return tab;
}

async function setUpDeck(id: string) {
  const p = await googleFetch<{ slides?: { pageElements?: ShapeEl[] }[] }>(`${SLIDES}/${id}`);
  const first = p.slides?.[0]?.pageElements ?? [];
  const title = first.find((e) => ["TITLE", "CENTERED_TITLE"].includes(e.shape?.placeholder?.type ?? ""));
  const requests: unknown[] = [];
  if (title?.objectId) requests.push({ insertText: { objectId: title.objectId, insertionIndex: 0, text: "Scribe demo" } });
  requests.push(
    {
      createSlide: {
        objectId: "smoke_roadmap",
        slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: "TITLE", index: 0 }, objectId: "smoke_roadmap_title" },
          { layoutPlaceholder: { type: "BODY", index: 0 }, objectId: "smoke_roadmap_body" },
        ],
      },
    },
    { insertText: { objectId: "smoke_roadmap_title", insertionIndex: 0, text: "Roadmap" } },
    { insertText: { objectId: "smoke_roadmap_body", insertionIndex: 0, text: "Beta in November" } }
  );
  await googleFetch(`${SLIDES}/${id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
}

/** A short generated video, the way the recorder would hand one over. */
async function makeVideo(ms: number): Promise<{ blob: Blob; mimeType: string; width: number; height: number }> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const g = canvas.getContext("2d")!;
  const stream = canvas.captureStream(15);
  const mimeType = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
  const rec = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  let n = 0;
  const draw = () => {
    g.fillStyle = `hsl(${(n * 9) % 360} 60% 45%)`;
    g.fillRect(0, 0, 640, 360);
    g.fillStyle = "#fff";
    g.font = "36px sans-serif";
    g.fillText(`Scribe smoke test · frame ${n++}`, 40, 190);
  };
  draw();
  const timer = setInterval(draw, 66);
  rec.start(500);
  await sleep(ms);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.stop();
  await stopped;
  clearInterval(timer);
  stream.getTracks().forEach((t) => t.stop());
  return { blob: new Blob(chunks, { type: mimeType }), mimeType, width: 640, height: 360 };
}

/* ---------- the run ---------- */

async function run() {
  const manifest = chrome.runtime.getManifest();
  const scopes = manifest.oauth2?.scopes ?? [];
  if (!scopes.some((s) => s.endsWith("drive.file")) || !(manifest.host_permissions ?? []).includes("https://www.googleapis.com/*")) {
    print("The loaded extension is older than this build (no Drive permission). Reload Scribe on chrome://extensions, then open this page again.", "fail");
    w.smoke.state = "needs-reload";
    return;
  }
  try {
    await getGoogleToken(false);
  } catch {
    w.smoke.state = "needs-sign-in";
    const auth = document.getElementById("auth")!;
    const button = document.createElement("button");
    button.textContent = "Sign in to Google (one time, for the new Drive permission)";
    auth.appendChild(button);
    print("Waiting for Google sign-in: click the button above.", "soft");
    await new Promise<void>((resolve) => {
      button.onclick = async () => {
        try {
          await getGoogleToken(true);
          auth.textContent = "Signed in.";
          resolve();
        } catch (e) {
          auth.textContent = `Sign-in failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      };
    });
  }
  w.smoke.state = "running";

  const saved = await loadSettings();
  // ?provider=chatgpt or ?provider=chrome overrides the saved choice for this run only.
  const forced = new URLSearchParams(location.search).get("provider") as ProviderId | null;
  const provider = forced ?? (await resolveProvider(saved.provider, saved));
  if (!provider) {
    print("No AI provider is ready with your saved settings. Pick one in the AI model tab first.", "fail");
    w.smoke.state = "no-ai";
    return;
  }
  print(`AI: ${provider} · text model ${saved.models[provider]} · vision model ${visionModelName(provider, saved)}`);

  // Files
  const name = `Scribe smoke test ${stamp()}`;
  const folder = await createInDrive(name, "application/vnd.google-apps.folder");
  const DOC: FileRef = { id: await createInDrive("Scribe Smoke Test Doc", "application/vnd.google-apps.document", folder), kind: "doc", title: "Scribe Smoke Test Doc" };
  const SHEET: FileRef = { id: await createInDrive("Scribe Smoke Test Tasks", "application/vnd.google-apps.spreadsheet", folder), kind: "sheet", title: "Scribe Smoke Test Tasks" };
  const DECK: FileRef = { id: await createInDrive("Scribe Smoke Test Deck", "application/vnd.google-apps.presentation", folder), kind: "slides", title: "Scribe Smoke Test Deck" };
  await setUpDoc(DOC.id);
  const TAB = await setUpSheet(SHEET.id);
  await setUpDeck(DECK.id);
  w.smoke.links = {
    folder: `https://drive.google.com/drive/folders/${folder}`,
    doc: `https://docs.google.com/document/d/${DOC.id}/edit`,
    sheet: `https://docs.google.com/spreadsheets/d/${SHEET.id}/edit`,
    deck: `https://docs.google.com/presentation/d/${DECK.id}/edit`,
  };
  print(`Folder: ${w.smoke.links.folder}`);

  // Engine with real everything, and settings kept in memory (your saved settings aren't touched).
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    provider: forced ?? saved.provider,
    models: saved.models,
    chatgptAccount: saved.chatgptAccount,
    wakeWord: "Scribe",
    files: [DOC, SHEET, DECK],
    approval: "auto",
    listenMode: "commands",
    commentsOnly: false,
    focusFileId: null,
    outputs: { docComments: true },
    roles: {},
    defaultRole: "edit",
    screen: { autoCapture: false, targetFileId: null },
    driveFolderId: folder,
  };
  const s = (patch: Partial<Settings>) => Object.assign(settings, patch);
  /** Each section starts from the same settings, so one section's misses don't spill into the next. */
  const reset = (patch: Partial<Settings> = {}) =>
    s({ approval: "auto", listenMode: "commands", commentsOnly: false, focusFileId: null, screen: { autoCapture: false, targetFileId: null }, ...patch });
  const frame: { current: Frame | null } = { current: null };
  const recorderCalls: string[] = [];
  const listening: boolean[] = [];
  const docs = docsTarget({ fetchOutline, batchUpdate, isRevisionConflict });
  const deps: EngineDeps = {
    settings: () => settings,
    targets: { doc: docs, sheet: sheetsTarget(googleFetch), slides: slidesTarget(googleFetch) },
    appendTranscript: (f, lines) => docs.appendTranscript(f, lines),
    model: modelFor,
    visionModel: visionModelFor,
    resolveProvider: async () => provider,
    ai: defaultAi,
    updateSettings: (patch) => void s(patch),
    control: {
      setListening: async (paused) => void listening.push(paused),
      recording: async (a) => (recorderCalls.push(a), `Recording ${a} (smoke-test recorder).`),
      recordingState: () => "on",
    },
    media: {
      capture: async () => {
        if (!frame.current) throw new Error("Nobody is sharing their screen, or Scribe can’t find the shared screen in Meet.");
        return { ...frame.current, at: Date.now() };
      },
      upload: (blob, n, mime) => upload(driveIO, { blob, name: n, mimeType: mime, folderId: folder, description: "Scribe smoke test" }),
      share: (fileId) => sharePublicly(driveIO, fileId),
    },
    now: Date.now,
    schedule: (fn, ms) => void setTimeout(fn, ms),
  };
  const engine = new Engine(deps);
  engine.setMeet({ status: "listening", title: "Smoke test", userName: SPEAKER, paused: false, screen: null });

  const settle = async () => {
    for (;;) {
      const q = engine.idle();
      await q;
      await sleep(30);
      if (q === engine.idle()) return;
    }
  };
  const entry = (id: string): Entry => engine.getState().entries.find((e) => e.id === id)!;
  const say = async (text: string, typed = false) => {
    const id = engine.addLine(SPEAKER, text, Date.now(), typed);
    await settle();
    return entry(id);
  };
  const kind = (e: Entry) => e.action.kind;
  const describe = (e: Entry) => {
    const a = e.action as { kind: string; message?: string; reason?: string; answer?: string; result?: { where?: string; add?: string; status?: string }; warning?: string };
    return [a.kind, a.result?.where, a.result?.add, a.result?.status, a.message, a.reason, a.answer, a.warning].filter(Boolean).join(" · ").slice(0, 300);
  };
  const written = (e: Entry) => {
    expect(kind(e) === "written", `expected a write, got ${describe(e)}`);
    return e.action as Extract<Entry["action"], { kind: "written" }>;
  };

  /* A. Commands, Auto: direct edits */
  print("\n— A. Commands mode, Auto (direct edits)");
  await check("A1", "append to a Doc section, directly, with credit", async () => {
    const e = await say("Scribe, add to decisions: we're using Postgres 16.");
    const a = written(e);
    expect(a.result.status === "applied", `status ${a.result.status}`);
    const d = await readDoc(DOC.id);
    expect(/postgres 16/i.test(sectionText(d.outline, "Decisions")), "Postgres 16 isn't under Decisions");
    expect(d.suggestions === 0, `${d.suggestions} suggestion(s) in the doc; Auto should edit directly`);
    const c = await comments(DOC.id);
    expect(c.some((x) => x.includes(SPEAKER) && /postgres/i.test(x)), "no credit comment naming the speaker");
    return describe(e);
  });
  await check("A2", "replace text in a Doc", async () => {
    const e = await say("Scribe, change MySQL to Postgres in decisions.");
    written(e);
    const d = await readDoc(DOC.id);
    expect(!/mysql/i.test(d.text), "MySQL is still in the doc");
    return describe(e);
  });
  await check("A3", "comment on text in a Doc", async () => {
    const e = await say("Scribe, comment on the launch date: this might slip a week.");
    const a = written(e);
    expect(a.result.status === "commented", `status ${a.result.status}`);
    expect((await comments(DOC.id)).some((x) => /slip a week/i.test(x)), "comment not found");
    expect((await readDoc(DOC.id)).text.includes("Launch date is December 1"), "the text changed");
    return describe(e);
  });
  await check("A4", "answer a question from the files", async () => {
    const e = await say("Scribe, what's the launch date?");
    expect(kind(e) === "answer", describe(e));
    expect(/(december|dec\.?)\s*1\b/i.test((e.action as { answer: string }).answer), describe(e));
    return describe(e);
  });
  await check("A5", "add a Sheet row, lined up with the columns", async () => {
    const e = await say("Scribe, add a task: Simon sets up staging by Friday.");
    written(e);
    const rows = await sheetRows(SHEET.id, TAB);
    const row = rows.find((r) => /staging/i.test(r.join(" ")));
    expect(row, `no staging row; went to: ${describe(e)}`);
    expect(lower(row[1] ?? "").includes("simon"), `Owner column: ${JSON.stringify(row)}`);
    expect(/friday/i.test(row.join(" ")), `no Friday: ${JSON.stringify(row)}`);
    return JSON.stringify(row);
  });
  await check("A6", "change a Sheet cell, old value kept in the note", async () => {
    const e = await say("Scribe, mark write the spec as done.");
    written(e);
    const rows = await sheetRows(SHEET.id, TAB);
    expect(/done/i.test(rows[1]?.[2] ?? ""), `C2 is ${rows[1]?.[2]}`);
    expect(/in progress/i.test(await sheetNote(SHEET.id, TAB, "C2")), "the note doesn't keep the old value");
    return describe(e);
  });
  await check("A7", "add a bullet to a named slide", async () => {
    const e = await say("Scribe, on the roadmap slide, add GA in January.");
    written(e);
    const deck = await readDeck(DECK.id);
    expect(deck[1] && /ga in january/i.test(deck[1].text), `slide 2: ${deck[1]?.text}`);
    expect(deck[1] && deck[1].notes.includes(SPEAKER), "no credit in the speaker notes");
    return describe(e);
  });
  await check("A8", "create a new slide", async () => {
    const e = await say("Scribe, add a new slide called Risks, with database migration.");
    written(e);
    const deck = await readDeck(DECK.id);
    expect(deck.some((x) => /risks/i.test(x.text) && /migration/i.test(x.text)), `slides: ${deck.map((x) => x.text.replace(/\n/g, " / ")).join(" | ")}`);
    return describe(e);
  });
  await check("A9", "ignore something that isn't a request", async () => {
    const e = await say("Scribe is pretty cool, right?");
    expect(kind(e) === "ignored", describe(e));
  });
  await check(
    "A10",
    "ask which one when the request is ambiguous",
    async () => {
      const e = await say("Scribe, move it to next week.");
      expect(kind(e) === "clarify", describe(e));
      return describe(e);
    },
    true
  );
  await check("A11", "a typed request works like a spoken one", async () => {
    const e = await say("add to open questions: do we need SSO for the beta?", true);
    written(e);
    expect(/sso/i.test(sectionText((await readDoc(DOC.id)).outline, "Open questions")), "SSO isn't under Open questions");
  });

  /* B. Ask before writing */
  print("\n— B. Ask before writing");
  reset({ approval: "manual" });
  await check("B1", "Docs edit becomes a suggestion; Accept makes it real", async () => {
    const e = await say("Scribe, add to action items: send the recap email.");
    const a = written(e);
    expect(a.result.status === "waiting", `status ${a.result.status}`);
    expect((await readDoc(DOC.id)).suggestions > 0, "no suggestion in the doc");
    engine.decide(e.id, true);
    await settle();
    expect((entry(e.id).action as { decision?: string }).decision === "accepted", describe(entry(e.id)));
    const d = await readDoc(DOC.id);
    expect(d.suggestions === 0 && /recap email/i.test(sectionText(d.outline, "Action items")), "not accepted in the doc");
  });
  await check("B2", "Reject leaves the doc unchanged", async () => {
    const e = await say("Scribe, change Postgres 16 to MySQL 8 in decisions.");
    const a = written(e);
    expect(a.result.status === "waiting", `status ${a.result.status}`);
    engine.decide(e.id, false);
    await settle();
    const d = await readDoc(DOC.id);
    expect(/postgres 16/i.test(d.text) && !/mysql 8/i.test(d.text) && d.suggestions === 0, "the doc changed");
  });
  await check("B3", "Sheet edit waits for Approve; Discard writes nothing", async () => {
    const e = await say("Scribe, add a task: book the demo room.");
    expect(kind(e) === "proposal", describe(e));
    expect(!(await sheetRows(SHEET.id, TAB)).some((r) => /demo room/i.test(r.join(" "))), "the Sheet changed before approval");
    engine.discard(e.id);
    await settle();
    expect(kind(entry(e.id)) === "discarded", describe(entry(e.id)));
  });
  await check("B4", "Approve all writes everything that waits", async () => {
    const e1 = await say("Scribe, add a task: order pizza for the demo.");
    const e2 = await say("Scribe, on the roadmap slide add demo on Thursday.");
    expect(kind(e1) === "proposal" && kind(e2) === "proposal", `${describe(e1)} | ${describe(e2)}`);
    engine.approveAll();
    await settle();
    expect((await sheetRows(SHEET.id, TAB)).some((r) => /pizza/i.test(r.join(" "))), "no pizza row");
    expect(/thursday/i.test((await readDeck(DECK.id))[1]?.text ?? ""), "no Thursday on slide 2");
  });
  s({ approval: "auto" });

  /* C. Smart */
  print("\n— C. Smart mode");
  reset({ listenMode: "smart" });
  const quiet = async (id: string, line: string) =>
    check(id, `leaves alone: “${line}”`, async () => {
      const e = await engine.addLine(SPEAKER, line, Date.now());
      await settle();
      expect(kind(entry(e)) === "skipped", describe(entry(e)));
    });
  await quiet("C1", "Hey, can everyone hear me okay?");
  await quiet("C2", "I think maybe Stripe, or maybe Paddle, I'm not sure yet.");
  await check("C3", "records a decision by itself", async () => {
    const e = await say("Okay, final call, we're going with Stripe for payments.");
    written(e);
    expect(/stripe/i.test(sectionText((await readDoc(DOC.id)).outline, "Decisions")), "Stripe isn't under Decisions");
    return describe(e);
  });
  // The Doc has an "Action items" heading and the Sheet is a task list: either is a right place for a task.
  await check("C4", "records an action item (Sheet row or the Doc's Action items)", async () => {
    const e = await say("Simon, can you build the billing page by Friday?");
    const a = written(e);
    const inSheet = (await sheetRows(SHEET.id, TAB)).some((r) => /billing/i.test(r.join(" ")));
    const inDoc = /billing/i.test(sectionText((await readDoc(DOC.id)).outline, "Action items"));
    expect(inSheet || inDoc, `no billing task in the Sheet or under Action items: ${describe(e)}`);
    return `${inSheet ? "Sheet" : "Doc"} · ${describe(e)} (${a.proposal.file.title})`;
  });
  await check("C5", "records an open question", async () => {
    const e = await say("We still don't know who owns customer support, let's come back to that.");
    written(e);
    expect(/support/i.test(sectionText((await readDoc(DOC.id)).outline, "Open questions")), "not under Open questions");
    return describe(e);
  });

  /* D. Record all */
  print("\n— D. Record all");
  reset({ listenMode: "record" });
  await check("D1", "writes every line under a Transcript heading, no AI", async () => {
    for (const line of ["Let's start with the agenda.", "First item is the launch.", "Scribe, add to decisions: we hire two engineers."]) {
      engine.addLine(SPEAKER, line, Date.now());
    }
    await settle();
    engine.flushTranscript();
    await settle();
    const d = await readDoc(DOC.id);
    const t = sectionText(d.outline, "Transcript");
    expect(/start with the agenda/i.test(t) && /hire two engineers/i.test(t), `Transcript: ${t.slice(0, 200)}`);
    expect(!/hire two engineers/i.test(sectionText(d.outline, "Decisions")), "a spoken edit ran in Record all");
  });

  /* E. Control tool */
  print("\n— E. Changing Scribe by voice");
  reset();
  await check("E1", "switch out of Record all by voice", async () => {
    const e = await say("Scribe, switch to commands mode.");
    expect(kind(e) === "control" && settings.listenMode === "commands", `${describe(e)} · mode ${settings.listenMode}`);
  });
  await check("E2", "three settings in one request", async () => {
    const e = await say("Scribe, switch to smart mode, work on the tasks sheet, and ask before writing.");
    expect(
      settings.listenMode === "smart" && settings.focusFileId === SHEET.id && settings.approval === "manual",
      `${JSON.stringify((e.action as { params?: unknown; failed?: unknown }).params)} ${JSON.stringify((e.action as { failed?: unknown }).failed ?? "")} · ${settings.listenMode}/${settings.focusFileId}/${settings.approval}`
    );
    return JSON.stringify((e.action as { params: unknown }).params);
  });
  await check("E3", "back to defaults", async () => {
    await say("Scribe, use any file, make the edits directly, and switch to commands mode.");
    expect(settings.focusFileId === null && settings.approval === "auto" && settings.listenMode === "commands", `${settings.focusFileId}/${settings.approval}/${settings.listenMode}`);
  });
  await check("E4", "“record everything” is Record all, never a video", async () => {
    const before = recorderCalls.length;
    await say("Scribe, record everything.");
    expect(settings.listenMode === "record", `mode ${settings.listenMode}`);
    expect(!recorderCalls.slice(before).includes("start"), "it started a video recording");
    await say("Scribe, switch back to commands mode.");
    expect((settings.listenMode as string) === "commands", "couldn't switch back");
  });
  await check("E5", "pause, drop paused lines, resume without the AI", async () => {
    await say("Scribe, pause.");
    expect(listening.at(-1) === true, "didn't pause");
    const count = engine.getState().entries.length;
    expect(engine.pausedLine(SPEAKER, "We should add Redis.", Date.now()) === null, "a paused line was kept");
    engine.pausedLine(SPEAKER, "Scribe, resume", Date.now());
    await settle();
    expect(listening.at(-1) === false, "didn't resume");
    expect(engine.getState().entries.length === count + 1, "paused lines showed up");
  });
  await check("E6", "pause and stop the video recording", async () => {
    await say("Scribe, pause the recording.");
    await say("Scribe, stop recording.");
    expect(recorderCalls.includes("pause") && recorderCalls.includes("stop"), `recorder got: ${recorderCalls.join(", ")}`);
  });
  await check("E7", "the working file takes requests that name no file", async () => {
    await say("Scribe, work on the tasks sheet.");
    const e = await say("Scribe, add order new laptops.");
    written(e);
    expect((await sheetRows(SHEET.id, TAB)).some((r) => /laptop/i.test(r.join(" "))), "laptops not in the Sheet");
    await say("Scribe, use any file.");
    expect(settings.focusFileId === null, "working file still set");
  });

  /* F. Comments only */
  print("\n— F. Comments only");
  reset({ commentsOnly: true });
  await check("F1", "Doc: a comment, the text unchanged", async () => {
    const e = await say("Scribe, add to decisions: we drop Mongo.");
    expect(written(e).result.status === "commented", describe(e));
    expect((await comments(DOC.id)).some((x) => /proposed/i.test(x) && /mongo/i.test(x)), "no Proposed comment");
    expect(!/drop mongo/i.test((await readDoc(DOC.id)).text), "the text changed");
  });
  await check("F2", "Sheet: a note, no new row", async () => {
    const before = (await sheetRows(SHEET.id, TAB)).length;
    // Names the sheet: with a Doc, a Sheet and a deck connected, "add a task" alone may fairly go to the Doc.
    const e = await say("Scribe, add a task to the tasks sheet: clean up the repo.");
    const a = written(e);
    expect(a.proposal.file.id === SHEET.id, `went to ${a.proposal.file.title}: ${describe(e)}`);
    expect((await sheetRows(SHEET.id, TAB)).length === before, "a row was added");
    expect(/clean up/i.test(await sheetNote(SHEET.id, TAB, "A1")), `no note on A1: ${describe(e)}`);
  });
  await check("F3", "Slides: speaker notes, the slide unchanged", async () => {
    const e = await say("Scribe, on the roadmap slide add mobile app.");
    written(e);
    const deck = await readDeck(DECK.id);
    expect(/mobile app/i.test(deck[1]?.notes ?? "") && !/mobile app/i.test(deck[1]?.text ?? ""), `notes: ${deck[1]?.notes}`);
  });
  s({ commentsOnly: false });

  /* G. Shared screen, pictures and video */
  print("\n— G. Shared screen: reading, screenshots, auto-capture, recordings");
  reset();
  const img = new Image();
  img.src = tablePng;
  await img.decode();
  frame.current = { dataUrl: tablePng, width: img.naturalWidth, height: img.naturalHeight, presenter: "Priya", at: Date.now() };
  engine.setMeet({ status: "listening", title: "Smoke test", userName: SPEAKER, paused: false, screen: { presenter: "Priya" } });

  await check("G1", "read a table off the screen into Sheet rows (vision model)", async () => {
    const e = await say("Scribe, add this table to the tasks sheet.");
    written(e);
    const rows = await sheetRows(SHEET.id, TAB);
    const text = rows.map((r) => r.join(" | ")).join("\n");
    for (const want of ["Payment page", "Load test", "Press kit", "Priya", "Marco", "Lena"]) expect(text.includes(want), `missing ${want}`);
    return describe(e);
  });
  const privateAfter = async (e: Entry) => {
    const a = written(e);
    const id = driveIdIn(a.result.add);
    expect(id, `no Drive link in ${a.result.add}`);
    expect(await isPrivate(id), "the picture is still public");
    return id;
  };
  await check("G2", "screenshot into Slides: new slide with the picture, then private again", async () => {
    const before = (await readDeck(DECK.id)).length;
    const e = await say("Scribe, screenshot this and put it in the deck.");
    await privateAfter(e);
    const deck = await readDeck(DECK.id);
    expect(deck.length === before + 1, `slides ${before} → ${deck.length}`);
    expect(deck.at(-1)!.images === 1, `new slide has ${deck.at(-1)!.images} pictures; ${(e.action as { warning?: string }).warning ?? ""}`);
    return describe(e);
  });
  await check("G3", "screenshot into the Doc: picture under “Shared screen”, then private", async () => {
    const before = (await readDoc(DOC.id)).images;
    const e = await say("Scribe, screenshot this into the doc.");
    await privateAfter(e);
    const d = await readDoc(DOC.id);
    expect(d.images === before + 1, `pictures ${before} → ${d.images}; went to: ${describe(e)}`);
    expect(findSection(d.outline, "Shared screen") || findSection(d.outline, "Decisions"), "no section for it");
    return describe(e);
  });
  await check("G4", "screenshot into the Sheet: a private link in a “Scribe captures” tab", async () => {
    const e = await say("Scribe, screenshot this into the tasks sheet.");
    written(e);
    expect((await sheetTabs(SHEET.id)).includes("Scribe captures"), "no Scribe captures tab");
    const rows = await sheetRows(SHEET.id, "Scribe captures");
    expect(rows.some((r) => r[0] === "Screenshot"), JSON.stringify(rows));
    const id = driveIdIn(written(e).result.add);
    expect(id && (await isPrivate(id)), "the picture isn't private");
  });
  await check("G5", "auto-captured slide lands as a new slide", async () => {
    const before = (await readDeck(DECK.id)).length;
    const id = engine.addScreen({ ...frame.current!, at: Date.now() }, "auto");
    await settle();
    await privateAfter(entry(id));
    expect((await readDeck(DECK.id)).length === before + 1, `no new slide; went to: ${describe(entry(id))}`);
  });
  await check("G6", "with Ask before writing, nothing reaches Drive before Approve", async () => {
    s({ approval: "manual" });
    const files = (await folderFiles(folder)).length;
    const id = engine.addScreen({ ...frame.current!, at: Date.now() }, "auto");
    await settle();
    expect(kind(entry(id)) === "proposal", describe(entry(id)));
    expect((await folderFiles(folder)).length === files, "something was uploaded before approval");
    engine.approve(id);
    await settle();
    await privateAfter(entry(id));
    s({ approval: "auto" });
  });
  await check("G7", "a recording goes to Drive and plays on a new slide", async () => {
    const v = await makeVideo(3000);
    const before = (await readDeck(DECK.id)).length;
    const id = engine.addRecording({ ...v, start: Date.now() - 3000, end: Date.now(), by: SPEAKER, pausedMs: 0 });
    await settle();
    const a = written(entry(id));
    const deck = await readDeck(DECK.id);
    expect(deck.length === before + 1, `no new slide; went to: ${describe(entry(id))}`);
    const fileId = driveIdIn(a.result.add);
    expect(fileId && (await isPrivate(fileId)), "the recording isn't private");
    if (deck.at(-1)!.videos !== 1) throw new Fail(`slide links to the video instead of playing it: ${a.warning ?? ""}`);
    return `${v.mimeType}, ${Math.round(v.blob.size / 1024)} KB`;
  });
  await check("G8", "a recording into the Doc is a linked caption", async () => {
    const v = await makeVideo(1500);
    s({ screen: { autoCapture: false, targetFileId: DOC.id } });
    const id = engine.addRecording({ ...v, start: Date.now() - 1500, end: Date.now(), by: SPEAKER });
    await settle();
    written(entry(id));
    expect(/recording .*started by simon/i.test((await readDoc(DOC.id)).text), "no recording caption in the doc");
    s({ screen: { autoCapture: false, targetFileId: null } });
  });
  await check("G9", "nobody sharing: a clear error, nothing saved", async () => {
    frame.current = null;
    engine.setMeet({ status: "listening", title: "Smoke test", userName: SPEAKER, paused: false, screen: null });
    const files = (await folderFiles(folder)).length;
    const e = await say("Scribe, screenshot this into the deck.");
    expect(kind(e) === "error" && /nobody is sharing/i.test(describe(e)), describe(e));
    expect((await folderFiles(folder)).length === files, "something was uploaded");
  });

  /* L. Long meetings: a request that points back further than the last 6 lines */
  print("\n— L. Long meeting: referring back");
  reset({ files: [DOC] });
  engine.addLine("Priya", "For the pilot, the budget is 42 thousand dollars, and finance approved it.", Date.now());
  for (let i = 0; i < 20; i++) {
    const [who, line] = i % 2
      ? ["Marco", ["The venue can seat about sixty people.", "I'll send the agenda tonight.", "Let's keep the demo short.", "The slides need a new cover.", "Can everyone hear me okay?"][i % 5]!]
      : ["Lena", ["We should invite the design team too.", "Coffee will be in the lobby.", "I booked the room until five.", "The projector cable is in my bag.", "Let's do introductions first."][i % 5]!];
    engine.addLine(who, line, Date.now());
  }
  await settle();
  await check("L1", "add what someone said 21 lines earlier", async () => {
    const e = await say("Scribe, add what Priya said about the pilot budget to decisions.");
    written(e);
    const decisions = sectionText((await readDoc(DOC.id)).outline, "Decisions");
    expect(/42/.test(decisions), `Decisions has no 42: ${decisions.slice(-200)}`);
    return describe(e);
  });
  await check("L2", "answer about something said 22 lines earlier", async () => {
    const e = await say("Scribe, what budget did Priya give for the pilot?");
    expect(kind(e) === "answer" && /42/.test((e.action as { answer: string }).answer), describe(e));
    return describe(e);
  });

  const tally = (st: Status) => results.filter((r) => r.status === st).length;
  w.smoke.summary = `${tally("pass")} passed, ${tally("fail")} failed, ${tally("soft")} soft (model judgement) of ${results.length}`;
  print(`\n${w.smoke.summary}`, tally("fail") ? "fail" : "pass");
  w.smoke.state = "done";
}

if (new URLSearchParams(location.search).get("run") === "1") {
  run().catch((e) => {
    print(`Stopped: ${e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)}`, "fail");
    w.smoke.state = "crashed";
  });
} else {
  w.smoke.state = "idle";
}
