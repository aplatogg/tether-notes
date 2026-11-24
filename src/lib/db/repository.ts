import { z } from "zod";
import { sortNotes } from "../notes/model";
import type { Note } from "../notes/types";
import {
  fromStoredNote,
  ownerKeyFor,
  type NotesDatabase,
  type OutboxMutation,
  toStoredNote,
} from "./database";

const timestampSchema = z.iso.datetime({ offset: true });
const userIdSchema = z.string().min(1).nullable();

export const noteSchema = z
  .object({
    id: z.string().min(1),
    userId: userIdSchema,
    title: z.string(),
    body: z.string(),
    tags: z.array(z.string()),
    isPinned: z.boolean(),
    isArchived: z.boolean(),
    lockHash: z.string().nullable().optional(),
    deletedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    syncStatus: z.enum(["local", "pending", "synced", "error"]),
    lastSyncError: z.string().optional(),
    shared: z.boolean().optional(),
    sharedFor: z.string().nullable().optional(),
    ownerEmail: z.string().nullable().optional(),
    shareGroup: z.string().nullable().optional(),
    reminderAt: timestampSchema.nullable().optional(),
    folder: z.string().optional(),
    workspaceId: z.uuid().nullable().optional(),
  })
  .strict();

/** Outbox mutations for workspace notes use this owner so they sync under any signed-in user. */
export const WORKSPACE_MUTATION_OWNER = "workspace";

const remoteDeleteSchema = z
  .object({
    id: z.string().min(1),
    userId: userIdSchema,
    deletedAt: timestampSchema,
    updatedAt: timestampSchema,
    createdAt: timestampSchema.optional(),
  })
  .strict();

export type RemoteDeleteInput = z.input<typeof remoteDeleteSchema>;

export function parseNote(value: unknown): Note {
  return noteSchema.parse(value);
}

export interface NotesRepositoryOptions {
  now?: () => string;
  createOperationId?: () => string;
}

export interface ClearUserDataResult {
  notesDeleted: number;
  mutationsDeleted: number;
}

export type RemoteMergeResult = "applied" | "ignored-older" | "ignored-pending";

function withoutSyncError(note: Note): Note {
  const cleanNote = { ...note };
  delete cleanNote.lastSyncError;
  return cleanNote;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class NotesRepository {
  private readonly now: () => string;
  private readonly createOperationId: () => string;

  constructor(
    private readonly database: NotesDatabase,
    options: NotesRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createOperationId =
      options.createOperationId ?? (() => globalThis.crypto.randomUUID());
  }

  async get(noteId: string): Promise<Note | undefined> {
    const note = await this.database.notes.get(noteId);
    return note === undefined ? undefined : parseNote(fromStoredNote(note));
  }

  async list(userId: string | null): Promise<Note[]> {
    const ownerId = userIdSchema.parse(userId);
    const own = await this.database.notes
      .where("ownerKey")
      .equals(ownerKeyFor(ownerId))
      .toArray();
    // Notes shared with this account are stored under the owner's key but
    // flagged with sharedFor = our user id.
    const shared =
      ownerId === null
        ? []
        : await this.database.notes
            .where("sharedIndex")
            .equals(1)
            .filter((note) => note.sharedFor === ownerId)
            .toArray();
    // Workspace notes are stored under the owner's key but flagged; RLS only
    // ever delivers workspaces this account belongs to.
    const workspaceNotes =
      ownerId === null
        ? []
        : await this.database.notes.where("workspaceIndex").equals(1).toArray();

    return sortNotes(
      [...own, ...shared, ...workspaceNotes].map((note) => parseNote(fromStoredNote(note))),
    );
  }

  private async assertNotShared(noteId: string): Promise<void> {
    const existing = await this.database.notes.get(noteId);
    // Workspace notes are collaborative (read-write for members); only
    // grant-shared notes are read-only.
    if (existing?.shared && !existing.workspaceId) {
      throw new Error("Notes shared with you are read-only");
    }
  }

  async localUpsert(value: Note): Promise<Note> {
    const input = parseNote(value);
    const timestamp = timestampSchema.parse(this.now());
    const operationId = z.string().min(1).parse(this.createOperationId());

    return this.database.transaction(
      "rw",
      this.database.notes,
      this.database.outbox,
      async () => {
        await this.assertNotShared(input.id);
        const existingNote = await this.database.notes.get(input.id);
        const existingMutation = await this.database.outbox.get(input.id);
        const saved = parseNote({
          ...withoutSyncError(input),
          createdAt: existingNote?.createdAt ?? input.createdAt,
          deletedAt: null,
          updatedAt: timestamp,
          syncStatus: "pending",
        });
        const mutation: OutboxMutation = {
          noteId: saved.id,
          userId: saved.workspaceId ? WORKSPACE_MUTATION_OWNER : saved.userId,
          kind: "upsert",
          payload: saved,
          operationId,
          attempts: 0,
          createdAt: existingMutation?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };

        await this.database.notes.put(toStoredNote(saved));
        await this.database.outbox.put(mutation);

        return saved;
      },
    );
  }

  async localSoftDelete(noteId: string): Promise<Note> {
    const id = z.string().min(1).parse(noteId);
    const timestamp = timestampSchema.parse(this.now());
    const operationId = z.string().min(1).parse(this.createOperationId());

    return this.database.transaction(
      "rw",
      this.database.notes,
      this.database.outbox,
      async () => {
        await this.assertNotShared(id);
        const existingNote = await this.database.notes.get(id);

        if (!existingNote) {
          throw new Error(`Note not found: ${id}`);
        }

        const existingMutation = await this.database.outbox.get(id);
        const saved = parseNote({
          ...withoutSyncError(parseNote(fromStoredNote(existingNote))),
          deletedAt: timestamp,
          updatedAt: timestamp,
          syncStatus: "pending",
        });
        const mutation: OutboxMutation = {
          noteId: saved.id,
          userId: saved.workspaceId ? WORKSPACE_MUTATION_OWNER : saved.userId,
          kind: "delete",
          payload: saved,
          operationId,
          attempts: 0,
          createdAt: existingMutation?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };

        await this.database.notes.put(toStoredNote(saved));
        await this.database.outbox.put(mutation);

        return saved;
      },
    );
  }

  async applyRemoteUpsert(value: Note): Promise<Note> {
    const saved = parseNote({
      ...withoutSyncError(parseNote(value)),
      syncStatus: "synced",
    });

    await this.database.notes.put(toStoredNote(saved));
    return saved;
  }

  async applyRemoteDelete(value: RemoteDeleteInput): Promise<Note | undefined> {
    const input = remoteDeleteSchema.parse(value);
    const existingNote = await this.database.notes.get(input.id);

    if (!existingNote) {
      if (!input.createdAt) {
        return undefined;
      }

      const tombstone = parseNote({
        id: input.id,
        userId: input.userId,
        title: "",
        body: "",
        tags: [],
        isPinned: false,
        isArchived: false,
        deletedAt: input.deletedAt,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        syncStatus: "synced",
      });

      await this.database.notes.put(toStoredNote(tombstone));
      return tombstone;
    }

    const saved = parseNote({
      ...withoutSyncError(parseNote(fromStoredNote(existingNote))),
      userId: input.userId,
      deletedAt: input.deletedAt,
      updatedAt: input.updatedAt,
      syncStatus: "synced",
    });

    await this.database.notes.put(toStoredNote(saved));
    return saved;
  }

  async mergeRemote(value: Note): Promise<RemoteMergeResult> {
    const remote = parseNote({
      ...withoutSyncError(parseNote(value)),
      syncStatus: "synced",
    });

    return this.database.transaction(
      "rw",
      this.database.notes,
      this.database.outbox,
      async () => {
        const pendingMutation = await this.database.outbox.get(remote.id);

        if (pendingMutation) {
          return "ignored-pending";
        }

        const stored = await this.database.notes.get(remote.id);

        if (stored) {
          const local = parseNote(fromStoredNote(stored));

          // Strictly older remote state is ignored. Equal timestamps are still
          // applied so recipient-side share metadata (ownerEmail, shareGroup)
          // refreshes even when the note content did not change.
          if (Date.parse(remote.updatedAt) < Date.parse(local.updatedAt)) {
            return "ignored-older";
          }
        }

        await this.database.notes.put(toStoredNote(remote));
        return "applied";
      },
    );
  }

  async markMutationFailed(
    noteId: string,
    operationId: string,
    error: unknown,
  ): Promise<boolean> {
    const id = z.string().min(1).parse(noteId);
    const expectedOperationId = z.string().min(1).parse(operationId);
    const timestamp = timestampSchema.parse(this.now());
    const message = errorMessage(error);

    return this.database.transaction(
      "rw",
      this.database.notes,
      this.database.outbox,
      async () => {
        const mutation = await this.database.outbox.get(id);

        if (!mutation || mutation.operationId !== expectedOperationId) {
          return false;
        }

        const note = await this.database.notes.get(id);

        if (!note) {
          throw new Error(`Note not found for mutation: ${id}`);
        }

        await this.database.outbox.put({
          ...mutation,
          attempts: mutation.attempts + 1,
          updatedAt: timestamp,
          lastError: message,
        });
        const failed = parseNote({
          ...parseNote(fromStoredNote(note)),
          syncStatus: "error",
          lastSyncError: message,
        });
        await this.database.notes.put(toStoredNote(failed));

        return true;
      },
    );
  }

  /** Permanently removes a note and any queued mutation for it (used by the trash). */
  async hardDelete(noteId: string): Promise<void> {
    const id = z.string().min(1).parse(noteId);

    await this.database.transaction("rw", this.database.notes, this.database.outbox, async () => {
      await this.database.notes.delete(id);
      await this.database.outbox.delete(id);
    });
  }

  /** Restores a trashed note by clearing deleted_at and queueing the change. */
  async restore(noteId: string): Promise<Note> {
    const id = z.string().min(1).parse(noteId);
    const timestamp = timestampSchema.parse(this.now());
    const operationId = z.string().min(1).parse(this.createOperationId());

    return this.database.transaction(
      "rw",
      this.database.notes,
      this.database.outbox,
      async () => {
        await this.assertNotShared(id);
        const existing = await this.database.notes.get(id);
        if (!existing) throw new Error(`Note not found: ${id}`);

        const existingMutation = await this.database.outbox.get(id);
        const restored = parseNote({
          ...withoutSyncError(parseNote(fromStoredNote(existing))),
          deletedAt: null,
          updatedAt: timestamp,
          syncStatus: "pending",
        });
        const mutation: OutboxMutation = {
          noteId: restored.id,
          userId: restored.workspaceId ? WORKSPACE_MUTATION_OWNER : restored.userId,
          kind: "upsert",
          payload: restored,
          operationId,
          attempts: 0,
          createdAt: existingMutation?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };

        await this.database.notes.put(toStoredNote(restored));
        await this.database.outbox.put(mutation);

        return restored;
      },
    );
  }
  /**
   * Sets the recipient-side group label on a shared note locally, without
   * queueing an outbox mutation (shared notes are read-only remotely; the
   * label itself lives on the grant row via an RPC).
   */
  async setLocalShareGroup(noteId: string, group: string | null): Promise<Note> {
    const id = z.string().min(1).parse(noteId);

    return this.database.transaction("rw", this.database.notes, async () => {
      const existing = await this.database.notes.get(id);
      if (!existing) {
        throw new Error(`Note not found: ${id}`);
      }

      const trimmed = group?.trim() ?? "";
      const saved = parseNote({
        ...parseNote(fromStoredNote(existing)),
        shareGroup: trimmed === "" ? null : trimmed,
      });

      await this.database.notes.put(toStoredNote(saved));
      return saved;
    });
  }

  async removeMutation(noteId: string, operationId: string): Promise<boolean> {
    const id = z.string().min(1).parse(noteId);
    const expectedOperationId = z.string().min(1).parse(operationId);

    return this.database.transaction(
      "rw",
      this.database.notes,
      this.database.outbox,
      async () => {
        const mutation = await this.database.outbox.get(id);

        if (!mutation || mutation.operationId !== expectedOperationId) {
          return false;
        }

        const note = await this.database.notes.get(id);

        if (!note) {
          throw new Error(`Note not found for mutation: ${id}`);
        }

        await this.database.outbox.delete(id);
        const synced = parseNote({
          ...withoutSyncError(parseNote(fromStoredNote(note))),
          syncStatus: "synced",
        });
        await this.database.notes.put(toStoredNote(synced));

        return true;
      },
    );
  }

  async clearUserData(userId: string | null): Promise<ClearUserDataResult> {
    const ownerId = userIdSchema.parse(userId);

    return this.database.transaction(
      "rw",
      this.database.notes,
      this.database.outbox,
      async () => {
        if (ownerId === null) {
          const notesDeleted = await this.database.notes
            .where("ownerKey")
            .equals(ownerKeyFor(null))
            .delete();
          const mutationsDeleted = await this.database.outbox
            .filter((mutation) => mutation.userId === null)
            .delete();

          return { notesDeleted, mutationsDeleted };
        }

        const notesDeleted = await this.database.notes
          .where("ownerKey")
          .equals(ownerKeyFor(ownerId))
          .delete();
        const sharedDeleted = await this.database.notes
          .where("sharedIndex")
          .equals(1)
          .filter((note) => note.sharedFor === ownerId)
          .delete();
        const workspaceDeleted = await this.database.notes
          .where("workspaceIndex")
          .equals(1)
          .delete();
        const mutationsDeleted = await this.database.outbox
          .filter(
            (mutation) =>
              mutation.userId === ownerId || mutation.userId === WORKSPACE_MUTATION_OWNER,
          )
          .delete();

        return { notesDeleted: notesDeleted + sharedDeleted + workspaceDeleted, mutationsDeleted };
      },
    );
  }

  async listOutbox(userId?: string | null): Promise<OutboxMutation[]> {
    let mutations: OutboxMutation[];

    if (arguments.length === 0) {
      mutations = await this.database.outbox.toArray();
    } else {
      const ownerId = userIdSchema.parse(userId);
      mutations =
        ownerId === null
          ? await this.database.outbox
              .filter((mutation) => mutation.userId === null)
              .toArray()
          : await this.database.outbox
              .filter(
                (mutation) =>
                  mutation.userId === ownerId || mutation.userId === WORKSPACE_MUTATION_OWNER,
              )
              .toArray();
    }

    return mutations.sort((left, right) => {
      const timestampOrder = left.createdAt.localeCompare(right.createdAt);
      return timestampOrder === 0 ? left.noteId.localeCompare(right.noteId) : timestampOrder;
    });
  }

  async getMetadata<T>(key: string): Promise<T | undefined> {
    const record = await this.database.metadata.get(z.string().min(1).parse(key));
    return record?.value as T | undefined;
  }

  async setMetadata(key: string, value: unknown): Promise<void> {
    await this.database.metadata.put({
      key: z.string().min(1).parse(key),
      value,
    });
  }
}



