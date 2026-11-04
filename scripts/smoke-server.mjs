// Dev-only helper for the end-to-end smoke test, on http://127.0.0.1:8792 (this computer only).
//   POST /log    the smoke page sends each result line here; appended to .smoke/smoke.log
//   GET  /state  what smoke builds of Scribe poll: { build, run, nonce }
//                - build differs from the loaded one → Scribe reloads itself
//                - run + a new nonce → Scribe opens its smoke page for that AI provider
// Normal builds of Scribe contain none of this.
import { createServer } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

const DIR = new URL("../.smoke/", import.meta.url);
mkdirSync(DIR, { recursive: true });
const LOG = new URL("smoke.log", DIR);
const STATE = new URL("state.json", DIR);

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "POST" && req.url === "/log") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      appendFileSync(LOG, `${body}\n`);
      res.writeHead(204).end();
    });
    return;
  }
  if (req.method === "GET" && req.url === "/state") {
    // So whoever runs the server can see a smoke build is loaded and polling.
    appendFileSync(new URL("polls.log", DIR), `${new Date().toISOString()}\n`);
    const state = existsSync(STATE) ? readFileSync(STATE, "utf8") : "{}";
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(state);
    return;
  }
  res.writeHead(404).end();
}).listen(8792, "127.0.0.1", () => console.log("smoke server on http://127.0.0.1:8792"));
