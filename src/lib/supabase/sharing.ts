import type { SupabaseClient } from "@supabase/supabase-js";

/** Recipient sets or clears the group label on a note shared with them. */
export async function setSharedNoteGroup(
  client: SupabaseClient,
  noteId: string,
  group: string,
): Promise<void> {
  const { error } = await client.rpc("set_shared_note_group", {
    p_note_id: noteId,
    p_group: group,
  });
  if (error) throw new Error(error.message);
}

/**
 * Recipient sets an auto-group rule: every note shared by this owner email is
 * shown in the given group unless the note has its own explicit label.
 * Pass an empty group to remove the rule.
 */
export async function setShareAutogroup(
  client: SupabaseClient,
  ownerEmail: string,
  group: string,
): Promise<void> {
  const { error } = await client.rpc("set_share_autogroup", {
    p_owner_email: ownerEmail,
    p_group: group,
  });
  if (error) throw new Error(error.message);
}
