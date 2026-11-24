"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { ArrowUpRight, Check, LoaderCircle } from "lucide-react";
import { useNotesWorkspace } from "@/hooks/use-notes-workspace";
import { displayTitle } from "@/lib/notes/model";
import { createSupabaseSyncAdapter } from "@/lib/supabase/adapter";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function hideWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

async function openMainWindow() {
  if (!isTauri()) {
    window.open("/", "_blank", "noopener");
    return;
  }
  const { Window } = await import("@tauri-apps/api/window");
  const existing = await Window.getByLabel("main");
  if (existing) {
    await existing.show();
    await existing.unminimize();
    await existing.setFocus();
  }
  await hideWindow();
}

function MiniWorkspace({ userId, client }: { userId: string | null; client: SupabaseClient | null }) {
  const adapter = useMemo(
    () => (client ? createSupabaseSyncAdapter(client) : null),
    [client],
  );
  const workspace = useNotesWorkspace(userId, adapter);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const recent = (workspace.notes ?? []).slice(0, 3);

  async function save(noteId?: string) {
    const value = text.trim();
    if (!value || saving) return;

    setSaving(true);
    try {
      const [firstLine, ...rest] = value.split(/\r?\n/);
      const title = firstLine.slice(0, 120);
      const body = rest.length > 0 ? value : "";

      if (noteId) {
        const existing = workspace.notes?.find((note) => note.id === noteId);
        if (existing) await workspace.saveNote({ ...existing, title, body });
      } else {
        const draft = await workspace.createNote();
        await workspace.saveNote({ ...draft, title, body });
      }

      setText("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
      if (!noteId) await hideWindow();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mini-shell">
      <header className="mini-head" data-tauri-drag-region>
        <span className="mini-brand">Tether Notes</span>
        <span className="mini-sync">{workspace.syncState.phase}</span>
        {workspace.syncState.phase === "local-only" ? (
          <span className="mini-warn">Sign in in the main window to sync</span>
        ) : null}
        <button className="mini-open" type="button" onClick={() => void openMainWindow()}>
          Open workspace <ArrowUpRight aria-hidden="true" />
        </button>
      </header>

      <textarea
        ref={textareaRef}
        className="mini-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void save();
          }
          if (event.key === "Escape") void hideWindow();
        }}
        placeholder="Jot a thought… first line becomes the title"
        aria-label="Quick note"
      />

      <div className="mini-actions">
        <span className="mini-hint">Ctrl+Enter to save · Esc to hide</span>
        <button
          className="primary-button mini-save"
          type="button"
          onClick={() => void save()}
          disabled={saving || text.trim().length === 0}
        >
          {saving ? <LoaderCircle className="spin" aria-hidden="true" /> : saved ? <Check aria-hidden="true" /> : null}
          {saved ? "Saved" : "Save"}
        </button>
      </div>

      {recent.length > 0 ? (
        <div className="mini-recent">
          <span className="mini-recent-label">Recent</span>
          {recent.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => setText([displayTitle(note), note.body].filter(Boolean).join("\n"))}
            >
              {displayTitle(note)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function MiniPage() {
  const [client, setClient] = useState<SupabaseClient | null | undefined>(undefined);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const activeClient = getSupabaseBrowserClient();
    // Client resolution is a browser-only external system, so it runs after mount.
    queueMicrotask(() => setClient(activeClient));
    if (!activeClient) return;

    void activeClient.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = activeClient.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (client === undefined) {
    return <main className="mini-shell mini-loading">Loading…</main>;
  }

  return <MiniWorkspace userId={session?.user.id ?? null} client={client} />;
}


