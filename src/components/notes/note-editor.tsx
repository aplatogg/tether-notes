"use client";

import { useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Bold,
  ChevronLeft,
  Code,
  Eye,
  FileCode2,
  FileText,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  LoaderCircle,
  Lock,
  LockOpen,
  Pencil,
  Pin,
  PinOff,
  Save,
  Trash2,
  Type,
} from "lucide-react";
import { NoteBody } from "@/components/notes/note-body";
import {
  applyBlockStyle,
  applyCodeBlock,
  applyInlineStyle,
  checklistProgress,
  continueList,
  indentOf,
  indentSelection,
  toggleChecklistLine,
} from "@/lib/notes/format";
import { createLockSecret, verifyLockPin } from "@/lib/notes/lock";
import { normalizeTags } from "@/lib/notes/model";
import type { Note } from "@/lib/notes/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { createShareLink, revokeShareLink } from "@/lib/supabase/share";

interface NoteEditorProps {
  note: Note | null;
  isDirty: boolean;
  isLocalOnly: boolean;
  onChange: (changes: Partial<Note>) => void;
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
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [unlocked, setUnlocked] = useState<Record<string, boolean>>({});
  const [pinMode, setPinMode] = useState<"set" | "unlock" | "remove" | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [share, setShare] = useState<{ url: string; copied: boolean } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const locked = Boolean(note?.lockHash) && !(note ? unlocked[note.id] : false);
  const progress = note ? checklistProgress(note.body) : { done: 0, total: 0 };

  function commitTags() {
    if (!note) return;
    onChange({ tags: normalizeTags(note.tags) });
  }

  function applyEdit(
    transform: (body: string, start: number, end: number) => { body: string; selectionStart: number; selectionEnd: number },
  ) {
    if (!note) return;
    const textarea = bodyRef.current;
    // The textarea is uncontrolled, so the DOM is the source of truth while typing.
    const current = textarea ? textarea.value : note.body;
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? current.length;
    const result = transform(current, start, end);

    onChange({ body: result.body });

    if (textarea) {
      textarea.focus();
      applyResult(textarea, result);
    }
  }

  function formatBlock(type: Parameters<typeof applyBlockStyle>[3]) {
    applyEdit((body, start, end) => applyBlockStyle(body, start, end, type));
  }

  /**
   * Applies a programmatic edit through execCommand so the browser keeps a real
   * undo stack; direct `textarea.value = ...` would wipe Ctrl+Z history.
   */
  function applyResult(
    textarea: HTMLTextAreaElement,
    result: { body: string; selectionStart: number; selectionEnd: number },
  ) {
    const previous = textarea.value;

    if (previous !== result.body && typeof document.execCommand === "function") {
      let start = 0;
      while (start < previous.length && start < result.body.length && previous[start] === result.body[start]) {
        start += 1;
      }

      let tail = 0;
      while (
        tail < previous.length - start &&
        tail < result.body.length - start &&
        previous[previous.length - 1 - tail] === result.body[result.body.length - 1 - tail]
      ) {
        tail += 1;
      }

      const end = previous.length - tail;
      const inserted = result.body.slice(start, result.body.length - tail);
      const applied = document.execCommand("insertText", false, inserted);

      if (!applied) {
        textarea.setRangeText(inserted, start, end, "end");
      }
    }

    textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    onChange({ body: textarea.value });
  }

  function handleBodyKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const textarea = event.currentTarget;

    if (event.key === "Tab") {
      event.preventDefault();
      const result = indentSelection(
        textarea.value,
        textarea.selectionStart,
        textarea.selectionEnd,
        event.shiftKey ? -1 : 1,
      );
      applyResult(textarea, result);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      const result = continueList(textarea.value, textarea.selectionStart);
      if (!result) return;
      event.preventDefault();
      applyResult(textarea, result);
      return;
    }

    if (event.key === "Backspace" && textarea.selectionStart === textarea.selectionEnd) {
      const caret = textarea.selectionStart;
      const lineStart = textarea.value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
      const prefix = textarea.value.slice(lineStart, caret);
      if (/^ +$/.test(prefix) && indentOf(prefix) > 0) {
        event.preventDefault();
        applyResult(textarea, indentSelection(textarea.value, caret, caret, -1));
      }
    }
  }
  async function openPinModal(next: "set" | "unlock" | "remove") {
    setPin("");
    setPinError(null);
    setPinMode(next);
  }

  async function submitPin() {
    if (!note || !pinMode) return;

    if (pin.trim().length < 4) {
      setPinError("Use at least 4 characters.");
      return;
    }

    if (pinMode === "set") {
      const secret = await createLockSecret(pin);
      onChange({ lockHash: secret });
      setUnlocked((current) => ({ ...current, [note.id]: true }));
    } else {
      const ok = note.lockHash ? await verifyLockPin(pin, note.lockHash) : false;
      if (!ok) {
        setPinError("Wrong PIN. Try again.");
        return;
      }
      if (pinMode === "unlock") {
        setUnlocked((current) => ({ ...current, [note.id]: true }));
      } else {
        onChange({ lockHash: null });
      }
    }

    setPinMode(null);
    setPin("");
  }

  async function copyShareLink() {
    if (!note) return;

    if (!note.userId) {
      setShareError("Sign in before sharing a note.");
      return;
    }

    const client = getSupabaseBrowserClient();
    if (!client) {
      setShareError("Sharing needs the Supabase configuration.");
      return;
    }

    setShareBusy(true);
    setShareError(null);

    try {
      const token = await createShareLink(client, note.id, note.userId);
      const url = `${window.location.origin}/s?t=${token}`;
      let copied = false;

      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        copied = false;
      }

      setShare({ url, copied });
    } catch (error) {
      setShareError(error instanceof Error ? error.message : String(error));
    } finally {
      setShareBusy(false);
    }
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
                disabled={locked}
              >
                {mode === "write" ? <Eye aria-hidden="true" /> : <Pencil aria-hidden="true" />}
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => void copyShareLink()}
                aria-label="Copy share link"
                title="Copy share link"
                disabled={shareBusy || locked}
              >
                {shareBusy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Link2 aria-hidden="true" />}
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => void openPinModal(note.lockHash ? "remove" : "set")}
                aria-label={note.lockHash ? "Remove note lock" : "Lock note"}
                title={note.lockHash ? "Remove lock" : "Lock note"}
                aria-pressed={Boolean(note.lockHash)}
              >
                {note.lockHash ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
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

          {share ? (
            <div className="share-banner" role="status">
              <span className="share-banner-label">
                {share.copied ? "Link copied" : "Share link ready"}
              </span>
              <code className="share-banner-url">{share.url}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(share.url);
                  setShare({ ...share, copied: true });
                }}
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => {
                  const client = getSupabaseBrowserClient();
                  if (note && client) {
                    void revokeShareLink(client, note.id)
                      .then(() => setShare(null))
                      .catch((error: unknown) => setShareError(error instanceof Error ? error.message : String(error)));
                  } else {
                    setShare(null);
                  }
                }}
              >
                Revoke
              </button>
              <button type="button" onClick={() => setShare(null)}>Dismiss</button>
            </div>
          ) : null}

          {shareError ? (
            <div className="storage-error" role="alert">
              <span>{shareError}</span>
              <button type="button" onClick={() => setShareError(null)}>Dismiss</button>
            </div>
          ) : null}

          {locked ? (
            <div className="lock-overlay">
              <Lock aria-hidden="true" />
              <h2>This note is locked</h2>
              <p>Enter the PIN to read and edit it on this device.</p>
              <button className="primary-button" type="button" onClick={() => void openPinModal("unlock")}>
                Unlock note
              </button>
            </div>
          ) : (
            <>
              <div className="editor-fields">
                <label className="sr-only" htmlFor="note-title">Note title</label>
                <input
                  key={`title-${note.id}`}
                  id="note-title"
                  className="title-input"
                  defaultValue={note.title}
                  onChange={(event) => onChange({ title: event.target.value })}
                  placeholder="Untitled note"
                  autoComplete="off"
                  maxLength={500}
                />

                <div className="editor-format-bar" role="toolbar" aria-label="Text formatting">
                  {[
                    { type: "heading" as const, label: "Heading", Icon: Type, text: "H" },
                    { type: "subheading" as const, label: "Subheading", Icon: Type, text: "H2" },
                  ].map(({ type, label, Icon, text }) => (
                    <button key={label} className="format-button" type="button" onClick={() => formatBlock(type)} aria-label={label} title={label} disabled={mode === "preview"}>
                      <Icon aria-hidden="true" className="sr-only" />
                      {text}
                    </button>
                  ))}
                  {[
                    { type: "bullet" as const, label: "Bulleted list", Icon: List },
                    { type: "ordered" as const, label: "Numbered list", Icon: ListOrdered },
                    { type: "checklist" as const, label: "Checklist", Icon: ListChecks },
                  ].map(({ type, label, Icon }) => (
                    <button key={label} className="format-button" type="button" onClick={() => formatBlock(type)} aria-label={label} title={label} disabled={mode === "preview"}>
                      <Icon aria-hidden="true" />
                    </button>
                  ))}
                  <span className="format-divider" aria-hidden="true" />
                  {[
                    { marker: "**" as const, label: "Bold", Icon: Bold },
                    { marker: "*" as const, label: "Italic", Icon: Italic },
                  ].map(({ marker, label, Icon }) => (
                    <button key={label} className="format-button" type="button" onClick={() => applyEdit((body, start, end) => applyInlineStyle(body, start, end, marker))} aria-label={label} title={label} disabled={mode === "preview"}>
                      <Icon aria-hidden="true" />
                    </button>
                  ))}
                  <button
                    className="format-button"
                    type="button"
                    onClick={() => applyEdit((body, start, end) => applyInlineStyle(body, start, end, "`"))}
                    aria-label="Inline code"
                    title="Inline code"
                    disabled={mode === "preview"}
                  >
                    <Code aria-hidden="true" />
                  </button>
                  <button
                    className="format-button"
                    type="button"
                    onClick={() => applyEdit((body, start, end) => applyCodeBlock(body, start, end))}
                    aria-label="Code block"
                    title="Code block"
                    disabled={mode === "preview"}
                  >
                    <FileCode2 aria-hidden="true" />
                  </button>
                  {progress.total > 0 ? (
                    <span className="format-hint num">{progress.done}/{progress.total} done</span>
                  ) : (
                    <span className="format-hint">Select lines, then format.</span>
                  )}
                </div>

                {mode === "write" ? (
                  <>
                    <label className="sr-only" htmlFor="note-body">Note body</label>
                    <textarea
                      key={`body-${note.id}`}
                      id="note-body"
                      ref={bodyRef}
                      className="body-input"
                      defaultValue={note.body}
                      onChange={(event) => onChange({ body: event.target.value })}
                      onKeyDown={handleBodyKeyDown}
                      placeholder="Start writing. H heading, H2 subheading, lists, checklists, **bold**, `code`, and ``` code blocks."
                    />
                  </>
                ) : (
                  <div className="note-preview-scroll">
                    <NoteBody body={note.body} onToggleChecklist={(lineIndex) => onChange({ body: toggleChecklistLine(note.body, lineIndex) })} />
                  </div>
                )}
              </div>

              <footer className="editor-footer">
                <label htmlFor="note-tags">Tags</label>
                <input
                  key={`tags-${note.id}`}
                  id="note-tags"
                  defaultValue={note.tags.join(", ")}
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
          )}

          {pinMode ? (
            <div className="pin-backdrop" role="dialog" aria-modal="true" aria-label="Note PIN">
              <form
                className="pin-dialog"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitPin();
                }}
              >
                <h2>{pinMode === "set" ? "Lock this note" : pinMode === "unlock" ? "Unlock note" : "Remove lock"}</h2>
                <p>
                  {pinMode === "set"
                    ? "Choose a PIN with at least 4 characters. It is stored as a hash with the note."
                    : pinMode === "unlock"
                      ? "Enter the PIN you set for this note."
                      : "Enter the current PIN to remove the lock."}
                </p>
                <label className="sr-only" htmlFor="note-pin">PIN</label>
                <input
                  id="note-pin"
                  type="password"
                  autoFocus
                  autoComplete="off"
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  placeholder="PIN"
                />
                {pinError ? <p className="form-error" role="alert">{pinError}</p> : null}
                <div className="pin-actions">
                  <button className="secondary-button" type="button" onClick={() => setPinMode(null)}>Cancel</button>
                  <button className="primary-button" type="submit">Confirm</button>
                </div>
              </form>
            </div>
          ) : null}
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






