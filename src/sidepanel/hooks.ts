import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { checkProvider, modelFor, resolveProvider, visionModelFor } from "@/lib/ai/providers";
import { normalizeError } from "@/lib/problems";
import { ensureFolder, sharePublicly, upload, type DriveIO } from "@/lib/drive";
import { defaultAi, Engine, type EngineState, type RecordingDone } from "@/lib/engine";
import { batchUpdate, fetchOutline, getGoogleProfile, getGoogleToken, googleFetch, isRevisionConflict } from "@/lib/google";
import { docsTarget } from "@/lib/targets/docs";
import { notesTarget } from "@/lib/targets/notes";
import { overleafTarget } from "@/lib/targets/overleaf";
import { readProject, writeProject } from "@/lib/overleaf/tab";
import { loadVault, vaultAccess } from "@/lib/notes/vault";
import { sheetsTarget } from "@/lib/targets/sheets";
import { slidesTarget } from "@/lib/targets/slides";
import type { CaptureReply, MeetState, ToMeet, ToPanel } from "@/lib/messages";
import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, saveSettings, type ProviderId, type Settings } from "@/lib/settings";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(settings);
  useEffect(() => {
    loadSettings().then((s) => {
      ref.current = s;
      setSettings(s);
      setLoaded(true);
    });
    return onSettingsChanged((s) => {
      ref.current = s;
      setSettings(s);
    });
  }, []);
  const update = useCallback((patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => {
    const next = { ...ref.current, ...(typeof patch === "function" ? patch(ref.current) : patch) };
    ref.current = next;
    setSettings(next);
    void saveSettings(next);
  }, []);
  return { settings, update, loaded, ref };
}

/** Caches "auto" provider resolution for 30 s so each line doesn't re-probe Ollama. */
function cachedResolver() {
  let cache: { key: string; id: ProviderId | null; at: number } | null = null;
  return async (s: Settings) => {
    const key = JSON.stringify([s.provider, s.models, s.chatgptAccount, s.ollamaUrl]);
    if (cache && cache.key === key && Date.now() - cache.at < 30_000) return cache.id;
    const id = await resolveProvider(s.provider, s);
    cache = { key, id, at: Date.now() };
    return id;
  };
}

const driveIO: DriveIO = {
  token: () => getGoogleToken(false).catch(() => getGoogleToken(true)),
  fetch: (input, init) => fetch(input, init),
};

/** What the control tool can switch that lives outside the engine. App fills in the recorder. */
export interface Controls {
  recording: (action: "start" | "stop" | "pause" | "resume") => Promise<string>;
  recordingState: () => "off" | "on" | "paused";
}

const NO_CONTROLS: Controls = {
  recording: async () => {
    throw new Error("Recording isn’t available yet. Open the Live tab and try again.");
  },
  recordingState: () => "off",
};

export function useEngine(settingsRef: React.MutableRefObject<Settings>, update: (patch: Partial<Settings>) => void) {
  const meetTabRef = useRef<number | null>(null);
  const controlsRef = useRef<Controls>(NO_CONTROLS);
  const pauseRef = useRef<(paused: boolean) => Promise<void>>(async () => undefined);
  const engine = useMemo(() => {
    const docs = docsTarget({ fetchOutline, batchUpdate, isRevisionConflict });
    const notes = notesTarget({
      root: async () => {
        const vault = await loadVault();
        if (!vault) throw new Error("Choose your Obsidian vault folder in Outputs first.");
        if (!(await vaultAccess(vault, false))) throw new Error("Chrome needs your OK to use the Obsidian vault again. Open Outputs › Obsidian and click Allow.");
        return vault;
      },
    });
    let folder: string | null = null; // checked once per session
    return new Engine({
      settings: () => settingsRef.current,
      targets: { doc: docs, sheet: sheetsTarget(googleFetch), slides: slidesTarget(googleFetch), note: notes, tex: overleafTarget({ read: readProject, write: writeProject }) },
      appendTranscript: (file, lines) => (file.kind === "note" ? notes.appendTranscript(file, lines) : docs.appendTranscript(file, lines)),
      model: modelFor,
      visionModel: visionModelFor,
      resolveProvider: cachedResolver(),
      ai: defaultAi,
      updateSettings: update,
      control: {
        setListening: (paused) => pauseRef.current(paused),
        recording: (action) => controlsRef.current.recording(action),
        recordingState: () => controlsRef.current.recordingState(),
      },
      media: {
        capture: async () => {
          const tabId = meetTabRef.current;
          if (!tabId) throw new Error("Open the Meet call first.");
          const reply = (await chrome.tabs.sendMessage(tabId, { type: "meet/capture" } satisfies ToMeet).catch(() => null)) as CaptureReply | null;
          if (!reply) throw new Error("Reload the Meet tab so Scribe can see the shared screen.");
          if (!reply.ok) throw new Error(reply.error);
          return reply.frame;
        },
        upload: async (blob, name, mimeType) => {
          if (!folder) {
            folder = await ensureFolder(driveIO, settingsRef.current.driveFolderId);
            if (folder !== settingsRef.current.driveFolderId) update({ driveFolderId: folder });
          }
          return upload(driveIO, { blob, name, mimeType, folderId: folder, description: "Saved by Scribe during a Google Meet call." });
        },
        share: (id) => sharePublicly(driveIO, id),
      },
      now: Date.now,
      schedule: (fn, ms) => void setTimeout(fn, ms),
    });
  }, [settingsRef, update]);

  // Your name and photo from your Google account, so your lines don't say "You". Tried until Google sign-in exists.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      const p = await getGoogleProfile();
      if (!alive || !p?.name) return;
      engine.setSelf({ name: p.name, picture: p.picture });
      if (timer) clearInterval(timer);
    };
    void load();
    timer = setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [engine]);
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  const [meetTabId, setMeetTabIdState] = useState<number | null>(null);
  const setMeetTabId = useCallback((id: number | null) => {
    meetTabRef.current = id;
    setMeetTabIdState(id);
  }, []);

  // Find an open Meet tab and ask it for its state.
  const findMeet = useCallback(async () => {
    const tabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
    const tab = tabs.find((t) => t.active) ?? tabs[0];
    if (!tab?.id) {
      setMeetTabId(null);
      engine.setMeet(null);
      return;
    }
    setMeetTabId(tab.id);
    try {
      const reply = (await chrome.tabs.sendMessage(tab.id, { type: "meet/get-state" } satisfies ToMeet)) as MeetState;
      engine.setMeet(reply);
    } catch {
      engine.setMeet({ status: "loading", title: null, userName: null, paused: false, detail: "Reload the Meet tab so Scribe can read it." });
    }
  }, [engine, setMeetTabId]);

  useEffect(() => {
    const onMessage = (msg: ToPanel, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id) setMeetTabId(sender.tab.id);
      switch (msg.type) {
        case "meet/state":
          engine.setMeet(msg.state);
          break;
        case "meet/partial":
          engine.setPartial({ speaker: msg.speaker, text: msg.text });
          break;
        case "meet/clear-partial":
          engine.setPartial(null);
          break;
        case "meet/final":
          if (msg.paused) engine.pausedLine(msg.speaker, msg.text, msg.at);
          else engine.addLine(msg.speaker, msg.text, msg.at);
          break;
        case "meet/screen":
          engine.addScreen(msg.frame, "auto");
          break;
        case "meet/avatar":
          engine.noteAvatar(msg.speaker, msg.url);
          break;
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    void findMeet();
    const onTab = () => void findMeet();
    chrome.tabs.onUpdated.addListener(onTab);
    chrome.tabs.onRemoved.addListener(onTab);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onUpdated.removeListener(onTab);
      chrome.tabs.onRemoved.removeListener(onTab);
    };
  }, [engine, findMeet, setMeetTabId]);

  const setPaused = useCallback(
    async (paused: boolean) => {
      if (!meetTabId) throw new Error("There’s no Meet call to pause.");
      const reply = (await chrome.tabs.sendMessage(meetTabId, { type: "meet/set-paused", paused } satisfies ToMeet).catch(() => null)) as MeetState | null;
      if (!reply) throw new Error("Reload the Meet tab so Scribe can reach it.");
      engine.setMeet(reply);
    },
    [engine, meetTabId]
  );
  pauseRef.current = setPaused;

  return { engine, state, meetTabId, setPaused, findMeet, controlsRef };
}

/** Tells the Meet tab whether to save each new slide by itself. */
export function useAutoCaptureSync(meetTabId: number | null, on: boolean, inCall: boolean) {
  useEffect(() => {
    if (!meetTabId || !inCall) return;
    chrome.tabs.sendMessage(meetTabId, { type: "meet/set-auto-capture", on } satisfies ToMeet).catch(() => undefined);
  }, [meetTabId, on, inCall]);
}

interface ActiveRecording {
  recorder: MediaRecorder;
  stream: MediaStream;
  audio: AudioContext | null;
  chunks: Blob[];
  start: number;
  mimeType: string;
  width: number;
  height: number;
  pausedMs: number;
  pausedAt: number | null;
}

export interface RecorderTiming {
  start: number;
  pausedMs: number;
  pausedAt: number | null;
}

const RECORD_TYPES = ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Records the Meet tab, sound included. Chrome lets an extension record a tab only after
 * it was opened on that tab (clicking Scribe's icon there); otherwise Chrome's own picker
 * asks which tab to share, which needs a click. Starts from the Record button, or when
 * someone says "Scribe, start recording" out loud, which the whole call hears.
 */
export function useRecorder(meetTabId: number | null, by: string, onDone: (r: RecordingDone) => void) {
  const [timing, setTiming] = useState<RecorderTiming | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<ActiveRecording | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const byRef = useRef(by);
  byRef.current = by;
  const sync = () => {
    const r = active.current;
    setTiming(r ? { start: r.start, pausedMs: r.pausedMs, pausedAt: r.pausedAt } : null);
  };

  const stop = useCallback(() => {
    const r = active.current;
    if (r && r.recorder.state !== "inactive") r.recorder.stop();
  }, []);

  const begin = useCallback(
    async (fromVoice: boolean) => {
      if (active.current) throw new Error("Already recording.");
      if (!meetTabId) throw new Error("Open the Meet call first.");
      let stream: MediaStream;
      let fromTab = true;
      try {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: meetTabId });
        const source = { chromeMediaSource: "tab", chromeMediaSourceId: streamId };
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { mandatory: source },
          video: { mandatory: { ...source, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 15 } },
        } as unknown as MediaStreamConstraints);
      } catch {
        if (fromVoice) throw new Error("Chrome needs a click to record this tab: click Scribe’s icon while on the Meet tab, or press Record.");
        fromTab = false;
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: "browser", frameRate: 15 },
            audio: true,
            selfBrowserSurface: "exclude",
            surfaceSwitching: "exclude",
          } as DisplayMediaStreamOptions);
        } catch (e) {
          throw new Error(e instanceof Error && e.name === "NotAllowedError" ? "Recording was cancelled." : `Couldn’t start recording: ${errText(e)}`);
        }
      }
      // Capturing a tab mutes it for you; play its sound back so you can still hear the call.
      let audio: AudioContext | null = null;
      if (fromTab && stream.getAudioTracks().length) {
        audio = new AudioContext();
        audio.createMediaStreamSource(stream).connect(audio.destination);
      }
      const mimeType = RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_500_000 });
      const size = stream.getVideoTracks()[0]?.getSettings();
      const rec: ActiveRecording = {
        recorder,
        stream,
        audio,
        chunks: [],
        start: Date.now(),
        mimeType,
        width: size?.width ?? 1280,
        height: size?.height ?? 720,
        pausedMs: 0,
        pausedAt: null,
      };
      recorder.ondataavailable = (e) => {
        if (e.data.size) rec.chunks.push(e.data);
      };
      recorder.onstop = () => {
        rec.stream.getTracks().forEach((t) => t.stop());
        void rec.audio?.close();
        if (rec.pausedAt) rec.pausedMs += Date.now() - rec.pausedAt;
        active.current = null;
        sync();
        const blob = new Blob(rec.chunks, { type: rec.mimeType });
        if (blob.size) {
          done.current({ blob, mimeType: rec.mimeType, start: rec.start, end: Date.now(), width: rec.width, height: rec.height, by: byRef.current, pausedMs: rec.pausedMs });
        }
      };
      // Stopping the share from Chrome's own bar ends the recording too.
      stream.getVideoTracks()[0]?.addEventListener("ended", stop);
      recorder.start(5000);
      active.current = rec;
      sync();
    },
    [meetTabId, stop]
  );

  const pause = useCallback(() => {
    const r = active.current;
    if (!r) throw new Error("Nothing is being recorded.");
    if (r.recorder.state === "recording") {
      r.recorder.pause();
      r.pausedAt = Date.now();
      sync();
    }
  }, []);

  const resume = useCallback(() => {
    const r = active.current;
    if (!r) throw new Error("Nothing is being recorded.");
    if (r.recorder.state === "paused") {
      r.recorder.resume();
      if (r.pausedAt) r.pausedMs += Date.now() - r.pausedAt;
      r.pausedAt = null;
      sync();
    }
  }, []);

  /** For the Record button: errors show under it. */
  const start = useCallback(() => {
    setError(null);
    begin(false).catch((e) => setError(errText(e)));
  }, [begin]);

  /** For the control tool: errors go back to the card that asked. */
  const control = useCallback(
    async (action: "start" | "stop" | "pause" | "resume"): Promise<string> => {
      setError(null);
      switch (action) {
        case "start":
          await begin(true);
          return "Recording started. Meet doesn’t tell anyone, so say that you’re recording.";
        case "stop":
          if (!active.current) throw new Error("Nothing is being recorded.");
          stop();
          return "Recording stopped. Saving it to your Drive.";
        case "pause":
          pause();
          return "Recording paused.";
        case "resume":
          resume();
          return "Recording resumed.";
      }
    },
    [begin, stop, pause, resume]
  );

  const state = useCallback((): "off" | "on" | "paused" => {
    const r = active.current;
    return r ? (r.recorder.state === "paused" ? "paused" : "on") : "off";
  }, []);

  // Closing the panel stops the recording. Keep the panel open until a recording is saved.
  useEffect(() => stop, [stop]);

  return { timing, paused: Boolean(timing?.pausedAt), error, start, stop, pause, resume, control, state };
}

/** Recording time so far, not counting pauses, updated every second. */
export function useElapsed(t: RecorderTiming | null): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!t || t.pausedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [t]);
  if (!t) return "";
  const s = Math.max(0, Math.floor(((t.pausedAt ?? now) - t.start - t.pausedMs) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Why the chosen AI can't run right now, or null. Checked when the choice changes and once a minute, so the Live banner can say so before a request fails. */
export function useProviderHealth(settings: Settings): string | null {
  const [problem, setProblem] = useState<string | null>(null);
  const { provider, models, ollamaUrl, chatgptAccount } = settings;
  useEffect(() => {
    let alive = true;
    const check = () =>
      checkProvider(provider, { ...settings, provider, models, ollamaUrl, chatgptAccount }).then(
        (a) => alive && setProblem(a.ok ? null : a.detail),
        (e) => alive && setProblem(normalizeError(e))
      );
    void check();
    const timer = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // settings is read only for the fields listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, models, ollamaUrl, chatgptAccount]);
  return problem;
}
