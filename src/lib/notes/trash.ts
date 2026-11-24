import type { Note } from "@/lib/notes/types";

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function trashExpiresAt(note: Note): string | null {
  if (!note.deletedAt) return null;
  const deleted = Date.parse(note.deletedAt);
  if (Number.isNaN(deleted)) return null;
  return new Date(deleted + TRASH_RETENTION_DAYS * DAY_MS).toISOString();
}

/** Whole days remaining before permanent deletion (0 means it is due). */
export function trashDaysLeft(note: Note, now: number = Date.now()): number {
  if (!note.deletedAt) return TRASH_RETENTION_DAYS;
  const deleted = Date.parse(note.deletedAt);
  if (Number.isNaN(deleted)) return TRASH_RETENTION_DAYS;
  const remaining = deleted + TRASH_RETENTION_DAYS * DAY_MS - now;
  return Math.max(0, Math.ceil(remaining / DAY_MS));
}

export function isTrashExpired(note: Note, now: number = Date.now()): boolean {
  return note.deletedAt !== null && trashDaysLeft(note, now) === 0;
}

export function selectExpired(notes: readonly Note[], now: number = Date.now()): Note[] {
  return notes.filter((note) => isTrashExpired(note, now));
}
