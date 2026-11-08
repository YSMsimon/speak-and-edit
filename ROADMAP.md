# Scribe roadmap

One step at a time. A step is finished only when every box in its **gate** is ticked. The next step doesn't start before that.

## The gate every step has to pass

1. **Unit tests:** all pass, and the count never goes down. New code comes with its own tests.
2. **Live AI checks** (`SCRIBE_LIVE=1`, Ollama `gpt-oss:120b-cloud`):
   - each new check passes in 3 runs out of 3;
   - the old checks keep their usual rate, about 1 miss in 60.
3. **Smoke test** (`SCRIBE_SMOKE=1`, real Google and service APIs):
   - it gets a section for the new feature;
   - the full run ends with **0 failures**. Model-judgement "soft" results are listed but don't block.
4. **Real call:** Simon runs the step's new section of `TEST_SCRIPT.md` in a Meet call. Every item passes, or the failure is fixed and the item rerun.
5. **No regressions:** the earlier smoke sections and the step-0 test-script sections still pass.
6. **Docs:**
   - README, `TEST_SCRIPT.md` and `THIRD_PARTY.md` are updated;
   - the version goes up (the header shows it);
   - the project note gets one line.

Who does what:
- **Claude:** builds; runs unit tests, live checks and headless checks; fixes failures.
- **Simon:** sign-ins, the smoke page in his Chrome, real calls, and the decisions marked ⚑.

---

## Waiting on Simon, in one place (updated 2026-11-01)

Everything here needs your accounts or a credential or publishing decision. Do them in any order; each unblocks the step named. Claude builds everything else in the meantime.

| # | What | Unblocks | Time |
|---|---|---|---|
| ~~1~~ | ~~Reload Scribe once~~: done 2026-11-01. Scribe now reloads and runs smoke tests by itself | — | — |
| 2 | Real call with `TEST_SCRIPT.md` (step 0 list) | Step 0 | 30 min |
| 3 | (Before release) Google Cloud: turn on the Picker API, create a picker key, create an OAuth web client; approve publishing the picker page, preferably on a separate page for Scribe rather than the personal site | Step 1 | 10 min |
| 4 | An OpenRouter account (free), or one API key you're happy to test with, typed by you into Scribe | Step 2 live and smoke checks | 5 min |
| 5 | Notion: create a public integration. Decide where its small sign-in server lives (free Cloudflare Worker or Vercel function): Notion has no secret-free sign-in | Step 3 | 15 min |
| 6 | GitHub: register an OAuth app with **device flow** on (no secret needed); give Claude its client ID. Linear: create an OAuth app | Step 4 | 5 min |
| 7 | Figma: create an OAuth app (private is fine for testing; public needs Figma's review) | Step 7 | 10 min |
| ~~8~~ | ~~Sign in to Overleaf in Chrome~~: done 2026-11-01. Claude made the "Scribe test" project; step 6 is built | — | — |

## Step 0. Make v0.5 solid (no new features)

Everything built on 2026-11-01:
- ChatGPT sign-in;
- the error cards;
- word-aware pauses;
- Smart requests without "Scribe";
- "which line?";
- the pause fix;
- names and photos;
- the hidden typing box.

**Simon:**
- Reload Scribe and the Meet tab, and check the header says v0.5.
- Sign in to Google again so Scribe can read your name and photo.

**Gate**
- [x] Unit tests pass (156).
- [x] Live checks: all 35 pass (2026-11-01). Smart and comment-on-a-line passed 3/3 runs.
- [x] Smoke test on Ollama: **40/40, 0 failed, 0 soft** (2026-11-01, run 5).
- [ ] Smoke test on ChatGPT. Skipped: no Plus or Pro account.
- [ ] Real call, `TEST_SCRIPT.md`:
  - [ ] sections 1–9;
  - [ ] the new rows: 3.4a–3.4e (Smart requests, comment on a line, the pause race) and 7.4–7.6 (pauses);
  - [ ] your own name and photo show instead of "You";
  - [ ] other people's photos show (needs a second person or a guest).
- [x] ⚑ Google permissions: in roadmap order (Simon confirmed the roadmap on 2026-11-01). Blocked on setup; see step 1.
- [x] ⚑ Zoom and Teams: waits (track B).

Automated parts are done. The real call is queued for Simon and doesn't block the build steps; failures found there get fixed as they come in.

## Step 1. Narrower Google permissions: moved to "Before release" (Simon, 2026-11-01)

Not needed for personal use, since the current access works. It's required before a public release (Chrome Web Store, and Google's review of the sensitive Docs, Sheets and Slides permissions). The plan below stands; it runs as the first item of "Before release".

Today Scribe can open every Doc, Sheet and Slides file you have. With `drive.file` plus Google's file picker, it only sees files you pick. Google then doesn't need to review the app, which is what makes open-sourcing realistic.

**Spike result (2026-11-01).**
- **Rejected: a sandboxed extension page.** The picker needs `allow-same-origin`, which sandboxed pages can't have.
- **Rejected: bundling the picker.** It's loaded from Google's servers, which MV3 forbids.
- **Chosen: a small web page on Simon's site.**
  1. Scribe opens the page in a tab.
  2. The page signs in with Google Identity Services, using a web client in the *same* Google Cloud project. Files picked there are granted to Scribe too, because `drive.file` grants are per project.
  3. It sends the picked file IDs back through `externally_connectable`.
  4. No token ever goes in a URL.

**Waiting on Simon** (credential and publishing steps; Claude doesn't do these alone):
- [ ] In your Google Cloud project, turn on the **Google Picker API**.
- [ ] Create an **API key** limited to the Picker API and the site's address.
- [ ] Create an **OAuth web client** whose JavaScript origin is the site's address. Add `http://localhost:8790` too, for testing.
- [ ] Approve publishing the picker page on the personal site (`shimeng-dnx.pages.dev`, which deploys on push to main), or name another host.

**Build:**
- add files through the picker;
- the "Open in this window" list keeps working for files already granted;
- a clear message for a file that wasn't picked.

**Gate:** the shared gate, plus:
- [ ] Sign in fresh. Scribe sees only picked files; a file not picked gives the "Pick it first" card.
- [ ] Smoke test passes on picked files.
- [ ] Sections 1–3 of the test script still pass.

## Step 2. Advanced: your own API key (v0.6). Built 2026-11-01; checks waiting on #4 above

Collapsed at the bottom of AI model, closed by default:
- **OpenRouter Connect** (one-click sign-in, free models with a daily limit): for people without ChatGPT Plus.
- **API keys:** OpenAI, Anthropic (the only allowed way to use Claude), Gemini, Groq.
- **Permissions on demand:** each service's address is an *optional* permission, requested only when someone turns it on, so the update doesn't disable anyone's Scribe.

**Status (2026-11-01):**
- [x] Built: a collapsed section in AI model; OpenRouter Connect; keys for Anthropic, OpenAI, Gemini and Groq; optional host permissions; error cards for bad keys, no credit and missing permission.
- [x] Unit tests: 162 pass, including a check that only one service's permission is asked for, straight from the click.
- [x] The normal build's manifest: the four services are `optional_host_permissions`. Nothing new is required.

**Gate:** the shared gate, plus:
- [ ] Turning Advanced on asks for that one service's permission. Nothing else asks.
- [ ] Live checks pass on OpenRouter (a free model) and on one paid key (Anthropic or OpenAI, using the research credits sparingly).
- [ ] Smoke test passes on OpenRouter.
- [ ] Removing a key, or turning Advanced off, returns to the previous model.

## Step 3. Notion (v0.7)

Notion pages, the way Docs work today:
- add under a heading;
- change text;
- comments, with credit as a comment;
- screenshots as images.

Notion databases work like Sheets: a new row, a cell change. Sign in with Notion; no key.

**Gate:** the shared gate, plus:
- [ ] Notion shows in Outputs. Connect, pick a page, see its headings.
- [ ] Smoke test: a new Notion section with 8 checks (add, change, comment, database row, screenshot, Ask before writing held, Comments only, Smart decision). All pass.
- [ ] Real call: a new `TEST_SCRIPT.md` section for Notion.

## Step 4. Tasks: Linear and GitHub Issues (v0.7.1)

Action items become tasks (title, owner, due date), from "Scribe, make that a task" or from Smart mode. Sign-in only.

**Gate:** the shared gate, plus:
- [ ] Smoke test: create, update and comment on a task in a test project for each service.
- [ ] Real call: three action items turn into three tasks with the right owners.

## Step 5. Obsidian (v0.7.2). Built 2026-11-01, ahead of steps 3–4, which wait on Simon

Meeting notes go into a folder of your vault, as Markdown. Pick the folder once; nothing to sign in. Scribe asks again if Chrome forgets the folder.

**Status (2026-11-01):**
- [x] Built:
  - **Choosing the vault:** Outputs › Obsidian ("Choose vault"); the folder handle is kept in IndexedDB, with a one-click "Allow" if Chrome forgets it.
  - **Notes:** "New note" creates `Meetings/YYYY-MM-DD <meeting>.md` with frontmatter and the sections Decisions, Action items, Open questions and Notes. Existing notes in `Meetings/` can be added.
  - **Edits:** adding under a heading (bullets kept), changing text, comments as `> [!comment]` callouts, credit as hidden `%% … %%`, and Comments only as "Proposed" callouts.
  - **Record all:** writes the note's Transcript.
  - **Screenshots:** linked under "Shared screen".
  - **Ask before writing:** holds changes in the panel.
- [x] Unit tests: 176 pass (Markdown editing, plus the note target on an in-memory vault, including parallel writes).
- [x] Smoke test section H: 7/7 in runs 8–10.

**Gate:** the shared gate, plus:
- [ ] Notes land in the picked folder, with the frontmatter and links Obsidian expects.
- [ ] The folder survives a browser restart, or Scribe asks again clearly.

## Step 6. Overleaf (v0.8). Built 2026-11-01

**Spike (done 2026-11-01, "Scribe test" project, free plan):**
- [x] Typing into the editor works. The page keeps its CodeMirror 6 editor in `window.overleaf.unstable.store` (`editor.view`, `editor.open_doc_name`); Scribe reaches it with `chrome.scripting.executeScript` in the page's own world. Edits save and sync like typing, and survive a reload.
- [x] Overleaf's real comments: not reliable from outside (selecting text doesn't bring up its comment box). Scribe comments on `% [Scribe] …` lines instead, which are in the source and never in the PDF.
- [x] Track changes is paid-only, so Ask before writing holds edits in the panel.

**Status (2026-11-01):**
- [x] Built:
  - **Adding:** Outputs › Overleaf lists projects open in Chrome; **Add** asks Chrome once for overleaf.com (`optional_host_permissions`, plus the `scripting` permission). Nothing else to sign in to: the tab is already signed in.
  - **Edits** (`lib/latex/tex.ts`, `targets/overleaf.ts`): add under `\section{…}` (as `\item` lines when the section ends in a list), change text, comment, credit, Comments only as "Proposed" lines, screenshots as a `% [Scribe]` line with the Drive link.
  - **LaTeX safety:** what people say is escaped (`% & $ # _ { } ~ ^ \`), and "change 30%" finds `30\%`. The AI is told to write plain words.
  - **Typing at the same time:** each edit is the smallest single change, and is only made if the file still reads as Scribe last saw it; otherwise Scribe reads again (3 tries). One edit at a time per project.
  - **Tab closed:** Scribe opens the project in a background tab and waits for the editor.
  - **Error cards:** not signed in, Chrome hasn't allowed Overleaf, not a `.tex` file, tab closed, file kept changing.
  - **Side fix:** screenshots for Obsidian and Overleaf no longer get a temporary public Drive link (only Docs and Slides need one to copy the picture).
- [x] Unit tests: 208 pass (LaTeX editing, plus the Overleaf target on a pretend tab: escaping, the `30\%` match, retry when someone types in between, the wrong-file guard, parallel edits, list indentation).
- [x] Live AI checks: 3/3 runs (plain words under `\section`, "change 30% to 35%", "add to the method list").
- [x] Smoke test section J, on the real "Scribe test" project: 9/9 in runs 13 and 14, ending with a reload (the edits were saved by Overleaf) and a clean compile. Run 12 found two test bugs (J7, J8), now fixed.
- [x] Full smoke run 14 (v0.8.0): 55/56, **0 failures**, 1 soft (A10, the usual "move it" judgement). F2 and C4 now name or accept the right file: with a Doc, a Sheet and a deck connected, "add a task" may fairly go to the Doc's Action items.

**Build:**
- add under `\section{…}`;
- change text;
- comments;
- LaTeX escaping (`% & _ # $`);
- "Ask before writing" holds edits in the panel (track changes is paid-only).

**Gate:** the shared gate, plus:
- [x] Unit tests for LaTeX escaping and section finding.
- [x] Smoke test on a free test project: the project still compiles after the changes (J8 compiles once at the end of section J).
- [ ] Real call: `TEST_SCRIPT.md` section 7c (research meeting, about 5 minutes).

## Step 7. Figma comments (v0.8.1)

Comments on a Figma file, pinned to a frame named out loud ("on the login screen"). Sign in with Figma.

**Gate:** the shared gate, plus a smoke section and a real-call design review.

## Step 8. GitHub pull-request comments (v0.8.2)

Review comments on a pull request, on a file or line named out loud. Uses the GitHub sign-in from step 4.

**Gate:** the shared gate, plus a smoke section on a test repository.

## Step 9. Claude and ChatGPT read the meeting (MCP connector): removed (Simon, 2026-11-01)

Built and tested on 2026-11-01 (a local MCP server with four read-only tools, and "Share with Claude" in Outputs), then removed at Simon's request: no MCP for now. The code is in the Trash (`scribe-connector-*`) if it's ever wanted again.

## Before release

**The public edition is Google-only (Simon, 2026-11-07).** The store and GitHub Releases get Google Meet → Google Docs, Sheets and Slides, with Sign in with ChatGPT or Chrome's built-in model. Obsidian, Overleaf, Ollama and API keys are switched off in that build, not deleted: they stay in the full edition (`SCRIBE_FULL=1`). See README › Editions.

1. **Step 1:** narrower Google permissions (`drive.file` and the hosted picker).
2. **Chrome Web Store listing:** privacy policy, screenshots, and a demo video.
3. **Ask OpenAI** whether Sign in with ChatGPT is fine inside an extension: the sign-in is caught from the tab, and tokens are kept in extension storage.
4. **A free sign-in for the public edition (open):** OpenRouter Connect is built (one-click, no key) but only in the full edition. Before it can join the public one: a live check with a real OpenRouter account, a free model as its default instead of `openrouter/auto`, and a model picker instead of the text field.

## Later, unscheduled

- Word, as an Office add-in with tracked changes.
- Comments on PDFs, through Hypothesis.
- Gmail recap drafts and Calendar follow-ups. Google reviews those permissions more strictly.

---

## Track B: Zoom and Teams in the browser ⚑ (waits for your decision)

One caption reader per site, reusing everything else. **Spike first, in a real call:** do captions show in the browser version, and do they carry speaker names?
- **Zoom web** (`app.zoom.us`).
- **Teams web** (`teams.microsoft.com`).

Each gets the shared gate, a smoke section where possible, and a real call on that platform. Desktop apps are out of scope.
