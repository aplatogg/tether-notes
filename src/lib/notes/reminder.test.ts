import { describe, expect, test } from "vitest";
import {
  dueReminders,
  reconcileFiredReminders,
  reminderKey,
} from "./reminder";
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
    expect(dueReminders([due], now, new Set([reminderKey(due) as string]))).toEqual([]);
  });

  test("rings again after the reminder time is changed", () => {
    const original = makeNote({ reminderAt: "2026-11-24T11:00:00.000Z" });
    const fired = new Set([reminderKey(original) as string]);

    // Same note, new time: the old key must not suppress the new reminder.
    const rescheduled = { ...original, reminderAt: "2026-11-24T11:30:00.000Z" };
    expect(dueReminders([rescheduled], now, fired)).toEqual([rescheduled]);

    // And the legacy id-only key must not suppress it either.
    expect(dueReminders([rescheduled], now, new Set(["n1"]))).toEqual([rescheduled]);
  });
});

describe("reconcileFiredReminders", () => {
  const now = new Date("2026-11-24T12:00:00.000Z");

  test("prunes keys for removed notes and changed reminder times", () => {
    const kept = makeNote({ id: "keep", reminderAt: "2026-11-24T09:00:00.000Z" });
    const moved = makeNote({ id: "moved", reminderAt: "2026-11-24T08:00:00.000Z" });

    const fired = new Set([
      `${kept.id}:${kept.reminderAt}`,
      `gone:2026-11-24T08:00:00.000Z`,
      `moved:2026-11-24T07:00:00.000Z`, // stale: time changed since
      "legacy-without-reminder", // note no longer has a reminder
    ]);

    const result = reconcileFiredReminders([kept, moved], fired, now);

    expect([...result.fired]).toEqual([`${kept.id}:${kept.reminderAt}`]);
    expect(result.changed).toBe(true);
  });

  test("is a no-op when the set already matches the notes", () => {
    const note = makeNote({ reminderAt: "2026-11-24T09:00:00.000Z" });
    const fired = new Set([`${note.id}:${note.reminderAt}`]);

    const result = reconcileFiredReminders([note], fired, now);

    expect([...result.fired]).toEqual([...fired]);
    expect(result.changed).toBe(false);
  });

  test("migrates legacy id keys: past-due stays silent, future still rings", () => {
    const past = makeNote({ id: "past", reminderAt: "2026-11-24T09:00:00.000Z" });
    const future = makeNote({ id: "future", reminderAt: "2026-11-25T09:00:00.000Z" });
    const legacy = new Set(["past", "future"]);

    const result = reconcileFiredReminders([past, future], legacy, now);

    // The delivered past reminder is marked under the new key so it cannot re-ring.
    expect(result.fired.has(`past:2026-11-24T09:00:00.000Z`)).toBe(true);
    expect(dueReminders([past, future], now, result.fired)).toEqual([]);
    // The future one is not marked, so it fires when due.
    expect(result.fired.has(`future:2026-11-25T09:00:00.000Z`)).toBe(false);
    expect(dueReminders([future], new Date("2026-11-25T10:00:00.000Z"), result.fired)).toEqual([
      future,
    ]);
  });
});