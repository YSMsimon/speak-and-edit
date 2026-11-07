# Third-party code

## Code adapted from other projects

| Project | What | License |
|---|---|---|
| TranscripTonic by Vivek G (github.com/vivek-nexus/transcriptonic) | How `src/entrypoints/meet.content.ts` reads Google Meet captions: the caption-region selector, which block is current, where the speaker name sits, pressing "c" to turn captions on, and re-attaching when Meet replaces the region. Rewritten in TypeScript, not copied. | MIT, Copyright (c) 2024 Vivek G |

## Libraries

| Library | Used for | License |
|---|---|---|
| WXT | Extension build tooling | MIT |
| Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/openai`) | Calling every AI provider through one interface (Ollama, and ChatGPT plans through the Responses API) | Apache-2.0 |
| `@browser-ai/core` | Chrome and Edge built-in models through the AI SDK | Apache-2.0 |
| zod | Schemas for the model's structured answers | MIT |
| cn (shadcn-ui/cn) | Class-name merging used by the shadcn components | MIT |

## UI

Every element in the panel starts as a stock component from these libraries, restyled with Tailwind classes to the Speak and Edit design (dark liquid glass, neon gradient edges). Nothing is hand-drawn.

| Library | Used for | License | Source |
|---|---|---|---|
| glasscn (kostyniuk/glasscn-components) | Liquid-glass look: Glass Card, Glass Toggle Group (tab bar and mode switch), Glass Button, Glass Icon, Glass Badge, Glass Item, Glass Radio Group, Glass Select, Glass Input, Glass Alert, Glass Separator, Liquid Switch, Liquid Glass, Glance, Avatar, Tooltip, and the glass variant styles | MIT | https://glasscn-components.vercel.app, registry `@glasscn`, in `src/components/glasscn/` |
| Logo and background | `src/assets/logo.png` (the glass quotation mark, also the extension icon) and `src/assets/backgrounds/speak-dark.webp`, made for this project on 2026-11-04 with OpenAI's image model (`gpt-image-2.5-sunburst`); the background was then darkened | Generated for this project; OpenAI's terms assign the output to the user | not from another project |
| AI Elements (Vercel) | Conversation, Message, Tool, Confirmation, Queue, Question, Chain of Thought, Shimmer, Transcription, Suggestion, Prompt Input, Model Selector, Environment Variables, Agent, Context, Image, Checkpoint (the "heard nothing" and "panel was closed" markers) | Apache-2.0 | https://elements.ai-sdk.dev, in `src/components/ai-elements/` |
| shadcn/ui, preset `radix-nova` | Collapsible, Kbd, and the parts AI Elements is built on | MIT | https://ui.shadcn.com, in `src/components/ui/` |
| Base UI | Primitives under glasscn | MIT | https://base-ui.com |
| Radix UI | Primitives under shadcn/ui | MIT | https://www.radix-ui.com |
| Paper Shaders (`@paper-design/shaders-react`) | The liquid-metal effect in Liquid Switch | Apache-2.0 | https://shaders.paper.design |
| Lucide | Every icon that isn't a brand logo | ISC | https://lucide.dev |
| Sonner, through shadcn/ui's Sonner component (registry `new-york-v4/sonner`) | Toasts for confirmations ("Ollama works", "Signed out of ChatGPT") | MIT | https://sonner.emilkowal.ski, in `src/components/ui/sonner.tsx` |
| selfh.st/icons, via `@iconify-json/selfhst` | Brand logos: Google Docs, Sheets, Slides, Meet, Drive, Google, Chrome, Gemini, Ollama, OpenRouter, OpenAI (for ChatGPT), Claude, Notion, Obsidian, Overleaf, GitHub, Microsoft Word, Zoom, Microsoft Teams. Used unchanged; one-colour marks use the set's own light and dark versions | CC BY 4.0, by selfh.st | https://selfh.st/icons, in `src/sidepanel/logos.tsx` |
| theSVG, via `@iconify-json/thesvg-color` | The Anthropic, Groq and Hypothesis logos, which the set above lacks, and the model makers in the Ollama model menus (DeepSeek, Gemma, Kimi, MiniMax, Mistral, NVIDIA Nemotron, Qwen, Xiaomi, Zhipu) | MIT | https://thesvg.org |
| unplugin-icons | Compiles only the logos used into the build, so nothing loads from the network | MIT | https://github.com/unplugin/unplugin-icons |
| double-metaphone (words) | Hearing that a first word sounds like the wake word ("Subscribe" for "Scribe"), in `src/lib/wake.ts` | MIT | https://github.com/words/double-metaphone |
| Geist (via Fontsource) | Typeface | OFL-1.1 | https://vercel.com/font |
| Tailwind CSS | Styling | MIT | https://tailwindcss.com |
| shiki | JSON highlighting inside Tool and Agent cards | MIT | https://shiki.style |

## Local changes

- **glasscn folder layout.** Installed with the shadcn CLI under `src/components/glasscn/` so it does not overwrite the Radix-based shadcn files AI Elements needs. The glass components sit in `ui/glasscn/`, as in glasscn's own layout, so their relative imports work unchanged.
- **glasscn `glance` CSS** in `src/index.css`. The CLI garbled the reduced-motion rule while converting it. It now matches the registry source.
- **`.glass-scope` tokens** in `src/index.css`. Inside the panels, shadcn's surface colours become translucent so AI Elements cards match the glass. The values follow glasscn's `subtle` and `frosted` variants.
- **Dark-mode opacity.** The panels and header cards add `dark:bg-black/60` on top of glasscn's `frosted` variant (`bg-black/35`), because grey text lost contrast over the bright part of the dark background.
- **AI Elements** `agent.tsx` and `context.tsx`: three one-line type fixes for the `ai` v7 package, each marked `local patch`.
- **shadcn Sonner** `src/components/ui/sonner.tsx`:
  - It follows the system's light or dark setting instead of using `next-themes`, which the extension doesn't have.
  - Toasts use glasscn's frosted surface.
  - Both changes are marked `local patch`.
- **Error placement** follows IBM Carbon's notification guidance (https://carbondesignsystem.com/components/notification/usage/):
  - **Inline:** the problem stays where it happened, in the row or bar that failed.
  - **Banner:** problems that stop Scribe working appear at the top, one at a time.
  - **Toasts:** only for confirmations, never for something that needs a fix.
- **AI Elements** `tool.tsx`: `ToolHeader` takes an optional `icon`, shown instead of the wrench, so each card shows the file’s logo. Marked `local patch`.
- **AI Elements** `tool.tsx`: card titles one step larger (`text-[0.9375rem]` instead of `text-sm`). Marked `local patch`.
- **glasscn** `item.tsx`: row titles `text-base` and descriptions `text-[0.9375rem]`, two and one steps above shadcn's defaults, for the mockups' scale. Marked `local patch`.
- **AI Elements** `checkpoint.tsx`: added from the registry as is; only the import paths point at `src/components/ui/`, as the shadcn CLI would write them.
- **`tsconfig.app.json`**: `verbatimModuleSyntax` is off, because glasscn imports types without `import type`.
- **`src/lib/shiki-lite.ts`** loads only the JSON and Bash grammars. **`src/lib/streamdown-stub.ts`** stands in for streamdown, which only `MessageResponse` uses and the panel never renders. Both are wired in through aliases in `vite.config.ts`.

## Trademarks

The brand logos belong to their companies. Scribe shows them only to name the product a row connects to.

## Not used, on purpose

- **AI Elements Persona** (animated voice orb): it downloads its Rive animation and runtime from Vercel's servers. The artifact page blocks requests to other sites.
- **ModelSelectorLogo**: it loads provider logos from models.dev. Blocked for the same reason.
- **shadcn-glass-ui's animated background**: it ships its own full Tailwind build and sets `data-theme` on `<html>`, which collides with the artifact page's light and dark setting.
