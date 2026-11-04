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
import type { CaptureReply, MeetState, ToMeet, ToPanel } from "@/lib/messages";

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

/** The text in this tile that mentions presenting, if any. */
function presentingLabel(tile: Element): string | null {
  const walker = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
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
  const videos = Array.from(document.querySelectorAll("video")).filter(
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

export default defineContentScript({
  matches: ["https://meet.google.com/*"],
  runAt: "document_idle",
  main(ctx) {
    const state: MeetState = { status: "waiting", title: null, userName: null, paused: false, screen: null, autoCapture: false };
    const send = (msg: ToPanel) => {
      chrome.runtime.sendMessage(msg).catch(() => {
        // The side panel is closed. Nothing to do.
      });
    };
    const publish = () => send({ type: "meet/state", state: { ...state } });

    const segmenter = new Segmenter(
      (u) => {
        // While paused, lines still reach the panel (in this browser only) so "Scribe, resume" works;
        // the panel drops everything else and sends none of it to the AI.
        send({ type: "meet/final", speaker: u.speaker, text: u.text, at: u.at, ...(state.paused ? { paused: true } : {}) });
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
      if (msg.type === "meet/get-state") reply({ ...state });
      if (msg.type === "meet/set-paused") {
        state.paused = msg.paused;
        if (msg.paused) segmenter.flush();
        publish();
        reply({ ...state });
      }
      if (msg.type === "meet/capture") reply(capture());
      if (msg.type === "meet/set-auto-capture") {
        state.autoCapture = msg.on;
        watcher.reset();
        publish();
        reply({ ...state });
      }
      return false;
    });

    const symbolsWithText = (text: string) =>
      Array.from(document.querySelectorAll(SELECTORS.GOOGLE_SYMBOLS)).filter((el) => el.textContent === text);

    const poll = (test: () => boolean, everyMs = 250) =>
      new Promise<void>((resolve) => {
        const id = ctx.setInterval(() => {
          if (test()) {
            clearInterval(id);
            resolve();
          }
        }, everyMs);
      });

    // Your own name, shown before you join. Meet labels your captions "You".
    const nameTimer = ctx.setInterval(() => {
      const name = document.querySelector(SELECTORS.USER_NAME)?.textContent?.trim();
      if (name) {
        state.userName = name;
        clearInterval(nameTimer);
        publish();
      }
    }, 500);

    publish();

    // The "end call" button appears once you're in the call (not in the lobby).
    poll(() => symbolsWithText(SELECTORS.TEXT_CALL_END).length > 0).then(async () => {
      state.status = "in-call";
      state.title = document.querySelector(SELECTORS.MEETING_TITLE)?.textContent?.trim() || null;
      publish();

      // Turn captions on if they're off. Pressing "c" toggles them, so only press when the button says "off".
      await poll(() => symbolsWithText(SELECTORS.TEXT_CAPTIONS_OFF).length > 0 || !!document.querySelector(SELECTORS.TRANSCRIPT_REGION), 400);
      if (symbolsWithText(SELECTORS.TEXT_CAPTIONS_OFF).length > 0 && !document.querySelector(SELECTORS.TRANSCRIPT_REGION)) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", bubbles: true }));
      }
      watchCaptions();

      // Leaving the call.
      const endButton = symbolsWithText(SELECTORS.TEXT_CALL_END)[0]?.parentElement?.parentElement;
      endButton?.addEventListener("click", () => {
        segmenter.flush();
        state.status = "ended";
        publish();
      });
    });

    // Meet sometimes replaces the caption region; re-attach every 2 seconds if it did.
    function watchCaptions() {
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

      const check = () => {
        if (state.status === "ended") return;
        const region = document.querySelector(SELECTORS.TRANSCRIPT_REGION);
        if (!region) {
          if (state.status === "listening") {
            state.status = "in-call";
            state.detail = "Captions are off. Press c in Meet to turn them on.";
            publish();
          }
          return;
        }
        if (region !== target || !target?.isConnected) {
          segmenter.flush();
          observer?.disconnect();
          target = region;
          observer = new MutationObserver(onMutations);
          observer.observe(region, { childList: true, subtree: true, characterData: true });
        }
        if (state.status !== "listening") {
          state.status = "listening";
          state.detail = undefined;
          publish();
        }
      };
      check();
      ctx.setInterval(check, 2000);
    }

    ctx.onInvalidated(() => segmenter.flush());
  },
});
