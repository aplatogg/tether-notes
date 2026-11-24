import { describe, expect, test } from "vitest";
import { dueReminders } from "./reminder";
import type { Note } from "./types";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    userId: "u1",
    title: "Call",
    body: "",
    tags: [],
    isPinned: false,
    isArchived: false,
    deletedAt: null,
    createdAt: "2026-11-24T10:00:00.000Z",
    updatedAt: "2026-11-24T10:00:00.000Z",
    syncStatus: "synced",
    ...overrides,
  };
}

describe("dueReminders", () => {
  const now = new Date("2026-11-24T12:00:00.000Z");

  test("returns notes whose reminder is due and not yet fired", () => {
    const due = makeNote({ reminderAt: "2026-11-24T11:00:00.000Z" });
    const future = makeNote({ id: "n2", reminderAt: "2026-11-25T11:00:00.000Z" });
    const none = makeNote({ id: "n3" });
    const deleted = makeNote({ id: "n4", reminderAt: "2026-11-24T10:00:00.000Z", deletedAt: "2026-11-24T11:30:00.000Z" });

    expect(dueReminders([due, future, none, deleted], now, new Set())).toEqual([due]);
    expect(dueReminders([due], now, new Set(["n1"]))).toEqual([]);
  });
});
