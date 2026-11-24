"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Bell,
  BellOff,
  FileUp,
  LoaderCircle,
  Mic,
  Paperclip,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  attachmentUrl,
  formatBytes,
  isAudioMime,
  isImageMime,
  listAttachments,
  removeAttachment,
  uploadAttachment,
  type NoteAttachment,
} from "@/lib/supabase/attachments";
import { loadAiConfig, saveAiConfig, summarizeText, type AiConfig } from "@/lib/ai/summary";
import { notePlainText } from "@/lib/notes/export";
import type { Note } from "@/lib/notes/types";

/* ---------- reminder ---------- */

export function ReminderControl({
  note,
  readOnly,
  onChange,
}: {
  note: Note;
  readOnly: boolean;
  onChange: (changes: Partial<Note>) => void;
}) {
  const [open, setOpen] = useState(false);
  const value = note.reminderAt ? toLocalInput(note.reminderAt) : "";

  if (readOnly && !note.reminderAt) return null;

  return (
    <div className="reminder-control">
      <button
        className="icon-button"
        type="button"
        aria-label={note.reminderAt ? "Edit reminder" : "Set reminder"}
        title={note.reminderAt ? `Reminder ${new Date(note.reminderAt).toLocaleString()}` : "Set reminder"}
        aria-pressed={Boolean(note.reminderAt)}
        disabled={readOnly && !note.reminderAt}
        onClick={() => !readOnly && setOpen((open) => !open)}
      >
        {note.reminderAt ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}
      </button>
      {open && !readOnly ? (
        <div className="reminder-popover" role="dialog" aria-label="Reminder">
          <label htmlFor="reminder-at">Remind me at</label>
          <input
            id="reminder-at"
            type="datetime-local"
            defaultValue={value}
            onChange={(event) => {
              const next = event.target.value ? new Date(event.target.value).toISOString() : null;
              onChange({ reminderAt: next });
            }}
          />
          {note.reminderAt ? (
            <button type="button" className="danger-link" onClick={() => onChange({ reminderAt: null })}>
              Clear reminder
            </button>
          ) : null}
          <button type="button" className="secondary-button" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      ) : null}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ---------- folder ---------- */

export function FolderInput({
  note,
  folders,
  readOnly,
  onChange,
}: {
  note: Note;
  folders: string[];
  readOnly: boolean;
  onChange: (changes: Partial<Note>) => void;
}) {
  return (
    <label className="folder-input">
      <span className="sr-only">Folder</span>
      <input
        list="note-folders"
        defaultValue={note.folder ?? ""}
        key={`folder-${note.id}`}
        placeholder="Group (optional, e.g. General, Kerja/Q4)"
        readOnly={readOnly}
        maxLength={60}
        onBlur={(event) => onChange({ folder: event.target.value.trim() })}
      />
      <datalist id="note-folders">
        {folders.map((folder) => (
          <option key={folder} value={folder} />
        ))}
      </datalist>
    </label>
  );
}

/* ---------- attachments + voice ---------- */

export function AttachmentsPanel({
  note,
  client,
  readOnly,
}: {
  note: Note;
  client: SupabaseClient | null;
  readOnly: boolean;
}) {
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [recording, setRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    queueMicrotask(() => {
      setAttachments([]);
      setUrls({});
      setError(null);
    });
    if (!client || !note.userId) return;

    let active = true;
    void listAttachments(client, note.id)
      .then((rows) => {
        if (active) setAttachments(rows);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      active = false;
    };
  }, [client, note.id, note.userId]);

  useEffect(() => {
    if (!client || attachments.length === 0) return;
    let active = true;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        attachments.map(async (row) => {
          try {
            next[row.id] = await attachmentUrl(client, row.path);
          } catch {
            // Leave the row without a URL; the Open link retries on demand.
          }
        }),
      );
      if (active) setUrls(next);
    })();
    return () => {
      active = false;
    };
  }, [client, attachments]);

  async function handleFiles(files: FileList | null) {
    if (!client || !note.userId || !files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const uploaded = await uploadAttachment(client, note.id, note.userId, file, file.name);
        setAttachments((current) => [...current, uploaded]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function toggleRecording() {
    if (!client || !note.userId) return;
    if (recording) {
      recorderRef.current?.stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const mime = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        const extension = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
        void (async () => {
          setBusy(true);
          try {
            const uploaded = await uploadAttachment(
              client,
              note.id,
              note.userId!,
              blob,
              `voice-${new Date().toISOString().replace(/[:.]/gu, "-")}.${extension}`,
            );
            setAttachments((current) => [...current, uploaded]);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setBusy(false);
          }
        })();
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function handleRemove(attachment: NoteAttachment) {
    if (!client) return;
    setBusy(true);
    try {
      await removeAttachment(client, attachment);
      setAttachments((current) => current.filter((row) => row.id !== attachment.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!client || !note.userId) return null;

  return (
    <section className="attachments-panel" aria-label="Attachments">
      <header>
        <Paperclip aria-hidden="true" />
        <span>Attachments</span>
        {!readOnly ? (
          <>
            <button
              type="button"
              className="mini-action"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <FileUp aria-hidden="true" /> Upload
            </button>
            <button
              type="button"
              className="mini-action"
              onClick={() => void toggleRecording()}
              disabled={busy}
              aria-pressed={recording}
            >
              {recording ? <X aria-hidden="true" /> : <Mic aria-hidden="true" />}
              {recording ? "Stop" : "Voice note"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              aria-label="Upload files"
              onChange={(event) => void handleFiles(event.target.files)}
            />
          </>
        ) : null}
        {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
      </header>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {attachments.length === 0 ? (
        <p className="attachments-empty">No files yet.</p>
      ) : (
        <ul>
          {attachments.map((attachment) => {
            const url = urls[attachment.id];
            return (
              <li key={attachment.id}>
                {isAudioMime(attachment.mime) && url ? (
                  <audio controls src={url} className="attachment-audio" />
                ) : isImageMime(attachment.mime) && url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote signed URLs, not local assets
                  <img src={url} alt={attachment.name} className="attachment-image" />
                ) : null}
                <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
                <span className="num">{formatBytes(attachment.sizeBytes)}</span>
                {url ? (
                  <a href={url} download={attachment.name} className="mini-action">Open</a>
                ) : null}
                {!readOnly ? (
                  <button
                    type="button"
                    className="danger-link"
                    disabled={busy}
                    onClick={() => void handleRemove(attachment)}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ---------- AI summary (BYOK) ---------- */

export function AiSummaryPanel({
  note,
  readOnly,
}: {
  note: Note;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [draft, setDraft] = useState({ apiKey: "", endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini" });
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const existing = loadAiConfig();
      setConfig(existing);
      if (existing) {
        setDraft({ apiKey: "••••••", endpoint: existing.endpoint, model: existing.model });
      }
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setResult(null);
      setError(null);
    });
  }, [note.id]);

  async function runSummary() {
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      const summary = await summarizeText(config, notePlainText(note));
      setResult(summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function saveConfig() {
    const parsed = saveable();
    if (!parsed) {
      setError("API key is required. The key stays on this device only.");
      return;
    }
    saveAiConfig(parsed);
    setConfig(parsed);
    setError(null);
  }

  function saveable(): AiConfig | null {
    const apiKey = draft.apiKey.includes("•") ? config?.apiKey ?? "" : draft.apiKey.trim();
    if (!apiKey) return null;
    return {
      apiKey,
      endpoint: draft.endpoint.trim() || "https://api.openai.com/v1",
      model: draft.model.trim() || "gpt-4o-mini",
    };
  }

  return (
    <section className="ai-panel" aria-label="AI summary">
      <button
        type="button"
        className="mini-action"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Sparkles aria-hidden="true" /> AI summary
      </button>
      {open ? (
        <div className="ai-panel-body">
          {!config ? (
            <>
              <p className="ai-hint">
                Bring your own key — it is stored only in this browser and sent only to your endpoint.
              </p>
              <input
                type="password"
                placeholder="API key (required)"
                aria-label="API key"
                value={draft.apiKey}
                onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
              />
              <input
                placeholder="Endpoint, e.g. https://api.openai.com/v1"
                aria-label="Endpoint"
                value={draft.endpoint}
                onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))}
              />
              <input
                placeholder="Model, e.g. gpt-4o-mini"
                aria-label="Model"
                value={draft.model}
                onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
              />
              <button type="button" className="primary-button" onClick={saveConfig}>Save key</button>
            </>
          ) : (
            <>
              <p className="ai-hint">
                Key saved on this device · {config.model} @ {config.endpoint.replace(/^https?:\/\//u, "")}
              </p>
              <div className="ai-actions">
                <button type="button" className="primary-button" onClick={() => void runSummary()} disabled={busy || readOnly}>
                  {busy ? "Summarizing…" : "Summarize this note"}
                </button>
                <button
                  type="button"
                  className="danger-link"
                  onClick={() => {
                    setConfig(null);
                    localStorage.removeItem("tether-ai-config");
                    setDraft({ apiKey: "", endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini" });
                  }}
                >
                  Remove key
                </button>
              </div>
            </>
          )}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {result ? (
            <div className="ai-result" role="status">
              <pre>{result}</pre>
              <button type="button" className="secondary-button" onClick={() => setResult(null)}>Dismiss</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
