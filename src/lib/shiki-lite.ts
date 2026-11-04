// Small stand-in for the "shiki" package, used only by AI Elements' CodeBlock.
// Loads two grammars and two themes instead of every language shiki ships,
// so the single-file build stays small. Wired in through an alias in vite.config.ts.
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import bash from 'shiki/langs/bash.mjs'
import json from 'shiki/langs/json.mjs'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'

export const createHighlighter = (_options?: unknown) =>
  createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [json, bash],
    engine: createJavaScriptRegexEngine(),
  })
