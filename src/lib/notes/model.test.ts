import { describe, expect, expectTypeOf, test, vi } from "vitest";
import {
  createDraftNote,
  displayTitle,
  filterNotes,
  matchesSearch,
  normalizeTags,
  sortNotes,
} from "./model";
import type { CreateDraftNoteInput, Note } from "./types";

const NOW = "2026-11-24T12:34:56.789Z";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-default",
    userId: null,
    title: "",
    body: "",
    tags: [],
    isPinned: false,
    isArchived: false,
    deletedAt: null,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
    syncStatus: "local",
    ...overrides,
  };
}

describe("createDraftNote", () => {
  test("creates a local-only draft with stable defaults", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    try {
      const note = createDraftNote();

      expect(note).toEqual({
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        userId: null,
        title: "",
        body: "",
        tags: [],
        isPinned: false,
        isArchived: false,
        deletedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        syncStatus: "local",
      });
      expect(note).not.toHaveProperty("lastSyncError");
    } finally {
      vi.useRealTimers();
    }
  });

  test("generates a unique client UUID for each draft", () => {
    const first = createDraftNote();
    const second = createDraftNote();

    expect(first.id).not.toBe(second.id);
  });

  test("preserves legitimate caller fields without retaining the tags array", () => {
    const tags = ["work", "urgent"];
    const input: CreateDraftNoteInput = {
      userId: "user-123",
      title: "Release plan",
      body: "Ship it",
      tags,
      isPinned: true,
      isArchived: true,
    };

    const note = createDraftNote(input);

    expect(note).toMatchObject(input);
    expect(note.tags).not.toBe(tags);
  });

  test("exposes only legitimate caller fields in the draft input type", () => {
    expectTypeOf<CreateDraftNoteInput>().toEqualTypeOf<{
      userId?: string | null;
      title?: string;
      body?: string;
      tags?: readonly string[];
      isPinned?: boolean;
      isArchived?: boolean;
    }>();
  });

  test("ignores protected metadata supplied by an untyped caller", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    try {
      const unsafeInput = {
        userId: "user-123",
        title: "Preserved title",
        body: "Preserved body",
        tags: ["work"],
        isPinned: true,
        isArchived: true,
        id: "forced-id",
        deletedAt: "2020-01-01T00:00:00.000Z",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
        syncStatus: "synced",
        lastSyncError: "injected",
      } as unknown as CreateDraftNoteInput;

      const note = createDraftNote(unsafeInput);

      expect(note).toMatchObject({
        userId: "user-123",
        title: "Preserved title",
        body: "Preserved body",
        tags: ["work"],
        isPinned: true,
        isArchived: true,
        deletedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        syncStatus: "local",
      });
      expect(note.id).not.toBe("forced-id");
      expect(note).not.toHaveProperty("lastSyncError");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("displayTitle", () => {
  test("uses a trimmed explicit title before the body", () => {
    const note = makeNote({
      title: "  Quarterly plan  ",
      body: "Body fallback",
    });

    expect(displayTitle(note)).toBe("Quarterly plan");
  });

  test("uses the first non-empty trimmed body line for a blank title", () => {
    const note = makeNote({ body: " \r\n\t\r\n  First useful line  \r\nSecond line" });

    expect(displayTitle(note)).toBe("First useful line");
  });

  test.each([
    ["U+2028 line separator", "\u2028"],
    ["U+2029 paragraph separator", "\u2029"],
  ])("treats %s as a body line break", (_label, separator) => {
    const note = makeNote({ body: `First useful line${separator}Second line` });

    expect(displayTitle(note)).toBe("First useful line");
  });

  test("falls back to Untitled note when title and body are blank", () => {
    expect(displayTitle(makeNote({ title: "  ", body: "\n\t\r\n" }))).toBe(
      "Untitled note",
    );
  });

  test("preserves Unicode text", () => {
    expect(displayTitle(makeNote({ body: "\n  你好，世界 🌍  \n" }))).toBe(
      "你好，世界 🌍",
    );
  });

  test("caps titles at 80 complete Unicode graphemes", () => {
    const family = "👨‍👩‍👧‍👦";
    const title = `${"a".repeat(79)}${family}trailing`;

    expect(displayTitle(makeNote({ title }))).toBe(`${"a".repeat(79)}${family}`);
  });
});

describe("normalizeTags", () => {
  test("trims, lowercases, collapses whitespace, and removes leading hashes", () => {
    expect(
      normalizeTags([
        "  #Work  ",
        "PROJECT\t  ALPHA",
        "##Release",
        "#   # Roadmap",
      ]),
    ).toEqual(["work", "project alpha", "release", "roadmap"]);
  });

  test("deduplicates normalized tags and discards blanks", () => {
    expect(normalizeTags(["Work", "#work", "  ", "###", "WORK"])).toEqual([
      "work",
    ]);
  });

  test("normalizes equivalent Unicode representations", () => {
    expect(normalizeTags(["  #DÉJÀ   VU ", "de\u0301ja\u0300 vu"])).toEqual([
      "déjà vu",
    ]);
  });

  test("uses deterministic pragmatic Unicode folding for tag identity", () => {
    expect(
      normalizeTags([
        "Straße",
        "STRASSE",
        "Σ",
        "σ",
        "ς",
        "İSTANBUL",
        "istanbul",
        "ıstanbul",
      ]),
    ).toEqual(["strasse", "σ", "istanbul", "ıstanbul"]);
  });

  test("limits tags to 20 items and 50 complete Unicode graphemes", () => {
    const family = "👨‍👩‍👧‍👦";
    const input = [
      `${"A".repeat(49)}${family}trailing`,
      ...Array.from({ length: 22 }, (_, index) => `tag-${index}`),
    ];

    const result = normalizeTags(input);

    expect(result).toHaveLength(20);
    expect(result[0]).toBe(`${"a".repeat(49)}${family}`);
    expect(input[0]).toBe(`${"A".repeat(49)}${family}trailing`);
  });
});

describe("matchesSearch", () => {
  test("searches title, body, and tags case-insensitively", () => {
    const note = makeNote({
      title: "Launch Checklist",
      body: "Confirm the production migration.",
      tags: ["Release Ready"],
    });

    expect(matchesSearch(note, "launch")).toBe(true);
    expect(matchesSearch(note, "PRODUCTION")).toBe(true);
    expect(matchesSearch(note, "release")).toBe(true);
    expect(matchesSearch(note, "#RELEASE")).toBe(true);
  });

  test("requires every normalized query term to match", () => {
    const note = makeNote({
      title: "Launch checklist",
      body: "Migration window",
      tags: ["backend"],
    });

    expect(matchesSearch(note, "  LAUNCH   window backend ")).toBe(true);
    expect(matchesSearch(note, "launch mobile")).toBe(false);
  });

  test("treats a blank query as a match for an active note", () => {
    expect(matchesSearch(makeNote(), "  \t\n ")).toBe(true);
  });

  test("never matches a deleted note", () => {
    const deleted = makeNote({
      title: "Launch checklist",
      deletedAt: "2026-11-24T00:00:00.000Z",
    });

    expect(matchesSearch(deleted, "launch")).toBe(false);
    expect(matchesSearch(deleted, "")).toBe(false);
  });

  test("matches canonically equivalent Unicode text", () => {
    const note = makeNote({ title: "Cafe\u0301", body: "東京のメモ" });

    expect(matchesSearch(note, "CAFÉ 東京")).toBe(true);
  });

  test("uses the same pragmatic Unicode fold across text, queries, and tags", () => {
    const note = makeNote({
      title: "Straße",
      body: "τελικός",
      tags: ["İstanbul"],
    });

    expect(matchesSearch(note, "STRASSE τελικόσ istanbul")).toBe(true);
    expect(matchesSearch(note, "ıstanbul")).toBe(false);
    expect(filterNotes([note], { scope: "all", tag: "ISTANBUL" })).toEqual([note]);
  });
});

describe("filterNotes", () => {
  const notes = [
    makeNote({ id: "regular" }),
    makeNote({ id: "pinned", isPinned: true }),
    makeNote({ id: "archived", isArchived: true }),
    makeNote({ id: "archived-pinned", isPinned: true, isArchived: true }),
    makeNote({ id: "deleted", deletedAt: "2026-11-24T00:00:00.000Z" }),
    makeNote({
      id: "deleted-archived",
      isArchived: true,
      deletedAt: "2026-11-24T00:00:00.000Z",
    }),
  ];

  test("all includes active notes and excludes archived and deleted notes", () => {
    expect(filterNotes(notes, { scope: "all" }).map((note) => note.id)).toEqual([
      "regular",
      "pinned",
    ]);
  });

  test("pinned includes only active, unarchived pinned notes", () => {
    expect(filterNotes(notes, { scope: "pinned" }).map((note) => note.id)).toEqual([
      "pinned",
    ]);
  });

  test("archived includes archived notes but not deleted notes", () => {
    expect(filterNotes(notes, { scope: "archived" }).map((note) => note.id)).toEqual([
      "archived",
      "archived-pinned",
    ]);
  });

  test("combines scope, multi-term search, and normalized exact tag matching", () => {
    const candidates = [
      makeNote({
        id: "match",
        title: "Alpha roadmap",
        body: "Review milestones",
        tags: ["Project Alpha"],
      }),
      makeNote({
        id: "wrong-tag",
        title: "Alpha roadmap",
        body: "Review milestones",
        tags: ["personal"],
      }),
      makeNote({
        id: "wrong-query",
        title: "Alpha roadmap",
        body: "Draft milestones",
        tags: ["Project Alpha"],
      }),
    ];

    expect(
      filterNotes(candidates, {
        scope: "all",
        query: "alpha review",
        tag: "  #PROJECT   ALPHA ",
      }).map((note) => note.id),
    ).toEqual(["match"]);
  });

  test("does not mutate the input collection", () => {
    const input = Object.freeze([...notes]);

    const result = filterNotes(input, { scope: "all" });

    expect(result).not.toBe(input);
    expect(input.map((note) => note.id)).toEqual(notes.map((note) => note.id));
  });
});

describe("sortNotes", () => {
  test("sorts pinned notes first, then newest updates, then IDs", () => {
    const notes = [
      makeNote({ id: "regular-old", updatedAt: "2026-11-20T00:00:00.000Z" }),
      makeNote({ id: "pinned-old", isPinned: true, updatedAt: "2026-11-19T00:00:00.000Z" }),
      makeNote({ id: "regular-z", updatedAt: "2026-11-22T00:00:00.000Z" }),
      makeNote({ id: "regular-a", updatedAt: "2026-11-22T00:00:00.000Z" }),
      makeNote({ id: "pinned-new", isPinned: true, updatedAt: "2026-11-23T00:00:00.000Z" }),
    ];

    expect(sortNotes(notes).map((note) => note.id)).toEqual([
      "pinned-new",
      "pinned-old",
      "regular-a",
      "regular-z",
      "regular-old",
    ]);
  });

  test("treats timestamps with different offsets for the same instant as equal", () => {
    const notes = [
      makeNote({ id: "z-note", updatedAt: "2026-11-24T12:00:00.000Z" }),
      makeNote({ id: "a-note", updatedAt: "2026-11-24T07:00:00.000-05:00" }),
    ];

    expect(sortNotes(notes).map((note) => note.id)).toEqual(["a-note", "z-note"]);
  });

  test("accepts leap days only in real Gregorian leap years", () => {
    const notes = [
      makeNote({ id: "invalid-1900", updatedAt: "1900-02-29T00:00:00Z" }),
      makeNote({ id: "valid-2000", updatedAt: "2000-02-29T00:00:00Z" }),
      makeNote({ id: "invalid-2023", updatedAt: "2023-02-29T00:00:00Z" }),
      makeNote({ id: "valid-2024", updatedAt: "2024-02-29T00:00:00Z" }),
    ];

    expect(sortNotes(notes).map((note) => note.id)).toEqual([
      "valid-2024",
      "valid-2000",
      "invalid-1900",
      "invalid-2023",
    ]);
  });

  test("rejects impossible calendar dates and clock values", () => {
    const notes = [
      makeNote({ id: "invalid-feb-30", updatedAt: "2099-02-30T12:00:00Z" }),
      makeNote({ id: "invalid-hour-24", updatedAt: "2099-01-01T24:00:00Z" }),
      makeNote({ id: "valid", updatedAt: "2000-01-01T00:00:00Z" }),
    ];

    expect(sortNotes(notes).map((note) => note.id)).toEqual([
      "valid",
      "invalid-feb-30",
      "invalid-hour-24",
    ]);
  });

  test.each([
    ["date-only", "2099-12-31"],
    ["year-only", "2099"],
    ["locale date", "12/31/2099"],
    ["timezone-less datetime", "2099-12-31T23:59:59"],
  ])("rejects %s timestamps", (_label, timestamp) => {
    const notes = [
      makeNote({ id: "invalid", updatedAt: timestamp }),
      makeNote({ id: "valid", updatedAt: "2000-01-01T00:00:00Z" }),
    ];

    expect(sortNotes(notes).map((note) => note.id)).toEqual(["valid", "invalid"]);
  });

  test("accepts explicit RFC3339 offsets and rejects invalid offset components", () => {
    const notes = [
      makeNote({ id: "z-note", updatedAt: "2026-11-24T12:00:00Z" }),
      makeNote({ id: "a-note", updatedAt: "2026-11-24T17:30:00+05:30" }),
      makeNote({ id: "invalid-hour", updatedAt: "2099-01-01T00:00:00+24:00" }),
      makeNote({ id: "invalid-minute", updatedAt: "2099-01-01T00:00:00+05:60" }),
    ];

    expect(sortNotes(notes).map((note) => note.id)).toEqual([
      "a-note",
      "z-note",
      "invalid-hour",
      "invalid-minute",
    ]);
  });

  test("places invalid timestamps last and orders them by ID", () => {
    const notes = [
      makeNote({ id: "invalid-z", updatedAt: "not-a-timestamp" }),
      makeNote({ id: "valid-old", updatedAt: "2026-11-20T00:00:00.000Z" }),
      makeNote({ id: "invalid-a", updatedAt: "still-not-a-timestamp" }),
      makeNote({ id: "valid-new", updatedAt: "2026-11-21T00:00:00.000Z" }),
    ];

    expect(sortNotes(notes).map((note) => note.id)).toEqual([
      "valid-new",
      "valid-old",
      "invalid-a",
      "invalid-z",
    ]);
  });

  test("returns a new array without mutating the input", () => {
    const older = makeNote({ id: "older", updatedAt: "2026-11-20T00:00:00.000Z" });
    const newer = makeNote({ id: "newer", updatedAt: "2026-11-21T00:00:00.000Z" });
    const input = Object.freeze([older, newer]);

    const result = sortNotes(input);

    expect(result.map((note) => note.id)).toEqual(["newer", "older"]);
    expect(input.map((note) => note.id)).toEqual(["older", "newer"]);
    expect(result).not.toBe(input);
    expect(result[0]).toBe(newer);
  });
});
