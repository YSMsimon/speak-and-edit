// Google Slides: add bullets to a slide, replace text on a slide, add a slide,
// and keep credit and comments in the slide's speaker notes. Slides has no
// suggestion mode or API comments, so changes land directly.

import type { FileRef } from "../files";
import type { FetchJson } from "./sheets";
import { clip, squash, type ApplyOptions, type ApplyResult, type FileContext, type MediaInput, type Target, type WriteIntent } from "./types";

interface TextElement {
  endIndex?: number;
  textRun?: { content?: string };
}
interface Shape {
  placeholder?: { type?: string };
  text?: { textElements?: TextElement[] };
}
interface PageElement {
  objectId?: string;
  shape?: Shape;
}
interface Slide {
  objectId: string;
  pageElements?: PageElement[];
  slideProperties?: { notesPage?: { notesProperties?: { speakerNotesObjectId?: string }; pageElements?: PageElement[] } };
}
interface Presentation {
  title?: string;
  slides?: Slide[];
  /** In EMU. A 16:9 deck is 9144000 × 5143500. */
  pageSize?: { width?: { magnitude?: number }; height?: { magnitude?: number } };
}

/** Fits a w×h picture inside a box, centred, keeping its shape. Exported for tests. */
export function fitBox(w: number, h: number, box: { x: number; y: number; width: number; height: number }) {
  const scale = Math.min(box.width / w, box.height / h);
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);
  return { width, height, x: Math.round(box.x + (box.width - width) / 2), y: Math.round(box.y + (box.height - height) / 2) };
}

/** Request batches for a new slide holding the media, best first. Each batch is all-or-nothing. Exported for tests. */
export function mediaSlideAttempts(p: Presentation, m: MediaInput, publicUrls: string[] | null, ids: { slide: string; title: string; box: string }) {
  const W = p.pageSize?.width?.magnitude ?? 9144000;
  const H = p.pageSize?.height?.magnitude ?? 5143500;
  const fit = fitBox(m.width || 16, m.height || 9, { x: W * 0.05, y: H * 0.2, width: W * 0.9, height: H * 0.75 });
  const emu = (n: number) => ({ magnitude: n, unit: "EMU" });
  const place = (w: number, h: number, x: number, y: number) => ({
    pageObjectId: ids.slide,
    size: { width: emu(w), height: emu(h) },
    transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "EMU" },
  });
  const base = [
    {
      createSlide: {
        objectId: ids.slide,
        insertionIndex: (p.slides ?? []).length,
        slideLayoutReference: { predefinedLayout: "TITLE_ONLY" },
        placeholderIdMappings: [{ layoutPlaceholder: { type: "TITLE", index: 0 }, objectId: ids.title }],
      },
    },
    { insertText: { objectId: ids.title, insertionIndex: 0, text: m.title } },
  ];
  const elementProperties = place(fit.width, fit.height, fit.x, fit.y);
  const noun = m.kind === "image" ? "Screenshot" : "Recording";
  const linkOnly = [
    ...base,
    { createShape: { objectId: ids.box, shapeType: "TEXT_BOX", elementProperties: place(W * 0.9, H * 0.15, W * 0.05, H * 0.35) } },
    { insertText: { objectId: ids.box, insertionIndex: 0, text: `${noun}: ${m.caption}` } },
    { updateTextStyle: { objectId: ids.box, textRange: { type: "ALL" }, style: { link: { url: m.link } }, fields: "link" } },
  ];
  const media: unknown[][] =
    m.kind === "video"
      ? [[...base, { createVideo: { source: "DRIVE", id: m.driveId, elementProperties } }]]
      : (publicUrls ?? []).map((url) => [...base, { createImage: { url, elementProperties } }]);
  return { media, linkOnly };
}

const API = "https://slides.googleapis.com/v1/presentations";
const TITLES = new Set(["TITLE", "CENTERED_TITLE"]);

export const shapeText = (s: Shape | undefined) => (s?.text?.textElements ?? []).map((e) => e.textRun?.content ?? "").join("");

export function slideTitle(slide: Slide): string {
  const el = (slide.pageElements ?? []).find((e) => TITLES.has(e.shape?.placeholder?.type ?? ""));
  return shapeText(el?.shape).trim();
}

/** Body text: the BODY placeholder, else the first non-title shape that has text. */
export function bodyElement(slide: Slide): PageElement | undefined {
  const els = slide.pageElements ?? [];
  return (
    els.find((e) => e.shape?.placeholder?.type === "BODY") ??
    els.find((e) => e.shape && !TITLES.has(e.shape.placeholder?.type ?? "") && shapeText(e.shape).trim())
  );
}

export function notesElement(slide: Slide): PageElement | undefined {
  const id = slide.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId;
  return id ? (slide.slideProperties?.notesPage?.pageElements ?? []).find((e) => e.objectId === id) ?? { objectId: id } : undefined;
}

/** "3", "slide 3", or a title. Defaults to the last slide. Returns a 0-based index. */
export function pickSlide(slides: Slide[], section: string | null): number {
  if (!slides.length) return -1;
  if (section) {
    const n = /^(?:slide\s*)?(\d+)$/i.exec(section.trim());
    if (n?.[1]) return Math.min(Math.max(Number(n[1]) - 1, 0), slides.length - 1);
    const want = squash(section);
    const exact = slides.findIndex((s) => squash(slideTitle(s)) === want);
    if (exact >= 0) return exact;
    const loose = slides.findIndex((s) => {
      const t = squash(slideTitle(s));
      return t.length > 0 && (t.includes(want) || want.includes(t));
    });
    if (loose >= 0) return loose;
  }
  return slides.length - 1;
}

/** insertText that adds a new paragraph at the end of a shape's text. */
export function appendText(objectId: string, current: string, text: string) {
  if (!current.trim()) return { insertText: { objectId, insertionIndex: 0, text } };
  const index = current.endsWith("\n") ? current.length - 1 : current.length;
  return { insertText: { objectId, insertionIndex: index, text: `\n${text}` } };
}

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function slidesTarget(fetchJson: FetchJson): Target {
  const load = (file: FileRef) => fetchJson<Presentation>(`${API}/${file.id}`);
  const update = (file: FileRef, requests: unknown[]) =>
    fetchJson<{ replies?: { replaceAllText?: { occurrencesChanged?: number } }[] }>(`${API}/${file.id}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  const addNotes = async (file: FileRef, slideIndex: number, text: string) => {
    const p = await load(file);
    const slide = p.slides?.[slideIndex];
    const notes = slide && notesElement(slide);
    if (!notes?.objectId) return;
    await update(file, [appendText(notes.objectId, shapeText(notes.shape), text)]);
  };
  const label = (i: number, slide?: Slide) => {
    const t = slide ? slideTitle(slide) : "";
    return `Slide ${i + 1}${t ? ` (${t})` : ""}`;
  };

  return {
    async describe(file): Promise<FileContext> {
      const p = await load(file);
      const slides = p.slides ?? [];
      const lines: string[] = [];
      const parts: string[] = [];
      slides.forEach((s, i) => {
        const title = slideTitle(s);
        parts.push(`${i + 1}. ${title || "Untitled"}`);
        lines.push(`Slide ${i + 1} “${title || "Untitled"}”`);
        const body = shapeText(bodyElement(s)?.shape).trim();
        if (body) lines.push(...body.split("\n").map((l) => `  - ${l}`));
      });
      return { title: p.title ?? file.title, text: clip(lines.join("\n") || "(no slides yet)", 2000), parts };
    },

    async apply(file, w: WriteIntent, o: ApplyOptions): Promise<ApplyResult> {
      const p = await load(file);
      const slides = p.slides ?? [];
      const direct = o.landAs === "suggest" ? "Slides can’t take suggestions, so this was written directly." : undefined;

      if (w.action === "new_slide" || !slides.length) {
        const titleId = newId("title");
        const bodyId = newId("body");
        const title = (w.section ?? w.text ?? "New slide").trim();
        const body = w.action === "new_slide" ? (w.text ?? "").trim() : (w.text ?? "").trim();
        const requests: unknown[] = [
          {
            createSlide: {
              objectId: newId("slide"),
              insertionIndex: slides.length,
              slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" },
              placeholderIdMappings: [
                { layoutPlaceholder: { type: "TITLE", index: 0 }, objectId: titleId },
                { layoutPlaceholder: { type: "BODY", index: 0 }, objectId: bodyId },
              ],
            },
          },
          { insertText: { objectId: titleId, insertionIndex: 0, text: title } },
        ];
        if (body && body !== title) requests.push({ insertText: { objectId: bodyId, insertionIndex: 0, text: body } });
        await update(file, requests);
        if (o.withCredit) await addNotes(file, slides.length, o.credit).catch(() => undefined);
        return { where: `Slide ${slides.length + 1} (new)`, add: [title, body].filter(Boolean).join(": "), status: "applied", suggestionIds: [], warning: direct };
      }

      const i = pickSlide(slides, w.section);
      const slide = slides[i]!;

      if (w.action === "comment" || o.landAs === "comment") {
        const body = w.action === "comment" ? (w.text ?? "") : `Proposed: ${w.text ?? `${w.find} → ${w.replaceWith}`}`;
        await addNotes(file, i, [body, o.credit].filter(Boolean).join(" — "));
        return { where: `${label(i, slide)} notes`, add: body, status: "commented", suggestionIds: [] };
      }

      if (w.action === "replace") {
        if (!w.find) throw new Error("The request didn’t say which text to change.");
        const res = await update(file, [
          { replaceAllText: { containsText: { text: w.find, matchCase: false }, replaceText: w.replaceWith ?? "", pageObjectIds: [slide.objectId] } },
        ]);
        if (!res.replies?.[0]?.replaceAllText?.occurrencesChanged) throw new Error(`Couldn’t find “${w.find}” on ${label(i, slide)}.`);
        if (o.withCredit) await addNotes(file, i, `${o.credit} (was “${w.find}”)`).catch(() => undefined);
        return { where: label(i, slide), remove: w.find, add: w.replaceWith ?? "", status: "applied", suggestionIds: [], warning: direct };
      }

      // append: a new bullet in the slide body, or the notes when the slide has no body.
      const text = (
        w.text ?? (w.rows?.length ? w.rows.map((r) => r.map((c) => c.value).filter(Boolean).join(" — ")).join("\n") : w.cells.map((c) => c.value).join(", "))
      ).trim();
      if (!text) throw new Error("Nothing to add.");
      const body = bodyElement(slide);
      if (body?.objectId) {
        await update(file, [appendText(body.objectId, shapeText(body.shape), text)]);
        if (o.withCredit) await addNotes(file, i, o.credit).catch(() => undefined);
        return { where: label(i, slide), add: text, status: "applied", suggestionIds: [], warning: direct };
      }
      await addNotes(file, i, [text, o.withCredit ? o.credit : ""].filter(Boolean).join(" — "));
      return { where: `${label(i, slide)} notes`, add: text, status: "applied", suggestionIds: [], warning: "This slide has no text box, so it went into the speaker notes." };
    },

    async insertMedia(file, m, w, o, publicUrls) {
      const p = await load(file);
      const slides = p.slides ?? [];
      const noun = m.kind === "image" ? "Screenshot" : "Recording";
      if (o.landAs === "comment") {
        const i = pickSlide(slides, w.section);
        if (i < 0) throw new Error("The deck has no slides to add a note to.");
        await addNotes(file, i, [`${noun}: ${m.caption} ${m.link}`, o.withCredit ? o.credit : ""].filter(Boolean).join(" — "));
        return { where: `${label(i, slides[i])} notes`, add: `${noun}: ${m.caption}`, status: "commented", suggestionIds: [] };
      }
      const ids = { slide: newId("slide"), title: newId("title"), box: newId("link") };
      const { media, linkOnly } = mediaSlideAttempts(p, m, publicUrls, ids);
      const warnings: string[] = [];
      if (o.landAs === "suggest") warnings.push("Slides can’t take suggestions, so this was added directly.");
      let placed = false;
      let lastError = "";
      for (const requests of media) {
        try {
          await update(file, requests);
          placed = true;
          break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      if (!placed) {
        await update(file, linkOnly);
        warnings.push(
          m.kind === "image"
            ? `The slide links to the picture in Drive${lastError ? `, because Google couldn’t copy it (${lastError})` : ", because it couldn’t be shared for Google to copy"}.`
            : `The slide links to the recording in Drive, because Slides couldn’t embed it${lastError ? ` (${lastError})` : ""}.`
        );
      }
      const notes = [`${noun}: ${m.caption}`, m.link, o.withCredit ? o.credit : ""].filter(Boolean).join(" — ");
      await addNotes(file, slides.length, notes).catch(() => warnings.push("The speaker notes didn’t save."));
      return { where: `Slide ${slides.length + 1} (new)`, add: `${noun}: ${m.caption}`, status: "applied", suggestionIds: [], warning: warnings.join(" ") || undefined };
    },
  };
}
