/** When this build was made (ISO time). Set in wxt.config.ts. */
declare const __SCRIBE_BUILT__: string;
/** True only in SCRIBE_SMOKE=1 builds, which carry the dev bridge to scripts/smoke-server.mjs. */
declare const __SCRIBE_SMOKE__: boolean;
/** Built by scripts/screens.mjs for screenshots: smoke pages, but no dev bridge. */
declare const __SCRIBE_SCREENS__: boolean;
/** True in the full edition (SCRIBE_FULL=1, smoke builds, tests): Obsidian, Overleaf, Ollama and API keys. False in the public edition. */
declare const __SCRIBE_FULL__: boolean;
