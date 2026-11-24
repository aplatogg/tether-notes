export type SyncStatus = "local" | "pending" | "synced" | "error";

export interface Note {
  id: string;
  userId: string | null;
  title: string;
  body: string;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
  /** salt:hash PBKDF2 secret; null when the note is not locked. */
  lockHash?: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
  lastSyncError?: string;
  /** True when this note belongs to another account and was shared with us (read-only). */
  shared?: boolean;
  /** The account the note was shared with (grantee), i.e. the local viewer. */
  sharedFor?: string | null;
  /** Owner's email, shown on notes shared with us. */
  ownerEmail?: string | null;
}

export interface CreateDraftNoteInput {
  userId?: string | null;
  title?: string;
  body?: string;
  tags?: readonly string[];
  isPinned?: boolean;
  isArchived?: boolean;
  lockHash?: string | null;
}

export type NoteScope = "all" | "pinned" | "archived" | "trash" | "shared";

export interface NoteFilter {
  scope: NoteScope;
  query?: string;
  tag?: string;
}



