import { stripBlockPrefix } from "./format";
import { bodyToPlainText, isHtmlBody } from "./rich";
import type { CreateDraftNoteInput, Note, NoteFilter } from "./types";

/** New notes land in this group by default, and it is the default list view. */
export const DEFAULT_GROUP = "General";

const MAX_DISPLAY_TITLE_LENGTH = 80;
const MAX_TAG_LENGTH = 50;
const MAX_TAG_COUNT = 20;
const RFC3339_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/u;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

interface ParsedTimestamp {
  epochSecond: number;
  fraction: string;
}

function truncateGraphemes(value: string, limit: number): string {
  let result = "";
  let count = 0;

  for (const { segment } of graphemeSegmenter.segment(value)) {
    if (count === limit) {
      break;
    }

    result += segment;
    count += 1;
  }

  return result;
}

// This locale-independent fold covers common full-fold gaps in toLowerCase:
// sharp-s expands, final sigma merges with sigma, and dotted-I merges with i.
// Dotless i remains distinct so matching does not silently adopt a Turkish locale.
function unicodeCaseFoldKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ß/gu, "ss")
    .replace(/ς/gu, "σ")
    .replace(/i\u0307/gu, "i")
    .normalize("NFKC");
}

function normalizeTag(value: string): string {
  const normalized = unicodeCaseFoldKey(value)
    .trim()
    .replace(/^(?:#\s*)+/u, "")
    .trim()
    .replace(/\s+/gu, " ");

  return truncateGraphemes(normalized, MAX_TAG_LENGTH).trim();
}

function normalizeSearchText(value: string): string {
  return unicodeCaseFoldKey(value);
}

function parseRfc3339Timestamp(value: string): ParsedTimestamp | null {
  const match = RFC3339_TIMESTAMP_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[9] ?? 0);
  const offsetMinute = Number(match[10] ?? 0);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }

  const localTime = new Date(0);
  localTime.setUTCFullYear(year, month - 1, day);
  localTime.setUTCHours(hour, minute, second, 0);

  const offsetDirection = match[8] === "+" ? 1 : match[8] === "-" ? -1 : 0;
  const offsetSeconds = offsetDirection * (offsetHour * 60 + offsetMinute) * 60;

  return {
    epochSecond: localTime.getTime() / 1_000 - offsetSeconds,
    fraction: (match[7] ?? "").replace(/0+$/u, ""),
  };
}

function compareTimestamps(left: ParsedTimestamp, right: ParsedTimestamp): number {
  if (left.epochSecond !== right.epochSecond) {
    return left.epochSecond > right.epochSecond ? 1 : -1;
  }

  const width = Math.max(left.fraction.length, right.fraction.length);

  for (let index = 0; index < width; index += 1) {
    const leftDigit = left.fraction[index] ?? "0";
    const rightDigit = right.fraction[index] ?? "0";

    if (leftDigit !== rightDigit) {
      return leftDigit > rightDigit ? 1 : -1;
    }
  }

  return 0;
}

export function createDraftNote(input: CreateDraftNoteInput = {}): Note {
  const timestamp = new Date().toISOString();
  const {
    userId = null,
    title = "",
    body = "",
    tags = [],
    isPinned = false,
    isArchived = false,
    lockHash = null,
  } = input;

  return {
    id: globalThis.crypto.randomUUID(),
    userId,
    title,
    body,
    tags: [...tags],
    isPinned,
    isArchived,
    lockHash,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    syncStatus: "local",
  };
}

export function displayTitle(note: Note): string {
  const explicitTitle = note.title.trim();

  if (explicitTitle) {
    return truncateGraphemes(explicitTitle, MAX_DISPLAY_TITLE_LENGTH);
  }

  const bodyText = isHtmlBody(note.body) ? bodyToPlainText(note.body) : note.body;

  for (const line of bodyText.split(/\r\n?|[\n\u2028\u2029]/u)) {
    const trimmedLine = line.trim();

    if (trimmedLine) {
      const plain = stripBlockPrefix(trimmedLine).trim();
      return truncateGraphemes(plain || trimmedLine, MAX_DISPLAY_TITLE_LENGTH);
    }
  }

  return "Untitled note";
}

export function normalizeTags(input: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of input) {
    const tag = normalizeTag(value);

    if (!tag || seen.has(tag)) {
      continue;
    }

    seen.add(tag);
    result.push(tag);

    if (result.length === MAX_TAG_COUNT) {
      break;
    }
  }

  return result;
}

export function matchesSearch(note: Note, query: string): boolean {
  if (note.deletedAt !== null) {
    return false;
  }

  const terms = normalizeSearchText(query).trim().split(/\s+/u).filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  const normalizedTags = note.tags.map(normalizeTag).filter(Boolean);
  const searchableFields = [
    normalizeSearchText(note.title),
    ...(note.lockHash ? [] : [normalizeSearchText(isHtmlBody(note.body) ? bodyToPlainText(note.body) : note.body)]),
    ...normalizedTags,
    ...normalizedTags.map((tag) => `#${tag}`),
  ];

  return terms.every((term) => searchableFields.some((field) => field.includes(term)));
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Local calendar day (YYYY-MM-DD) of a timestamp, UTC-based for stability. */
export function dayOfTimestamp(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function noteDays(note: Note): string[] {
  const days = new Set<string>();
  const created = dayOfTimestamp(note.createdAt);
  if (created) days.add(created);
  if (note.reminderAt) {
    const reminded = dayOfTimestamp(note.reminderAt);
    if (reminded) days.add(reminded);
  }
  return [...days];
}

/** Distinct, sorted folder names across the given notes. */
export function collectFolders(notes: readonly Note[]): string[] {
  const folders = new Set<string>();
  notes.forEach((note) => {
    const folder = (note.folder ?? "").trim();
    if (folder) folders.add(folder);
  });
  return [...folders].sort((left, right) => left.localeCompare(right));
}

/**
 * Folder/group match with sub-group support: selecting "Kerja" also matches
 * "Kerja/Q4". Separator is "/".
 */
export function folderMatches(noteFolder: string | undefined, selected: string): boolean {
  const folder = (noteFolder ?? "").trim();
  const want = selected.trim();
  if (!want) return true;
  return folder === want || folder.startsWith(`${want}/`);
}

/** Deduped, sorted union of folder lists. */
export function mergeFolders(...lists: readonly (readonly string[])[]): string[] {
  const merged = new Set<string>();
  lists.forEach((list) =>
    list.forEach((folder) => {
      const trimmed = folder.trim();
      if (trimmed) merged.add(trimmed);
    }),
  );
  return [...merged].sort((left, right) => left.localeCompare(right));
}

/** Depth (0-based) of a hierarchical folder path: "A/B/C" → 2. */
export function folderDepth(path: string): number {
  return path.split("/").length - 1;
}

/** Last segment of a hierarchical folder path: "A/B/C" → "C". */
export function folderLabel(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

/** Subtree-inclusive counts: every ancestor of a note's folder is counted too. */
export function folderTreeCounts(notes: readonly Note[]): Map<string, number> {
  const totals = new Map<string, number>();
  notes.forEach((note) => {
    if (note.deletedAt !== null) return;
    const folder = (note.folder ?? "").trim();
    if (!folder) return;
    const segments = folder.split("/");
    for (let i = 1; i <= segments.length; i += 1) {
      const path = segments.slice(0, i).join("/");
      totals.set(path, (totals.get(path) ?? 0) + 1);
    }
  });
  return totals;
}

/** Distinct, sorted share-group names across shared notes. */
export function collectShareGroups(notes: readonly Note[]): string[] {
  const groups = new Set<string>();
  notes.forEach((note) => {
    if (!note.shared) return;
    const group = (note.shareGroup ?? "").trim();
    if (group) groups.add(group);
  });
  return [...groups].sort((left, right) => left.localeCompare(right));
}

export function filterNotes(notes: readonly Note[], filter: NoteFilter): Note[] {
  const selectedTag = filter.tag === undefined ? "" : normalizeTag(filter.tag);
  const query = normalizeSearchText(filter.query ?? "").trim();
  const selectedFolder = (filter.folder ?? "").trim();
  const selectedDay = filter.day !== undefined && DAY_PATTERN.test(filter.day) ? filter.day : "";
  const selectedShareGroup = (filter.shareGroup ?? "").trim();

  return notes.filter((note) => {
    if (filter.scope === "trash") {
      if (note.deletedAt === null) return false;
      if (selectedTag && !note.tags.some((tag) => normalizeTag(tag) === selectedTag)) return false;
      if (query.length === 0) return true;
      return normalizeSearchText(note.title).includes(query);
    }

    if (note.deletedAt !== null) {
      return false;
    }

    if (filter.scope === "shared") {
      if (!note.shared) return false;
      if (selectedTag && !note.tags.some((tag) => normalizeTag(tag) === selectedTag)) return false;
      if (selectedFolder && !folderMatches(note.folder, selectedFolder)) return false;
      if (selectedDay && !noteDays(note).includes(selectedDay)) return false;
      if (selectedShareGroup && (note.shareGroup ?? "").trim() !== selectedShareGroup) return false;
      if (query.length === 0) return true;
      return matchesSearch(note, query);
    }

    if (filter.scope === "all" && note.isArchived) {
      return false;
    }

    if (filter.scope === "pinned" && (!note.isPinned || note.isArchived)) {
      return false;
    }

    if (filter.scope === "archived" && !note.isArchived) {
      return false;
    }

    if (filter.query !== undefined && !matchesSearch(note, filter.query)) {
      return false;
    }

    if (selectedTag && !note.tags.some((tag) => normalizeTag(tag) === selectedTag)) {
      return false;
    }

    if (selectedFolder && !folderMatches(note.folder, selectedFolder)) {
      return false;
    }

    if (selectedDay && !noteDays(note).includes(selectedDay)) {
      return false;
    }

    return true;
  });
}

export function sortNotes(notes: readonly Note[]): Note[] {
  return notes
    .map((note) => ({ note, updatedAt: parseRfc3339Timestamp(note.updatedAt) }))
    .sort((left, right) => {
      if (left.note.isPinned !== right.note.isPinned) {
        return left.note.isPinned ? -1 : 1;
      }

      const leftHasValidTimestamp = left.updatedAt !== null;
      const rightHasValidTimestamp = right.updatedAt !== null;

      if (leftHasValidTimestamp !== rightHasValidTimestamp) {
        return leftHasValidTimestamp ? -1 : 1;
      }

      if (left.updatedAt && right.updatedAt) {
        const timestampOrder = compareTimestamps(left.updatedAt, right.updatedAt);

        if (timestampOrder !== 0) {
          return timestampOrder > 0 ? -1 : 1;
        }
      }

      if (left.note.id === right.note.id) {
        return 0;
      }

      return left.note.id < right.note.id ? -1 : 1;
    })
    .map(({ note }) => note);
}





