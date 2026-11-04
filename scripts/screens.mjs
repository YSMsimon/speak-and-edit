// Screenshots of every panel tab with made-up people and edits (sidepanel.html?demo=1), for design
// checks and the README. Builds a smoke copy into .output-screens, so the copy Chrome has loaded
// stays as it is, then opens it in a headless Chromium.
//   node scripts/screens.mjs [out dir] [width] [height]
// Needs Playwright's Chromium (npx playwright install chromium) unless one is already cached.
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.resolve(process.argv[2] ?? path.join(root, ".output-screens", "shots"));
const width = Number(process.argv[3] ?? 480);
const height = Number(process.argv[4] ?? 860);
const ext = path.join(root, ".output-screens", "chrome-mv3");

execSync("pnpm exec wxt build", { cwd: root, stdio: "ignore", env: { ...process.env, SCRIBE_SMOKE: "1", SCRIBE_OUT: ".output-screens" } });
mkdirSync(out, { recursive: true });

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "scribe-shots-")), {
  channel: "chromium",
  headless: true,
  viewport: { width, height },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent("serviceworker");
const id = new URL(worker.url()).host;

for (const tab of ["live", "outputs", "ai", "people", "live-more"]) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/sidepanel.html?demo=1&tab=${tab.replace("-more", "&more")}`);
  await page.waitForTimeout(1200);
  const file = path.join(out, `${tab}.png`);
  await page.screenshot({ path: file });
  console.log(file);
  await page.close();
}
await context.close();
