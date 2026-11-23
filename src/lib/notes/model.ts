import type { CreateDraftNoteInput, Note, NoteFilter } from "./types";

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
  } = input;

  return {
    id: globalThis.crypto.randomUUID(),
    userId,
    title,
    body,
    tags: [...tags],
    isPinned,
    isArchived,
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

  for (const line of note.body.split(/\r\n?|[\n\u2028\u2029]/u)) {
    const trimmedLine = line.trim();

    if (trimmedLine) {
      return truncateGraphemes(trimmedLine, MAX_DISPLAY_TITLE_LENGTH);
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
    normalizeSearchText(note.body),
    ...normalizedTags,
    ...normalizedTags.map((tag) => `#${tag}`),
  ];

  return terms.every((term) => searchableFields.some((field) => field.includes(term)));
}

export function filterNotes(notes: readonly Note[], filter: NoteFilter): Note[] {
  const selectedTag = filter.tag === undefined ? "" : normalizeTag(filter.tag);

  return notes.filter((note) => {
    if (note.deletedAt !== null) {
      return false;
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
