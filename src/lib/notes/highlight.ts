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
 * Extracts highlights from stored note HTML (sanitized first). Used by the
 * global "All highlights" view, so it must not depend on a live editor.
 */
export function extractHighlights(html: string): NoteHighlight[] {
  const highlights: NoteHighlight[] = [];

  for (const match of html.matchAll(MARK_PATTERN)) {
    const color = COLOR_ATTR.exec(match[1] ?? "");
    const text = textFromMarkup(match[2] ?? "");
    if (!text) continue;
    highlights.push({
      index: highlights.length,
      text,
      color: normalizeHighlightColor(color?.[1]),
    });
  }

  return highlights;
}