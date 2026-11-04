// The prototype never uses AI Elements' MessageResponse (markdown rendering).
// This stub stands in for streamdown and its plugins so mermaid, KaTeX and
// every shiki grammar stay out of the single-file build. Wired in through vite.config.ts.
export const Streamdown = () => null
export const code = {}
export const math = {}
export const mermaid = {}
export const cjk = {}
