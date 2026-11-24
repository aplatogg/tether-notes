"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getNotesDatabase } from "@/lib/db/database";
import { NotesRepository } from "@/lib/db/repository";
import { createDraftNote } from "@/lib/notes/model";
import { selectExpired } from "@/lib/notes/trash";
import type { Note } from "@/lib/notes/types";
import {
  SyncEngine,
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

  const notes = useLiveQuery(async () => {
    if (!repository) {
      return undefined;
    }

    try {
      return await repository.list(userId);
    } catch (error) {
      setStorageError(messageFrom(error));
      return [];
    }
  }, [repository, userId]);

  const pending = useLiveQuery(async () => {
    if (!repository) {
      return 0;
    }

    return (await repository.listOutbox(userId)).length;
  }, [repository, userId], 0);

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
    const unsubscribe = engine.subscribe(setSyncState);
    const handleConnectionChange = () => void engine.sync();

    window.addEventListener("online", handleConnectionChange);
    window.addEventListener("offline", handleConnectionChange);
    void engine.start();

    return () => {
      unsubscribe();
      window.removeEventListener("online", handleConnectionChange);
      window.removeEventListener("offline", handleConnectionChange);
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
    void engineRef.current?.sync();
    return saved;
  }

  async function deleteNote(noteId: string): Promise<Note> {
    const saved = await withRepository((activeRepository) =>
      activeRepository.localSoftDelete(noteId),
    );
    void engineRef.current?.sync();
    return saved;
  }

  async function restoreNote(noteId: string): Promise<Note> {
    const saved = await withRepository((activeRepository) => activeRepository.restore(noteId));
    void engineRef.current?.sync();
    return saved;
  }

  async function deleteForever(noteId: string): Promise<void> {
    await withRepository(async (activeRepository) => {
      if (adapter?.purge) {
        await adapter.purge(noteId);
      }
      await activeRepository.hardDelete(noteId);
    });
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
    deleteForever,
    purgeExpiredTrash,
    retrySync: () => engineRef.current?.sync() ?? Promise.resolve(),
    clearStorageError: () => setStorageError(null),
  };
}

