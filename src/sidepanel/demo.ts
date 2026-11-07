// Smoke builds only: sidepanel.html?demo=1&tab=live|outputs|ai|people shows the panel with made-up
// people and edits, for screenshots and design checks. Nothing here reaches a real file or call.
import type { EngineState, Entry, Proposal } from "@/lib/engine";
import type { FileRef } from "@/lib/files";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";

const params = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
export const DEMO = __SCRIBE_SMOKE__ && params.has("demo");
export const DEMO_TAB = (params.get("tab") ?? "live") as "live" | "outputs" | "ai" | "people";

const PAPER: FileRef = { id: "overleaf:000000000000000000000001", kind: "tex", title: "Paper" };
const ROADMAP: FileRef = { id: "demo-doc", kind: "doc", title: "Roadmap" };
const TASKS: FileRef = { id: "demo-sheet", kind: "sheet", title: "Tasks" };
const DECK: FileRef = { id: "demo-slides", kind: "slides", title: "Launch deck" };

const T0 = new Date(2026, 10, 4, 16, 5, 0).getTime();

function written(id: string, speaker: string, at: number, text: string, file: FileRef, where: string, add: string, remove?: string): Entry {
  const proposal: Proposal = { origin: "command", file, write: { action: remove ? "replace" : "append", section: where, text: add, find: remove ?? null, replaceWith: remove ? add : null, cells: [] }, quote: text, speaker, at };
  return { id, speaker, text, at, addressed: true, typed: false, action: { kind: "written", proposal, result: { where, add, remove, status: "applied", suggestionIds: [] } } };
}

export const DEMO_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  files: [ROADMAP, TASKS, DECK, PAPER],
  focusFileId: ROADMAP.id,
  listenMode: "smart",
  approval: "auto",
  roles: { Marco: "comment", Lena: "ignore" },
};

/** ?demo=1&more: the cards that need someone (a held change, a question, a problem). */
const MORE: Entry[] = [
  // Left the call 16:08–16:09, then two lines heard while the panel was closed.
  { id: "g1", speaker: "Scribe", text: "Scribe heard nothing from 16:08 to 16:09.", at: T0 + 200_000, addressed: false, typed: false, source: "gap", action: { kind: "skipped" } },
  { id: "x1", speaker: "Lena", text: "I can take the launch email.", at: T0 + 215_000, addressed: false, typed: false, missed: true, action: { kind: "skipped" } },
  { id: "x2", speaker: "Marco", text: "Scribe, add that to the tasks.", at: T0 + 225_000, addressed: false, typed: false, missed: true, action: { kind: "skipped" } },
  {
    id: "m1", speaker: "Marco", text: "Scribe, change the budget to 40k.", at: T0 + 240_000, addressed: true, typed: false,
    action: { kind: "proposal", proposal: { origin: "command", file: TASKS, write: { action: "replace", section: "Budget", text: null, find: "30k", replaceWith: "40k", cells: [] }, quote: "change the budget to 40k", speaker: "Marco", at: T0 + 240_000 } },
  },
  { id: "m2", speaker: "Lena", text: "Scribe, move it to next week.", at: T0 + 300_000, addressed: true, typed: false, action: { kind: "clarify", question: "Which one should move to next week?", options: ["Launch email", "Design review"], command: "move it to next week" } },
  { id: "m3", speaker: "Priya", text: "Scribe, add the chart to the deck.", at: T0 + 360_000, addressed: true, typed: false, action: { kind: "error", message: "Google sign-in ended. Sign in again to keep editing." } },
];

export const DEMO_STATE: EngineState = {
  meet: { status: "listening", title: "Design review", userName: "Priya", paused: false, screen: null },
  entries: [
    written("d1", "Priya", T0, "Scribe, add the test results to the paper.", PAPER, "Results", "Recall was 85% on the pilot."),
    written("d2", "Marco", T0 + 62_000, "Let’s move launch to March in the roadmap.", ROADMAP, "Timeline", "Launch moves to March.", "Launch in February."),
    written("d3", "Lena", T0 + 130_000, "Also add the follow-up tasks for next week.", TASKS, "Sheet1 row 4", "Write the launch email · Lena · Friday"),
    { id: "d4", speaker: "Priya", text: "Perfect, that looks good.", at: T0 + 190_000, addressed: false, typed: false, action: { kind: "skipped" } },
    ...(params.has("more") ? MORE : []),
  ],
  partial: null,
  speakers: { Priya: 4, Marco: 3, Lena: 2 },
  avatars: {},
  self: { name: "Priya", picture: null },
  files: {
    [ROADMAP.id]: { title: ROADMAP.title, parts: ["Timeline", "Decisions"] },
    [TASKS.id]: { title: TASKS.title, parts: ["Sheet1"] },
    [DECK.id]: { title: DECK.title, parts: ["Next steps"] },
    [PAPER.id]: { title: PAPER.title, parts: ["Introduction", "Results"] },
  },
  provider: "ollama",
  providerError: null,
  usage: { inputTokens: 0, outputTokens: 0 },
};
