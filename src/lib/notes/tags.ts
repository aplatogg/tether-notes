const TAG_COLORS = [
  { bg: "#e0f2f1", ink: "#0f5f59", darkBg: "#153b39", darkInk: "#7ee2d8" },
  { bg: "#e8eefc", ink: "#2e4c92", darkBg: "#1c2b4b", darkInk: "#9cb8f9" },
  { bg: "#f6ece0", ink: "#7a4a12", darkBg: "#3d2a14", darkInk: "#f3c388" },
  { bg: "#f3e7f7", ink: "#6b2d7d", darkBg: "#381f42", darkInk: "#e2a6f2" },
  { bg: "#e7f3e6", ink: "#2f6b35", darkBg: "#1b3820", darkInk: "#95dca0" },
  { bg: "#fdeaea", ink: "#8a2b2b", darkBg: "#421d1d", darkInk: "#f6a4a4" },
  { bg: "#e9f0f3", ink: "#33525e", darkBg: "#21323b", darkInk: "#a5cad8" },
  { bg: "#fbf0d9", ink: "#7a5a10", darkBg: "#3b2e11", darkInk: "#f3d586" },
] as const;

export interface TagColor {
  bg: string;
  ink: string;
  darkBg: string;
  darkInk: string;
}

/** Stable colour per tag: the same label always maps to the same swatch. */
export function tagColor(tag: string): TagColor {
  const normalized = tag.trim().toLowerCase();
  let hash = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) % 1_000_003;
  }

  return TAG_COLORS[hash % TAG_COLORS.length];
}
