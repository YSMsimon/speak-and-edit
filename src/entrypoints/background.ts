// Opens Scribe's side panel when the toolbar icon is clicked.
// Smoke builds also carry a dev bridge to scripts/smoke-server.mjs (see devBridge below).
export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => console.error(e));
  // Screenshot builds (scripts/screens.mjs) leave the bridge off: no reloads, no smoke runs.
  if (__SCRIBE_SMOKE__ && !__SCRIBE_SCREENS__) devBridge();
});

/**
 * Smoke builds only. Every 30 s, and at start-up, asks the local smoke server (this computer only):
 *  - a different build is waiting → reload Scribe, so a fresh build loads without chrome://extensions;
 *  - a smoke run was requested and not yet started → open the smoke page in a small window.
 */
function devBridge() {
  const poll = async () => {
    try {
      const res = await fetch("http://127.0.0.1:8792/state", { cache: "no-store" });
      const s = (await res.json()) as { build?: string; run?: string; nonce?: string };
      if (s.build && s.build !== __SCRIBE_BUILT__) return chrome.runtime.reload();
      if (!s.run || !s.nonce) return;
      const { "smoke.nonce": done } = await chrome.storage.local.get("smoke.nonce");
      if (done === s.nonce) return;
      await chrome.storage.local.set({ "smoke.nonce": s.nonce });
      await chrome.windows.create({
        url: chrome.runtime.getURL(`/smoke.html?run=1&provider=${encodeURIComponent(s.run)}`),
        type: "popup",
        focused: false,
        width: 520,
        height: 640,
      });
    } catch {
      // No smoke server running: nothing to do.
    }
  };
  chrome.alarms.create("scribe-dev-bridge", { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === "scribe-dev-bridge") void poll();
  });
  void poll();
}
