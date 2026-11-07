// Puts Scribe's Meet script into a Meet tab that was open before Scribe was installed, updated or
// reloaded. Chrome only adds content scripts to pages loaded afterwards, so without this the tab
// would need a reload before Scribe could read its captions.

const FILE = "content-scripts/meet.js";

export async function injectMeetScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [FILE] });
    return true;
  } catch {
    // Not a Meet page any more, or Chrome won't allow it (a discarded tab, for one).
    return false;
  }
}

/** Every open Meet tab. Called when Scribe is installed or updated. */
export async function injectIntoOpenMeetTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
  await Promise.all(tabs.map((t) => (t.id && !t.discarded ? injectMeetScript(t.id) : Promise.resolve(false))));
}
