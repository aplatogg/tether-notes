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

export type NoteScope = "all" | "pinned" | "archived" | "trash";

export interface NoteFilter {
  scope: NoteScope;
  query?: string;
  tag?: string;
}



