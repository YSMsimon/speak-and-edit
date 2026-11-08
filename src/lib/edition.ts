// Which edition this build is (README › Editions).
//  - Public, the default: what the Chrome Web Store and GitHub releases get. Google Meet → Google Docs,
//    Sheets and Slides, with Sign in with ChatGPT or Chrome's built-in model.
//  - Full (SCRIBE_FULL=1, smoke builds, tests): also Obsidian, Overleaf, Ollama and API keys.
// The public edition switches those off; nothing is deleted. Code behind `if (FULL)` is left out of
// public builds when they're built.
export const FULL: boolean = __SCRIBE_FULL__;
