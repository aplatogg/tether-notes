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

  test("merges notes shared with us from the remote pull", async () => {
    const engine = new SyncEngine(
      repository,
      createAdapter({
        pull: async () => [
          makeNote({
            id: "shared-note",
            userId: "owner-9",
            title: "Shared with me",
            shared: true,
            sharedFor: USER_ID,
            ownerEmail: "owner@example.com",
            updatedAt: "2026-11-23T00:00:00.000Z",
          }),
        ],
      }),
      USER_ID,
      { sleep: async () => undefined },
    );

    await engine.sync();

    const stored = await repository.get("shared-note");
    expect(stored?.shared).toBe(true);
    expect(stored?.ownerEmail).toBe("owner@example.com");
    expect((await repository.list(USER_ID)).map((note) => note.id)).toContain("shared-note");
    // Shared notes never enter the outbox for this user.
    expect(await repository.listOutbox(USER_ID)).toEqual([]);
    expect(engine.getState().phase).toBe("synced");
  });

  test("rejects local edits to a shared note", async () => {
    await repository.applyRemoteUpsert(
      makeNote({ id: "shared-note", userId: "owner-9", shared: true, sharedFor: USER_ID }),
    );

    await expect(
      repository.localUpsert(makeNote({ id: "shared-note", userId: "owner-9", shared: true, title: "Hacked" })),
    ).rejects.toThrow("read-only");
    await expect(repository.localSoftDelete("shared-note")).rejects.toThrow("read-only");
    await expect(repository.restore("shared-note")).rejects.toThrow("read-only");
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

  test("onRemote listeners fire when a realtime note arrives", async () => {
    let onRemote: ((note: Note) => void | Promise<void>) | undefined;
    const engine = new SyncEngine(
      repository,
      createAdapter({
        subscribe: (_userId, noteListener) => {
          onRemote = noteListener;
          return () => undefined;
        },
      }),
      USER_ID,
      { sleep: async () => undefined },
    );
    let fired = 0;
    let received: { type: string; id?: string } | null = null;
    const off = engine.onRemote((event) => {
      fired += 1;
      received = event.type === "note" ? { type: "note", id: event.note.id } : { type: "delete", id: event.noteId };
    });

    await engine.start();
    await onRemote?.(makeNote({ id: "live-2", updatedAt: "2026-11-25T00:00:00.000Z" }));

    expect(fired).toBe(1);
    expect(received).toEqual({ type: "note", id: "live-2" });
    off();
    await onRemote?.(makeNote({ id: "live-3", updatedAt: "2026-11-25T00:00:00.000Z" }));
    expect(fired).toBe(1);
    await engine.stop();
  });

  test("exposes the rows from the latest pull for the server-driven list", async () => {
    const engine = new SyncEngine(
      repository,
      createAdapter({
        pull: async () => [makeNote({ id: "pulled-1", syncStatus: "synced" })],
      }),
      USER_ID,
      { sleep: async () => undefined },
    );

    expect(engine.getLastPull()).toBeNull();
    await engine.sync();
    expect(engine.getLastPull()?.map((note) => note.id)).toEqual(["pulled-1"]);
  });

  test("refreshView skips a pull made within the minimum interval", async () => {
    let pulls = 0;
    const engine = new SyncEngine(
      repository,
      createAdapter({
        pull: async () => {
          pulls += 1;
          return [];
        },
      }),
      USER_ID,
      { sleep: async () => undefined, minPullIntervalMs: 60_000, pollIntervalMs: 0 },
    );

    await engine.sync(); // first pull
    await engine.syncSoon(); // too soon -> skipped
    expect(pulls).toBe(1);
  });

  test("refreshView pulls once the interval has elapsed", async () => {
    let pulls = 0;
    let clock = 0;
    const engine = new SyncEngine(
      repository,
      createAdapter({
        pull: async () => {
          pulls += 1;
          return [];
        },
      }),
      USER_ID,
      {
        sleep: async () => undefined,
        minPullIntervalMs: 1_000,
        pollIntervalMs: 0,
        nowMs: () => clock,
      },
    );

    await engine.sync();
    expect(pulls).toBe(1);

    clock += 2_000;
    await engine.syncSoon();
    expect(pulls).toBe(2);
  });

  test("polls in the background while started and stops on stop", async () => {
    let pulls = 0;
    let inFlight = false;
    const engine = new SyncEngine(
      repository,
      createAdapter({
        pull: async () => {
          inFlight = true;
          await new Promise((resolve) => setTimeout(resolve, 25));
          pulls += 1;
          inFlight = false;
          return [];
        },
      }),
      USER_ID,
      { sleep: async () => undefined, pollIntervalMs: 40, minPullIntervalMs: 0 },
    );

    await engine.start();
    expect(pulls).toBe(1);
    expect(inFlight).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(pulls).toBeGreaterThan(1);

    await engine.stop();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const atStop = pulls;
    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(pulls).toBe(atStop);
  });

  test("prunes local rows that vanished from the remote pull", async () => {
    await repository.applyRemoteUpsert(
      makeNote({ id: "still-there", syncStatus: "synced" }),
    );
    await repository.applyRemoteUpsert(
      makeNote({ id: "purged-elsewhere", syncStatus: "synced" }),
    );
    await repository.localUpsert(makeNote({ id: "pending-new", syncStatus: "local" }));

    const engine = new SyncEngine(
      repository,
      createAdapter({
        pull: async () => [makeNote({ id: "still-there", syncStatus: "synced" })],
      }),
      USER_ID,
      { sleep: async () => undefined },
    );

    await engine.sync();

    expect(await repository.get("still-there")).toBeDefined();
    expect(await repository.get("purged-elsewhere")).toBeUndefined();
    // Pending local creation survives the prune and still flushes.
    expect(await repository.get("pending-new")).toBeDefined();
    expect(engine.getState()).toMatchObject({ phase: "synced", pending: 0 });
  });

  test("hard-deletes locally on a remote delete event unless a mutation is pending", async () => {
    let onRemoteDelete: ((noteId: string) => void | Promise<void>) | undefined;
    await repository.applyRemoteUpsert(
      makeNote({ id: "gone-note", syncStatus: "synced" }),
    );
    await repository.localUpsert(makeNote({ id: "busy-note", syncStatus: "local" }));

    const engine = new SyncEngine(
      repository,
      createAdapter({
        // Remote still lists busy-note; the failed push keeps it pending.
        pull: async () => [makeNote({ id: "busy-note", syncStatus: "synced" })],
        upsert: async () => {
          throw new Error("network unavailable");
        },
        subscribe: (_userId, _noteListener, _onError, deleteListener) => {
          onRemoteDelete = deleteListener;
          return () => undefined;
        },
      }),
      USER_ID,
      { maxAttempts: 1, sleep: async () => undefined },
    );

    await engine.start();
    await onRemoteDelete?.("gone-note");
    await onRemoteDelete?.("busy-note");
    await engine.stop();

    expect(await repository.get("gone-note")).toBeUndefined();
    // Pending mutation protects the row from the remote delete.
    expect(await repository.get("busy-note")).toBeDefined();
    expect(await repository.listOutbox(USER_ID)).toHaveLength(1);
  });

  test("starts offline without a channel and subscribes when the network returns", async () => {
    let online = false;
    const subscribe = vi.fn(() => () => undefined);
    const engine = new SyncEngine(
      repository,
      createAdapter({ subscribe }),
      USER_ID,
      { isOnline: () => online, pollIntervalMs: 0, sleep: async () => undefined },
    );

    await engine.start();
    expect(subscribe).not.toHaveBeenCalled();
    expect(engine.getState().phase).toBe("offline");

    online = true;
    window.dispatchEvent(new Event("online"));
    await flush();

    expect(subscribe).toHaveBeenCalledTimes(1);
    // A repeated online event must not stack a second channel.
    window.dispatchEvent(new Event("online"));
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(1);

    await engine.stop();
    // stop() removes the listener: a later online event is ignored.
    window.dispatchEvent(new Event("online"));
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  test("drops a dead channel so it can be rebuilt", async () => {
    let onError: ((error: unknown) => void) | undefined;
    const release = vi.fn();
    const subscribe = vi.fn(
      (_userId: string, _onNote: unknown, errorListener: (error: unknown) => void) => {
        onError = errorListener;
        return release;
      },
    );
    const engine = new SyncEngine(
      repository,
      createAdapter({ subscribe }),
      USER_ID,
      { pollIntervalMs: 0, sleep: async () => undefined },
    );

    await engine.start();
    expect(subscribe).toHaveBeenCalledTimes(1);

    onError?.(new Error("channel closed"));
    await flush();

    expect(release).toHaveBeenCalled();
    expect(engine.getState()).toMatchObject({ phase: "error" });

    // The handle was forgotten, so the engine can reconnect.
    await engine.ensureSubscription();
    expect(subscribe).toHaveBeenCalledTimes(2);

    await engine.stop();
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
