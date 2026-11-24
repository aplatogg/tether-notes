import { describe, expect, test } from "vitest";
import type { Note } from "@/lib/notes/types";
import { combinePulledNotes, createSupabaseSyncAdapter, grantedRowToNote, noteToRemoteRow, remoteRowToNote } from "./adapter";

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
      workspace_id: null,
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
      shareGroup: null,
      workspaceId: null,
    });
  });

  test("workspace notes owned by others are collaborative, not read-only shares", () => {
    const row = { ...noteToRemoteRow(note), workspace_id: "11111111-1111-4111-8111-111111111111" };
    const mapped = remoteRowToNote(row, "current-user");
    expect(mapped.shared).toBe(false);
    expect(mapped.sharedFor).toBeNull();
    expect(mapped.workspaceId).toBe("11111111-1111-4111-8111-111111111111");
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

  test("granted_notes rows are masked: locked body stays empty, lock hash never leaks", () => {
    const base = noteToRemoteRow(note);
    const unlocked = grantedRowToNote(
      { ...base, body: "shared body", is_locked: false },
      "current-user",
    );
    expect(unlocked.shared).toBe(true);
    expect(unlocked.sharedFor).toBe("current-user");
    expect(unlocked.body).toBe("shared body");
    expect(unlocked.lockHash).toBeNull();

    const locked = grantedRowToNote(
      { ...base, body: null, is_locked: true },
      "current-user",
    );
    expect(locked.body).toBe("");
    expect(locked.lockHash).toBe("locked");
  });

  test("combinePulledNotes dedupes notes visible via both table and grants", () => {
    const ownRow = noteToRemoteRow(note);
    const grantedRow = { ...noteToRemoteRow(note), body: null, is_locked: false };
    const meta = { ownerEmailByNote: new Map(), groupByNote: new Map() };

    const combined = combinePulledNotes([ownRow], [grantedRow], "current-user", meta);

    expect(combined).toHaveLength(1);
    expect(combined[0].id).toBe(note.id);
    expect(combined[0].shared).toBe(true); // owned by someone else -> shared
  });
});

describe("Supabase adapter write guards", () => {
  type FakeResult = { data: unknown; error: null };
  function makeClient(results: FakeResult[]) {
    const calls: string[] = [];
    const queue = [...results];
    const next = () => queue.shift() ?? { data: null, error: null };
    const chain = (kind: string) => {
      const result = next();
      calls.push(kind);
      const api = {
        eq: () => api,
        select: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (v: FakeResult) => unknown) => resolve(result),
      };
      return api;
    };
    return {
      calls,
      from: () => ({
        upsert: () => Promise.resolve(next()),
        delete: () => chain("delete"),
      }),
    };
  }

  test("refuses to write a note without an authenticated owner", async () => {
    const client = makeClient([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseSyncAdapter(client as any);
    await expect(adapter.upsert({ ...note, userId: null })).rejects.toThrow(
      "authenticated user",
    );
    expect(client.calls).toHaveLength(0);
  });

  test("reports a purge that RLS silently ignored instead of dropping the row locally", async () => {
    const client = makeClient([{ data: [], error: null }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseSyncAdapter(client as any);
    await expect(adapter.purge?.(note.id)).rejects.toThrow("Only the owner");
  });

  test("succeeds when the purge actually deleted the row", async () => {
    const client = makeClient([{ data: [{ id: note.id }], error: null }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createSupabaseSyncAdapter(client as any);
    await expect(adapter.purge?.(note.id)).resolves.toBeUndefined();
  });
});


