export type SyncStatus = "local" | "pending" | "synced" | "error";

export interface Note {
  id: string;
  userId: string | null;
  title: string;
  body: string;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
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
}

export type NoteScope = "all" | "pinned" | "archived";

export interface NoteFilter {
  scope: NoteScope;
  query?: string;
  tag?: string;
}
