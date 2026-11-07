// Reads Google Meet's own live captions, with speaker names, and sends each
// finished line to Scribe's side panel. No audio is captured here.
//
// It also finds the shared screen (a presentation tile) and copies stills of it
// when asked, or by itself when "Save each new slide" is on.
//
// The DOM approach (caption region selector, which block is "current", where the
// speaker name sits, pressing "c" to turn captions on, re-attaching when Meet
// replaces the region) follows TranscripTonic by Vivek G, MIT licence:
// https://github.com/vivek-nexus/transcriptonic (extension/content-scripts/google-meet).
// Meet changes its page often; when captions stop arriving, check these selectors
// against TranscripTonic's latest config.js first.

import { Segmenter } from "@/lib/segmenter";
import { SAMPLE_H, SAMPLE_W, SlideWatcher, signature } from "@/lib/screen/watch";
import type { CaptureReply, MeetState, MissedLine, ToMeet, ToPanel } from "@/lib/messages";

const SELECTORS = {
  USER_NAME: ".awLEm",
  MEETING_TITLE: ".u6vdEc",
  GOOGLE_SYMBOLS: ".google-symbols",
  TEXT_CALL_END: "call_end",
  TEXT_CAPTIONS_OFF: "closed_caption_off",
  TRANSCRIPT_REGION: 'div[role="region"][tabindex="0"]',
};

// Meet shows a shared screen as its own video tile, labelled "<name> (Presentation)"
// or "<name> is presenting". English labels only, and not yet checked against every
// Meet layout: if screenshots stop working, start here.
const PRESENTING = /\(presentation\)|\bis presenting\b|\bpresenting\b|\bpresentation\b/i;
const STILL_MAX_WIDTH = 1600;
/** Lines kept while the side panel is closed: about a long day of talk. */
const MISSED_MAX = 3000;

/** The Meet code in the address, which tells one meeting from another. */
const meetCode = () => /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:$|[/?#])/.exec(location.pathname)?.[1] ?? null;

/** The text in this tile that mentions presenting, if any. */
function presentingLabel(tile: Element): string | null {
  const walker = tile.ownerDocument.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent?.trim() ?? "";
    if (t && PRESENTING.test(t)) return n.parentElement?.textContent?.trim() || t;
  }
  return null;
}

function presenterFrom(label: string, me: string | null): string | null {
  if (/^you\b/i.test(label)) return me;
  const name = label.replace(PRESENTING, "").replace(/[()]/g, "").replace(/\s+/g, " ").trim();
  return name && name.length <= 60 ? name : null;
}

function findPresentation(me: string | null): { video: HTMLVideoElement; presenter: string | null } | null {
  const videos = (findAll("video") as HTMLVideoElement[]).filter(
    (v) => v.readyState >= 2 && v.videoWidth > 0 && v.getBoundingClientRect().width > 0
  );
  for (const video of videos) {
    // Climb to the tile: the largest ancestor that holds only this video.
    let el: Element | null = video.parentElement;
    for (let i = 0; el && i < 8; i++, el = el.parentElement) {
      if (el.querySelectorAll("video").length > 1) break;
      const label = presentingLabel(el);
      if (label) return { video, presenter: presenterFrom(label, me) };
    }
  }
  return null;
}

/**
 * The Meet page, plus Meet's picture-in-picture window when it's open: Meet moves its call controls,
 * captions and video tiles there when you switch to another tab.
 */
function meetDocs(): Document[] {
  try {
    const pip = (window as unknown as { documentPictureInPicture?: { window: Window | null } }).documentPictureInPicture?.window;
    return pip?.document ? [document, pip.document] : [document];
  } catch {
    return [document];
  }
}
const find = (selector: string): Element | null => meetDocs().map((d) => d.querySelector(selector)).find(Boolean) ?? null;
const findAll = (selector: string): Element[] => meetDocs().flatMap((d) => Array.from(d.querySelectorAll(selector)));
const symbolsWithText = (text: string) => findAll(SELECTORS.GOOGLE_SYMBOLS).filter((el) => el.textContent === text);

export default defineContentScript({
  matches: ["https://meet.google.com/*"],
  runAt: "document_idle",
  main(ctx) {
    const state: MeetState = { status: "waiting", title: null, userName: null, paused: false, screen: null, autoCapture: false, code: meetCode(), joinedAt: null, leftAt: null };
    const send = (msg: ToPanel, closed?: () => void) => {
      // A newer copy of this script took over the tab (Scribe was updated or put it in again): stay quiet.
      if (ctx.isInvalid) return;
      chrome.runtime.sendMessage(msg).catch(() => {
        // The side panel is closed.
        closed?.();
      });
    };
    const publish = () => {
      state.code = meetCode();
      send({ type: "meet/state", state: { ...state } });
    };

    // Finished lines said while the panel is closed, handed over when it opens again (meet/take-missed).
    const missed: MissedLine[] = [];

    const segmenter = new Segmenter(
      (u) => {
        // While paused, lines still reach the panel (in this browser only) so "Scribe, resume" works;
        // the panel drops everything else and sends none of it to the AI. Paused lines are never kept.
        const paused = state.paused;
        send({ type: "meet/final", speaker: u.speaker, text: u.text, at: u.at, ...(paused ? { paused: true } : {}) }, () => {
          if (paused) return;
          missed.push({ speaker: u.speaker, text: u.text, at: u.at });
          if (missed.length > MISSED_MAX) missed.shift();
        });
      },
      (p) => {
        if (state.paused) return;
        send(p ? { type: "meet/partial", speaker: p.speaker, text: p.text } : { type: "meet/clear-partial" });
      }
    );

    /* ---------- shared screen ---------- */

    const watcher = new SlideWatcher();
    const sampler = document.createElement("canvas");
    sampler.width = SAMPLE_W;
    sampler.height = SAMPLE_H;
    const sampleCtx = sampler.getContext("2d", { willReadFrequently: true });

    const capture = (): CaptureReply => {
      const p = findPresentation(state.userName);
      if (!p) return { ok: false, error: "Nobody is sharing their screen, or Scribe can’t find the shared screen in Meet." };
      try {
        const scale = Math.min(1, STILL_MAX_WIDTH / p.video.videoWidth);
        const width = Math.round(p.video.videoWidth * scale);
        const height = Math.round(p.video.videoHeight * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(p.video, 0, 0, width, height);
        return { ok: true, frame: { dataUrl: canvas.toDataURL("image/jpeg", 0.85), width, height, presenter: p.presenter, at: Date.now() } };
      } catch (e) {
        return { ok: false, error: `Couldn’t copy the shared screen: ${e instanceof Error ? e.message : String(e)}` };
      }
    };

    // Every 1.5 s: is someone presenting, and (when on) is this a new slide?
    ctx.setInterval(() => {
      if (state.status !== "in-call" && state.status !== "listening") return;
      const p = findPresentation(state.userName);
      const screen = p ? { presenter: p.presenter } : null;
      if (JSON.stringify(screen) !== JSON.stringify(state.screen ?? null)) {
        state.screen = screen;
        if (!p) watcher.reset();
        publish();
      }
      if (!p || !state.autoCapture || state.paused || !sampleCtx) return;
      try {
        sampleCtx.drawImage(p.video, 0, 0, SAMPLE_W, SAMPLE_H);
        if (watcher.push(signature(sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data), Date.now())) {
          const r = capture();
          if (r.ok) send({ type: "meet/screen", frame: r.frame });
        }
      } catch {
        // The video isn't ready yet. Try again next tick.
      }
    }, 1500);

    chrome.runtime.onMessage.addListener((msg: ToMeet, _sender, reply) => {
      if (ctx.isInvalid) return false;
      if (msg.type === "meet/get-state") reply({ ...state });
      if (msg.type === "meet/set-paused") {
        state.paused = msg.paused;
        if (msg.paused) segmenter.flush();
        publish();
        reply({ ...state });
      }
      if (msg.type === "meet/capture") reply(capture());
      if (msg.type === "meet/take-missed") reply(missed.splice(0));
      if (msg.type === "meet/set-auto-capture") {
        state.autoCapture = msg.on;
        watcher.reset();
        publish();
        reply({ ...state });
      }
      return false;
    });

    // Your own name, shown before you join. Meet labels your captions "You".
    const nameTimer = ctx.setInterval(() => {
      const name = find(SELECTORS.USER_NAME)?.textContent?.trim();
      if (name) {
        state.userName = name;
        clearInterval(nameTimer);
        publish();
      }
    }, 500);

    publish();

    /* ---------- in the call or not ---------- */

    // Captions being read: the caption region, the observer on it, and an ID per caption block.
    let target: Element | null = null;
    let observer: MutationObserver | null = null;
    const blockIds = new WeakMap<Element, string>();
    let nextId = 1;
    const idFor = (el: Element) => {
      let id = blockIds.get(el);
      if (!id) {
        id = `b${nextId++}`;
        blockIds.set(el, id);
      }
      return id;
    };

    // Each speaker's photo, from the image Meet puts next to their captions.
    const avatars = new Map<string, string>();
    const noteAvatar = (block: Element, speaker: string) => {
      const url = block.querySelector("img")?.getAttribute("src");
      if (!url || !/^https:\/\//.test(url) || avatars.get(speaker) === url) return;
      avatars.set(speaker, url);
      send({ type: "meet/avatar", speaker, url });
    };

    const onMutations = (mutations: MutationRecord[]) => {
      for (const m of mutations) {
        if (m.type !== "characterData") continue;
        const textEl = m.target.parentElement;
        const block = textEl?.parentElement;
        const blocks = block?.parentElement ? Array.from(block.parentElement.children) : [];
        // The last two children are not captions; the one before them is the live block.
        // Meet also edits older blocks to fix words; those are ignored.
        if (!block || blocks[blocks.length - 3] !== block) continue;
        let speaker = textEl?.previousSibling?.textContent?.trim() ?? "";
        const text = textEl?.textContent ?? "";
        if (speaker === "You" && state.userName) speaker = state.userName;
        if (speaker) noteAvatar(block, speaker);
        if (speaker && text) segmenter.update(idFor(block), speaker, text);
        else segmenter.flush();
      }
    };

    // Meet sometimes replaces the caption region, or moves it into its picture-in-picture window.
    const attach = (region: Element) => {
      if (region === target && target.isConnected) return;
      segmenter.flush();
      observer?.disconnect();
      target = region;
      observer = new MutationObserver(onMutations);
      observer.observe(region, { childList: true, subtree: true, characterData: true });
    };
    ctx.onInvalidated(() => observer?.disconnect());

    const leave = () => {
      if (state.status !== "in-call" && state.status !== "listening") return;
      segmenter.flush();
      state.status = "ended";
      state.leftAt = Date.now();
      state.detail = undefined;
      publish();
    };

    /**
     * Once a second: are you in the call, and are captions on? In the call means the call's controls
     * or its captions can be seen, in the Meet page or in Meet's picture-in-picture window (where Meet
     * moves them when you switch to another tab). So joining, rejoining, picture-in-picture, and Scribe
     * being put into a tab mid-call all end up right. Gone for two checks in a row means you left.
     */
    let absent = 0;
    let pressedC = false;
    let endButton: Element | null = null;
    const tick = () => {
      if (ctx.isInvalid) return;
      const region = find(SELECTORS.TRANSCRIPT_REGION);
      const controls = symbolsWithText(SELECTORS.TEXT_CALL_END);
      if (!region && controls.length === 0) {
        if ((state.status === "in-call" || state.status === "listening") && ++absent >= 2) {
          absent = 0;
          leave();
        }
        return;
      }
      absent = 0;
      if (state.status !== "in-call" && state.status !== "listening") {
        // Joined, rejoined, or Scribe arrived mid-call.
        state.joinedAt = Date.now();
        state.title = find(SELECTORS.MEETING_TITLE)?.textContent?.trim() || state.title;
        pressedC = false;
      }
      if (region) attach(region);
      // Turn captions on if they're off. Pressing "c" toggles them, so only when the button says "off", once per join.
      if (!region && !pressedC && symbolsWithText(SELECTORS.TEXT_CAPTIONS_OFF).length > 0) {
        pressedC = true;
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", bubbles: true }));
      }
      const status = region ? "listening" : "in-call";
      const detail = region ? undefined : "Captions are off. Press c in Meet to turn them on.";
      if (state.status !== status || state.detail !== detail) {
        state.status = status;
        state.detail = detail;
        publish();
      }
      // Leaving by the call's own button.
      const button = controls[0]?.parentElement?.parentElement ?? null;
      if (button && button !== endButton) {
        endButton = button;
        button.addEventListener("click", leave, { once: true });
      }
    };
    tick();
    ctx.setInterval(tick, 1000);

    ctx.onInvalidated(() => segmenter.flush());
  },
});
