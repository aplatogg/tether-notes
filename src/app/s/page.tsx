"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LoaderCircle, Lock } from "lucide-react";
import { NoteBody } from "@/components/notes/note-body";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchSharedNote, type SharedNote } from "@/lib/supabase/share";

function SharedNoteView() {
  const params = useSearchParams();
  const token = params?.get("t") ?? "";
  const [note, setNote] = useState<SharedNote | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      queueMicrotask(() => {
        setError("This share link is missing its token.");
        setNote(null);
      });
      return;
    }

    let active = true;
    const client = getSupabaseBrowserClient();

    if (!client) {
      queueMicrotask(() => {
        if (!active) return;
        setError("Sharing is not configured for this deployment.");
        setNote(null);
      });
      return () => {
        active = false;
      };
    }

    void fetchSharedNote(client, token)
      .then((result) => {
        if (active) setNote(result);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setNote(null);
      });

    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (note?.title) document.title = `${note.title} — Shared note`;
  }, [note]);

  return (
    <main className="share-frame">
      <article className="share-sheet">
        <header className="share-header">
          <Link className="share-back" href="/">
            <ArrowLeft aria-hidden="true" /> Tether Notes
          </Link>
          <span className="share-badge">Shared note</span>
        </header>

        {note === undefined ? (
          <p className="share-status" aria-busy="true">
            <LoaderCircle className="spin" aria-hidden="true" /> Loading the shared note…
          </p>
        ) : null}

        {error ? <p className="share-status form-error" role="alert">{error}</p> : null}

        {note === null && !error ? (
          <p className="share-status">This link is invalid or was revoked.</p>
        ) : null}

        {note ? (
          <>
            <h1 className="share-title">{note.title || "Untitled note"}</h1>
            {note.isLocked || note.body === null ? (
              <p className="share-status">
                <Lock aria-hidden="true" /> The owner locked this note, so its content is not shared.
              </p>
            ) : (
              <NoteBody body={note.body} />
            )}
            <footer className="share-footer">
              Updated {new Date(note.updatedAt).toLocaleString()}
            </footer>
          </>
        ) : null}
      </article>
    </main>
  );
}

export default function SharedNotePage() {
  return (
    <Suspense
      fallback={
        <main className="share-frame">
          <p className="share-status">Loading…</p>
        </main>
      }
    >
      <SharedNoteView />
    </Suspense>
  );
}

