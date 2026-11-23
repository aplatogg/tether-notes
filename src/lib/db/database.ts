import Dexie, { type Table } from "dexie";
import type { Note } from "../notes/types";

export type MutationKind = "upsert" | "delete";

export interface OutboxMutation {
  noteId: string;
  userId: string | null;
  kind: MutationKind;
  payload: Note;
  operationId: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface MetadataRecord {
  key: string;
  value: unknown;
}

export interface StoredNote extends Note {
  ownerKey?: string;
  pinnedIndex?: 0 | 1;
  archivedIndex?: 0 | 1;
  deletedIndex?: 0 | 1;
}

export interface NotesDatabaseOptions {
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

export class NotesDatabase extends Dexie {
  notes!: Table<StoredNote, string>;
  outbox!: Table<OutboxMutation, string>;
  metadata!: Table<MetadataRecord, string>;
  meta!: Table<MetadataRecord, string>;

  constructor(name: string, options: Required<NotesDatabaseOptions>) {
    super(name, options);

    this.version(1).stores({
      notes:
        "id, userId, updatedAt, isArchived, isPinned, deletedAt, [userId+updatedAt], [userId+isArchived], [userId+isPinned], [userId+deletedAt]",
      outbox: "noteId, userId, kind, operationId, createdAt, updatedAt",
      metadata: "key",
    });

    this.version(2)
      .stores({
        notes:
          "id, userId, ownerKey, updatedAt, isArchived, isPinned, deletedAt, [userId+updatedAt], [userId+isArchived], [userId+isPinned], [userId+deletedAt], [ownerKey+updatedAt], [ownerKey+archivedIndex], [ownerKey+pinnedIndex], [ownerKey+deletedIndex]",
        outbox: "noteId, userId, kind, operationId, createdAt, updatedAt",
        metadata: "key",
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<StoredNote, string>("notes")
          .toCollection()
          .modify((note) => {
            Object.assign(note, noteIndexFields(note));
          });
      });

    this.meta = this.table("metadata");
  }
}

export function ownerKeyFor(userId: string | null): string {
  return userId === null ? "local" : `user:${userId}`;
}

export function noteIndexFields(
  note: Pick<Note, "userId" | "isPinned" | "isArchived" | "deletedAt">,
): Required<
  Pick<StoredNote, "ownerKey" | "pinnedIndex" | "archivedIndex" | "deletedIndex">
> {
  return {
    ownerKey: ownerKeyFor(note.userId),
    pinnedIndex: note.isPinned ? 1 : 0,
    archivedIndex: note.isArchived ? 1 : 0,
    deletedIndex: note.deletedAt === null ? 0 : 1,
  };
}

export function toStoredNote(note: Note): StoredNote {
  return { ...note, ...noteIndexFields(note) };
}

export function fromStoredNote(note: StoredNote): Note {
  const value = { ...note };
  delete value.ownerKey;
  delete value.pinnedIndex;
  delete value.archivedIndex;
  delete value.deletedIndex;

  return value;
}

export function createNotesDatabase(
  name: string,
  options: NotesDatabaseOptions = {},
): NotesDatabase {
  const indexedDBFactory = options.indexedDB ?? globalThis.indexedDB;
  const keyRange = options.IDBKeyRange ?? globalThis.IDBKeyRange;

  if (!indexedDBFactory || !keyRange) {
    throw new Error("IndexedDB is not available in this environment");
  }

  return new NotesDatabase(name, {
    indexedDB: indexedDBFactory,
    IDBKeyRange: keyRange,
  });
}

let browserDatabase: NotesDatabase | undefined;

export function getNotesDatabase(): NotesDatabase | null {
  if (!globalThis.indexedDB || !globalThis.IDBKeyRange) {
    return null;
  }

  browserDatabase ??= createNotesDatabase("tether-notes");
  return browserDatabase;
}
