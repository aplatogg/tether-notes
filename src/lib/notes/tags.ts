const TAG_COLORS = [
  { bg: "#e0f2f1", ink: "#0f5f59" },
  { bg: "#e8eefc", ink: "#2e4c92" },
  { bg: "#f6ece0", ink: "#7a4a12" },
  { bg: "#f3e7f7", ink: "#6b2d7d" },
  { bg: "#e7f3e6", ink: "#2f6b35" },
  { bg: "#fdeaea", ink: "#8a2b2b" },
  { bg: "#e9f0f3", ink: "#33525e" },
  { bg: "#fbf0d9", ink: "#7a5a10" },
] as const;

export interface TagColor {
  bg: string;
  ink: string;
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
