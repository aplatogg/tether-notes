/**
 * Highlight palette shared by the editor extension, the sanitizer and CSS.
 * Kept free of Tiptap imports so server-side rendering can use it too.
 */
export const HIGHLIGHT_COLORS = ["yellow", "green", "pink", "blue", "orange"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "yellow";

const COLOR_NAMES: Record<string, HighlightColor> = {
  yellow: "yellow",
  "#fef08a": "yellow",
  "#fde68a": "yellow",
  green: "green",
  "#bbf7d0": "green",
  "#a7f3d0": "green",
  pink: "pink",
  "#fbcfe8": "pink",
  "#f9a8d4": "pink",
  blue: "blue",
  "#bfdbfe": "blue",
  "#93c5fd": "blue",
  orange: "orange",
  "#fed7aa": "orange",
  "#fdba74": "orange",
};

export function normalizeHighlightColor(value: unknown): HighlightColor {
  if (typeof value !== "string") return DEFAULT_HIGHLIGHT_COLOR;
  const key = value.trim().toLowerCase();
  return COLOR_NAMES[key] ?? DEFAULT_HIGHLIGHT_COLOR;
}