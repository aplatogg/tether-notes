import { mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import Highlight from "@tiptap/extension-highlight";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  normalizeHighlightColor,
  type HighlightColor,
} from "./highlight-colors";

export { DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_COLORS, normalizeHighlightColor };
export type { HighlightColor };

let lastColor: HighlightColor = DEFAULT_HIGHLIGHT_COLOR;

export function getLastHighlightColor(): HighlightColor {
  return lastColor;
}

export function setLastHighlightColor(color: HighlightColor): void {
  lastColor = normalizeHighlightColor(color);
}

export const SafeHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: DEFAULT_HIGHLIGHT_COLOR,
        parseHTML: (element: HTMLElement) =>
          element.hasAttribute("data-color")
            ? normalizeHighlightColor(element.getAttribute("data-color"))
            : normalizeHighlightColor(element.style?.backgroundColor),
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-color": normalizeHighlightColor(attributes.color),
        }),
      },
    };
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ["mark", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-h": () =>
        this.editor.chain().focus().toggleHighlight({ color: getLastHighlightColor() }).run(),
    };
  },
});

export interface HighlightText {
  text: string;
  color: HighlightColor;
}

export interface DocHighlight extends HighlightText {
  from: number;
  to: number;
}

/** Collects highlight marks from a ProseMirror doc, merging adjacent text nodes. */
export function collectDocHighlights(doc: ProseMirrorNode): DocHighlight[] {
  const highlights: DocHighlight[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const mark = node.marks.find((candidate) => candidate.type.name === "highlight");
    if (!mark) return;

    const color = normalizeHighlightColor(mark.attrs.color);
    const previous = highlights[highlights.length - 1];
    if (previous && previous.to === pos && previous.color === color) {
      previous.text += node.text;
      previous.to += node.nodeSize;
      return;
    }

    highlights.push({ text: node.text, color, from: pos, to: pos + node.nodeSize });
  });

  return highlights;
}

export interface NoteHighlight extends HighlightText {
  index: number;
}

/** Cheap check used by list filters and sidebar counts. */
export function bodyHasHighlight(body: string): boolean {
  return /<mark\b/i.test(body) || /==[^=\n]+==/.test(body);
}

const MARK_PATTERN = /<mark\b([^>]*)>([\s\S]*?)<\/mark>/gi;
const COLOR_ATTR = /data-color="([^"]*)"/i;

function textFromMarkup(inner: string): string {
  return inner
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts highlights from stored note HTML, merging adjacent `<mark>` runs
 * of the same color so indexes match ProseMirror's `collectDocHighlights`.
 * Used by the global "All highlights" view, so it must not depend on a live editor.
 */
export function extractHighlights(html: string): NoteHighlight[] {
  const highlights: NoteHighlight[] = [];
  let lastEnd = -1;

  for (const match of html.matchAll(MARK_PATTERN)) {
    const color = normalizeHighlightColor(COLOR_ATTR.exec(match[1] ?? "")?.[1]);
    const rawInner = match[2] ?? "";
    const text = textFromMarkup(rawInner);
    const matchStart = match.index ?? 0;
    const matchEnd = matchStart + match[0].length;
    if (!text) {
      lastEnd = matchEnd;
      continue;
    }

    const previous = highlights[highlights.length - 1];
    const between = lastEnd >= 0 ? html.slice(lastEnd, matchStart) : null;
    // Adjacent marks separated only by inline tags (e.g. </strong><strong>)
    // represent one contiguous highlight in ProseMirror.
    if (
      previous &&
      previous.color === color &&
      between !== null &&
      /^(?:<\/?(?:strong|b|em|i|u|s|del|code|a|span)\b[^>]*>)*$/i.test(between)
    ) {
      const joiner = /^\s/.test(rawInner.replace(/<[^>]+>/g, "")) ? " " : " ";
      previous.text = `${previous.text}${joiner}${text}`.replace(/\s+/g, " ").trim();
      lastEnd = matchEnd;
      continue;
    }

    highlights.push({
      index: highlights.length,
      text,
      color,
    });
    lastEnd = matchEnd;
  }

  return highlights;
}