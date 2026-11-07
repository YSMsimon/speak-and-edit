# Speak and Edit

An open-source Chrome extension for Google Meet. Say an edit during the call ("Scribe, add Postgres 16 to Decisions") and it lands in your Google Doc, Sheet, Slides, Obsidian note or Overleaf project, credited to whoever said it. It reads Meet's own captions, so nothing records the audio, and the AI can be your ChatGPT plan, Ollama's free cloud models, or Chrome's built-in model.

"Scribe" is what you call it in the call: the wake word, which you can change. Smart mode doesn't need it at all.

Status: v0.9, in development. Unit-tested, the prompts are checked against a real model, and an end-to-end smoke test runs against real Google files and an Overleaf project. Not yet used in a full live call.

## What works

- **Reading the call:** Google Meet's live captions, with speaker names. Scribe turns captions on when you join. No audio is captured.
- **Three listening modes** (picker at the bottom-left of the Live tab):
  - **Commands:** acts only on lines that start with the wake word (default "Scribe").
  - **Smart:** the model reads every line and records decisions, action items, open questions and facts on its own. Ordinary discussion is left alone.
    - **Requests without "Scribe":** "Can you take a screenshot?", "add a comment saying thanks", "switch to command mode". Requests aimed at a named person ("Priya, can you…") are not.
    - **Wake-word requests:** they still work.
- **Comments on a named line:** "comment on the line about the beta, saying check with Wei". The comment says only "Check with Wei". If Meet mishears the line, Scribe picks the Doc line that shares the most words, and word pairs in order. When two lines are close, it asks "Which line did you mean?" with the real lines as the answers. Follow-up questions only ever offer real things from the files.
- **Transcript is Record all's:** Smart mode and requests that name no section never write into it. Notes with no section go at the end of the doc, before Transcript.
- **Pausing:** anything said while a pause request was still being worked out is dropped too, as if it was said while paused.
- **Typing:** Scribe is voice-first. The text box stays hidden behind a keyboard button at the bottom right, for when Meet mishears or you can't speak aloud. Sending, ✕ or Esc closes it.
- **Version:** hover the logo to see the version and build time ("v0.9 · 18:24"), so you can tell a reload took.
- **Obsidian** (v0.7): Outputs › Obsidian. Choose your vault folder once, then "New note" makes a meeting note in `Meetings/`, or add existing notes. Scribe adds under headings, changes text, comments as `> [!comment]` callouts, keeps credit hidden as `%% … %%`, and Record all writes the note's Transcript. Files stay on your computer; nothing to sign in to.
- **Overleaf** (v0.8): Outputs › Overleaf lists the projects open in this Chrome; **Add** asks Chrome once for overleaf.com. Scribe edits the `.tex` file open in the project's tab, through Overleaf's own editor, so Overleaf saves it and co-authors see it live. It adds under `\section{…}` (as `\item` lines when the section ends in a list), changes text, and comments and credits on `% [Scribe] …` lines, which are in the source and never in the PDF. What people say is made safe for LaTeX (`30%` becomes `30\%`; `& $ # _ { }` likewise), and "change 30% to 35%" finds `30\%`. If the tab is closed, Scribe opens it in the background. Screenshots go in as a `% [Scribe]` line with the Drive link. Track changes is a paid Overleaf feature, so Ask before writing holds changes in the panel. Overleaf's real comments aren't used: its editor gives no reliable way in. The `scripting` permission is only used on Overleaf tabs.
- **Use your own API key** (v0.6): collapsed at the bottom of AI model. OpenRouter Connect, or keys for Anthropic (the only allowed way to use Claude), OpenAI, Gemini and Groq. Each service's permission is asked for only when you first use it.
- **Names and photos:** each line shows the speaker's name and the photo Meet shows next to their captions. Your own lines use your Google account name and photo (the `userinfo.profile` permission) instead of Meet's "You". Meet often hears "Scribe!" as "Subscribe!"; that counts when it's said like a name.
  - **Record all:** no model. Every line goes into a "Transcript" section at the end of a chosen Doc, written in batches.
- **Approval** (picker next to it): **Auto** writes straight into the file. **Ask before writing** puts Docs edits in as suggestions to accept or reject (in the panel or the Doc); anything that can't be a suggestion (Sheets, Slides, transcript lines, screenshots) waits in the panel for Approve. "Approve all" clears the queue. Comments go straight in either way. New installs start on Ask before writing.
- **Changing Scribe by voice** (v0.4): a control tool with five parameters (mode, file to work on, approval, listening, video recording). "Scribe, switch to Smart mode", "work on the tracker", "use any file", "let me approve changes first", "make the edits directly", "pause", "resume", "start/pause/resume/stop recording". Several at once work too. "Scribe, resume" is matched without the AI, since nothing said during a pause goes to the model. Starting a video needs the request to mention the video, the recording, the screen or the call, so "record everything" means Record all mode. People set to comments only can't change settings.
- **Working file** (Outputs › Work on, or by voice): requests that don't name a file go there, and Smart mode writes only there.
- **Files:** Google Docs, Sheets and Slides, several at once. The model picks the right file per request. Any Doc, Sheet or Slides file open in the window is offered with one click.
  - **Docs:** suggestions (SUGGEST write mode) or direct edits, comments, and a Transcript section.
  - **Sheets:** new rows lined up with the header, cell changes, and credit as cell notes. An overwritten cell keeps its old value in the note.
  - **Slides:** bullets, text replaced on one slide, new slides, and credit in speaker notes.
- **How changes land:** edit the file (the approval picker decides how), or comments only.
- **Shared screen** (v0.3, Live tab, when someone presents):
  - **Read it into files:** "Scribe, add this table to the tracker". A model that can see pictures reads the screen and writes text: Sheet rows, Doc lines, slide bullets. Ollama uses `gemma4:31b-cloud` for this (free); `gpt-oss` can't see pictures.
  - **Screenshots:** "Scribe, screenshot this into the deck", or the Screenshot button. Slides get a new slide with the picture; Docs get it under a "Shared screen" heading; Sheets get a link in a "Scribe captures" tab.
  - **Save each new slide:** a switch. Scribe saves the screen whenever it changes and then holds still, so a playing video or a moving cursor isn't saved over and over.
  - **Record:** records the Meet tab with sound, from a click only. Saved to Drive; Slides embed it, Docs and Sheets link to it. Your own microphone isn't in the recording (Meet doesn't play you back to yourself), and Meet doesn't tell anyone, so say you're recording.
  - **Where originals go:** a "Scribe captures" folder in your Drive. Scribe can only see files it created (`drive.file`).
  - **Public for seconds:** Docs and Slides only copy a picture from a public link, so each picture is shared by link while Google copies it, then the link is switched off. If switching it off fails, the card says so with the file's link.
- **People:** each speaker can edit, comment only, or be ignored.
- **AI, with no API keys:**
  - **ChatGPT:** your own Plus or Pro plan, through OpenAI's "Sign in with ChatGPT" (preview).
  - **Ollama:** free cloud models, nothing downloaded.
  - **The browser's built-in model:** Gemini Nano in Chrome, Phi-4-mini in Edge.
  - **No Auto:** you pick one. Ollama is the default, and signing in with ChatGPT switches to it.
  - **Reading the shared screen:** all three can do it (Ollama through `gemma4:31b-cloud`).
  - **Not possible:** Claude and Gemini subscriptions, because Anthropic requires its approval for apps that offer Claude login and Google has no route for apps. API keys (OpenRouter, OpenAI, Anthropic, Gemini, Groq) were removed in v0.5 to keep setup simple.
- **How "Sign in with ChatGPT" differs from OpenAI's docs**, which are written for desktop apps:
  - **The sign-in reply:** OpenAI expects it at a program listening on `127.0.0.1`. Scribe reads it from the tab's address instead; PKCE makes the code useless to anything else.
  - **The tokens:** Scribe keeps them in extension storage, which web pages can't read. OpenAI asks for them to stay out of browser storage.
  - Ask OpenAI before a public launch.

Planned: Zoom and Teams web, Claude through MCP, Notion, GitHub, Word, PDF.

## Install

Download `speak-and-edit-<version>-chrome.zip` from [Releases](https://github.com/YSMsimon/speak-and-edit/releases) and unzip it. In Chrome, open `chrome://extensions`, turn on Developer mode, click Load unpacked and pick the unzipped folder. 0.x versions are pre-releases; a Chrome Web Store listing comes later. Until Google reviews the app, Google Docs, Sheets and Slides sign-in only works for accounts added as testers.

## Build and load

```sh
pnpm install
cp .env.example .env      # add your Google client ID, see below
pnpm build                # output in .output/chrome-mv3
pnpm test                 # unit tests
SCRIBE_LIVE=1 pnpm test   # also runs 4 requests against a real model (Ollama cloud, nothing downloaded)
```

In Chrome: `chrome://extensions` → Developer mode → Load unpacked → pick `.output/chrome-mv3`. Click the toolbar icon to open the side panel. Note the extension's ID on that page: Google sign-in is tied to it. To keep the same ID on every computer, put a public key in `.keys/public-key.b64` (git-ignored) and the build adds it to the manifest.

`pnpm dev` starts a live-reloading build in a separate Chrome profile.

To publish a release: `pnpm release 0.9.1`. It tests, builds and scans the zip, then tags and uploads it to GitHub Releases after you answer y. Add `--dry-run` to stop before anything is committed or pushed.

## Google sign-in (one-time)

1. In Google Cloud Console, pick or create a project. Billing isn't needed.
2. APIs & Services → Library → enable **Google Docs API**.
3. OAuth consent screen → External → add your own Google account under **Test users**. Add the scope `https://www.googleapis.com/auth/documents`.
4. Credentials → Create credentials → OAuth client ID → **Chrome extension** → Item ID: your extension's ID from `chrome://extensions`.
5. Put the client ID in `.env` as `WXT_GOOGLE_CLIENT_ID`, then `pnpm build` and reload the extension.

Scribe asks for the full `documents`, `spreadsheets` and `presentations` scopes so you can use any file. That scope needs Google's app verification before the public can use it. The plan before a public release is to switch to `drive.file` plus Google Picker, which needs no verification.

## Ollama

The default Ollama model is `gpt-oss:120b-cloud`, one of Ollama's free cloud models (also `gemma4:31b-cloud` and `gpt-oss:20b-cloud`). In a live check on 2026-11-01, 120b and gemma4 handled all four test requests; 20b sometimes guessed instead of asking when a request was ambiguous. They run on Ollama's servers through the signed-in Ollama app, so nothing is downloaded. Scribe never pulls models.

These models don't enforce a JSON schema, so for Ollama Scribe puts the exact keys in the prompt, parses the reply leniently, and retries once.

Ollama blocks browser extensions until you allow this one:

```sh
launchctl setenv OLLAMA_ORIGINS chrome-extension://<your-extension-id>
```

Then quit and reopen Ollama. Don't use `*`: that lets every website reach Ollama.

### Shared screen: what isn't verified yet

- **Finding the shared screen in Meet** relies on the tile's English label ("(Presentation)" / "is presenting"). Checked against nothing live yet.
- **Which Drive link Google can copy from:** Scribe tries `drive.google.com/uc?export=download&id=…`, then `lh3.googleusercontent.com/d/…`, then falls back to a linked caption.
- **Recording:** Chrome allows tab recording only after Scribe was opened on that tab (click its icon while on Meet). Otherwise Chrome's own picker asks which tab to share.
- **Background tab:** stills may be stale if the Meet tab is hidden; keep Meet visible when you take one.

## When a spoken line counts as finished

Scribe reads Meet's captions as they grow, word by word. A line ends when the captions stop changing, or when someone else starts talking. How long Scribe waits depends on the last words (`src/lib/segmenter.ts`):

| The line ends with | Wait | Why |
|---|---|---|
| A full stop, question mark or exclamation mark | 0.7 s | Meet already heard the sentence end |
| Anything else | 1.2 s | No clue either way |
| A comma, or a word like "to", "and", "the", "um" | 2.0 s | The speaker is mid-thought |

A single shorter wait would cut sentences in half:
- **Heldner & Edlund (2010)** found that 56–60% of the pauses inside one person's speech last 0.5 s or more, and 28–31% last 1 s or more.
- **Campione & Véronis (2002)** found that only 2.8% last over 2 s.
- **A cut request is worse than a slow one:** its second half has no wake word, so it would be lost.

If a line is only "Scribe,", the same speaker's next line within 8 seconds counts as the request, even if someone else talks in between.

## Errors

Every failure is turned into one shape (`src/lib/problems.ts`):
- a short title, and one line saying why or what to do;
- buttons that fix it: Try again, Open AI model, Continue with ChatGPT, Use Ollama, Sign in to Google, Reload Meet, and others;
- the raw message under **Details**.

The same card (`src/sidepanel/problem.tsx`, glasscn's Glass Alert) is used everywhere:

| Where | When | Example |
|---|---|---|
| Top of Live (banner, one at a time, dismissible) | Something stops Scribe working: the chosen AI isn't ready (checked every minute), or a file can't be read | "Ollama isn't running": Get Ollama |
| Under the line that failed (conversation) | A request couldn't be done | "You can't edit this file": Open Outputs; spoken and typed lines get **Try again** |
| Inside the row or bar that failed | Sign-in, Test, connecting a file, recording | "Couldn't connect ChatGPT": Try again · Use Ollama |
| Toast (bottom, two lines, no buttons) | Confirmations only | "Ollama works", "Signed out of ChatGPT" |

Colours and icons:
- **Errors:** red, with a circle-alert icon.
- **Warnings:** amber, with a triangle icon. Examples: a usage limit, Google slowing Scribe down.
- **Info:** grey, with an info icon. Examples: "No file connected", "Scribe needs more detail".

## End-to-end smoke test

Runs real requests through the engine, the real AI and the real Google APIs, on new files it creates in a "Scribe smoke test …" folder in your Drive, and reads every result back from Google. It deletes nothing.

```sh
SCRIBE_SMOKE=1 pnpm wxt build     # normal builds leave the smoke page out
```

Reload Scribe on `chrome://extensions`, then open `chrome-extension://<your-extension-id>/smoke.html?run=1` (add `&provider=ollama` to force a provider). 40 checks across all modes, approval, the control tool, comments-only, Sheets/Slides/Docs, screenshots (checked private afterwards), auto-capture and recordings. It can't reach Meet itself: captions, finding the shared screen and tab capture still need a live call.

Results on 2026-11-01: 23/40 with Chrome's built-in Gemini Nano; 39/40 with Ollama `gpt-oss:120b-cloud` + `gemma4:31b-cloud` after the fixes the earlier runs found.

## Testing in a real call

[TEST_SCRIPT.md](TEST_SCRIPT.md) has lines to read aloud in a Meet call, with the expected result for each mode and setting.

## How it fits together

- `src/entrypoints/meet.content.ts`: reads captions in the Meet tab and sends finished lines to the panel.
- `src/lib/segmenter.ts`: turns live caption updates into finished lines.
- `src/lib/wake.ts`: fuzzy wake-word match.
- `src/lib/engine.ts`: handles one line at a time: mode → model → proposal → approval → file target.
- `src/lib/targets/`: Docs, Sheets and Slides, each behind the same interface.
- `src/lib/ai/`: providers and the two model jobs (parse a request, decide whether a line is worth a comment).
- `src/lib/docs/`: reads the doc into sections and computes the API requests. The model never picks indexes.
- `src/sidepanel/`: the side panel UI.

The UI is library components (glasscn, Vercel AI Elements, shadcn/ui) restyled with Tailwind to the Speak and Edit design; the brand logos come from Iconify sets. See `THIRD_PARTY.md`.
