// Brand logos, taken as-is from two Iconify sets and compiled in at build time:
// selfh.st/icons (CC BY 4.0) and theSVG (MIT). Nothing here is drawn by hand.
// Single-colour marks come in two versions; the matching one shows for light or dark.
import type { ComponentType, SVGProps } from "react";

import AnthropicDark from "~icons/thesvg-color/anthropic-light";
import AnthropicLight from "~icons/thesvg-color/anthropic-dark";
import Groq from "~icons/thesvg-color/groq";
// Model makers, for the Ollama model menus.
import Deepseek from "~icons/thesvg-color/deepseek";
import GemmaGoogle from "~icons/thesvg-color/gemma-google";
import Kimi from "~icons/thesvg-color/kimi";
import Minimax from "~icons/thesvg-color/minimax";
import Mistral from "~icons/thesvg-color/mistral";
import NvidiaNemotron from "~icons/thesvg-color/nvidia-nemotron";
import QwenDark from "~icons/thesvg-color/qwen-dark";
import QwenLight from "~icons/thesvg-color/qwen-light";
import Xiaomi from "~icons/thesvg-color/xiaomi";
import Zhipu from "~icons/thesvg-color/zhipu";
import Hypothesis from "~icons/thesvg-color/hypothesis";
import GoogleGemini from "~icons/selfhst/google-gemini";
import OpenrouterDark from "~icons/selfhst/openrouter-dark";
import OpenrouterLight from "~icons/selfhst/openrouter-light";
import Claude from "~icons/selfhst/claude";
import GithubDark from "~icons/selfhst/github-dark";
import GithubLight from "~icons/selfhst/github-light";
import Google from "~icons/selfhst/google";
import GoogleChrome from "~icons/selfhst/google-chrome";
import GoogleDocs from "~icons/selfhst/google-docs";
import GoogleDrive from "~icons/selfhst/google-drive";
import GoogleMeet from "~icons/selfhst/google-meet";
import GoogleSheets from "~icons/selfhst/google-sheets";
import GoogleSlides from "~icons/selfhst/google-slides";
import MicrosoftTeams from "~icons/selfhst/microsoft-teams";
import MicrosoftWord from "~icons/selfhst/microsoft-word";
import Notion from "~icons/selfhst/notion";
import ObsidianMark from "~icons/selfhst/obsidian";
import OllamaDark from "~icons/selfhst/ollama-dark";
import Overleaf from "~icons/selfhst/overleaf";
import OllamaLight from "~icons/selfhst/ollama-light";
import OpenaiDark from "~icons/selfhst/openai-dark";
import OpenaiLight from "~icons/selfhst/openai-light";
import Zoom from "~icons/selfhst/zoom";

import { cn } from "@/lib/utils";
import type { FileKind } from "@/lib/files";
import type { ProviderId } from "@/lib/settings";

type Svg = ComponentType<SVGProps<SVGSVGElement>>;
type Mark = Svg | { light: Svg; dark: Svg };

export const MARKS = {
  doc: GoogleDocs,
  sheet: GoogleSheets,
  slides: GoogleSlides,
  meet: GoogleMeet,
  drive: GoogleDrive,
  google: Google,
  chrome: GoogleChrome,
  ollama: { light: OllamaDark, dark: OllamaLight },
  // ChatGPT's mark is OpenAI's.
  chatgpt: { light: OpenaiDark, dark: OpenaiLight },
  openai: { light: OpenaiDark, dark: OpenaiLight },
  openrouter: { light: OpenrouterDark, dark: OpenrouterLight },
  anthropic: { light: AnthropicDark, dark: AnthropicLight },
  gemini: GoogleGemini,
  groq: Groq,
  claude: Claude,
  notion: Notion,
  obsidian: ObsidianMark,
  overleaf: Overleaf,
  github: { light: GithubDark, dark: GithubLight },
  word: MicrosoftWord,
  hypothesis: Hypothesis,
  zoom: Zoom,
  teams: MicrosoftTeams,
  deepseek: Deepseek,
  gemma: GemmaGoogle,
  kimi: Kimi,
  minimax: Minimax,
  mistral: Mistral,
  nemotron: NvidiaNemotron,
  qwen: { light: QwenLight, dark: QwenDark },
  // Xiaomi's MiMo mark is black, which disappears on the dark panel; Xiaomi's own logo is orange.
  mimo: Xiaomi,
  glm: Zhipu,
} satisfies Record<string, Mark>;

export type LogoName = keyof typeof MARKS;

export function Logo({ name, className }: { name: LogoName; className?: string }) {
  const mark: Mark = MARKS[name];
  const size = cn("size-5 shrink-0", className);
  if ("light" in mark) {
    const { light: L, dark: D } = mark;
    return (
      <>
        <L aria-hidden className={cn(size, "dark:hidden")} />
        <D aria-hidden className={cn(size, "hidden dark:block")} />
      </>
    );
  }
  const M = mark;
  return <M aria-hidden className={size} />;
}

export const FILE_LOGO: Record<FileKind, LogoName> = { doc: "doc", sheet: "sheet", slides: "slides", note: "obsidian", tex: "overleaf" };
export const PROVIDER_LOGO: Record<ProviderId, LogoName> = {
  chrome: "chrome",
  ollama: "ollama",
  chatgpt: "chatgpt",
  openrouter: "openrouter",
  anthropic: "anthropic",
  openai: "openai",
  gemini: "gemini",
  groq: "groq",
};

/** The maker's logo for an Ollama model name ("kimi-k3:cloud" → Kimi); Ollama's own when there's none. */
export function modelLogo(model: string): LogoName {
  const m = model.toLowerCase();
  const maker: [RegExp, LogoName][] = [
    [/^gpt-oss/, "openai"],
    [/^gemma/, "gemma"],
    [/^deepseek/, "deepseek"],
    [/^kimi/, "kimi"],
    [/^glm/, "glm"],
    [/^minimax/, "minimax"],
    [/^mistral|^devstral|^magistral/, "mistral"],
    [/^nemotron/, "nemotron"],
    [/^qwen/, "qwen"],
    [/^mimo/, "mimo"],
  ];
  return maker.find(([re]) => re.test(m))?.[1] ?? "ollama";
}
