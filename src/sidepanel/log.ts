// The panel's one AI log (lib/interactions.ts). Smoke builds also send it to the local dev server,
// which appends it to .smoke/interactions.jsonl for scripts/eval-report.mjs.
import { createInteractionLog } from "@/lib/interactions";

export const interactionLog = createInteractionLog({
  post: __SCRIBE_SMOKE__ ? (body) => fetch("http://127.0.0.1:8792/interactions", { method: "POST", body }) : undefined,
});
