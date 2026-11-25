"use client";

import { useState } from "react";
import {
  Bell,
  Briefcase,
  CalendarDays,
  FileText,
  Folder,
  Highlighter,
  Lock,
  Pin,
  UsersRound,
} from "lucide-react";
import { CalendarView } from "@/components/notes/calendar-view";
import { bodyToPlainText } from "@/lib/notes/rich";
import { displayTitle } from "@/lib/notes/model";
import { tagColor } from "@/lib/notes/tags";
import type { Workspace } from "@/lib/supabase/workspaces";
import type { Note, NoteScope } from "@/lib/notes/types";

interface NoteListProps {
  notes: Note[];
  selectedId: string | null;
  isLoading: boolean;
  query: string;
  scope: NoteScope;
  selectedTag: string | null;
  selectedFolder: string | null;
  shareGroups: string[];
  selectedShareGroup: string | null;
  onShareGroupSelect: (group: string) => void;
  onAssignShareGroup: (note: Note, group: string, autogroup: boolean) => void;
  workspaces: Workspace[];
  selectedWorkspace: string | "personal" | null;
  onWorkspaceSelect: (workspaceId: string | "personal" | null) => void;
  showCalendar: boolean;
  calendarDay: string | null;
  calendarNotes: Note[];
  onSelect: (note: Note) => void;
  onTagSelect: (tag: string) => void;
  onFolderSelect: (folder: string) => void;
  onToggleCalendar: () => void;
  onSelectDay: (day: string | null) => void;
  onCreate: () => void;
  hiddenOnMobile: boolean;
  highlightsOnly: boolean;
  onToggleHighlightsOnly: () => void;
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

  if (scope === "shared") {
    return "Notes other people share with you appear here (read-only).";
  }

  if (scope === "trash") {
    return "Deleted notes stay here for 30 days.";
  }

  return "Capture the first thought in this workspace.";
}

function hasActiveFilters(
  query: string,
  selectedTag: string | null,
  selectedFolder: string | null,
  selectedShareGroup: string | null,
  selectedWorkspace: string | "personal" | null,
  highlightsOnly: boolean,
  calendarDay: string | null,
): boolean {
  return Boolean(
    query.trim() ||
      selectedTag ||
      selectedFolder ||
      selectedShareGroup ||
      selectedWorkspace ||
      highlightsOnly ||
      calendarDay,
  );
}

export function NoteList({
  notes,
  selectedId,
  isLoading,
  query,
  scope,
  selectedTag,
  selectedFolder,
  shareGroups,
  selectedShareGroup,
  onShareGroupSelect,
  onAssignShareGroup,
  workspaces,
  selectedWorkspace,
  onWorkspaceSelect,
  showCalendar,
  calendarDay,
  calendarNotes,
  onSelect,
  onTagSelect,
  onFolderSelect,
  onToggleCalendar,
  onSelectDay,
  onCreate,
  hiddenOnMobile,
  highlightsOnly,
  onToggleHighlightsOnly,
}: NoteListProps) {
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pickerValue, setPickerValue] = useState("");
  const [pickerAuto, setPickerAuto] = useState(false);

  function openPicker(note: Note) {
    setPickerFor(note.id);
    setPickerValue(note.shareGroup?.trim() ?? "");
    setPickerAuto(false);
  }

  return (
    <section
      className="note-list-pane"
      data-mobile-hidden={hiddenOnMobile}
      aria-label="Notes"
    >
      <header className="pane-heading">
        <div>
          <h1>
            {selectedWorkspace === "personal"
              ? "Personal"
              : selectedWorkspace
                ? (workspaces.find((w) => w.id === selectedWorkspace)?.name ?? "Workspace")
                : scope === "trash"
                  ? "Trash"
                  : scope === "pinned"
                    ? "Pinned"
                    : scope === "archived"
                      ? "Archived"
                      : scope === "shared"
                        ? "Shared with me"
                        : selectedFolder
                          ? selectedFolder
                          : "All notes"}
          </h1>
          <p className="num">{notes.length} {notes.length === 1 ? "note" : "notes"}</p>
        </div>
        <div className="pane-heading-actions">
          <button
            className={highlightsOnly ? "icon-button is-active" : "icon-button"}
            type="button"
            onClick={onToggleHighlightsOnly}
            aria-label="Show only notes with highlights"
            aria-pressed={highlightsOnly}
            title="Has highlights"
          >
            <Highlighter aria-hidden="true" />
          </button>
          <button
            className={showCalendar ? "icon-button is-active" : "icon-button"}
            type="button"
            onClick={onToggleCalendar}
            aria-label="Toggle calendar"
            aria-pressed={showCalendar}
            title="Calendar"
          >
            <CalendarDays aria-hidden="true" />
          </button>
          <button className="mobile-new-button" type="button" onClick={onCreate}>
            New
          </button>
        </div>
      </header>

      {showCalendar ? (
        <CalendarView notes={calendarNotes} selectedDay={calendarDay} onSelectDay={onSelectDay} />
      ) : null}

      {highlightsOnly ? (
        <div className="active-filter">
          <span>Has highlights</span>
          <button type="button" onClick={onToggleHighlightsOnly}>Clear</button>
        </div>
      ) : null}
      {selectedTag ? (
        <div className="active-filter">
          <span>Tag: {selectedTag}</span>
          <button type="button" onClick={() => onTagSelect("")}>Clear</button>
        </div>
      ) : null}
      {selectedFolder ? (
        <div className="active-filter">
          <span>Group: {selectedFolder}</span>
          <button type="button" onClick={() => onFolderSelect("")}>Clear</button>
        </div>
      ) : null}
      {selectedShareGroup ? (
        <div className="active-filter">
          <span>Group: {selectedShareGroup}</span>
          <button type="button" onClick={() => onShareGroupSelect("")}>Clear</button>
        </div>
      ) : null}
      {selectedWorkspace ? (
        <div className="active-filter">
          <span>
            {selectedWorkspace === "personal"
              ? "Personal"
              : `Workspace: ${workspaces.find((w) => w.id === selectedWorkspace)?.name ?? selectedWorkspace}`}
          </span>
          <button type="button" onClick={() => onWorkspaceSelect(null)}>Clear</button>
        </div>
      ) : null}

      <datalist id="share-group-options">
        {shareGroups.map((group) => (
          <option key={group} value={group} />
        ))}
      </datalist>

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
              className={[ "note-row", note.id === selectedId ? "is-selected" : "", note.deletedAt ? "is-deleted" : "" ].filter(Boolean).join(" ")}
              key={note.id}
              role="listitem"
            >
              <button className="note-row-main" type="button" onClick={() => onSelect(note)}>
                <span className="note-row-title">
                   {note.isPinned ? <Pin aria-label="Pinned" /> : null}
                   {note.lockHash ? <Lock aria-label="Locked" /> : null}
                   {note.reminderAt ? <Bell aria-label={`Reminder ${new Date(note.reminderAt).toLocaleString()}`} /> : null}
                   {note.shared ? <UsersRound aria-label={`Shared by ${note.ownerEmail ?? "someone"}`} /> : null}
                  <span>{displayTitle(note)}</span>
                </span>
                <span className="note-row-preview">
                  {note.lockHash ? "Locked note" : bodyToPlainText(note.body).slice(0, 160) || "No additional text"}
                </span>
                <span className="note-row-meta">
                  {note.folder?.trim() ? (
                    <button
                      type="button"
                      className="folder-chip"
                      onClick={(event) => {
                        event.stopPropagation();
                        onFolderSelect(note.folder!.trim());
                      }}
                    >
                      <Folder aria-hidden="true" /> {note.folder.trim()}
                    </button>
                  ) : null}
                  {note.shared ? (
                    <button
                      type="button"
                      className="folder-chip share-group-chip"
                      title="Assign a share group"
                      onClick={(event) => {
                        event.stopPropagation();
                        openPicker(note);
                      }}
                    >
                      <UsersRound aria-hidden="true" /> {note.shareGroup?.trim() || "Group"}
                    </button>
                  ) : null}
                  {note.workspaceId ? (
                    <span className="folder-chip" title="Workspace">
                      <Briefcase aria-hidden="true" />
                      {workspaces.find((w) => w.id === note.workspaceId)?.name ?? "Workspace"}
                    </span>
                  ) : null}
                  <span>{formatUpdatedAt(note.updatedAt)}</span>
                </span>
              </button>
              {note.shared && pickerFor === note.id ? (
                <form
                  className="share-group-picker"
                  onClick={(event) => event.stopPropagation()}
                  onSubmit={(event) => {
                    event.preventDefault();
                    onAssignShareGroup(note, pickerValue.trim(), pickerAuto);
                    setPickerFor(null);
                  }}
                >
                  <input
                    type="text"
                    list="share-group-options"
                    aria-label="Group name"
                    placeholder="Group name (e.g. Kerja)"
                    value={pickerValue}
                    onChange={(event) => setPickerValue(event.target.value)}
                    autoFocus
                  />
                  {note.ownerEmail ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={pickerAuto}
                        onChange={(event) => setPickerAuto(event.target.checked)}
                      />
                      Auto-group everything from {note.ownerEmail}
                    </label>
                  ) : null}
                  <div className="share-group-picker-actions">
                    <button type="submit" className="secondary-button">Save</button>
                    {note.shareGroup?.trim() ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          onAssignShareGroup(note, "", false);
                          setPickerFor(null);
                        }}
                      >
                        Clear
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setPickerFor(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
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
            <p>
              {hasActiveFilters(
                query,
                selectedTag,
                selectedFolder,
                selectedShareGroup,
                selectedWorkspace,
                highlightsOnly,
                calendarDay,
              )
                ? "No notes match the current filters. Clear a filter (the chips above the list) to see more."
                : emptyMessage(scope, query, selectedTag)}
            </p>
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




