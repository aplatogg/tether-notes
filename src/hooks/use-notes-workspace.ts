"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getNotesDatabase } from "@/lib/db/database";
import { NotesRepository } from "@/lib/db/repository";
import { createDraftNote } from "@/lib/notes/model";
import { selectExpired } from "@/lib/notes/trash";
import type { Note } from "@/lib/notes/types";
import {
  SyncEngine,
  type RemoteEvent,
  type SyncAdapter,
  type SyncEngineState,
} from "@/lib/sync/engine";

const INITIAL_SYNC_STATE: SyncEngineState = {
  phase: "idle",
  pending: 0,
  attempt: 0,
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useNotesWorkspace(
  userId: string | null,
  adapter: SyncAdapter | null,
) {
  const [repository, setRepository] = useState<NotesRepository | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [syncState, setSyncState] =
    useState<SyncEngineState>(INITIAL_SYNC_STATE);
  // Bumped after every completed sync so the notes liveQuery re-reads the
  // table even when rows were last written by another tab (cross-tab writes
  // don't always re-trigger liveQuery).
  const [syncTick, setSyncTick] = useState(0);
  const engineRef = useRef<SyncEngine | null>(null);

  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      if (!active) return;

      try {
        const database = getNotesDatabase();

        if (!database) {
          setStorageError("IndexedDB is unavailable. Notes cannot be stored in this browser.");
          return;
        }

        setRepository(new NotesRepository(database));
      } catch (error) {
        setStorageError(
          `Local storage could not be opened. Notes are read-only in this tab. ${messageFrom(error)}`,
        );
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const localNotes = useLiveQuery(async () => {
    if (!repository) {
      return undefined;
    }

    try {
      return await repository.list(userId);
    } catch (error) {
      setStorageError(messageFrom(error));
      return [];
    }
  }, [repository, userId, syncTick]);

  // In Supabase mode the server is the display source of truth, but the data
  // comes from the sync engine's own pull (no second request) and realtime
  // events are applied in place. Local-only mode keeps using IndexedDB.
  const [serverNotes, setServerNotes] = useState<Note[] | null>(null);

  const applyPulled = useEffectEvent((pulled: Note[]) => {
    setServerNotes(() => {
      const merged = new Map(pulled.map((note) => [note.id, note]));
      // The engine pulls before it pushes, so its snapshot can predate a local
      // write made moments ago. Unconfirmed local rows win until the server
      // confirms them, otherwise a freshly trashed note flickers back to live.
      for (const local of localNotes ?? []) {
        if (local.syncStatus !== "synced") merged.set(local.id, local);
      }
      return [...merged.values()].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    });
  });

  const applyRemoteEvent = useEffectEvent((event: RemoteEvent) => {
    setServerNotes((current) => {
      if (!current) return current;
      if (event.type === "delete") {
        return current.filter((note) => note.id !== event.noteId);
      }
      const rest = current.filter((note) => note.id !== event.note.id);
      return [event.note, ...rest].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    });
  });

  // Optimistic patch: the list reflects a local write immediately instead of
  // waiting for the next pull to come back over the network. Plain callbacks
  // (not Effect Events) because user handlers invoke them, and the updater form
  // keeps them correct without subscribing to serverNotes.
  const applyLocalPatch = (note: Note) => {
    setServerNotes((current) => {
      if (!current) return current;
      const rest = current.filter((row) => row.id !== note.id);
      return [...rest, note].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    });
  };

  const applyLocalRemove = (noteId: string) => {
    setServerNotes((current) =>
      current ? current.filter((note) => note.id !== noteId) : current,
    );
  };

  const notes =
    adapter !== null && userId !== null ? (serverNotes ?? localNotes) : localNotes;

  const pending = useLiveQuery(async () => {
    if (!repository) {
      return 0;
    }

    return (await repository.listOutbox(userId)).length;
  }, [repository, userId], 0);

  /** User-created groups that exist even before any note is filed into them. */
  const customFolders = useLiveQuery(async () => {
    if (!repository) {
      return [] as string[];
    }

    return (await repository.getMetadata<string[]>("custom-folders")) ?? [];
  }, [repository], [] as string[]);

  useEffect(() => {
    if (!repository) {
      return;
    }

    if (!adapter || userId === null) {
      engineRef.current = null;
      return;
    }

    const engine = new SyncEngine(repository, adapter, userId);
    engineRef.current = engine;
    const unsubscribe = engine.subscribe((next) => {
      setSyncState(next);
      if (next.phase === "synced" || next.phase === "error" || next.phase === "local-only") {
        setSyncTick((tick) => tick + 1);
        const pulled = engine.getLastPull();
        if (pulled) applyPulled(pulled);
      }
    });
    const handleConnectionChange = () => void engine.sync();
    const handleFocus = () => void engine.sync();
    // Realtime arrivals are applied in place; no extra pull needed.
    const offRemote = engine.onRemote((event) => applyRemoteEvent(event));

    window.addEventListener("online", handleConnectionChange);
    window.addEventListener("offline", handleConnectionChange);
    window.addEventListener("focus", handleFocus);
    void engine.start();

    return () => {
      unsubscribe();
      offRemote();
      window.removeEventListener("online", handleConnectionChange);
      window.removeEventListener("offline", handleConnectionChange);
      window.removeEventListener("focus", handleFocus);
      engineRef.current = null;
      void engine.stop();
    };
  }, [adapter, repository, userId]);

  async function withRepository<T>(
    action: (activeRepository: NotesRepository) => Promise<T>,
  ): Promise<T> {
    if (!repository) {
      throw new Error("Local notes are still loading");
    }

    try {
      const result = await action(repository);
      setStorageError(null);
      return result;
    } catch (error) {
      setStorageError(messageFrom(error));
      throw error;
    }
  }

  async function createNote(): Promise<Note> {
    const draft = createDraftNote({ userId });
    const saved = await withRepository((activeRepository) =>
      activeRepository.localUpsert(draft),
    );
    void engineRef.current?.sync();
    return saved;
  }

async function saveNote(note: Note): Promise<Note> {
    const saved = await withRepository((activeRepository) =>
      activeRepository.localUpsert(note),
    );
    applyLocalPatch(saved);
    void engineRef.current?.sync();
    return saved;
  }

  async function deleteNote(noteId: string): Promise<Note> {
    const saved = await withRepository((activeRepository) =>
      activeRepository.localSoftDelete(noteId),
    );
    // Trashing keeps the row (it moves to Trash), so patch rather than remove.
    applyLocalPatch(saved);
    void engineRef.current?.sync();
    return saved;
  }

  async function restoreNote(noteId: string): Promise<Note> {
    const saved = await withRepository((activeRepository) => activeRepository.restore(noteId));
    applyLocalPatch(saved);
    void engineRef.current?.sync();
    return saved;
  }

  /** Updates the recipient-side group label locally (server side goes through an RPC). */
  async function addCustomFolder(name: string): Promise<string[]> {
    const trimmed = name.trim().replace(/\/+/gu, "/").replace(/^\/|\/$/gu, "");
    if (!trimmed) throw new Error("Group name cannot be empty");

    return withRepository(async (activeRepository) => {
      const current = (await activeRepository.getMetadata<string[]>("custom-folders")) ?? [];
      if (current.includes(trimmed)) return current;
      const next = [...current, trimmed].sort((left, right) => left.localeCompare(right));
      await activeRepository.setMetadata("custom-folders", next);
      return next;
    });
  }

  async function setShareGroup(noteId: string, group: string | null): Promise<Note> {
    return withRepository((activeRepository) =>
      activeRepository.setLocalShareGroup(noteId, group),
    );
  }

async function deleteForever(noteId: string): Promise<void> {
    await withRepository(async (activeRepository) => {
      if (adapter?.purge) {
        await adapter.purge(noteId);
      }
      await activeRepository.hardDelete(noteId);
    });
    // Nothing to re-pull for: the row is gone server-side and locally.
    applyLocalRemove(noteId);
  }

  async function purgeExpiredTrash(): Promise<number> {
    if (!repository) return 0;

    const all = await withRepository((activeRepository) => activeRepository.list(userId));
    const expired = selectExpired(all);
    let removed = 0;

    for (const note of expired) {
      try {
        if (adapter?.purge) await adapter.purge(note.id);
        await repository.hardDelete(note.id);
        removed += 1;
      } catch {
        // Keep the note when the remote purge fails so nothing is lost silently.
      }
    }

    return removed;
  }
  return {
    notes,
    customFolders,
    addCustomFolder,
    isLoading: repository === null || notes === undefined,
    storageError,
    syncState:
      !adapter || userId === null
        ? { phase: "local-only", pending, attempt: 0 } satisfies SyncEngineState
        : syncState,
    createNote,
    saveNote,
    deleteNote,
    restoreNote,
    setShareGroup,
    deleteForever,
    purgeExpiredTrash,
    retrySync: () => engineRef.current?.sync() ?? Promise.resolve(),
    // View changes are cheap to refresh but frequent, so they share the engine's
    // minimum-pull-interval gate instead of firing a request per click.
    refreshView: () => engineRef.current?.syncSoon() ?? Promise.resolve(),
    clearStorageError: () => setStorageError(null),
  };
}

