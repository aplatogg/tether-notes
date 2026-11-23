"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  Eye,
  FileText,
  List,
  ListChecks,
  ListOrdered,
  Pencil,
  Pin,
  PinOff,
  Save,
  Trash2,
  Type,
} from "lucide-react";
import { normalizeTags } from "@/lib/notes/model";
import {
  applyBlockStyle,
  parseBlocks,
  toggleChecklistLine,
  type BlockType,
  type NoteBlock,
} from "@/lib/notes/format";
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

interface FormatButton {
  type: BlockType;
  label: string;
  title: string;
  Icon: typeof Type;
}

const FORMAT_BUTTONS: FormatButton[] = [
  { type: "heading", label: "Heading", title: "Heading", Icon: Type },
  { type: "subheading", label: "Subheading", title: "Subheading", Icon: Type },
  { type: "bullet", label: "Bulleted list", title: "Bulleted list", Icon: List },
  { type: "ordered", label: "Numbered list", title: "Numbered list", Icon: ListOrdered },
  { type: "checklist", label: "Checklist", title: "Checklist", Icon: ListChecks },
];

function renderBlocks(blocks: NoteBlock[], onToggle: (lineIndex: number) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  let listType: "bullet" | "checklist" | "ordered" | null = null;
  let items: { block: NoteBlock; index: number }[] = [];

  const flush = () => {
    if (!listType || items.length === 0) return;

    if (listType === "ordered") {
      nodes.push(
        <ol key={`ol-${items[0].index}`} className="note-ordered">
          {items.map(({ block, index }) => (
            <li key={index}>{block.text || "\u00A0"}</li>
          ))}
        </ol>,
      );
    } else {
      nodes.push(
        <ul
          key={`ul-${items[0].index}`}
          className={listType === "checklist" ? "note-checklist" : "note-bullets"}
        >
          {items.map(({ block, index }) => (
            <li key={index}>
              {listType === "checklist" ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={block.checked === true}
                  aria-label={block.text || "Checklist item"}
                  className={block.checked ? "note-check is-checked" : "note-check"}
                  onClick={() => onToggle(index)}
                >
                  {block.checked ? <Check aria-hidden="true" /> : null}
                </button>
              ) : (
                <span className="note-bullet" aria-hidden="true" />
              )}
              <span className={block.checked ? "note-checked-text" : undefined}>
                {block.text || "\u00A0"}
              </span>
            </li>
          ))}
        </ul>,
      );
    }

    listType = null;
    items = [];
  };

  blocks.forEach((block, index) => {
    const isList = block.type === "bullet" || block.type === "checklist" || block.type === "ordered";

    if (!isList) {
      flush();

      if (block.type === "heading") {
        nodes.push(<h2 key={index} className="note-h1">{block.text || "\u00A0"}</h2>);
      } else if (block.type === "subheading") {
        nodes.push(<h3 key={index} className="note-h2">{block.text || "\u00A0"}</h3>);
      } else if (block.text.trim().length === 0) {
        nodes.push(<div key={index} className="note-gap" />);
      } else {
        nodes.push(<p key={index}>{block.text}</p>);
      }
      return;
    }

    const currentType = block.type as "bullet" | "checklist" | "ordered";
    if (listType !== currentType) {
      flush();
      listType = currentType;
    }
    items.push({ block, index });
  });

  flush();
  return nodes;
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
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");

  function commitTags() {
    if (!note) return;
    const tags = normalizeTags(note.tags);
    onChange({ tags });
  }

  function format(type: BlockType) {
    if (!note) return;

    const textarea = bodyRef.current;
    const start = textarea?.selectionStart ?? note.body.length;
    const end = textarea?.selectionEnd ?? note.body.length;
    const result = applyBlockStyle(note.body, start, end, type);
    onChange({ body: result.body });

    window.requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  function toggleChecklist(lineIndex: number) {
    if (!note) return;
    onChange({ body: toggleChecklistLine(note.body, lineIndex) });
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
              <button
                className="icon-button"
                type="button"
                onClick={() => setMode(mode === "write" ? "preview" : "write")}
                aria-label={mode === "write" ? "Preview formatting" : "Edit note"}
                aria-pressed={mode === "preview"}
                title={mode === "write" ? "Preview" : "Edit"}
              >
                {mode === "write" ? <Eye aria-hidden="true" /> : <Pencil aria-hidden="true" />}
              </button>
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

            <div className="editor-format-bar" role="toolbar" aria-label="Text formatting">
              {FORMAT_BUTTONS.map(({ type, label, title, Icon }) => (
                <button
                  key={type + label}
                  className={type === "subheading" ? "format-button format-subheading" : "format-button"}
                  type="button"
                  onClick={() => format(type)}
                  aria-label={label}
                  title={title}
                  disabled={mode === "preview"}
                >
                  <Icon aria-hidden="true" />
                  {type === "heading" ? "H" : null}
                  {type === "subheading" ? "H2" : null}
                </button>
              ))}
              <span className="format-hint">Select lines, then format.</span>
            </div>

            {mode === "write" ? (
              <>
                <label className="sr-only" htmlFor="note-body">Note body</label>
                <textarea
                  id="note-body"
                  ref={bodyRef}
                  className="body-input"
                  value={note.body}
                  onChange={(event) => onChange({ body: event.target.value })}
                  placeholder="Start writing. Use H for a heading, H2 for a subheading, or turn lines into a list."
                />
              </>
            ) : (
              <div className="note-preview" aria-label="Formatted note">
                {renderBlocks(parseBlocks(note.body), toggleChecklist)}
              </div>
            )}
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
