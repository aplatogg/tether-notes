export interface MiniPrefill {
  text: string;
  autoSave: boolean;
}

/**
 * Builds the quick-capture text from share/sheet/shortcut query params.
 * Supports `?title=&text=&url=` (Android share sheet / iOS Shortcut) and
 * `?save=1` to save immediately instead of just prefilling.
 */
export function miniPrefillFromSearch(search: string): MiniPrefill {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const parts = [params.get("title"), params.get("text"), params.get("url")];
  const text = parts.filter((part): part is string => Boolean(part && part.trim())).join("\n");

  return { text, autoSave: params.get("save") === "1" };
}
