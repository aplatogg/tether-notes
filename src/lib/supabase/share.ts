import type { SupabaseClient } from "@supabase/supabase-js";

export interface SharedNote {
  id: string;
  title: string;
  body: string | null;
  updatedAt: string;
  isLocked: boolean;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createShareLink(
  client: SupabaseClient,
  noteId: string,
  ownerId: string,
): Promise<string> {
  const existing = await client
    .from("note_shares")
    .select("token")
    .eq("note_id", noteId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.token) return existing.data.token;

  const token = randomToken();
  const { error } = await client
    .from("note_shares")
    .insert({ note_id: noteId, owner_id: ownerId, token });

  if (error) throw new Error(error.message);
  return token;
}

export async function revokeShareLink(client: SupabaseClient, noteId: string): Promise<void> {
  const { error } = await client
    .from("note_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("note_id", noteId)
    .is("revoked_at", null);

  if (error) throw new Error(error.message);
}

export async function fetchSharedNote(
  client: SupabaseClient,
  token: string,
): Promise<SharedNote | null> {
  const { data, error } = await client.rpc("shared_note", { p_token: token });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    id: row.id,
    title: row.title ?? "",
    body: row.body,
    updatedAt: row.updated_at,
    isLocked: row.is_locked === true,
  };
}
