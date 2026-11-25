import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export interface NoteAttachment {
  id: string;
  noteId: string;
  path: string;
  name: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
}

const attachmentRowSchema = z.object({
  id: z.uuid(),
  note_id: z.uuid(),
  path: z.string(),
  name: z.string(),
  mime: z.string(),
  size_bytes: z.number(),
  created_at: z.string(),
});

const BUCKET = "attachments";

/** Hard cap so a public deployment can't be used to park huge files in the bucket. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function toAttachment(row: unknown): NoteAttachment {
  const parsed = attachmentRowSchema.parse(row);
  return {
    id: parsed.id,
    noteId: parsed.note_id,
    path: parsed.path,
    name: parsed.name,
    mime: parsed.mime,
    sizeBytes: parsed.size_bytes,
    createdAt: parsed.created_at,
  };
}

export async function listAttachments(
  client: SupabaseClient,
  noteId: string,
): Promise<NoteAttachment[]> {
  const { data, error } = await client
    .from("note_attachments")
    .select("id,note_id,path,name,mime,size_bytes,created_at")
    .eq("note_id", noteId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toAttachment);
}

function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[^\w.()\- ]+/gu, "_")
    .replace(/\.{2,}/gu, "_")
    .replace(/^\.+/u, "")
    .slice(0, 120);
  return cleaned || "file";
}

/**
 * Attaching writes carry a note_attachments INSERT, whose policy requires the
 * note to be yours or in a workspace you belong to. Checking with this SELECT
 * (RLS applies the same rule) means a rejected attach never leaves an orphan
 * object in the bucket, and every failure is one uniform, non-probing message.
 */
async function assertCanAttach(client: SupabaseClient, noteId: string): Promise<void> {
  const { data, error } = await client
    .from("notes")
    .select("id")
    .eq("id", noteId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("You cannot attach files to this note.");
}

/** Uploads a file into the private bucket and registers its metadata row. */
export async function uploadAttachment(
  client: SupabaseClient,
  noteId: string,
  uploaderId: string,
  file: Blob,
  fileName: string,
): Promise<NoteAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `File too large: ${formatBytes(file.size)} (max ${formatBytes(MAX_ATTACHMENT_BYTES)})`,
    );
  }

  await assertCanAttach(client, noteId);

  // The bucket policy scopes objects to the uploader's folder, so the path uses
  // the caller (not the note owner): a workspace member attaching to someone
  // else's note must upload under their own uid.
  const safeName = sanitizeFileName(fileName);
  const path = `${uploaderId}/${noteId}/${globalThis.crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await client.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });

  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await client
    .from("note_attachments")
    .insert({
      note_id: noteId,
      user_id: uploaderId,
      path,
      name: safeName,
      mime: file.type || "application/octet-stream",
      size_bytes: file.size,
    })
    .select("id,note_id,path,name,mime,size_bytes,created_at")
    .single();

  if (error) {
    // Best-effort rollback; surface a failed cleanup instead of hiding it so an
    // orphan object is visible to whoever reads the error.
    const { error: cleanupError } = await client.storage.from(BUCKET).remove([path]);
    const suffix = cleanupError ? ` (orphan cleanup failed: ${cleanupError.message})` : "";
    throw new Error(`${error.message}${suffix}`);
  }

  return toAttachment(data);
}

export async function removeAttachment(
  client: SupabaseClient,
  attachment: NoteAttachment,
): Promise<void> {
  const { error } = await client.from("note_attachments").delete().eq("id", attachment.id);
  if (error) throw new Error(error.message);
  await client.storage.from(BUCKET).remove([attachment.path]);
}

/** Short-lived signed URL for downloading/playing a private attachment. */
export async function attachmentUrl(
  client: SupabaseClient,
  path: string,
  expiresSeconds = 3600,
): Promise<string> {
  const { data, error } = await client.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresSeconds);

  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export function isAudioMime(mime: string): boolean {
  return mime.startsWith("audio/");
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
