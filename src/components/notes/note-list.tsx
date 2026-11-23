"use client";

import { FileText, Lock, Pin } from "lucide-react";
import { plainPreview } from "@/lib/notes/format";
import { displayTitle } from "@/lib/notes/model";
import { tagColor } from "@/lib/notes/tags";
import type { Note, NoteScope } from "@/lib/notes/types";

interface NoteListProps {
  notes: Note[];
  selectedId: string | null;
  isLoading: boolean;
  query: string;
  scope: NoteScope;
  selectedTag: string | null;
  onSelect: (note: Note) => void;
  onTagSelect: (tag: string) => void;
  onCreate: () => void;
  hiddenOnMobile: boolean;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Saved locally";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function emptyMessage(scope: NoteScope, query: string, selectedTag: string | null) {
  if (query.trim() || selectedTag) {
    return "No notes match this search.";
  }

  if (scope === "pinned") {
    return "Pin a note to keep it within reach.";
  }

  if (scope === "archived") {
    return "Archived notes will wait here.";
  }

  return "Capture the first thought in this workspace.";
}

export function NoteList({
  notes,
  selectedId,
  isLoading,
  query,
  scope,
  selectedTag,
  onSelect,
  onTagSelect,
  onCreate,
  hiddenOnMobile,
}: NoteListProps) {
  return (
    <section
      className="note-list-pane"
      data-mobile-hidden={hiddenOnMobile}
      aria-label="Notes"
    >
      <header className="pane-heading">
        <div>
          <h1>{scope === "all" ? "All notes" : scope === "pinned" ? "Pinned" : "Archived"}</h1>
          <p className="num">{notes.length} {notes.length === 1 ? "note" : "notes"}</p>
        </div>
        <button className="mobile-new-button" type="button" onClick={onCreate}>
          New
        </button>
      </header>

      {selectedTag ? (
        <div className="active-filter">
          <span>Tag: {selectedTag}</span>
          <button type="button" onClick={() => onTagSelect("")}>Clear</button>
        </div>
      ) : null}

      <div className="note-list" role="list" aria-busy={isLoading}>
        {isLoading ? (
          Array.from({ length: 4 }, (_, index) => (
            <div className="note-row note-row-loading" key={index} aria-hidden="true">
              <span />
              <span />
            </div>
          ))
        ) : notes.length > 0 ? (
          notes.map((note) => (
            <article
              className={note.id === selectedId ? "note-row is-selected" : "note-row"}
              key={note.id}
              role="listitem"
            >
              <button className="note-row-main" type="button" onClick={() => onSelect(note)}>
                <span className="note-row-title">
                  {note.isPinned ? <Pin aria-label="Pinned" /> : null}
                  {note.lockHash ? <Lock aria-label="Locked" /> : null}
                  <span>{displayTitle(note)}</span>
                </span>
                <span className="note-row-preview">
                  {note.lockHash ? "Locked note" : plainPreview(note.body) || "No additional text"}
                </span>
                <span className="note-row-meta">
                  <span>{formatUpdatedAt(note.updatedAt)}</span>
                </span>
              </button>
              {note.tags.length > 0 ? (
                <span className="note-row-tags" aria-label="Tags">
                  {note.tags.slice(0, 2).map((tag) => (
                    <button
                      className="tag-button"
                      key={tag}
                      type="button"
                      style={{ "--tag-bg": tagColor(tag).bg, "--tag-ink": tagColor(tag).ink } as React.CSSProperties}
                      onClick={() => onTagSelect(tag)}
                    >
                      #{tag}
                    </button>
                  ))}
                </span>
              ) : null}
            </article>
          ))
        ) : (
          <div className="list-empty-state">
            <FileText aria-hidden="true" />
            <p>{emptyMessage(scope, query, selectedTag)}</p>
            {scope === "all" && !query.trim() && !selectedTag ? (
              <button className="secondary-button" type="button" onClick={onCreate}>
                Create a note
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}


