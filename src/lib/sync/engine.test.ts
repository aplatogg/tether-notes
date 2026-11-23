import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createNotesDatabase, type NotesDatabase } from "@/lib/db/database";
import { NotesRepository } from "@/lib/db/repository";
import type { Note } from "@/lib/notes/types";
import {
  SyncEngine,
  type SyncAdapter,
  type SyncEngineState,
} from "./engine";

const USER_ID = "user-1";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-default",
    userId: USER_ID,
    title: "Release plan",
    body: "Ship it",
    tags: ["work"],
    isPinned: false,
    isArchived: false,
    deletedAt: null,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
    syncStatus: "synced",
    ...overrides,
  };
}

function createAdapter(overrides: Partial<SyncAdapter> = {}): SyncAdapter {
  return {
    pull: async () => [],
    upsert: async () => undefined,
    softDelete: async () => undefined,
    subscribe: () => () => undefined,
    ...overrides,
  };
}

describe("SyncEngine", () => {
  let database: NotesDatabase;
  let repository: NotesRepository;
  let operationNumber: number;
  let currentTime: string;

  beforeEach(() => {
    operationNumber = 0;
    currentTime = "2026-11-24T12:00:00.000Z";
    database = createNotesDatabase("sync-engine-test", {
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

  test("reports local-only mode without invoking a remote adapter", async () => {
    const engine = new SyncEngine(repository, null, USER_ID);

    await engine.sync();

    expect(engine.getState()).toMatchObject({
      phase: "local-only",
      pending: 0,
      attempt: 0,
    });
  });

  test("pulls newer remote notes and ignores older remote notes", async () => {
    await repository.applyRemoteUpsert(
      makeNote({ title: "Current", updatedAt: "2026-11-22T00:00:00.000Z" }),
    );
    const engine = new SyncEngine(
      repository,
      createAdapter({
        pull: async () => [
          makeNote({ title: "Older", updatedAt: "2026-11-21T00:00:00.000Z" }),
          makeNote({
            id: "remote-new",
            title: "From another device",
            updatedAt: "2026-11-23T00:00:00.000Z",
          }),
        ],
      }),
      USER_ID,
      { sleep: async () => undefined },
    );

    await engine.sync();

    expect((await repository.get("note-default"))?.title).toBe("Current");
    expect((await repository.get("remote-new"))?.title).toBe("From another device");
    expect(engine.getState().phase).toBe("synced");
  });

  test("flushes queued upserts and soft deletes", async () => {
    const pushed: string[] = [];
    const deleted: string[] = [];
    await repository.localUpsert(makeNote({ id: "upsert-me", syncStatus: "local" }));
    await repository.localUpsert(makeNote({ id: "delete-me", syncStatus: "local" }));
    currentTime = "2026-11-24T13:00:00.000Z";
    await repository.localSoftDelete("delete-me");
    const engine = new SyncEngine(
      repository,
      createAdapter({
        upsert: async (note) => {
          pushed.push(note.id);
        },
        softDelete: async (note) => {
          deleted.push(note.id);
        },
      }),
      USER_ID,
      { sleep: async () => undefined },
    );

    await engine.sync();

    expect(pushed).toEqual(["upsert-me"]);
    expect(deleted).toEqual(["delete-me"]);
    expect(await repository.listOutbox(USER_ID)).toEqual([]);
    expect((await repository.get("upsert-me"))?.syncStatus).toBe("synced");
    expect((await repository.get("delete-me"))?.syncStatus).toBe("synced");
  });

  test("does not clear an edit queued while an older request is in flight", async () => {
    await repository.localUpsert(makeNote({ title: "First edit", syncStatus: "local" }));
    const engine = new SyncEngine(
      repository,
      createAdapter({
        upsert: async () => {
          currentTime = "2026-11-24T14:00:00.000Z";
          await repository.localUpsert(
            makeNote({ title: "Newest edit", syncStatus: "pending" }),
          );
        },
      }),
      USER_ID,
      { maxAttempts: 1, sleep: async () => undefined },
    );

    await engine.sync();

    expect((await repository.get("note-default"))?.title).toBe("Newest edit");
    expect(await repository.listOutbox(USER_ID)).toHaveLength(1);
    expect(engine.getState()).toMatchObject({ phase: "synced", pending: 1 });
  });

  test("bounds retries and keeps failed mutations durable", async () => {
    let calls = 0;
    await repository.localUpsert(makeNote({ syncStatus: "local" }));
    const states: SyncEngineState[] = [];
    const engine = new SyncEngine(
      repository,
      createAdapter({
        upsert: async () => {
          calls += 1;
          throw new Error("network unavailable");
        },
      }),
      USER_ID,
      { maxAttempts: 2, sleep: async () => undefined },
    );
    engine.subscribe((state) => states.push(state));

    await engine.sync();

    expect(calls).toBe(2);
    expect((await repository.listOutbox(USER_ID))[0]).toMatchObject({
      attempts: 2,
      lastError: "network unavailable",
    });
    expect((await repository.get("note-default"))?.syncStatus).toBe("error");
    expect(engine.getState()).toMatchObject({
      phase: "error",
      pending: 1,
      attempt: 2,
      error: "network unavailable",
    });
    expect(states.some(({ phase }) => phase === "syncing")).toBe(true);
  });

  test("applies realtime notes and releases the subscription on stop", async () => {
    let onRemote: ((note: Note) => void | Promise<void>) | undefined;
    let released = false;
    const engine = new SyncEngine(
      repository,
      createAdapter({
        subscribe: (_userId, listener) => {
          onRemote = listener;
          return () => {
            released = true;
          };
        },
      }),
      USER_ID,
      { sleep: async () => undefined },
    );

    await engine.start();
    await onRemote?.(
      makeNote({
        id: "live-note",
        title: "Live update",
        updatedAt: "2026-11-25T00:00:00.000Z",
      }),
    );
    await engine.stop();

    expect((await repository.get("live-note"))?.title).toBe("Live update");
    expect(released).toBe(true);
  });
});
