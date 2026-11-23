"use client";

import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  FileText,
  Pin,
  PinOff,
  Save,
  Trash2,
} from "lucide-react";
import { normalizeTags } from "@/lib/notes/model";
import type { Note } from "@/lib/notes/types";

interface NoteEditorProps {
  note: Note | null;
  isDirty: boolean;
  isLocalOnly: boolean;
  onChange: (changes: Partial<Pick<Note, "title" | "body" | "tags">>) => void;
  onSave: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  onBack: () => void;
  onCreate: () => void;
  hiddenOnMobile: boolean;
}

function noteStateLabel(note: Note, isDirty: boolean, isLocalOnly: boolean): string {
  if (isDirty) return "Unsaved changes";
  if (isLocalOnly) return "Saved locally";
  if (note.syncStatus === "error") return "Sync error";
  if (note.syncStatus === "pending") return "Saved locally, waiting to sync";
  if (note.syncStatus === "local") return "Saved locally";
  return "Synced";
}

export function NoteEditor({
  note,
  isDirty,
  isLocalOnly,
  onChange,
  onSave,
  onTogglePin,
  onToggleArchive,
  onDelete,
  onBack,
  onCreate,
  hiddenOnMobile,
}: NoteEditorProps) {
  function commitTags() {
    if (!note) return;
    const tags = normalizeTags(note.tags);
    onChange({ tags });
  }

  return (
    <section
      className="note-editor-pane"
      data-mobile-hidden={hiddenOnMobile}
      aria-label="Note editor"
    >
      {note ? (
        <>
          <header className="editor-toolbar">
            <button className="icon-button mobile-back" type="button" onClick={onBack} aria-label="Back to notes">
              <ChevronLeft aria-hidden="true" />
            </button>
            <span className="editor-save-state" role="status">
              {noteStateLabel(note, isDirty, isLocalOnly)}
            </span>
            <div className="editor-actions">
              <button className="icon-button" type="button" onClick={onSave} aria-label="Save note" title="Save (Ctrl or Cmd + S)">
                <Save aria-hidden="true" />
              </button>
              <button className="icon-button" type="button" onClick={onTogglePin} aria-label={note.isPinned ? "Unpin note" : "Pin note"} title={note.isPinned ? "Unpin" : "Pin"}>
                {note.isPinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
              </button>
              <button className="icon-button" type="button" onClick={onToggleArchive} aria-label={note.isArchived ? "Restore note" : "Archive note"} title={note.isArchived ? "Restore" : "Archive"}>
                {note.isArchived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
              </button>
              <button className="icon-button danger-button" type="button" onClick={onDelete} aria-label="Delete note" title="Delete">
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          </header>

          {note.isArchived ? (
            <div className="archive-notice">
              This note is archived.
              <button type="button" onClick={onToggleArchive}>Restore</button>
            </div>
          ) : null}

          <div className="editor-fields">
            <label className="sr-only" htmlFor="note-title">Note title</label>
            <input
              id="note-title"
              className="title-input"
              value={note.title}
              onChange={(event) => onChange({ title: event.target.value })}
              placeholder="Untitled note"
              autoComplete="off"
              maxLength={500}
            />
            <label className="sr-only" htmlFor="note-body">Note body</label>
            <textarea
              id="note-body"
              className="body-input"
              value={note.body}
              onChange={(event) => onChange({ body: event.target.value })}
              placeholder="Start writing…"
            />
          </div>

          <footer className="editor-footer">
            <label htmlFor="note-tags">Tags</label>
            <input
              id="note-tags"
              value={note.tags.join(", ")}
              onChange={(event) => onChange({ tags: event.target.value.split(",") })}
              onBlur={commitTags}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitTags();
                  event.currentTarget.blur();
                }
              }}
              placeholder="work, ideas"
            />
            <span>Separate tags with commas.</span>
          </footer>
        </>
      ) : (
        <div className="editor-empty-state">
          <FileText aria-hidden="true" />
          <h2>Select a note</h2>
          <p>Choose a note from the list or capture a new thought.</p>
          <button className="primary-button" type="button" onClick={onCreate}>New note</button>
        </div>
      )}
    </section>
  );
}
