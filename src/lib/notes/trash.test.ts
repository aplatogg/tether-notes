import { describe, expect, it } from "vitest";
import { createDraftNote } from "@/lib/notes/model";
import {
  isTrashExpired,
  selectExpired,
  TRASH_RETENTION_DAYS,
  trashDaysLeft,
  trashExpiresAt,
} from "@/lib/notes/trash";

const NOW = Date.parse("2026-11-24T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function trashed(daysAgo: number) {
  return createDraftNote({
    title: `note ${daysAgo}`,
  });
}

describe("trash retention", () => {
  it("computes days left from the deletion timestamp", () => {
    const note = { ...trashed(1), deletedAt: new Date(NOW - 1 * DAY).toISOString() };
    expect(trashDaysLeft(note, NOW)).toBe(TRASH_RETENTION_DAYS - 1);
  });

  it("is due exactly at the retention boundary", () => {
    const note = { ...trashed(30), deletedAt: new Date(NOW - 30 * DAY).toISOString() };
    expect(trashDaysLeft(note, NOW)).toBe(0);
    expect(isTrashExpired(note, NOW)).toBe(true);
  });

  it("keeps notes inside the window", () => {
    const note = { ...trashed(29), deletedAt: new Date(NOW - 29 * DAY).toISOString() };
    expect(isTrashExpired(note, NOW)).toBe(false);
  });

  it("ignores live notes", () => {
    const note = trashed(0);
    expect(isTrashExpired(note, NOW)).toBe(false);
    expect(trashExpiresAt(note)).toBeNull();
  });

  it("selects only expired notes", () => {
    const expired = { ...trashed(31), deletedAt: new Date(NOW - 31 * DAY).toISOString() };
    const fresh = { ...trashed(2), deletedAt: new Date(NOW - 2 * DAY).toISOString() };
    const live = trashed(0);

    expect(selectExpired([expired, fresh, live], NOW).map((note) => note.title)).toEqual(["note 31"]);
  });

  it("returns an expiry date for trashed notes", () => {
    const note = { ...trashed(1), deletedAt: new Date(NOW - DAY).toISOString() };
    expect(trashExpiresAt(note)).toBe(new Date(NOW + 29 * DAY).toISOString());
  });
});
