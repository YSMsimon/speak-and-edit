// The model's jobs. Everything else is plain code.
//   parseCommand: a line addressed to Scribe -> one structured intent, which may be the
//                 control tool (change Scribe's own mode, file, approval, listening, recording).
//   decideSmart:  any line, in Smart mode -> record it somewhere, or not.
//   answerQuestion: a question about the files -> a short answer.
//   readScreen:   a still of the shared screen + the request -> what to write (needs a model that sees images).

import { generateText, Output, type LanguageModel, type LanguageModelUsage } from "ai";
import { z } from "zod";

/**
 * A model plus how to get JSON out of it.
 * strict: the provider enforces a JSON schema (OpenAI, Anthropic, Gemini, Groq, Chrome built-in).
 * prompt: it doesn't (Ollama cloud models, many OpenRouter models), so the keys go in the
 * prompt and the reply is parsed leniently, with one retry.
 */
export interface AiModel {
  model: LanguageModel;
  mode: "strict" | "prompt";
}

const CELLS = z
  .array(z.object({ column: z.string(), value: z.string() }))
  .describe("Google Sheets only: column name and value pairs for the row or cell. Otherwise an empty list.");

/** The control tool: what someone can tell Scribe to change about itself. Null leaves a setting as it is. */
export const CONTROL_SCHEMA = z.object({
  mode: z
    .enum(["commands", "smart", "record"])
    .nullable()
    .describe("commands: act only when addressed by name. smart: record decisions and action items on its own. record: write every line to the transcript."),
  file: z.string().nullable().describe('Exact title of a connected file to work on, or "any" to let Scribe pick the file for each request.'),
  approval: z.enum(["auto", "ask"]).nullable().describe("auto: edits go straight in. ask: Docs edits become suggestions to accept, everything else waits for approval."),
  listening: z.enum(["pause", "resume"]).nullable().describe("Pause or resume listening to the call."),
  recording: z.enum(["start", "stop", "pause", "resume"]).nullable().describe("The video recording of the call."),
});
export type Control = z.infer<typeof CONTROL_SCHEMA>;

/**
 * Starting a video recording matters more than switching mode, so the model's word isn't
 * enough: the request itself has to mention the video, the recording, the screen or the call.
 * "Record everything" means Record all mode.
 */
export function settleControl(c: Control | null, command: string): Control | null {
  if (!c || c.recording !== "start") return c;
  if (/\b(video|recording|screen|the call|the meeting)\b/i.test(command)) return c;
  return { ...c, recording: null, mode: c.mode ?? "record" };
}

/**
 * Code check on the model's screen answers (smoke run 7: "add this table to the tasks sheet" was right
 * only 5 times in 8). A request marked as about the screen is never "none"; and a table, rows, numbers or
 * a list is read off the screen as text, not saved as a picture, unless the words ask for a picture.
 */
export function settleScreen<T extends { action: string; screen?: "none" | "read" | "image" }>(intent: T, command: string): T {
  const screen = intent.screen ?? "none";
  if (screen === "none") return intent;
  let out = intent;
  // Only when the words ask for something to be added ("can you see my screen?" asks for nothing).
  if (out.action === "none" && /\b(add|adding|put|insert|copy|paste|save|grab|take|log|write|capture|move|drop)\b/i.test(command)) out = { ...out, action: "append" };
  const wantsData = /\b(table|tables|rows?|columns?|numbers|figures|list|data|values)\b/i.test(command);
  const wantsPicture = /\b(screenshot|screen ?shot|picture|image|photo|snapshot|capture)\b/i.test(command);
  if (screen === "image" && wantsData && !wantsPicture) out = { ...out, screen: "read" };
  return out;
}

export const INTENT_SCHEMA = z.object({
  action: z
    .enum(["append", "replace", "comment", "new_slide", "question", "clarify", "control", "none"])
    .describe(
      "append: add new text (Docs: to a section; Sheets: a new row; Slides: a bullet). replace: change existing text or a cell. comment: leave a comment. new_slide: add a slide (Slides only). question: answer from the files. clarify: the request is ambiguous. control: change Scribe's own settings. none: not a request about the files or Scribe."
    ),
  file: z.string().nullable().describe("Exact title of the file to change, from the file list. Null means the first file."),
  section: z.string().nullable().describe("Docs: exact heading. Sheets: tab name. Slides: slide title or number. Or null."),
  text: z.string().nullable().describe("append: text as it should appear. comment: the comment. new_slide: the bullet text. question: the question."),
  find: z.string().nullable().describe("replace: text copied exactly from the file that should change. Sheets: the row's name, such as the task, never the old cell value."),
  replaceWith: z.string().nullable().describe("replace: the new text."),
  cells: CELLS,
  clarifyQuestion: z.string().nullable().describe("clarify: one short question for the room."),
  options: z.array(z.string()).describe("clarify: two or three short choices. Otherwise an empty list."),
  screen: z
    .enum(["none", "read", "image"])
    .describe("read: the request is about what's on the shared screen and wants its content written as text. image: it wants a picture of the screen in a file. none: otherwise."),
  control: CONTROL_SCHEMA.nullable().describe("control: the settings to change. Otherwise null."),
});

const INTENT_KEYS = `{"action": "append" | "replace" | "comment" | "new_slide" | "question" | "clarify" | "control" | "none", "file": exact file title or null, "section": heading, tab or slide, or null, "text": string or null, "find": string or null, "replaceWith": string or null, "cells": array of {"column": string, "value": string}, "clarifyQuestion": string or null, "options": array of strings, "screen": "none" | "read" | "image", "control": null or {"mode": "commands" | "smart" | "record" | null, "file": exact file title or "any" or null, "approval": "auto" | "ask" | null, "listening": "pause" | "resume" | null, "recording": "start" | "stop" | "pause" | "resume" | null}}`;
export type Intent = z.infer<typeof INTENT_SCHEMA>;

export const SMART_SCHEMA = z.object({
  action: z
    .enum(["append", "replace", "request", "none"])
    .describe("append: record something new. replace: update something already in a file. request: the line asks you to do something (screenshot, edit, comment, read the screen, change your settings). none: nothing to record."),
  label: z.enum(["decision", "action_item", "open_question", "fact", "none"]),
  file: z.string().nullable().describe("Exact file title from the file list, or null for the first file."),
  section: z.string().nullable().describe("Docs: exact heading. Sheets: tab name. Slides: slide title or number. Or null."),
  text: z.string().nullable().describe("append: the entry as it should read in the file. Short and plain, no speaker names."),
  find: z.string().nullable().describe("replace: text copied exactly from the file."),
  replaceWith: z.string().nullable(),
  cells: CELLS,
});
export type SmartDecision = z.infer<typeof SMART_SCHEMA>;

const SMART_KEYS = `{"action": "append" | "replace" | "request" | "none", "label": "decision" | "action_item" | "open_question" | "fact" | "none", "file": exact file title or null, "section": heading, tab or slide, or null, "text": string or null, "find": string or null, "replaceWith": string or null, "cells": array of {"column": string, "value": string}}`;

/** Models sometimes write U+202F or U+00A0 where a space belongs; that breaks matching text later. */
export function plainSpaces<T>(value: T): T {
  if (typeof value === "string") return value.replace(/[\u00a0\u2007\u202f]/g, " ") as T;
  if (Array.isArray(value)) return value.map(plainSpaces) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plainSpaces(v)])) as T;
  return value;
}

/** Pulls a JSON object out of a reply that may have code fences or prose around it. */
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The reply had no JSON object.");
  const value = JSON.parse(unfenced.slice(start, end + 1)) as Record<string, unknown>;
  // Some models send null where a list is expected.
  if (value && typeof value === "object") {
    if (value.options === null || value.options === undefined) value.options = [];
    if (value.cells === null || value.cells === undefined) value.cells = [];
    if (value.rows === null) value.rows = [];
  }
  return value;
}

/** Models often leave out keys they have nothing for. Fill those with null or [] when the schema allows it, nested objects too. */
export function fillMissing(schema: z.ZodTypeAny, value: unknown): unknown {
  const shape = (schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape;
  if (!shape || !value || typeof value !== "object") return value;
  const out = { ...(value as Record<string, unknown>) };
  for (const [key, field] of Object.entries(shape)) {
    if (out[key] === undefined) {
      if (field.safeParse(null).success) out[key] = null;
      else if (field.safeParse([]).success) out[key] = [];
      continue;
    }
    const inner = (field as unknown as { unwrap?: () => z.ZodTypeAny }).unwrap?.() ?? field;
    if (out[key] && typeof out[key] === "object" && !Array.isArray(out[key])) out[key] = fillMissing(inner, out[key]);
  }
  return out;
}

/** A prompt, with a picture attached when there is one. */
function input(prompt: string, image?: string) {
  if (!image) return { prompt };
  const [head = "", data = ""] = image.split(",");
  const mediaType = /^data:([^;,]+)/.exec(head)?.[1] ?? "image/jpeg";
  return { messages: [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }, { type: "file" as const, mediaType, data }] }] };
}

async function structured<S extends z.ZodTypeAny>(
  ai: AiModel,
  args: { system: string; prompt: string; schema: S; name: string; keys: string; signal?: AbortSignal; image?: string }
): Promise<{ value: z.infer<S>; usage: Usage }> {
  if (ai.mode === "strict") {
    try {
      const result = await generateText({
        model: ai.model,
        system: args.system,
        ...input(args.prompt, args.image),
        output: Output.object({ schema: args.schema, name: args.name }),
        maxRetries: 1,
        abortSignal: args.signal,
      });
      if (result.output) return { value: plainSpaces(result.output as z.infer<S>), usage: toUsage(result.usage) };
    } catch {
      // Fall through to the prompt route below.
    }
  }
  const system = `${args.system}\n\nReply with only a JSON object, no code fences, with exactly these keys:\n${args.keys}`;
  let prompt = args.prompt;
  let total: Usage = { inputTokens: 0, outputTokens: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateText({ model: ai.model, system, ...input(prompt, args.image), maxRetries: 1, abortSignal: args.signal });
    const u = toUsage(result.usage);
    total = { inputTokens: total.inputTokens + u.inputTokens, outputTokens: total.outputTokens + u.outputTokens };
    let problem: string;
    try {
      const parsed = args.schema.safeParse(fillMissing(args.schema, extractJson(result.text)));
      if (parsed.success) return { value: plainSpaces(parsed.data), usage: total };
      problem = parsed.error.issues.map((i) => `${i.path.join(".") || "reply"}: ${i.message}`).join("; ");
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
    prompt = `${args.prompt}\n\nYour last reply didn't fit (${problem}). Reply again with only the JSON object.`;
  }
  throw new Error("The model didn’t return a usable answer. Try a larger model.");
}

export const COMMAND_INSTRUCTIONS = `You are Scribe. People in a live meeting can ask you to change their shared Google files (Docs, Sheets, Slides).
Someone just addressed you by name. Turn their request into exactly one action.
Rules:
- Pick the file by its exact title from the file list. If the request doesn't name a file and a working file is set, use null: Scribe uses the working file. If there is only one file, use null.
- Use a section, tab or slide name exactly as it appears in that file. If none fits, use null.
- For append, write the text the way it should read in the file: short, plain, no speaker names, no quotation marks.
- For new_slide: the new slide's title goes in "section" ("a new slide called Risks" → section "Risks") and its bullet lines in "text". Never leave the title out when one was said.
- For Google Sheets, put each value under its column in "cells", using the column names shown.
- For replace, copy "find" word for word from the file. Never invent text that isn't there.
- For an Overleaf project (LaTeX), "section" is a \\section title as written. Write "text" and "replaceWith" as plain words, never LaTeX commands or escapes: Scribe makes them safe for LaTeX.
- For a Sheets cell change ("mark fix login as done"), "find" is the row's name copied from the sheet ("Fix login"), never the old value ("open"), and the new value goes in "cells" under its column ({"column": "Status", "value": "Done"}).
- A question about the files or the meeting ("what's the launch date?", "what did we decide about billing?") is question, with the question in text. Questions that aren't about the files or what was said ("can you hear me?", "are you there?") are none. Requests to add, put, change, move or mark something are never questions, even when that item isn't in the files yet: adding it is the point. Never reply that the files don't contain an instruction to do it: the person's words are the instruction.
- Do what was asked even when it contradicts what the files say: "change Postgres to MySQL" is replace, never a refusal or an answer. The room decides; you edit.
- If the request could mean two different things (for example "move it" when two dates match), use clarify with a question and 2-3 options. The options must be real things from the files (a heading, a line, a row, a slide) or the choices the person actually said, copied as they appear. Never offer actions nobody asked for.
- For comment: "text" is only what the comment should say, cleaned up and short ("…and comment it to delete this later" → "Delete this later"; "add a comment saying okay, thank you" → "Okay, thank you"). Never put the request itself in "text". "find" is the line or words the comment is about, copied from the file as closely as you can: the captions may have misheard a few words, so pick the file's line that matches best. If no line is named, "find" is null.
- Requests about Scribe itself use control, with only the asked-for settings filled and the rest null: switching mode ("switch to smart mode", "only listen for commands"; "record everything", "write everything down" and "transcribe the meeting" mean mode record), the file to work on ("work on the tracker", "use any file"), auto or ask before writing ("make the edits directly" is auto, "let me approve changes first" is ask), pausing or resuming listening ("stop listening", "pause"), and the video recording ("start recording the call", "pause the recording", "stop recording"). Use recording only when they speak of the video or "the recording"; never start one for "record everything".
- If the line isn't a request about the files or Scribe, use none.
- "Earlier in the meeting" holds older lines and Scribe's summary. Use it only when the request points back to something said before ("what Priya said about the budget", "the date we agreed on earlier"). Take facts from the exact lines when they are there, not from the summary.
- Shared screen: when someone is sharing their screen and the request points at it ("this table", "what's on screen", "these numbers"), set screen to read and say where it goes (file, section); leave text empty, it is read from the screen later. When they want a picture of it ("screenshot this", "save this slide", "put this in the deck"), use append with screen image. Otherwise screen is none.

Examples. The files in them are made up: Doc "Plan" (headings Goals, Risks; a line "Pilot ends March 3"), Sheet "Tasks" (columns Task | Owner | Status; a row "Update FAQ"), Slides "Review deck". Keys not shown are null, empty, or "none" for screen.
- "put Redis for the session cache under risks" → {"action": "append", "file": "Plan", "section": "Risks", "text": "Redis for the session cache"}
- "add a task, Lena drafts the FAQ by Thursday" → {"action": "append", "file": "Tasks", "cells": [{"column": "Task", "value": "Draft the FAQ by Thursday"}, {"column": "Owner", "value": "Lena"}]}
- "mark update FAQ as done" → {"action": "replace", "file": "Tasks", "find": "Update FAQ", "cells": [{"column": "Status", "value": "Done"}]}
- "push the pilot end to March 10" → {"action": "replace", "file": "Plan", "find": "March 3", "replaceWith": "March 10"}
- "comment on the pilot line, saying confirm with legal first" → {"action": "comment", "file": "Plan", "find": "Pilot ends March 3", "text": "Confirm with legal first"}
- "new slide called Open questions, with pricing and support hours" → {"action": "new_slide", "file": "Review deck", "section": "Open questions", "text": "Pricing\nSupport hours"}
- "what did we put down for the pilot end?" → {"action": "question", "text": "What did we put down for the pilot end?"}
- "move it to next week" (two dated lines could be meant) → {"action": "clarify", "clarifyQuestion": "Which one should move to next week?", "options": ["Pilot ends March 3", "Beta review March 5"]}
- "write everything down from now on" → {"action": "control", "control": {"mode": "record", "file": null, "approval": null, "listening": null, "recording": null}}
- "save this slide into the deck" (someone is sharing) → {"action": "append", "file": "Review deck", "screen": "image"}
- "thanks, that's all for now" → {"action": "none"}`;

export const SMART_INSTRUCTIONS = `You are Scribe, the note-taker in a live meeting. You read each line as it is spoken and decide, on your own, whether it should be recorded in the meeting's Google files.
Record it (append, or replace when it updates something already written) only when the line contains one of:
- a decision the group has made ("let's go with Postgres", "we agreed to ship Monday"),
- an action item: someone will do something, ideally with an owner or a date,
- an open question the group can't answer yet and wants to track,
- a concrete fact that belongs in one of the file's sections (a date, a number, a requirement).
Do NOT record: small talk, greetings, opinions still being debated, options still being weighed ("maybe X, maybe Y", "not sure yet": that is not an open question unless someone says to track it), half-finished thoughts, questions asked to a person in the room, or anything already written in the files. When you are unsure, use none. Most lines are none.
Write the entry the way it should read in the file: short, plain, no speaker names, no quotation marks. Use the recent lines to understand what "it" or "that" refers to and to tell a real decision from a suggestion.
Pick the file and section exactly as they appear in the file list. For an Overleaf project (LaTeX), write plain words, never LaTeX commands. When a working file is set, write only to it. Never write into a section called Transcript: it holds only what was said, word for word.
Requests: in this mode people don't have to say your name. When a line asks the note-taker, the assistant or "you" to do something you can do, use request and leave the other fields null: taking a screenshot or recording of the shared screen ("can you take a screenshot?", "grab this slide"), adding, changing or commenting in the files ("put that in the doc", "add a comment saying thanks", "mark the login fix as done"), reading what's on screen ("add this table to the sheet"), or changing your settings ("switch to command mode", "pause", "work on the tracker", "stop recording"). A request without a name ("can you…", "could you…", "please…") about something only you do here (screenshots, the files, your settings) is for you: use request. A request aimed at a named person in the room ("Priya, can you share your screen?", "Simon, can you set up staging by Friday?") is never a request: judge it like any other line, so a task given to someone with a deadline is still an action_item to append, and a quick favour is none. Things done right now in the meeting (sharing a screen, unmuting, going to the next slide, repeating something) are never action items. A request is never something to record as text.

Examples. The files are made up: Doc "Plan" (headings Decisions, Risks), Sheet "Tasks" (columns Task | Owner | Status). Keys not shown are null or empty.
- Marco: "Okay, so we go with weekly releases then." → {"action": "append", "label": "decision", "file": "Plan", "section": "Decisions", "text": "Release weekly"}
- Priya: "Lena, can you send the pricing sheet to finance by Monday?" → {"action": "append", "label": "action_item", "file": "Tasks", "cells": [{"column": "Task", "value": "Send the pricing sheet to finance by Monday"}, {"column": "Owner", "value": "Lena"}]}
- Lena: "Maybe weekly, maybe every two weeks, I'm not sure yet." → {"action": "none", "label": "none"}
- Simon: "Could you grab a screenshot of this?" → {"action": "request", "label": "none"}
- Priya: "Marco, can you share your screen?" → {"action": "none", "label": "none"}
- Marco: "Morning, everyone. Can you all hear me?" → {"action": "none", "label": "none"}`;

export interface Context {
  /** All connected files, described for the model. */
  outline: string;
  recent: string[]; // last few lines, "Name: text"
  /** Older lines and the meeting summary, picked to fit the model's budget (ai/context.ts). */
  earlier?: string;
  /** "Priya is sharing their screen." when someone is. */
  screen?: string;
  /** Scribe's current settings, so "switch back" and "which file" make sense. */
  state?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

const toUsage = (u: LanguageModelUsage | undefined): Usage => ({
  inputTokens: u?.inputTokens ?? 0,
  outputTokens: u?.outputTokens ?? 0,
});

export async function parseCommand(
  ai: AiModel,
  input: { speaker: string; command: string; clarification?: string },
  ctx: Context,
  signal?: AbortSignal
): Promise<{ intent: Intent; usage: Usage }> {
  const prompt = [
    `Files:\n${ctx.outline}`,
    ctx.earlier ? `Earlier in the meeting:\n${ctx.earlier}` : "",
    ctx.recent.length ? `Recent lines:\n${ctx.recent.join("\n")}` : "",
    ctx.screen ?? "Nobody is sharing their screen.",
    ctx.state ?? "",
    `${input.speaker} said to Scribe: "${input.command}"`,
    input.clarification ? `The room answered your question: "${input.clarification}"` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const ask = (p: string) =>
    structured(ai, {
      system: COMMAND_INSTRUCTIONS,
      prompt: p,
      schema: INTENT_SCHEMA.extend({ screen: INTENT_SCHEMA.shape.screen.nullable() }),
      name: "intent",
      keys: INTENT_KEYS,
      signal,
    });
  let { value, usage } = await ask(prompt);
  // Code check: a request that starts with a change word ("add a task: …") once in about 50 tries came back
  // as a question answered with "the sheet doesn't contain that task" (smoke runs 3, 6 and 9). Ask once more.
  if ((value.action === "question" || value.action === "none") && looksLikeChange(input.command)) {
    const again = await ask(`${prompt}\n\nThis is a request to change the files, not a question. Do what was asked.`);
    usage = { inputTokens: usage.inputTokens + again.usage.inputTokens, outputTokens: usage.outputTokens + again.usage.outputTokens };
    if (again.value.action !== "question" && again.value.action !== "none") value = again.value;
  }
  return {
    intent: settleScreen({ ...value, screen: value.screen ?? "none", control: settleControl(value.control ?? null, input.command), section: cleanSection(value.section) }, input.command),
    usage,
  };
}

/** "add a task: …", "please mark … as done", "put … in the deck": words that ask for a change, not an answer. */
export function looksLikeChange(command: string): boolean {
  return /^(?:(?:please|can you|could you|now|okay|ok|so|and)\s*,?\s+)*(add|put|insert|create|make|mark|change|move|set|update|write|note|log|record|rename|replace|append|include|list)\b/i.test(
    command.trim()
  );
}

/** Models sometimes echo the outline's markdown ("### Decisions"). Keep just the title. */
export function cleanSection(section: string | null): string | null {
  const t = section?.replace(/^#+\s*/, "").trim();
  return t ? t : null;
}

export async function decideSmart(
  ai: AiModel,
  input: { speaker: string; text: string },
  ctx: Context,
  signal?: AbortSignal
): Promise<{ decision: SmartDecision; usage: Usage }> {
  const prompt = [
    `Files:\n${ctx.outline}`,
    ctx.earlier ? `Earlier in the meeting:\n${ctx.earlier}` : "",
    ctx.recent.length ? `Recent lines:\n${ctx.recent.join("\n")}` : "",
    ctx.state ?? "",
    `New line. ${input.speaker}: "${input.text}"`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const { value, usage } = await structured(ai, { system: SMART_INSTRUCTIONS, prompt, schema: SMART_SCHEMA, name: "decision", keys: SMART_KEYS, signal });
  return { decision: { ...value, section: cleanSection(value.section) }, usage };
}

export async function answerQuestion(
  ai: AiModel,
  question: string,
  ctx: Context,
  signal?: AbortSignal
): Promise<{ answer: string; usage: Usage }> {
  const result = await generateText({
    model: ai.model,
    system: "Answer the meeting's question from the files in one or two short sentences. If the files don't say, say so.",
    prompt: [`Files:\n${ctx.outline}`, ctx.earlier ? `Earlier in the meeting:\n${ctx.earlier}` : "", `Recent lines:\n${ctx.recent.join("\n")}`, `Question: ${question}`]
      .filter(Boolean)
      .join("\n\n"),
    maxRetries: 1,
    abortSignal: signal,
  });
  return { answer: plainSpaces(result.text.trim()), usage: toUsage(result.usage) };
}

export const SCREEN_SCHEMA = z.object({
  action: z.enum(["append", "replace", "none"]).describe("append: add what was read. replace: update text already in a file. none: the screen doesn't show what was asked for."),
  file: z.string().nullable().describe("Exact file title from the file list, or null for the first file."),
  section: z.string().nullable().describe("Docs: exact heading. Sheets: tab name. Slides: slide title or number. Or null."),
  text: z.string().nullable().describe("Docs and Slides: what to write, one item per line, no bullet marks."),
  find: z.string().nullable().describe("replace: text copied exactly from the file."),
  replaceWith: z.string().nullable(),
  rows: z
    .array(z.array(z.object({ column: z.string(), value: z.string() })))
    .describe("Google Sheets only: one entry per row to add, each a list of column and value pairs using the sheet's column names. Otherwise an empty list."),
  note: z.string().nullable().describe("One short sentence for the room when something couldn't be read, or null."),
});
export type ScreenRead = z.infer<typeof SCREEN_SCHEMA>;

const SCREEN_KEYS = `{"action": "append" | "replace" | "none", "file": exact file title or null, "section": heading, tab or slide, or null, "text": string or null, "find": string or null, "replaceWith": string or null, "rows": array of arrays of {"column": string, "value": string}, "note": string or null}`;

export const SCREEN_INSTRUCTIONS = `You are Scribe, in a live meeting. The picture is what someone is sharing on their screen right now. Someone asked you to put what's on it into the meeting's Google files.
Read the screen carefully and copy only what is actually visible: never guess a value you can't read.
- For a Google Sheet, put one entry in "rows" per row to add, with each value under the sheet's own column names. Leave a column out when the screen has nothing for it.
- For a Doc or Slides, write "text" with one item per line, short and plain.
- Pick the file and section exactly as they appear in the file list, following what was asked.
- If the screen doesn't show what was asked for, use none and say why in "note".`;

export async function readScreen(
  ai: AiModel,
  input: { speaker: string; command: string; image: string },
  ctx: Context,
  signal?: AbortSignal
): Promise<{ read: ScreenRead; usage: Usage }> {
  const prompt = [`Files:\n${ctx.outline}`, ctx.recent.length ? `Recent lines:\n${ctx.recent.join("\n")}` : "", `${input.speaker} said to Scribe: "${input.command}"`]
    .filter(Boolean)
    .join("\n\n");
  const { value, usage } = await structured(ai, { system: SCREEN_INSTRUCTIONS, prompt, schema: SCREEN_SCHEMA, name: "screen", keys: SCREEN_KEYS, signal, image: input.image });
  return { read: { ...value, section: cleanSection(value.section) }, usage };
}

export const CONFIRM_SCHEMA = z.object({
  forScribe: z.boolean().describe("True only when the line asks Scribe to do one of its jobs."),
  request: z.string().nullable().describe("The request as said to Scribe, without the name in front. Null when it isn't for Scribe."),
});
export type Confirmation = z.infer<typeof CONFIRM_SCHEMA>;

const CONFIRM_KEYS = `{"forScribe": true | false, "request": string or null}`;

export const confirmInstructions = (wakeWord: string) => `You decide whether one line from a live meeting was said to Scribe, the meeting's AI note-taker, which people call "${wakeWord}".
Live captions often mishear that name as a word that sounds like it, at the start of the line ("Subscribe", "Describe", "Scrub" for "Scribe"). The line you get starts with such a word.
It is for Scribe only when the line asks Scribe to do one of its jobs:
- add, change, move or delete something in the meeting's shared files (Google Docs, Sheets, Slides, Obsidian notes, Overleaf),
- add a comment to them,
- take a screenshot or a recording of the shared screen, or copy what's on screen into a file,
- answer a question about the files or about what was said,
- change Scribe itself: listening mode, working file, approval, pause, resume, recording.
It is not for Scribe when the word is used in its normal meaning ("describe the login flow for me", "subscribe to the newsletter", "I'd scrub that idea"), when it's said to a person in the room, or when it's only a greeting, small talk or a sound check ("Scribe, hello, how are you?").
Use the recent lines to see who is being spoken to. When unsure, it is not for Scribe.

Examples (wake word "Scribe"):
- "Subscribe, put the new deadline in the timeline." → {"forScribe": true, "request": "put the new deadline in the timeline"}
- "Describe! Can you comment on the budget line saying check with finance?" → {"forScribe": true, "request": "comment on the budget line saying check with finance"}
- "Scrub, switch to smart mode." → {"forScribe": true, "request": "switch to smart mode"}
- "Describe what the customer saw when it crashed." → {"forScribe": false, "request": null}
- "Subscribe to our channel at the end of the demo." → {"forScribe": false, "request": null}
- "Subscribe, hi, can you hear me?" → {"forScribe": false, "request": null}`;

/** A line that starts with a word sounding like the wake word: was it really said to Scribe? */
export async function confirmRequest(
  ai: AiModel,
  input: { speaker: string; text: string; wakeWord: string },
  ctx: { recent: string[]; files: string[] },
  signal?: AbortSignal
): Promise<{ confirmation: Confirmation; usage: Usage }> {
  const prompt = [
    ctx.files.length ? `Files Scribe can edit: ${ctx.files.join(", ")}` : "No files connected.",
    ctx.recent.length ? `Recent lines:\n${ctx.recent.join("\n")}` : "",
    `${input.speaker} said: "${input.text}"`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const { value, usage } = await structured(ai, { system: confirmInstructions(input.wakeWord), prompt, schema: CONFIRM_SCHEMA, name: "confirmation", keys: CONFIRM_KEYS, signal });
  return { confirmation: { forScribe: value.forScribe, request: value.forScribe ? (value.request?.trim() || null) : null }, usage };
}

export const SUMMARY_INSTRUCTIONS =`You keep the running notes of a live meeting, so later requests can refer back to it.
You get the notes so far (maybe none) and the next lines of the meeting, each "time Name: words". Return the updated notes:
- decisions, with who made them;
- action items, with the owner and any date;
- open questions;
- facts and numbers people gave (dates, amounts, names), with who said them;
- what was asked of Scribe and which files or sections it went to.
Plain short lines, oldest first, no quotation marks, no small talk. Keep everything from the old notes that still matters. At most 250 words.`;

/** Folds older lines into the meeting's running summary. */
export async function summarizeMeeting(
  ai: AiModel,
  input: { previous: string | null; lines: string[] },
  signal?: AbortSignal
): Promise<{ summary: string; usage: Usage }> {
  const result = await generateText({
    model: ai.model,
    system: SUMMARY_INSTRUCTIONS,
    prompt: [`Notes so far:\n${input.previous ?? "(none yet)"}`, `Next lines:\n${input.lines.join("\n")}`].join("\n\n"),
    maxRetries: 1,
    abortSignal: signal,
  });
  return { summary: result.text.trim(), usage: toUsage(result.usage) };
}

/** A quick round trip used by the Test button. */
export async function pingModel(ai: AiModel): Promise<string> {
  const { intent: i } = await parseCommand(
    ai,
    { speaker: "Sam", command: "add to decisions: launch is December 8" },
    { outline: "File “Spec” (Google Doc)\n## Decisions\n- Use Postgres", recent: [] }
  );
  return `${i.action} → ${i.section ?? "no section"}: ${i.text ?? i.replaceWith ?? ""}`;
}
