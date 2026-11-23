"use client";

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  Archive,
  Check,
  CircleAlert,
  Database,
  FileText,
  LoaderCircle,
  LogOut,
  Pin,
  Plus,
  Search,
  Tags,
  UserRound,
  WifiOff,
} from "lucide-react";
import { AuthPanel } from "@/components/auth/auth-panel";
import { NoteEditor } from "@/components/notes/note-editor";
import { NoteList } from "@/components/notes/note-list";
import { useNotesWorkspace } from "@/hooks/use-notes-workspace";
import { filterNotes, normalizeTags, sortNotes } from "@/lib/notes/model";
import type { Note, NoteScope } from "@/lib/notes/types";
import { createSupabaseSyncAdapter } from "@/lib/supabase/adapter";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SyncAdapter, SyncEngineState } from "@/lib/sync/engine";

function Brand() {
  return (
    <div className="brand-lockup">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
      </span>
      <span>Tether Notes</span>
    </div>
  );
}

function AppLoading() {
  return (
    <main className="app-loading" aria-busy="true">
      <Brand />
      <div className="loading-line" />
      <p>Opening your notes…</p>
    </main>
  );
}

interface SyncIndicatorProps {
  state: SyncEngineState;
  onRetry: () => void;
}

function SyncIndicator({ state, onRetry }: SyncIndicatorProps) {
  const content = {
    idle: { icon: Database, label: "Starting local storage" },
    "local-only": { icon: Database, label: "Local only" },
    offline: { icon: WifiOff, label: "Offline" },
    syncing: { icon: LoaderCircle, label: "Syncing" },
    synced: {
      icon: Check,
      label: state.pending > 0 ? `${state.pending} waiting` : "Synced",
    },
    error: { icon: CircleAlert, label: "Sync error" },
  }[state.phase];
  const Icon = content.icon;

  return (
    <div
      className={`sync-indicator sync-${state.phase}`}
      role="status"
      aria-live="polite"
      title={state.phase === "error" ? state.error : undefined}
    >
      <Icon className={state.phase === "syncing" ? "spin" : undefined} aria-hidden="true" />
      <span className="sync-label">{content.label}</span>
      {state.phase === "error" ? (
        <button type="button" onClick={onRetry}>Retry</button>
      ) : null}
      {state.phase === "error" && state.error ? (
        <span className="sr-only">Sync failed: {state.error}</span>
      ) : null}
    </div>
  );
}

interface WorkspaceProps {
  userId: string | null;
  email: string | null;
  adapter: SyncAdapter | null;
  onSignOut?: () => Promise<void>;
  bootWarning?: string | null;
}

function NotesWorkspace({ userId, email, adapter, onSignOut, bootWarning }: WorkspaceProps) {
  const workspace = useNotesWorkspace(userId, adapter);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [scope, setScope] = useState<NoteScope>("all");
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Note | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "editor">("list");
  const [accountOpen, setAccountOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const draftRevision = useRef(0);

  const storedSelected = workspace.notes?.find((note) => note.id === selectedId);
  const candidateDraft = isDirty ? draft : (storedSelected ?? draft);
  const activeDraft = candidateDraft?.deletedAt === null ? candidateDraft : null;

  const notesWithDraft = useMemo(() => {
    const notes = workspace.notes ?? [];
    return notes.map((note) => (activeDraft?.id === note.id ? activeDraft : note));
  }, [activeDraft, workspace.notes]);

  const filteredNotes = useMemo(
    () =>
      sortNotes(
        filterNotes(notesWithDraft, {
          scope,
          query,
          tag: selectedTag ?? undefined,
        }),
      ),
    [notesWithDraft, query, scope, selectedTag],
  );

  const counts = useMemo(
    () => ({
      all: filterNotes(notesWithDraft, { scope: "all" }).length,
      pinned: filterNotes(notesWithDraft, { scope: "pinned" }).length,
      archived: filterNotes(notesWithDraft, { scope: "archived" }).length,
    }),
    [notesWithDraft],
  );

  const tags = useMemo(() => {
    const totals = new Map<string, number>();

    notesWithDraft.forEach((note) => {
      if (note.deletedAt !== null) return;
      note.tags.forEach((tag) => totals.set(tag, (totals.get(tag) ?? 0) + 1));
    });

    return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [notesWithDraft]);

  async function persistDraft(candidate: Note, revision: number) {
    try {
      const saved = await workspace.saveNote({
        ...candidate,
        tags: normalizeTags(candidate.tags),
      });

      if (draftRevision.current === revision && selectedId === saved.id) {
        setDraft(saved);
        setIsDirty(false);
      }
    } catch {
      // The workspace exposes the storage error without discarding editor state.
    }
  }

  const persistAutosave = useEffectEvent(
    (candidate: Note, revision: number) => void persistDraft(candidate, revision),
  );

  useEffect(() => {
    if (!draft || !isDirty) {
      return;
    }

    const candidate = draft;
    const revision = draftRevision.current;
    const timeout = window.setTimeout(() => persistAutosave(candidate, revision), 500);
    return () => window.clearTimeout(timeout);
  }, [draft, isDirty]);

  function flushCurrentDraft() {
    if (!activeDraft || !isDirty) return;
    void persistDraft(activeDraft, draftRevision.current);
  }

  async function handleCreate() {
    flushCurrentDraft();

    try {
      const note = await workspace.createNote();
      draftRevision.current += 1;
      setSelectedId(note.id);
      setDraft(note);
      setIsDirty(false);
      setMobilePane("editor");
    } catch {
      // The workspace exposes the storage error.
    }
  }

  function handleSelect(note: Note) {
    if (note.id !== selectedId) {
      flushCurrentDraft();
      draftRevision.current += 1;
    }

    setSelectedId(note.id);
    setDraft(note);
    setIsDirty(false);
    setMobilePane("editor");
  }

  function handleDraftChange(changes: Partial<Pick<Note, "title" | "body" | "tags">>) {
    draftRevision.current += 1;
    setDraft((current) => (current ? { ...current, ...changes } : current));
    setIsDirty(true);
  }

  async function persistImmediate(candidate: Note) {
    draftRevision.current += 1;
    const revision = draftRevision.current;
    setDraft(candidate);
    setIsDirty(true);
    await persistDraft(candidate, revision);
  }

  function handleTogglePin() {
    if (activeDraft) {
      void persistImmediate({ ...activeDraft, isPinned: !activeDraft.isPinned });
    }
  }

  function handleToggleArchive() {
    if (!activeDraft) return;
    const willLeaveView =
      (scope !== "archived" && !activeDraft.isArchived) ||
      (scope === "archived" && activeDraft.isArchived);
    void persistImmediate({ ...activeDraft, isArchived: !activeDraft.isArchived }).then(() => {
      if (willLeaveView) {
        setSelectedId(null);
        setDraft(null);
        setMobilePane("list");
      }
    });
  }

  async function handleDelete() {
    if (!activeDraft || !window.confirm("Delete this note? It will be removed from every synced device.")) {
      return;
    }

    try {
      draftRevision.current += 1;
      await workspace.deleteNote(activeDraft.id);
      setSelectedId(null);
      setDraft(null);
      setIsDirty(false);
      setMobilePane("list");
    } catch {
      // The workspace exposes the storage error.
    }
  }

  function handleScope(nextScope: NoteScope) {
    flushCurrentDraft();
    setScope(nextScope);
    setSelectedTag(null);
    setSelectedId(null);
    setDraft(null);
    setMobilePane("list");
  }

  function handleTagSelect(tag: string) {
    setSelectedTag(tag || null);
    setMobilePane("list");
  }

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    const command = event.metaKey || event.ctrlKey;

    if (command && event.key.toLowerCase() === "n") {
      event.preventDefault();
      void handleCreate();
      return;
    }

    if (command && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchInputRef.current?.focus();
      return;
    }

    if (command && event.key.toLowerCase() === "s") {
      event.preventDefault();
      flushCurrentDraft();
      return;
    }

    if (event.key === "Escape") {
      setAccountOpen(false);
      if (mobilePane === "editor") setMobilePane("list");
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  async function handleSignOut() {
    if (!onSignOut) return;
    flushCurrentDraft();
    setIsSigningOut(true);

    try {
      await onSignOut();
    } finally {
      setIsSigningOut(false);
      setAccountOpen(false);
    }
  }

  return (
    <main className="app-frame">
      <aside className="sidebar">
        <Brand />
        <button className="new-note-button" type="button" onClick={() => void handleCreate()}>
          <Plus aria-hidden="true" />
          New note
          <kbd>⌘ N</kbd>
        </button>

        <nav className="sidebar-nav" aria-label="Note filters">
          <p>Notes</p>
          {([
            ["all", FileText, "All notes"],
            ["pinned", Pin, "Pinned"],
            ["archived", Archive, "Archived"],
          ] as const).map(([value, Icon, label]) => (
            <button
              className={scope === value && !selectedTag ? "is-active" : undefined}
              type="button"
              key={value}
              onClick={() => handleScope(value)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              <span className="nav-count num">{counts[value]}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-tags">
          <p><Tags aria-hidden="true" /> Tags</p>
          {tags.length > 0 ? (
            tags.slice(0, 8).map(([tag, count]) => (
              <button
                className={selectedTag === tag ? "is-active" : undefined}
                type="button"
                key={tag}
                onClick={() => handleTagSelect(tag)}
              >
                <span>#{tag}</span>
                <span className="num">{count}</span>
              </button>
            ))
          ) : (
            <span className="tags-empty">Tags added to notes appear here.</span>
          )}
        </div>

        <div className="sidebar-foot">
          <span>{userId ? "Synced workspace" : "On this device"}</span>
          <strong>{email ?? "Local workspace"}</strong>
        </div>
      </aside>

      <header className="topbar">
        <div className="mobile-brand"><Brand /></div>
        <label className="search-field">
          <Search aria-hidden="true" />
          <span className="sr-only">Search notes</span>
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes"
          />
          <kbd>⌘ K</kbd>
        </label>
        <div className="topbar-actions">
          <SyncIndicator state={workspace.syncState} onRetry={() => void workspace.retrySync()} />
          <div className="account-control">
            <button
              className="account-button"
              type="button"
              aria-label="Account menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((open) => !open)}
            >
              <UserRound aria-hidden="true" />
            </button>
            {accountOpen ? (
              <div className="account-menu">
                <span>{userId ? "Signed in" : "Local-only mode"}</span>
                <strong>{email ?? "No account required"}</strong>
                {onSignOut ? (
                  <button type="button" onClick={() => void handleSignOut()} disabled={isSigningOut}>
                    <LogOut aria-hidden="true" />
                    {isSigningOut ? "Signing out…" : "Sign out"}
                  </button>
                ) : (
                  <p>Add public Supabase environment values to enable account sync.</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="workspace-sheet">
        {bootWarning && !warningDismissed ? (
          <div className="storage-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{bootWarning}</span>
            <button type="button" onClick={() => setWarningDismissed(true)}>Dismiss</button>
          </div>
        ) : null}
        {workspace.storageError ? (
          <div className="storage-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{workspace.storageError}</span>
            <button type="button" onClick={workspace.clearStorageError}>Dismiss</button>
          </div>
        ) : null}
        <div className="workspace-panes">
          <NoteList
            notes={filteredNotes}
            selectedId={selectedId}
            isLoading={workspace.isLoading}
            query={query}
            scope={scope}
            selectedTag={selectedTag}
            onSelect={handleSelect}
            onTagSelect={handleTagSelect}
            onCreate={() => void handleCreate()}
            hiddenOnMobile={mobilePane === "editor"}
          />
          <NoteEditor
            note={activeDraft}
            isDirty={isDirty}
            isLocalOnly={workspace.syncState.phase === "local-only"}
            onChange={handleDraftChange}
            onSave={flushCurrentDraft}
            onTogglePin={handleTogglePin}
            onToggleArchive={handleToggleArchive}
            onDelete={() => void handleDelete()}
            onBack={() => {
              flushCurrentDraft();
              setMobilePane("list");
            }}
            onCreate={() => void handleCreate()}
            hiddenOnMobile={mobilePane === "list"}
          />
        </div>
      </div>
    </main>
  );
}

function resolveBrowserClient(): { client: SupabaseClient | null; error: string | null } {
  try {
    return { client: getSupabaseBrowserClient(), error: null };
  } catch (error) {
    return {
      client: null,
      error: `Supabase configuration is invalid, so Tether Notes is running locally. ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

interface AuthLoadingProps {
  error: string | null;
  onRetry: () => void;
  onContinueOffline: () => void;
}

function AuthLoading({ error, onRetry, onContinueOffline }: AuthLoadingProps) {
  return (
    <main className="app-loading" aria-busy={error === null}>
      <Brand />
      <div className="loading-line" />
      <p>{error ? "Account check failed." : "Checking your account…"}</p>
      {error ? (
        <>
          <p className="boot-error">{error}</p>
          <div className="boot-actions">
            <button className="primary-button" type="button" onClick={onRetry}>
              Try again
            </button>
            <button className="secondary-button" type="button" onClick={onContinueOffline}>
              Continue without an account
            </button>
          </div>
        </>
      ) : null}
    </main>
  );
}

const subscribeToNothing = () => () => {};

function CloudWorkspace({
  client,
  onUseLocalMode,
}: {
  client: SupabaseClient;
  onUseLocalMode: () => void;
}) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [authError, setAuthError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [useLocalMode, setUseLocalMode] = useState(false);
  const adapter = useMemo(() => createSupabaseSyncAdapter(client), [client]);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      if (active) {
        setAuthError("The account service did not answer. You can keep working offline.");
      }
    }, 8000);

    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        window.clearTimeout(timeout);
        if (error) {
          setAuthError(error.message);
          return;
        }
        setAuthError(null);
        setSession(data.session);
      })
      .catch((error: unknown) => {
        if (!active) return;
        window.clearTimeout(timeout);
        setAuthError(error instanceof Error ? error.message : String(error));
      });

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setAuthError(null);
      setSession(nextSession);
    });

    return () => {
      active = false;
      window.clearTimeout(timeout);
      data.subscription.unsubscribe();
    };
  }, [client, attempt]);

  if (useLocalMode) {
    return <NotesWorkspace userId={null} email={null} adapter={null} />;
  }

  const continueOffline = () => {
    setUseLocalMode(true);
    onUseLocalMode();
  };

  if (session === undefined) {
    return (
      <AuthLoading
        error={authError}
        onRetry={() => {
          setAuthError(null);
          setAttempt((value) => value + 1);
        }}
        onContinueOffline={continueOffline}
      />
    );
  }

  if (!session) {
    return <AuthPanel client={client} initialError={authError} />;
  }

  return (
    <NotesWorkspace
      userId={session.user.id}
      email={session.user.email ?? null}
      adapter={adapter}
      onSignOut={async () => {
        const { error } = await client.auth.signOut();
        if (error) throw error;
      }}
    />
  );
}

export function TetherApp() {
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [forceLocalMode, setForceLocalMode] = useState(false);
  const boot = hydrated ? resolveBrowserClient() : { client: null, error: null };

  if (!hydrated) {
    return <AppLoading />;
  }

  if (boot.client === null || forceLocalMode) {
    if (boot.error) console.warn(boot.error);
    return (
      <NotesWorkspace
        userId={null}
        email={null}
        adapter={null}
        bootWarning={boot.error}
      />
    );
  }

  return (
    <CloudWorkspace client={boot.client} onUseLocalMode={() => setForceLocalMode(true)} />
  );
}
