import { describe, expect, test } from "vitest";
import type { Note } from "@/lib/notes/types";
import { noteToRemoteRow, remoteRowToNote } from "./adapter";

const note: Note = {
  id: "1c622c7e-6c1d-47d9-a98f-d8c4c8a13247",
  userId: "5ef56a5c-969d-47cc-a028-30d07fd0928f",
  title: "Release plan",
  body: "Ship the offline build.",
  tags: ["work", "release"],
  isPinned: true,
  isArchived: false,
  deletedAt: null,
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-24T12:00:00.000Z",
  syncStatus: "pending",
  lastSyncError: "old error",
};

describe("Supabase note mapping", () => {
  test("maps a local note to the SQL row shape without client-only state", () => {
    expect(noteToRemoteRow(note)).toEqual({
      id: note.id,
      user_id: note.userId,
      title: note.title,
      body: note.body,
      tags: note.tags,
      is_pinned: true,
      is_archived: false,
      lock_hash: null,
      reminder_at: null,
      folder: "",
      deleted_at: null,
      created_at: note.createdAt,
      updated_at: note.updatedAt,
    });
  });

  test("maps and validates a remote row as synced local state", () => {
    expect(remoteRowToNote(noteToRemoteRow(note))).toEqual({
      ...note,
      lockHash: null,
      reminderAt: null,
      folder: "",
      syncStatus: "synced",
      lastSyncError: undefined,
      shared: false,
      sharedFor: null,
      ownerEmail: null,
    });
  });

  test("marks rows owned by someone else as shared with the current user", () => {
    const mapped = remoteRowToNote(noteToRemoteRow(note), "current-user");
    expect(mapped.shared).toBe(true);
    expect(mapped.sharedFor).toBe("current-user");
    expect(remoteRowToNote(noteToRemoteRow(note), note.userId ?? undefined).shared).toBe(false);
  });

  test("rejects local-only notes and malformed remote rows", () => {
    expect(() => noteToRemoteRow({ ...note, userId: null })).toThrow(
      "authenticated user",
    );
    expect(() =>
      remoteRowToNote({ ...noteToRemoteRow(note), tags: "not-an-array" }),
    ).toThrow();
  });
});


