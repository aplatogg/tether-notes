"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  CopyPlus,
  Download,
  FileText,
  Link2,
  LoaderCircle,
  Lock,
  LockOpen,
  Paperclip,
  Pin,
  PinOff,
  Printer,
  Save,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { RichEditor } from "@/components/notes/rich-editor";
import { AiSummaryPanel, AttachmentsPanel, FolderInput, ReminderControl, WorkspaceSelect } from "@/components/notes/note-extras";
import { downloadText, exportNotesJson, noteToMarkdown, noteToTxt } from "@/lib/notes/export";
import {
  createLockSecret,
  decryptLockedBody,
  encryptLockedBody,
  isEncryptedBody,
} from "@/lib/notes/lock";
import { displayTitle, normalizeTags } from "@/lib/notes/model";
import { trashDaysLeft } from "@/lib/notes/trash";
import type { Note } from "@/lib/notes/types";
import type { Workspace } from "@/lib/supabase/workspaces";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  createShareLink,
  grantNoteToEmail,
  listNoteGrants,
  revokeNoteGrant,
  revokeShareLink,
  type NoteGrantEntry,
} from "@/lib/supabase/share";

interface NoteEditorProps {
  note: Note | null;
  currentUserId: string | null;
  isDirty: boolean;
  isLocalOnly: boolean;
  folders: string[];
  workspaces: Workspace[];
  onChange: (changes: Partial<Note>) => void;
  onSave: () => void;
  onDuplicate?: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
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
  currentUserId,
  isDirty,
  isLocalOnly,
  folders,
  workspaces,
  onChange,
  onSave,
  onDuplicate,
  onTogglePin,
  onToggleArchive,
  onDelete,
  onRestore,
  onDeleteForever,
  onBack,
  onCreate,
  hiddenOnMobile,
}: NoteEditorProps) {
  const [unlocked, setUnlocked] = useState<Record<string, boolean>>({});
  const [unlockedPins, setUnlockedPins] = useState<Record<string, string>>({});
  const [decryptedBodies, setDecryptedBodies] = useState<Record<string, string>>({});
  const [pinMode, setPinMode] = useState<"set" | "unlock" | "remove" | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [share, setShare] = useState<{ url: string; copied: boolean } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [grants, setGrants] = useState<NoteGrantEntry[]>([]);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const close = (event: MouseEvent) => {
      if (!exportWrapRef.current?.contains(event.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [exportOpen]);

  const locked = Boolean(note?.lockHash) && !(note ? unlocked[note.id] : false);
  const readOnly = note?.shared === true;
  const activePin = note ? unlockedPins[note.id] : undefined;
  const displayBody =
    note && note.lockHash && isEncryptedBody(note.body)
      ? (decryptedBodies[note.id] ?? "")
      : (note?.body ?? "");

  function commitTags() {
    if (!note) return;
    onChange({ tags: normalizeTags(note.tags) });
  }

  function noteSlug(target: Note): string {
    return (
      displayTitle(target)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "note"
    );
  }

  function exportSingleNote(format: "md" | "txt" | "json" | "pdf") {
    if (!note || locked) return;
    setExportOpen(false);
    const unlockedView: Note = { ...note, body: displayBody };
    const slug = noteSlug(unlockedView);
    if (format === "md") {
      downloadText(`${slug}.md`, noteToMarkdown(unlockedView), "text/markdown");
    } else if (format === "txt") {
      downloadText(`${slug}.txt`, noteToTxt(unlockedView), "text/plain");
    } else if (format === "json") {
      downloadText(`${slug}.json`, exportNotesJson([unlockedView]), "application/json");
    } else if (format === "pdf") {
      window.print();
    }
  }

  function handleBodyEdit(html: string) {
    if (!note) return;
    if (note.lockHash && activePin) {
      setDecryptedBodies((current) => ({ ...current, [note.id]: html }));
      void encryptLockedBody(html, activePin, note.lockHash).then((ciphertext) => {
        onChange({ body: ciphertext });
      });
      return;
    }
    onChange({ body: html });
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
      const encrypted = await encryptLockedBody(displayBody, pin, secret);
      setDecryptedBodies((current) => ({ ...current, [note.id]: displayBody }));
      setUnlockedPins((current) => ({ ...current, [note.id]: pin }));
      setUnlocked((current) => ({ ...current, [note.id]: true }));
      onChange({ lockHash: secret, body: encrypted });
    } else {
      const plaintext = note.lockHash
        ? await decryptLockedBody(note.body, pin, note.lockHash)
        : null;
      if (plaintext === null) {
        setPinError("Wrong PIN. Try again.");
        return;
      }
      if (pinMode === "unlock") {
        setDecryptedBodies((current) => ({ ...current, [note.id]: plaintext }));
        setUnlockedPins((current) => ({ ...current, [note.id]: pin }));
        setUnlocked((current) => ({ ...current, [note.id]: true }));
        // Transparently upgrade legacy unencrypted locked notes to AES-256-GCM.
        if (note.lockHash && !isEncryptedBody(note.body) && !readOnly) {
          const encrypted = await encryptLockedBody(plaintext, pin, note.lockHash);
          onChange({ body: encrypted });
        }
      } else {
        setDecryptedBodies((current) => {
          const copy = { ...current };
          delete copy[note.id];
          return copy;
        });
        setUnlockedPins((current) => {
          const copy = { ...current };
          delete copy[note.id];
          return copy;
        });
        onChange({ lockHash: null, body: plaintext });
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

  async function openGrantsDialog() {
    if (!note || !note.userId) {
      setShareError("Sign in before sharing a note with someone.");
      return;
    }

    const client = getSupabaseBrowserClient();
    if (!client) {
      setShareError("Sharing needs the Supabase configuration.");
      return;
    }

    setGrantsOpen(true);
    setShareError(null);
    setGrantBusy(true);

    try {
      setGrants(await listNoteGrants(client, note.id));
    } catch (error) {
      setShareError(error instanceof Error ? error.message : String(error));
    } finally {
      setGrantBusy(false);
    }
  }

  async function addGrant() {
    if (!note || !grantEmail.trim()) return;

    const client = getSupabaseBrowserClient();
    if (!client) return;

    setGrantBusy(true);
    setShareError(null);

    try {
      await grantNoteToEmail(client, note.id, grantEmail);
      setGrants(await listNoteGrants(client, note.id));
      setGrantEmail("");
    } catch (error) {
      setShareError(error instanceof Error ? error.message : String(error));
    } finally {
      setGrantBusy(false);
    }
  }

  async function removeGrant(granteeId: string) {
    if (!note) return;

    const client = getSupabaseBrowserClient();
    if (!client) return;

    setGrantBusy(true);
    setShareError(null);

    try {
      await revokeNoteGrant(client, note.id, granteeId);
      setGrants(await listNoteGrants(client, note.id));
    } catch (error) {
      setShareError(error instanceof Error ? error.message : String(error));
    } finally {
      setGrantBusy(false);
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
                className={extrasOpen ? "icon-button is-active" : "icon-button"}
                type="button"
                onClick={() => setExtrasOpen((open) => !open)}
                aria-label="Toggle attachments and AI summary"
                aria-pressed={extrasOpen}
                title="Attachments & AI summary"
              >
                <Paperclip aria-hidden="true" />
              </button>
              <div className="export-control" ref={exportWrapRef}>
                <button
                  className={exportOpen ? "icon-button is-active" : "icon-button"}
                  type="button"
                  onClick={() => setExportOpen((value) => !value)}
                  aria-label="Export note"
                  aria-expanded={exportOpen}
                  title="Export note (.md / .txt / .json / PDF)"
                  disabled={locked}
                >
                  <Download aria-hidden="true" />
                </button>
                {exportOpen && !locked ? (
                  <div className="export-menu" role="menu" aria-label="Export format">
                    <button type="button" role="menuitem" onClick={() => exportSingleNote("md")}>
                      <FileText aria-hidden="true" /> Markdown (.md)
                    </button>
                    <button type="button" role="menuitem" onClick={() => exportSingleNote("txt")}>
                      <FileText aria-hidden="true" /> Plain text (.txt)
                    </button>
                    <button type="button" role="menuitem" onClick={() => exportSingleNote("json")}>
                      <Download aria-hidden="true" /> Note JSON (.json)
                    </button>
                    <button type="button" role="menuitem" onClick={() => exportSingleNote("pdf")}>
                      <Printer aria-hidden="true" /> Print / Save as PDF
                    </button>
                  </div>
                ) : null}
              </div>
              {readOnly ? null : (
                <>
                  {onDuplicate ? (
                    <button
                      className="icon-button"
                      type="button"
                      onClick={onDuplicate}
                      aria-label="Duplicate note"
                      title="Duplicate note"
                      disabled={locked}
                    >
                      <CopyPlus aria-hidden="true" />
                    </button>
                  ) : null}
                  <ReminderControl note={note} readOnly={readOnly} onChange={onChange} />
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
                    onClick={() => void openGrantsDialog()}
                    aria-label="Share with user"
                    title="Share with a user by email (read-only for them)"
                    disabled={locked}
                  >
                    <UserPlus aria-hidden="true" />
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
                </>
              )}
            </div>
          </header>

          {readOnly ? (
            <div className="trash-banner" role="status">
              <span>Shared with you by {note.ownerEmail ?? "the owner"} · read-only</span>
            </div>
          ) : null}

          {note.deletedAt ? (
            <div className="trash-banner" role="status">
              <span>
                {trashDaysLeft(note) <= 0 ? "In trash · deleting now" : `In trash · ${trashDaysLeft(note)} days left before permanent deletion`}
              </span>
              {readOnly ? null : (
                <>
                  <button type="button" onClick={onRestore}>Restore</button>
                  <button type="button" className="danger-link" onClick={onDeleteForever}>Delete forever</button>
                </>
              )}
            </div>
          ) : null}
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
              <p>Enter the PIN to decrypt and edit it on this device.</p>
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
                  readOnly={note.deletedAt !== null || readOnly}
                  onChange={(event) => onChange({ title: event.target.value })}
                  placeholder="Untitled note"
                  autoComplete="off"
                  maxLength={500}
                />
                <FolderInput note={note} folders={folders} readOnly={readOnly || note.deletedAt !== null} onChange={onChange} />
                {workspaces.length > 0 ? (
                  <WorkspaceSelect note={note} workspaces={workspaces} readOnly={readOnly || note.deletedAt !== null} onChange={onChange} />
                ) : null}
                <RichEditor
                  key={note.id}
                  readOnly={note.deletedAt !== null || readOnly}
                  value={displayBody}
                  onChange={handleBodyEdit}
                  onSaveShortcut={onSave}
                />
                {extrasOpen ? (
                  <div className="editor-extras">
                    <AttachmentsPanel note={note} currentUserId={currentUserId} client={getSupabaseBrowserClient()} readOnly={readOnly || note.deletedAt !== null} />
                    <AiSummaryPanel note={{ ...note, body: displayBody }} readOnly={readOnly} />
                  </div>
                ) : null}
              </div>

              <footer className="editor-footer">
                <label htmlFor="note-tags">Tags</label>
                <input
                  key={`tags-${note.id}`}
                  id="note-tags"
                  defaultValue={note.tags.join(", ")}
                  readOnly={readOnly}
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

          {grantsOpen && !readOnly ? (
            <div className="pin-backdrop" role="dialog" aria-modal="true" aria-label="Share with users">
              <div className="pin-dialog">
                <h2>Share with a user</h2>
                <p>Enter an account email. They can read this note (read-only); nobody else can.</p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addGrant();
                  }}
                >
                  <label className="sr-only" htmlFor="grant-email">Email</label>
                  <input
                    id="grant-email"
                    type="email"
                    autoFocus
                    autoComplete="off"
                    value={grantEmail}
                    onChange={(event) => setGrantEmail(event.target.value)}
                    placeholder="name@example.com"
                  />
                  <div className="pin-actions">
                    <button className="secondary-button" type="button" onClick={() => setGrantsOpen(false)}>Close</button>
                    <button className="primary-button" type="submit" disabled={grantBusy || !grantEmail.trim()}>
                      {grantBusy ? "Working…" : "Share"}
                    </button>
                  </div>
                </form>
                {grants.length > 0 ? (
                  <ul className="grant-list">
                    {grants.map((grant) => (
                      <li key={grant.granteeId}>
                        <span>{grant.email}</span>
                        <button
                          type="button"
                          className="danger-link"
                          disabled={grantBusy}
                          onClick={() => void removeGrant(grant.granteeId)}
                        >
                          <X aria-hidden="true" /> Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="grant-empty">Not shared with anyone yet.</p>
                )}
              </div>
            </div>
          ) : null}

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
                    ? "Choose a PIN with at least 4 characters. The note body is encrypted with AES-256-GCM."
                    : pinMode === "unlock"
                      ? "Enter the PIN you set for this note."
                      : "Enter the current PIN to decrypt and remove the lock."}
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
