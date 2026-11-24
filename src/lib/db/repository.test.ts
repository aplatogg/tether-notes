import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Note } from "@/lib/notes/types";
import { createNotesDatabase, type NotesDatabase } from "./database";
import { NotesRepository } from "./repository";

const NOW = "2026-11-24T12:34:56.789Z";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-default",
    userId: "user-1",
    title: "Release plan",
    body: "Ship it",
    tags: ["work"],
    isPinned: false,
    isArchived: false,
    deletedAt: null,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
    syncStatus: "local",
    ...overrides,
  };
}

describe("notes database factory", () => {
  test("imports safely without browser globals and accepts an explicit factory", async () => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("IDBKeyRange", undefined);

    try {
      const databaseModule = await import("./database");

      expect(databaseModule.getNotesDatabase()).toBeNull();

      const database = databaseModule.createNotesDatabase("explicit-factory-test", {
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      });

      try {
        await database.open();
        expect(database.tables.map((table) => table.name).sort()).toEqual([
          "metadata",
          "notes",
          "outbox",
        ]);
        expect(database.notes.schema.primKey.name).toBe("id");
        expect(database.notes.schema.indexes.map((index) => index.name)).toEqual(
          expect.arrayContaining([
            "userId",
            "updatedAt",
            "isArchived",
            "isPinned",
            "deletedAt",
            "[userId+updatedAt]",
          ]),
        );
        expect(database.outbox.schema.primKey.name).toBe("noteId");
        expect(database.metadata.schema.primKey.name).toBe("key");
      } finally {
        await database.delete();
      }
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

describe("NotesRepository", () => {
  let database: NotesDatabase;
  let repository: NotesRepository;
  let currentTime: string;
  let operationNumber: number;

  beforeEach(() => {
    currentTime = NOW;
    operationNumber = 0;
    database = createNotesDatabase("repository-test", {
      indexedDB: new IDBFactory(),
      IDBKeyRange,
    });
    repository = new NotesRepository(database, {
      now: () => currentTime,
      createOperationId: () => `operation-${(operationNumber += 1)}`,
    });
  });

  afterEach(async () => {
    await database.delete();
  });

  test("upserts a local note and queues its pending snapshot atomically", async () => {
    const saved = await repository.localUpsert(makeNote());

    expect(saved).toEqual(
      makeNote({
        deletedAt: null,
        updatedAt: NOW,
        syncStatus: "pending",
      }),
    );
    expect(await repository.get(saved.id)).toEqual(saved);
    expect(await repository.listOutbox()).toEqual([
      {
        noteId: saved.id,
        userId: saved.userId,
        kind: "upsert",
        payload: saved,
        operationId: "operation-1",
        attempts: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
  });

  test("rolls back the note when its outbox write fails", async () => {
    database.outbox.hook("creating", () => {
      throw new Error("outbox unavailable");
    });

    await expect(repository.localUpsert(makeNote())).rejects.toThrow(
      "outbox unavailable",
    );
    expect(await repository.get("note-default")).toBeUndefined();
    expect(await repository.listOutbox()).toEqual([]);
  });

  test("rejects malformed notes before writing local state", async () => {
    const malformed = makeNote({ updatedAt: "not-a-timestamp" });

    await expect(repository.localUpsert(malformed)).rejects.toThrow();
    expect(await database.notes.count()).toBe(0);
    expect(await database.outbox.count()).toBe(0);
  });

  test("soft-deletes a local note without removing its stored record", async () => {
    const note = makeNote({ syncStatus: "synced" });
    await database.notes.put(note);
    currentTime = "2026-11-24T13:00:00.000Z";

    const deleted = await repository.localSoftDelete(note.id);

    expect(deleted).toEqual(
      makeNote({
        deletedAt: currentTime,
        updatedAt: currentTime,
        syncStatus: "pending",
      }),
    );
    expect(await database.notes.count()).toBe(1);
    expect(await repository.get(note.id)).toEqual(deleted);
    expect(await repository.listOutbox()).toEqual([
      {
        noteId: note.id,
        userId: note.userId,
        kind: "delete",
        payload: deleted,
        operationId: "operation-1",
        attempts: 0,
        createdAt: currentTime,
        updatedAt: currentTime,
      },
    ]);
  });

  test("rolls back a soft-delete when its outbox write fails", async () => {
    const note = makeNote({ syncStatus: "synced" });
    await database.notes.put(note);
    database.outbox.hook("creating", () => {
      throw new Error("outbox unavailable");
    });

    await expect(repository.localSoftDelete(note.id)).rejects.toThrow(
      "outbox unavailable",
    );
    expect(await repository.get(note.id)).toEqual(note);
    expect(await repository.listOutbox()).toEqual([]);
  });

  test("coalesces repeated upserts into the newest payload while preserving queue age", async () => {
    await repository.localUpsert(makeNote());
    currentTime = "2026-11-24T13:00:00.000Z";

    const saved = await repository.localUpsert(
      makeNote({ title: "Revised plan", isPinned: true }),
    );

    expect(await repository.listOutbox()).toEqual([
      {
        noteId: saved.id,
        userId: saved.userId,
        kind: "upsert",
        payload: saved,
        operationId: "operation-2",
        attempts: 0,
        createdAt: NOW,
        updatedAt: currentTime,
      },
    ]);
  });

  test("lets a delete replace an earlier queued upsert", async () => {
    await repository.localUpsert(makeNote());
    currentTime = "2026-11-24T13:00:00.000Z";

    const deleted = await repository.localSoftDelete("note-default");

    expect(await repository.listOutbox()).toEqual([
      {
        noteId: deleted.id,
        userId: deleted.userId,
        kind: "delete",
        payload: deleted,
        operationId: "operation-2",
        attempts: 0,
        createdAt: NOW,
        updatedAt: currentTime,
      },
    ]);
  });

  test("lets a later upsert restore a soft-deleted note and replace its delete", async () => {
    await repository.localUpsert(makeNote());
    currentTime = "2026-11-24T13:00:00.000Z";
    const deleted = await repository.localSoftDelete("note-default");
    currentTime = "2026-11-24T14:00:00.000Z";

    const restored = await repository.localUpsert({
      ...deleted,
      title: "Restored plan",
    });

    expect(restored.deletedAt).toBeNull();
    expect(await repository.listOutbox()).toEqual([
      {
        noteId: restored.id,
        userId: restored.userId,
        kind: "upsert",
        payload: restored,
        operationId: "operation-3",
        attempts: 0,
        createdAt: NOW,
        updatedAt: currentTime,
      },
    ]);
  });

  test("applies a remote upsert as synced without queuing a mutation", async () => {
    const remote = makeNote({
      id: "remote-note",
      title: "From another device",
      syncStatus: "pending",
      lastSyncError: "stale local error",
    });

    const saved = await repository.applyRemoteUpsert(remote);

    expect(saved).toEqual(
      makeNote({
        id: "remote-note",
        title: "From another device",
        syncStatus: "synced",
      }),
    );
    expect(saved).not.toHaveProperty("lastSyncError");
    expect(await repository.get(saved.id)).toEqual(saved);
    expect(await repository.listOutbox()).toEqual([]);
  });

  test("applies a remote delete to an existing note without queuing a mutation", async () => {
    const note = makeNote({ syncStatus: "synced" });
    await database.notes.put(note);
    const deletedAt = "2026-11-24T15:00:00.000Z";

    const deleted = await repository.applyRemoteDelete({
      id: note.id,
      userId: note.userId,
      deletedAt,
      updatedAt: deletedAt,
    });

    expect(deleted).toEqual(
      makeNote({
        deletedAt,
        updatedAt: deletedAt,
        syncStatus: "synced",
      }),
    );
    expect(await repository.get(note.id)).toEqual(deleted);
    expect(await repository.listOutbox()).toEqual([]);
  });

  test("stores a remote tombstone when the deleted note is not cached", async () => {
    const createdAt = "2026-11-20T00:00:00.000Z";
    const deletedAt = "2026-11-24T15:00:00.000Z";

    const tombstone = await repository.applyRemoteDelete({
      id: "missing-remote-note",
      userId: "user-1",
      createdAt,
      deletedAt,
      updatedAt: deletedAt,
    });

    expect(tombstone).toEqual({
      id: "missing-remote-note",
      userId: "user-1",
      title: "",
      body: "",
      tags: [],
      isPinned: false,
      isArchived: false,
      deletedAt,
      createdAt,
      updatedAt: deletedAt,
      syncStatus: "synced",
    });
    expect(await repository.get("missing-remote-note")).toEqual(tombstone);
    expect(await repository.listOutbox()).toEqual([]);
  });

  test("records a failed mutation on both the outbox and its note", async () => {
    const saved = await repository.localUpsert(makeNote());
    const [mutation] = await repository.listOutbox();
    currentTime = "2026-11-24T13:00:00.000Z";

    const updated = await repository.markMutationFailed(
      saved.id,
      mutation.operationId,
      new Error("network unavailable"),
    );

    expect(updated).toBe(true);
    expect(await repository.get(saved.id)).toEqual({
      ...saved,
      syncStatus: "error",
      lastSyncError: "network unavailable",
    });
    expect(await repository.listOutbox()).toEqual([
      {
        ...mutation,
        attempts: 1,
        updatedAt: currentTime,
        lastError: "network unavailable",
      },
    ]);
  });

  test("does not let a stale success clear a newer queued mutation", async () => {
    await repository.localUpsert(makeNote());
    const [firstMutation] = await repository.listOutbox();
    currentTime = "2026-11-24T13:00:00.000Z";
    const newestNote = await repository.localUpsert(
      makeNote({ title: "Newest local edit" }),
    );
    const [newestMutation] = await repository.listOutbox();

    const removed = await repository.removeMutation(
      firstMutation.noteId,
      firstMutation.operationId,
    );

    expect(removed).toBe(false);
    expect(await repository.listOutbox()).toEqual([newestMutation]);
    expect(await repository.get(newestNote.id)).toEqual(newestNote);
  });

  test("removes the matching mutation and marks its note synced", async () => {
    const saved = await repository.localUpsert(makeNote());
    const [mutation] = await repository.listOutbox();

    const removed = await repository.removeMutation(
      mutation.noteId,
      mutation.operationId,
    );

    expect(removed).toBe(true);
    expect(await repository.listOutbox()).toEqual([]);
    expect(await repository.get(saved.id)).toEqual({
      ...saved,
      syncStatus: "synced",
    });
  });

  test("lists only one user's notes in domain sort order", async () => {
    await repository.applyRemoteUpsert(
      makeNote({
        id: "user-1-new",
        updatedAt: "2026-11-23T00:00:00.000Z",
      }),
    );
    await repository.applyRemoteUpsert(
      makeNote({
        id: "user-2-note",
        userId: "user-2",
        isPinned: true,
        updatedAt: "2026-11-24T00:00:00.000Z",
      }),
    );
    await repository.applyRemoteUpsert(
      makeNote({
        id: "user-1-pinned",
        isPinned: true,
        updatedAt: "2026-11-20T00:00:00.000Z",
      }),
    );
    await repository.applyRemoteUpsert(
      makeNote({ id: "local-note", userId: null }),
    );

    const notes = await repository.list("user-1");

    expect(notes.map((note) => note.id)).toEqual([
      "user-1-pinned",
      "user-1-new",
    ]);
  });

  test("materializes queryable per-user pin, archive, and deletion indexes", async () => {
    await repository.applyRemoteUpsert(
      makeNote({ id: "pinned-note", isPinned: true }),
    );
    await repository.applyRemoteUpsert(
      makeNote({ id: "archived-note", isArchived: true }),
    );
    await repository.applyRemoteDelete({
      id: "deleted-note",
      userId: "user-1",
      createdAt: "2026-11-20T00:00:00.000Z",
      deletedAt: "2026-11-24T15:00:00.000Z",
      updatedAt: "2026-11-24T15:00:00.000Z",
    });

    const ownerKey = "user:user-1";

    expect(
      await database.notes
        .where("[ownerKey+pinnedIndex]")
        .equals([ownerKey, 1])
        .primaryKeys(),
    ).toEqual(["pinned-note"]);
    expect(
      await database.notes
        .where("[ownerKey+archivedIndex]")
        .equals([ownerKey, 1])
        .primaryKeys(),
    ).toEqual(["archived-note"]);
    expect(
      await database.notes
        .where("[ownerKey+deletedIndex]")
        .equals([ownerKey, 1])
        .primaryKeys(),
    ).toEqual(["deleted-note"]);
  });

  test("clears one user's notes and outbox without touching other owners", async () => {
    await repository.localUpsert(makeNote({ id: "user-1-note" }));
    await repository.localUpsert(
      makeNote({ id: "user-2-note", userId: "user-2" }),
    );
    await repository.localUpsert(
      makeNote({ id: "local-note", userId: null }),
    );

    await repository.clearUserData("user-1");

    expect(await repository.list("user-1")).toEqual([]);
    expect((await repository.list("user-2")).map((note) => note.id)).toEqual([
      "user-2-note",
    ]);
    expect((await repository.list(null)).map((note) => note.id)).toEqual([
      "local-note",
    ]);
    expect((await repository.listOutbox()).map((mutation) => mutation.noteId)).toEqual([
      "local-note",
      "user-2-note",
    ]);
  });

  test("lists queued mutations for only the requested owner", async () => {
    await repository.localUpsert(makeNote({ id: "user-1-note" }));
    await repository.localUpsert(
      makeNote({ id: "user-2-note", userId: "user-2" }),
    );
    await repository.localUpsert(makeNote({ id: "local-note", userId: null }));

    expect((await repository.listOutbox("user-1")).map(({ noteId }) => noteId)).toEqual([
      "user-1-note",
    ]);
    expect((await repository.listOutbox(null)).map(({ noteId }) => noteId)).toEqual([
      "local-note",
    ]);
  });

  test("keeps a pending local edit when a remote echo arrives", async () => {
    const pending = await repository.localUpsert(makeNote({ title: "Local edit" }));
    const remote = makeNote({
      title: "Stale remote echo",
      updatedAt: "2026-11-24T13:00:00.000Z",
      syncStatus: "synced",
    });

    const result = await repository.mergeRemote(remote);

    expect(result).toBe("ignored-pending");
    expect(await repository.get(pending.id)).toEqual(pending);
    expect(await repository.listOutbox("user-1")).toHaveLength(1);
  });

  test("merges only newer remote state when no local mutation is pending", async () => {
    await repository.applyRemoteUpsert(
      makeNote({ title: "Current", syncStatus: "synced" }),
    );

    expect(
      await repository.mergeRemote(
        makeNote({
          title: "Older",
          updatedAt: "2026-11-19T00:00:00.000Z",
          syncStatus: "synced",
        }),
      ),
    ).toBe("ignored-older");

    const newer = makeNote({
      title: "Newer",
      updatedAt: "2026-11-25T00:00:00.000Z",
      syncStatus: "synced",
    });

    expect(await repository.mergeRemote(newer)).toBe("applied");
    expect(await repository.get(newer.id)).toEqual(newer);
  });

  test("re-applies equal-timestamp remote state so share metadata refreshes", async () => {
    const shared = makeNote({
      id: "shared-1",
      userId: "owner-9",
      shared: true,
      sharedFor: "user-1",
      updatedAt: "2026-11-24T13:00:00.000Z",
      syncStatus: "synced",
    });
    await repository.applyRemoteUpsert(shared);

    const enriched = makeNote({
      ...shared,
      ownerEmail: "owner@example.com",
      shareGroup: "Kerja",
    });

    expect(await repository.mergeRemote(enriched)).toBe("applied");
    const stored = await repository.get(shared.id);
    expect(stored?.ownerEmail).toBe("owner@example.com");
    expect(stored?.shareGroup).toBe("Kerja");
  });

  test("setLocalShareGroup updates only the group label without an outbox mutation", async () => {
    const shared = makeNote({
      id: "shared-2",
      userId: "owner-9",
      shared: true,
      sharedFor: "user-1",
      syncStatus: "synced",
    });
    await repository.applyRemoteUpsert(shared);

    const updated = await repository.setLocalShareGroup("shared-2", "Kerja");
    expect(updated.shareGroup).toBe("Kerja");
    expect((await repository.get("shared-2"))?.shareGroup).toBe("Kerja");
    expect(await repository.listOutbox("user-1")).toHaveLength(0);

    const cleared = await repository.setLocalShareGroup("shared-2", "  ");
    expect(cleared.shareGroup).toBeNull();
  });

  test("stores and reads metadata without mixing it into note records", async () => {
    await repository.setMetadata("last-pull:user-1", NOW);

    expect(await repository.getMetadata<string>("last-pull:user-1")).toBe(NOW);
    expect(await repository.getMetadata("missing")).toBeUndefined();
    expect(await database.notes.count()).toBe(0);
  });
});
