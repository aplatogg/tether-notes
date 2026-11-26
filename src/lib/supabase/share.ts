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

  const isLocked = row.is_locked === true;
  return {
    id: row.id,
    title: isLocked ? "" : (row.title ?? ""),
    body: isLocked ? null : row.body,
    updatedAt: row.updated_at,
    isLocked,
  };
}

export interface NoteGrantEntry {
  granteeId: string;
  email: string;
}

/** Owner lists the accounts a note is shared with. */
export async function listNoteGrants(
  client: SupabaseClient,
  noteId: string,
): Promise<NoteGrantEntry[]> {
  const { data, error } = await client.rpc("note_grant_emails", { p_note_id: noteId });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: { grantee_id: string; email: string }) => ({
    granteeId: row.grantee_id,
    email: row.email,
  }));
}

/** Owner shares a note with another account by email (read-only for them). */
export async function grantNoteToEmail(
  client: SupabaseClient,
  noteId: string,
  email: string,
): Promise<void> {
  const { error } = await client.rpc("share_note_with_email", {
    p_note_id: noteId,
    p_email: email.trim(),
  });
  if (error) throw new Error(error.message);
}

/** Owner revokes one account's access to a note. */
export async function revokeNoteGrant(
  client: SupabaseClient,
  noteId: string,
  granteeId: string,
): Promise<void> {
  const { error } = await client.rpc("revoke_note_share", {
    p_note_id: noteId,
    p_grantee_id: granteeId,
  });
  if (error) throw new Error(error.message);
}
