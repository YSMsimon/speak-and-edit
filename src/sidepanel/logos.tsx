// Brand logos, taken as-is from the selfh.st/icons Iconify set (CC BY 4.0) and compiled in at build
// time. Nothing here is drawn by hand. Single-colour marks come in two versions; the matching one shows
// for light or dark.
import type { ComponentType, SVGProps } from "react";

import Google from "~icons/selfhst/google";
import GoogleChrome from "~icons/selfhst/google-chrome";
import GoogleDocs from "~icons/selfhst/google-docs";
import GoogleDrive from "~icons/selfhst/google-drive";
import GoogleMeet from "~icons/selfhst/google-meet";
import GoogleSheets from "~icons/selfhst/google-sheets";
import GoogleSlides from "~icons/selfhst/google-slides";
import OpenaiDark from "~icons/selfhst/openai-dark";
import OpenaiLight from "~icons/selfhst/openai-light";

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
  // ChatGPT's mark is OpenAI's.
  chatgpt: { light: OpenaiDark, dark: OpenaiLight },
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

export const FILE_LOGO: Record<FileKind, LogoName> = { doc: "doc", sheet: "sheet", slides: "slides" };
export const PROVIDER_LOGO: Record<ProviderId, LogoName> = { chrome: "chrome", chatgpt: "chatgpt" };
