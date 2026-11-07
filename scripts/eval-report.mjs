// Reads Scribe's AI log and finds the mistakes that happen most, for evals and few-shot examples.
//   node scripts/eval-report.mjs                      reads .smoke/interactions.jsonl (smoke builds write it)
//   node scripts/eval-report.mjs export.jsonl …       or files exported from Outputs › Saved meetings
// Prints a summary, and writes every flagged line with its full AI inputs and outputs to
// .evals/candidates-<date>.jsonl (git-ignored: it holds real meeting content).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const files = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(root, ".smoke", "interactions.jsonl")];
const events = [];
for (const f of files) {
  if (!existsSync(f)) {
    console.error(`No log at ${f}. Use Scribe in a call first (smoke builds write it), or export it from Outputs.`);
    process.exit(1);
  }
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      // Only Scribe's own events: a time and a known kind.
      if (typeof e?.at === "number" && ["ai", "outcome", "feedback"].includes(e.t)) events.push(e);
    } catch {
      // A torn last line while Scribe was writing: skip it.
    }
  }
}
events.sort((a, b) => a.at - b.at);
if (!events.length) {
  console.log("The log is empty.");
  process.exit(0);
}

const ai = events.filter((e) => e.t === "ai");
const outcomes = events.filter((e) => e.t === "outcome");
const feedback = events.filter((e) => e.t === "feedback");
const key = (e) => `${e.meeting ?? "-"}|${e.entry ?? "-"}`;
const byEntry = new Map();
for (const e of events) {
  if (!e.entry) continue;
  const k = key(e);
  if (!byEntry.has(k)) byEntry.set(k, { key: k, meeting: e.meeting, entry: e.entry, ai: [], outcomes: [], feedback: [] });
  const g = byEntry.get(k);
  if (e.t === "ai") g.ai.push(e);
  else if (e.t === "outcome") g.outcomes.push(e);
  else g.feedback.push(e);
}
const last = (arr) => arr[arr.length - 1];
const pct = (xs, p) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0);
const count = (xs) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
const words = (s) => new Set(String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const similar = (a, b) => {
  const A = words(a);
  const B = words(b);
  const both = [...A].filter((w) => B.has(w)).length;
  return both / Math.max(1, Math.min(A.size, B.size));
};
// The same words agent.ts treats as asking for a change.
const looksLikeChange = (c) =>
  /^(?:(?:please|can you|could you|now|okay|ok|so|and)\s*,?\s+)*(add|put|insert|create|make|mark|change|move|set|update|write|note|log|record|rename|replace|append|include|list)\b/i.test(String(c).trim());

/* ---------- flags ---------- */

const flags = new Map(); // entry key → Set of reasons
const flag = (g, reason) => {
  if (!flags.has(g.key)) flags.set(g.key, new Set());
  flags.get(g.key).add(reason);
};
const groups = [...byEntry.values()];
const addressed = groups.filter((g) => g.ai.some((c) => c.job === "parseCommand"));
for (const g of groups) {
  const end = last(g.outcomes);
  const parse = g.ai.find((c) => c.job === "parseCommand");
  const command = parse?.input?.command ?? end?.text ?? "";
  if (g.ai.some((c) => c.error) || end?.kind === "error") flag(g, "error");
  if (end?.kind === "clarify") flag(g, "asked which one");
  if (parse && (end?.kind === "ignored" || end?.kind === "answer") && looksLikeChange(command)) flag(g, "change taken as none or a question");
  if (g.feedback.some((f) => f.action === "reject" || f.action === "discard")) flag(g, "rejected or discarded");
  if (g.feedback.some((f) => f.action === "retry")) flag(g, "retried");
  if (g.ai.some((c) => c.ms > 8000)) flag(g, "slow (over 8 s)");
  const confirm = g.ai.find((c) => c.job === "confirmRequest");
  if (confirm?.output?.confirmation?.forScribe === true && (end?.kind === "ignored" || end?.kind === "skipped")) flag(g, "wake check said yes, request said none");
  if (confirm?.output?.confirmation?.forScribe === false && end) {
    // Said again with the real wake word within a minute: the check was wrong.
    const again = addressed.find((h) => {
      const o = h.outcomes[0];
      return o && o.speaker === end.speaker && o.at > end.at && o.at - end.at < 60_000 && !h.ai.some((c) => c.job === "confirmRequest");
    });
    if (again) flag(g, "wake check said no, then said again");
  }
}
// A request said again by the same person within 90 s, after the first didn't land.
for (const g of addressed) {
  const end = last(g.outcomes);
  if (!end || end.kind === "written" || end.kind === "proposal" || end.kind === "control") continue;
  const later = addressed.find((h) => {
    const o = h.outcomes[0];
    return h !== g && o && o.speaker === end.speaker && o.at > end.at && o.at - end.at < 90_000 && similar(o.text, end.text) >= 0.5;
  });
  if (later) flag(g, "said again soon after");
}

/* ---------- report ---------- */

const lines = [];
const out = (s = "") => lines.push(s);
const first = new Date(events[0].at).toISOString().slice(0, 16).replace("T", " ");
const lastAt = new Date(last(events).at).toISOString().slice(0, 16).replace("T", " ");
const meetings = new Set(events.map((e) => e.meeting).filter(Boolean)).size;
out(`# AI log report`);
out(`${events.length} events, ${first} to ${lastAt} UTC, ${meetings} meeting(s), ${groups.length} lines, ${addressed.length} requests to Scribe`);
out();
out(`## AI calls`);
out(`| Job | Calls | Errors | p50 | p90 | Tokens in/out |`);
out(`|---|---|---|---|---|---|`);
for (const [job] of count(ai.map((c) => c.job))) {
  const calls = ai.filter((c) => c.job === job);
  const ms = calls.map((c) => c.ms);
  const tin = calls.reduce((n, c) => n + (c.usage?.inputTokens ?? 0), 0);
  const tout = calls.reduce((n, c) => n + (c.usage?.outputTokens ?? 0), 0);
  out(`| ${job} | ${calls.length} | ${calls.filter((c) => c.error).length} | ${(pct(ms, 50) / 1000).toFixed(1)} s | ${(pct(ms, 90) / 1000).toFixed(1)} s | ${tin} / ${tout} |`);
}
const errors = count(ai.filter((c) => c.error).map((c) => `${c.job}: ${String(c.error).slice(0, 120)}`));
if (errors.length) {
  out();
  out(`Most common errors:`);
  for (const [msg, n] of errors.slice(0, 8)) out(`- ${n}× ${msg}`);
}
out();
out(`## What happened to lines (last outcome)`);
for (const [kind, n] of count(groups.map((g) => last(g.outcomes)?.kind ?? "none"))) out(`- ${kind}: ${n}`);
out();
out(`## Feedback`);
const fb = count(feedback.map((f) => f.action));
if (!fb.length) out("- none yet");
for (const [action, n] of fb) out(`- ${action}: ${n}`);
out();
out(`## Likely mistakes`);
const reasons = count([...flags.values()].flatMap((r) => [...r]));
if (!reasons.length) out("- none found");
for (const [reason, n] of reasons) {
  out(`### ${reason} (${n})`);
  const examples = [...flags].filter(([, r]) => r.has(reason)).slice(0, 3);
  for (const [k] of examples) {
    const g = byEntry.get(k);
    const end = last(g.outcomes);
    out(`- ${end?.speaker ?? "?"}: "${String(end?.text ?? g.ai[0]?.input?.command ?? "").slice(0, 140)}" → ${end?.kind ?? "?"}${end?.detail ? `: ${String(end.detail).slice(0, 140)}` : ""}`);
  }
}

console.log(lines.join("\n"));

const evals = path.join(root, ".evals");
mkdirSync(evals, { recursive: true });
const file = path.join(evals, `candidates-${new Date().toISOString().slice(0, 10)}.jsonl`);
const candidates = [...flags].map(([k, r]) => {
  const g = byEntry.get(k);
  return { reasons: [...r], line: g.outcomes[0] ? { speaker: g.outcomes[0].speaker, text: g.outcomes[0].text, at: g.outcomes[0].at, mode: g.outcomes[0].mode } : null, ai: g.ai, outcomes: g.outcomes, feedback: g.feedback };
});
writeFileSync(file, candidates.map((c) => JSON.stringify(c)).join("\n") + (candidates.length ? "\n" : ""));
console.log(`\n${candidates.length} flagged line(s) with their full AI inputs and outputs: ${path.relative(root, file)}`);
