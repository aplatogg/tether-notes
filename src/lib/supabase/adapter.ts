import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Note } from "@/lib/notes/types";
import type { SyncAdapter } from "@/lib/sync/engine";

const timestampSchema = z.iso.datetime({ offset: true });

const remoteNoteSchema = z
  .object({
    id: z.uuid(),
    user_id: z.uuid(),
    title: z.string(),
    body: z.string(),
    tags: z.array(z.string()),
    is_pinned: z.boolean(),
    is_archived: z.boolean(),
    lock_hash: z.string().nullable().optional(),
    deleted_at: timestampSchema.nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict();

export type RemoteNoteRow = z.infer<typeof remoteNoteSchema>;

function throwIfError(error: { message?: string } | null): void {
  if (error) {
    throw new Error(error.message || "Supabase request failed");
  }
}

export function noteToRemoteRow(note: Note): RemoteNoteRow {
  if (note.userId === null) {
    throw new Error("Remote sync requires an authenticated user");
  }

  return remoteNoteSchema.parse({
    id: note.id,
    user_id: note.userId,
    title: note.title,
    body: note.body,
    tags: [...note.tags],
    is_pinned: note.isPinned,
    is_archived: note.isArchived,
    lock_hash: note.lockHash ?? null,
    deleted_at: note.deletedAt,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
  });
}

export function remoteRowToNote(value: unknown, currentUserId?: string): Note {
  const row = remoteNoteSchema.parse(value);
  const shared = currentUserId !== undefined && row.user_id !== currentUserId;

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    body: row.body,
    tags: [...row.tags],
    isPinned: row.is_pinned,
    isArchived: row.is_archived,
    lockHash: row.lock_hash ?? null,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: "synced",
    lastSyncError: undefined,
    shared,
    sharedFor: shared ? (currentUserId ?? null) : null,
    ownerEmail: null,
  };
}

export function createSupabaseSyncAdapter(client: SupabaseClient): SyncAdapter {
  const write = async (note: Note): Promise<void> => {
    const { error } = await client
      .from("notes")
      .upsert(noteToRemoteRow(note), { onConflict: "id" });
    throwIfError(error);
  };

  return {
    async pull(userId) {
      // RLS returns our own notes plus notes shared with us; no user_id filter.
      const { data, error } = await client
        .from("notes")
        .select(
          "id,user_id,title,body,tags,is_pinned,is_archived,lock_hash,deleted_at,created_at,updated_at",
        )
        .order("updated_at", { ascending: true });

      throwIfError(error);

      const owners = await client.rpc("my_shared_note_owners");
      if (owners.error) throw new Error(owners.error.message);
      const ownerEmailByNote = new Map<string, string>(
        (owners.data ?? []).map((row: { note_id: string; owner_email: string }) => [
          row.note_id,
          row.owner_email,
        ]),
      );

      return (data ?? []).map((row) => {
        const note = remoteRowToNote(row, userId);
        if (note.shared) {
          note.ownerEmail = ownerEmailByNote.get(note.id) ?? null;
        }
        return note;
      });
    },

    upsert: write,
    softDelete: write,

    async purge(noteId) {
      const { error } = await client.from("notes").delete().eq("id", noteId);
      throwIfError(error);
    },

    subscribe(userId, onRemoteNote, onError) {
      // No user_id filter: RLS already limits rows to ours plus shared ones.
      const channel = client
        .channel(`notes:${userId}:${globalThis.crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notes" },
          (payload) => {
            if (!payload.new || Object.keys(payload.new).length === 0) {
              return;
            }

            try {
              void onRemoteNote(remoteRowToNote(payload.new, userId));
            } catch (error) {
              onError(error);
            }
          },
        )
        .subscribe((status, error) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            onError(error ?? new Error(`Realtime subscription ${status.toLowerCase()}`));
          }
        });

      return async () => {
        await client.removeChannel(channel);
      };
    },
  };
}




