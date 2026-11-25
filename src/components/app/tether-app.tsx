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
  Bell,
  Briefcase,
  Check,
  CircleAlert,
  Database,
  Download,
  FileText,
  Folder,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Tags,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  WifiOff,
  X,
} from "lucide-react";
import { AuthPanel } from "@/components/auth/auth-panel";
import { NoteEditor } from "@/components/notes/note-editor";
import { NoteList } from "@/components/notes/note-list";
import {
  DEFAULT_GROUP,
  collectFolders,
  collectShareGroups,
  filterNotes,
  folderDepth,
  folderLabel,
  folderTreeCounts,
  mergeFolders,
  normalizeTags,
  sortNotes,
} from "@/lib/notes/model";
import {
  downloadText,
  exportNotesJson,
  parseImportJson,
} from "@/lib/notes/export";
import {
  dueReminders,
  ensureNotificationPermission,
  loadFiredReminders,
  notifyDue,
  saveFiredReminders,
} from "@/lib/notes/reminder";
import { useNotesWorkspace } from "@/hooks/use-notes-workspace";
import { tagColor } from "@/lib/notes/tags";
import type { Note, NoteScope } from "@/lib/notes/types";
import { createSupabaseSyncAdapter } from "@/lib/supabase/adapter";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getNotesDatabase } from "@/lib/db/database";
import { NotesRepository } from "@/lib/db/repository";
import { setSharedNoteGroup, setShareAutogroup } from "@/lib/supabase/sharing";
import {
  acceptWorkspaceInvite,
  createWorkspace,
  declineWorkspaceInvite,
  deleteWorkspace,
  inviteWorkspaceMember,
  leaveWorkspace,
  listMyInvites,
  listMyWorkspaces,
  listWorkspaceMembers,
  removeWorkspaceMember,
  renameWorkspace,
  type Workspace,
  type WorkspaceInvite,
  type WorkspaceMember,
} from "@/lib/supabase/workspaces";
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
  client: SupabaseClient | null;
  onSignOut?: () => Promise<void>;
  bootWarning?: string | null;
}

function NotesWorkspace({ userId, email, adapter, client, onSignOut, bootWarning }: WorkspaceProps) {
  const workspace = useNotesWorkspace(userId, adapter);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [scope, setScope] = useState<NoteScope>("all");
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedShareGroup, setSelectedShareGroup] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupError, setNewGroupError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  // null = every note (All notes), "personal" = notes outside any workspace,
  // a workspace id = that workspace. These were one null before, which mixed
  // personal and workspace rows together.
  const [selectedWorkspace, setSelectedWorkspace] = useState<
    string | "personal" | null
  >(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [membersDialog, setMembersDialog] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [membersBusy, setMembersBusy] = useState(false);
  const [confirmDeleteWs, setConfirmDeleteWs] = useState(false);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<string | null>(null);
  const [editingWs, setEditingWs] = useState<{ id: string; name: string } | null>(null);
  const [wsMenuId, setWsMenuId] = useState<string | null>(null);

  // A dropdown opened from the workspace row must close on any outside click;
  // per-button handlers alone would leave it stuck open.
  useEffect(() => {
    if (wsMenuId === null) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".workspace-menu-wrap")) return;
      setWsMenuId(null);
      setConfirmDeleteRow(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [wsMenuId]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Note | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "editor">("list");
  const [navOpen, setNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const draftRevision = useRef(0);

  const storedSelected = workspace.notes?.find((note) => note.id === selectedId);
  const candidateDraft = isDirty ? draft : (storedSelected ?? draft);
  // Trashed notes stay selectable so the editor can offer restore / delete forever.
  const activeDraft = candidateDraft;

  const notesWithDraft = useMemo(() => {
    const notes = workspace.notes ?? [];
    return notes.map((note) => (activeDraft?.id === note.id ? activeDraft : note));
  }, [activeDraft, workspace.notes]);

  const folders = useMemo(
    () => mergeFolders(collectFolders(notesWithDraft), workspace.customFolders ?? []),
    [notesWithDraft, workspace.customFolders],
  );

  // Default view: the user's own "General" group, but only when it actually has
  // personal notes (workspace notes don't count), unless the user cleared it.
  const [folderCleared, setFolderCleared] = useState(false);
  const hasPersonalDefaultGroup = useMemo(
    () =>
      notesWithDraft.some(
        (note) =>
          !note.shared &&
          !note.workspaceId &&
          note.deletedAt === null &&
          (note.folder ?? "").trim() === DEFAULT_GROUP,
      ),
    [notesWithDraft],
  );
  const effectiveFolder =
    selectedFolder ??
    (folderCleared || scope !== "all" || !hasPersonalDefaultGroup ? null : DEFAULT_GROUP);

  const filteredNotes = useMemo(
    () =>
      sortNotes(
        filterNotes(notesWithDraft, {
          scope,
          query,
          tag: selectedTag ?? undefined,
          folder: effectiveFolder ?? undefined,
          day: calendarDay ?? undefined,
          shareGroup: scope === "shared" ? (selectedShareGroup ?? undefined) : undefined,
          // "personal" means notes outside any workspace; null means no filter.
          workspace:
            selectedWorkspace === "personal"
              ? null
              : (selectedWorkspace ?? undefined),
        }),
      ),
    [
      notesWithDraft,
      query,
      scope,
      selectedTag,
      effectiveFolder,
      calendarDay,
      selectedShareGroup,
      selectedWorkspace,
    ],
  );

  const workspaceCounts = useMemo(() => {
    const totals = new Map<string, number>();
    workspaces.forEach((ws) => {
      totals.set(
        ws.id,
        filterNotes(notesWithDraft, { scope: "all", workspace: ws.id }).length,
      );
    });
    return totals;
  }, [notesWithDraft, workspaces]);

  const personalCount = useMemo(
    () => filterNotes(notesWithDraft, { scope: "all", workspace: null }).length,
    [notesWithDraft],
  );

  async function refreshWorkspaces() {
    if (!client) return;
    try {
      const [list, inviteList] = await Promise.all([
        listMyWorkspaces(client),
        listMyInvites(client),
      ]);
      setWorkspaces(list);
      setInvites(inviteList);
    } catch {
      // surfaced via workspaceError when relevant
    }
  }

  useEffect(() => {
    if (!client || !userId) return;
    const timer = window.setTimeout(() => void refreshWorkspaces(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, userId]);

  // Live-refresh the workspace list + invite inbox when our membership rows change
  // (invited / accepted / removed), so an already-open session sees it without reload.
  useEffect(() => {
    if (!client || !userId) return;
    const channel = client
      .channel(`workspace-list:${userId}:${globalThis.crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workspace_members",
          filter: `user_id=eq.${userId}`,
        },
        () => void refreshWorkspaces(),
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, userId]);

  async function handleAcceptInvite(invite: WorkspaceInvite) {
    if (!client) return;
    setWorkspaceError(null);
    try {
      await acceptWorkspaceInvite(client, invite.workspaceId);
      await refreshWorkspaces();
      setSelectedWorkspace(invite.workspaceId);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDeclineInvite(invite: WorkspaceInvite) {
    if (!client) return;
    setWorkspaceError(null);
    try {
      await declineWorkspaceInvite(client, invite.workspaceId);
      await refreshWorkspaces();
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }

  const shareGroups = useMemo(() => collectShareGroups(notesWithDraft), [notesWithDraft]);

  const shareGroupCounts = useMemo(() => {
    const totals = new Map<string, number>();
    notesWithDraft.forEach((note) => {
      if (!note.shared || note.deletedAt !== null) return;
      const group = (note.shareGroup ?? "").trim();
      if (group) totals.set(group, (totals.get(group) ?? 0) + 1);
    });
    return totals;
  }, [notesWithDraft]);

  const folderCounts = useMemo(() => folderTreeCounts(notesWithDraft), [notesWithDraft]);

  const counts = useMemo(
    () => ({
      all: filterNotes(notesWithDraft, { scope: "all" }).length,
      pinned: filterNotes(notesWithDraft, { scope: "pinned" }).length,
      archived: filterNotes(notesWithDraft, { scope: "archived" }).length,
      shared: filterNotes(notesWithDraft, { scope: "shared" }).length,
      trash: filterNotes(notesWithDraft, { scope: "trash" }).length,
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
      let note = await workspace.createNote();
      // New notes land in the default "General" group and the selected workspace (if any).
      const changes: Partial<Note> = {};
      if (!note.folder?.trim()) changes.folder = DEFAULT_GROUP;
      if (selectedWorkspace && selectedWorkspace !== "personal") {
        changes.workspaceId = selectedWorkspace;
      }
      if (Object.keys(changes).length > 0) {
        note = await workspace.saveNote({ ...note, ...changes });
      }
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

  function handleDraftChange(changes: Partial<Note>) {
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

  useEffect(() => {
    if (workspace.isLoading) return;
    const key = "tether-trash-purge";
    const last = Number(window.sessionStorage.getItem(key) ?? "0");
    if (Date.now() - last < 60 * 60 * 1000) return;
    window.sessionStorage.setItem(key, String(Date.now()));
    void workspace.purgeExpiredTrash();
  }, [workspace.isLoading, workspace]);
  async function handleRestore() {
    if (!activeDraft) return;
    try {
      const restored = await workspace.restoreNote(activeDraft.id);
      setDraft(restored);
      setSelectedId(restored.id);
      setIsDirty(false);
    } catch {
      // The workspace surfaces storage errors.
    }
  }

async function handleDeleteForever() {
    if (!activeDraft) return;
    if (!window.confirm("Delete this note permanently? This cannot be undone.")) return;
    try {
      await workspace.deleteForever(activeDraft.id);
      setDraft(null);
      setSelectedId(null);
      setIsDirty(false);
    } catch {
      // The workspace surfaces storage errors.
    }
  }
  function handleScope(nextScope: NoteScope) {
    flushCurrentDraft();
    setScope(nextScope);
    setSelectedTag(null);
    setSelectedId(null);
    setDraft(null);
    setMobilePane("list");
    setNavOpen(false);
    void workspace.refreshView();
    // Filters from another view must not leak into the new scope (e.g. a
    // workspace chip sticking to Pinned/Trash and hiding everything).
    setSelectedWorkspace(null);
    if (nextScope !== "shared") setSelectedShareGroup(null);
    // "All notes" means every own note: drop the default General group filter.
    if (nextScope === "all") {
      setSelectedFolder(null);
      setFolderCleared(true);
    }
  }

  function handleTagSelect(tag: string) {
    // Picking a tag leaves Trash/Pinned/Shared so the tag view isn't stacked on
    // a stale scope (which used to look like "nothing updates").
    flushCurrentDraft();
    setScope("all");
    setSelectedTag(tag || null);
    setSelectedWorkspace(null);
    setSelectedFolder(null);
    setFolderCleared(true);
    setSelectedShareGroup(null);
    setCalendarDay(null);
    setSelectedId(null);
    setDraft(null);
    setIsDirty(false);
    setMobilePane("list");
    setNavOpen(false);
    void workspace.refreshView();
  }

  function handleFolderSelect(folder: string) {
    // Groups and workspaces are alternative views: selecting one clears the other
    // so the two filters never silently stack into an empty list. Selecting a
    // group also resets the scope so it works from Trash/Pinned/Shared too.
    flushCurrentDraft();
    setScope("all");
    setSelectedFolder(folder || null);
    setFolderCleared(!folder);
    setSelectedWorkspace(null);
    setSelectedShareGroup(null);
    setCalendarDay(null);
    setSelectedId(null);
    setDraft(null);
    setIsDirty(false);
    setMobilePane("list");
    setNavOpen(false);
    void workspace.refreshView();
  }

  function handleWorkspaceSelect(workspaceId: string | "personal" | null) {
    // Switching view switches the whole scope: reset the scope (so Trash /
    // Pinned / Shared don't silently stack with the workspace filter), the group
    // filter, and the open note so the editor doesn't keep showing a note from
    // another view.
    flushCurrentDraft();
    setScope("all");
    setSelectedWorkspace(workspaceId);
    setSelectedFolder(null);
    setFolderCleared(true);
    setSelectedShareGroup(null);
    setSelectedTag(null);
    setCalendarDay(null);
    setSelectedId(null);
    setDraft(null);
    setIsDirty(false);
    setMobilePane("list");
    setNavOpen(false);
    void workspace.refreshView();
  }

  async function handleCreateWorkspace() {
    if (!client || !newWorkspaceName.trim()) return;
    setWorkspaceError(null);
    try {
      const id = await createWorkspace(client, newWorkspaceName.trim());
      const list = await listMyWorkspaces(client);
      setWorkspaces(list);
      setCreatingWorkspace(false);
      setNewWorkspaceName("");
      setSelectedWorkspace(id);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }

  async function openMembersDialog(ws: Workspace) {
    if (!client) return;
    setMembersDialog(ws);
    setInviteEmail("");
    setWorkspaceError(null);
    setMembersBusy(true);
    try {
      setMembers(await listWorkspaceMembers(client, ws.id));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setMembersBusy(false);
    }
  }

  async function handleInviteMember() {
    if (!client || !membersDialog || !inviteEmail.trim()) return;
    setMembersBusy(true);
    setWorkspaceError(null);
    try {
      await inviteWorkspaceMember(client, membersDialog.id, inviteEmail.trim());
      setMembers(await listWorkspaceMembers(client, membersDialog.id));
      setInviteEmail("");
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setMembersBusy(false);
    }
  }

  async function handleRemoveMember(member: WorkspaceMember) {
    if (!client || !membersDialog) return;
    setMembersBusy(true);
    setWorkspaceError(null);
    try {
      await removeWorkspaceMember(client, membersDialog.id, member.userId);
      setMembers(await listWorkspaceMembers(client, membersDialog.id));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setMembersBusy(false);
    }
  }

  async function handleRenameWorkspace() {
    if (!client || !editingWs || !editingWs.name.trim()) return;
    setWorkspaceError(null);
    try {
      await renameWorkspace(client, editingWs.id, editingWs.name.trim());
      await refreshWorkspaces();
      setEditingWs(null);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDeleteWorkspaceById(workspaceId: string) {
    if (!client) return;
    setWorkspaceError(null);
    try {
      await deleteWorkspace(client, workspaceId);
      await refreshWorkspaces();
      if (selectedWorkspace === workspaceId) setSelectedWorkspace(null);
      setConfirmDeleteRow(null);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDeleteWorkspace() {
    if (!client || !membersDialog) return;
    setMembersBusy(true);
    setWorkspaceError(null);
    try {
      await deleteWorkspace(client, membersDialog.id);
      await refreshWorkspaces();
      setMembersDialog(null);
      setConfirmDeleteWs(false);
      if (selectedWorkspace === membersDialog.id) setSelectedWorkspace(null);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setMembersBusy(false);
    }
  }

  async function handleLeaveWorkspace() {
    if (!client || !membersDialog) return;
    setMembersBusy(true);
    setWorkspaceError(null);
    try {
      await leaveWorkspace(client, membersDialog.id);
      setWorkspaces(await listMyWorkspaces(client));
      setMembersDialog(null);
      setSelectedWorkspace(null);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setMembersBusy(false);
    }
  }

  async function handleCreateGroup() {
    const name = newGroupName.trim();
    if (!name) {
      setNewGroupError("Name the group first (e.g. Kerja or Kerja/Q4).");
      return;
    }
    try {
      await workspace.addCustomFolder(name);
      setCreatingGroup(false);
      setNewGroupName("");
      setNewGroupError(null);
      handleFolderSelect(name);
    } catch (error) {
      setNewGroupError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleShareGroupSelect(group: string) {
    setSelectedShareGroup(group || null);
    if (scope !== "shared") setScope("shared");
    setMobilePane("list");
    setNavOpen(false);
  }

  async function handleAssignShareGroup(note: Note, group: string, autogroup: boolean) {
    if (!client) return;
    try {
      await setSharedNoteGroup(client, note.id, group);
      if (autogroup && note.ownerEmail) {
        await setShareAutogroup(client, note.ownerEmail, group);
      }
      await workspace.setShareGroup(note.id, group || null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  function handleExport() {
    const own = (notesWithDraft ?? []).filter((note) => !note.shared);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`tether-notes-${stamp}.json`, exportNotesJson(own));
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    setImportError(null);
    try {
      const text = await file.text();
      let imported: Note[];
      try {
        imported = parseImportJson(text);
      } catch {
        setImportError("That file is not a valid Tether Notes JSON export.");
        return;
      }
      let count = 0;
      for (const note of imported) {
        await workspace.saveNote({ ...note, userId, shared: false, sharedFor: null, ownerEmail: null });
        count += 1;
      }
      void workspace.retrySync();
      window.alert(`Imported ${count} note${count === 1 ? "" : "s"}.`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  // Fire local notifications for due reminders.
  useEffect(() => {
    if (!workspace.notes) return;
    const check = () => {
      const fired = loadFiredReminders();
      const due = dueReminders(workspace.notes ?? [], new Date(), fired);
      if (due.length === 0) return;
      due.forEach((note) => {
        fired.add(note.id);
        void notifyDue(note);
      });
      saveFiredReminders(fired);
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [workspace.notes]);

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

    // Ctrl/Cmd+R: browsers reload natively; the Tauri shell doesn't, so handle
    // it here to make refresh work in the desktop app too.
    if (command && event.key.toLowerCase() === "r") {
      event.preventDefault();
      window.location.reload();
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
      {navOpen ? (
        <div
          className="nav-backdrop"
          aria-hidden="true"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <aside className={navOpen ? "sidebar sidebar-open" : "sidebar"}>
        <Brand />
        <button className="new-note-button" type="button" onClick={() => void handleCreate()}>
          <Plus aria-hidden="true" />
          New note
          <kbd>⌘ N</kbd>
        </button>

        {client && userId && invites.length > 0 ? (
          <div className="sidebar-tags">
            <p><Bell aria-hidden="true" /> Invitations</p>
            {invites.map((invite) => (
              <div className="workspace-row" key={invite.workspaceId}>
                <button type="button" title={`Invited by ${invite.inviterEmail}`} disabled>
                  <span>{invite.name}</span>
                </button>
                <button
                  type="button"
                  className="workspace-manage"
                  aria-label={`Accept invite to ${invite.name}`}
                  title="Accept"
                  onClick={() => void handleAcceptInvite(invite)}
                >
                  <Check aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="workspace-manage"
                  aria-label={`Decline invite to ${invite.name}`}
                  title="Decline"
                  onClick={() => void handleDeclineInvite(invite)}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {client && userId ? (
          <div className="sidebar-tags">
            <p>
              <Briefcase aria-hidden="true" /> Workspaces
              <button
                type="button"
                className="new-group-button"
                aria-label="New workspace"
                title="New workspace"
                onClick={() => {
                  setCreatingWorkspace((value) => !value);
                  setNewWorkspaceName("");
                  setWorkspaceError(null);
                }}
              >
                +
              </button>
            </p>
            {creatingWorkspace ? (
              <form
                className="new-group-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleCreateWorkspace();
                }}
              >
                <input
                  type="text"
                  aria-label="New workspace name"
                  placeholder="Tim Kerja"
                  maxLength={60}
                  autoFocus
                  value={newWorkspaceName}
                  onChange={(event) => setNewWorkspaceName(event.target.value)}
                />
                <div className="pin-actions">
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={!newWorkspaceName.trim()}
                  >
                    Create
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setCreatingWorkspace(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
            <button
              className={selectedWorkspace === "personal" ? "is-active" : undefined}
              type="button"
              onClick={() => handleWorkspaceSelect("personal")}
            >
              <span>Personal</span>
              <span className="num">{personalCount}</span>
            </button>
            {workspaces.map((ws) => (
              <div className="workspace-row" key={ws.id}>
                {editingWs?.id === ws.id ? (
                  <form
                    className="new-group-form workspace-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleRenameWorkspace();
                    }}
                  >
                    <input
                      type="text"
                      aria-label="Rename workspace"
                      maxLength={60}
                      autoFocus
                      value={editingWs.name}
                      onChange={(event) =>
                        setEditingWs({ id: ws.id, name: event.target.value })
                      }
                    />
                    <button type="submit" className="workspace-manage" aria-label="Save name" title="Save">
                      <Check aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="workspace-manage"
                      aria-label="Cancel rename"
                      title="Cancel"
                      onClick={() => setEditingWs(null)}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </form>
                ) : (
                  <button
                    className={selectedWorkspace === ws.id ? "is-active" : undefined}
                    type="button"
                    onClick={() => handleWorkspaceSelect(ws.id)}
                  >
                    <span>{ws.name}</span>
                    <span className="num">{workspaceCounts.get(ws.id) ?? 0}</span>
                  </button>
                )}
                {editingWs?.id === ws.id ? null : (
                  <div className="workspace-menu-wrap">
                    <button
                      type="button"
                      className="workspace-manage"
                      aria-label={`Actions for ${ws.name}`}
                      aria-haspopup="menu"
                      aria-expanded={wsMenuId === ws.id}
                      title="More"
                      onClick={() => {
                        setConfirmDeleteRow(null);
                        setWsMenuId((current) => (current === ws.id ? null : ws.id));
                      }}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </button>
                    {wsMenuId === ws.id ? (
                      <div className="workspace-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setWsMenuId(null);
                            void openMembersDialog(ws);
                          }}
                        >
                          <UsersRound aria-hidden="true" /> Members
                        </button>
                        {ws.role === "owner" ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setWsMenuId(null);
                              setEditingWs({ id: ws.id, name: ws.name });
                            }}
                          >
                            <Pencil aria-hidden="true" /> Rename
                          </button>
                        ) : null}
                        {ws.role === "owner" ? (
                          confirmDeleteRow === ws.id ? (
                            <button
                              type="button"
                              role="menuitem"
                              className="is-danger"
                              onClick={() => {
                                setWsMenuId(null);
                                setConfirmDeleteRow(null);
                                void handleDeleteWorkspaceById(ws.id);
                              }}
                            >
                              <Check aria-hidden="true" /> Confirm delete
                            </button>
                          ) : (
                            <button
                              type="button"
                              role="menuitem"
                              className="is-danger"
                              onClick={() => setConfirmDeleteRow(ws.id)}
                            >
                              <Trash2 aria-hidden="true" /> Delete workspace
                            </button>
                          )
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null}

        <nav className="sidebar-nav" aria-label="Note filters">
          <p>Notes</p>
          {([
            ["all", FileText, "All notes"],
            ["pinned", Pin, "Pinned"],
            ["archived", Archive, "Archived"],
            ["shared", UsersRound, "Shared with me"],
            ["trash", Trash2, "Trash"],
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
                <span style={{ color: tagColor(tag).ink }}>#{tag}</span>
                <span className="num">{count}</span>
              </button>
            ))
          ) : (
            <span className="tags-empty">Tags added to notes appear here.</span>
          )}
        </div>

        <div className="sidebar-tags">
          <p>
            <Folder aria-hidden="true" /> Groups
            <button
              type="button"
              className="new-group-button"
              aria-label="New group"
              title="New group (use / for sub-groups, e.g. Kerja/Q4)"
              onClick={() => {
                setCreatingGroup((value) => !value);
                setNewGroupName("");
                setNewGroupError(null);
              }}
            >
              +
            </button>
          </p>
          {creatingGroup ? (
            <form
              className="new-group-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateGroup();
              }}
            >
              <input
                type="text"
                aria-label="New group name"
                placeholder="Kerja/Q4"
                maxLength={60}
                autoFocus
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
              />
              {newGroupError ? <p className="form-error" role="alert">{newGroupError}</p> : null}
            </form>
          ) : null}
          {folders.length > 0 ? (
            folders.slice(0, 24).map((folder) => (
              <button
                className={effectiveFolder === folder ? "is-active" : undefined}
                type="button"
                key={folder}
                style={{ paddingLeft: `${10 + folderDepth(folder) * 14}px` }}
                title={folder}
                onClick={() => handleFolderSelect(folder)}
              >
                <span>{folderLabel(folder)}</span>
                <span className="num">{folderCounts.get(folder) ?? 0}</span>
              </button>
            ))
          ) : (
            <span className="tags-empty">Create a group to file notes into.</span>
          )}
        </div>

        {shareGroups.length > 0 ? (
          <div className="sidebar-tags">
            <p><UsersRound aria-hidden="true" /> Share groups</p>
            {shareGroups.slice(0, 10).map((group) => (
              <button
                className={selectedShareGroup === group && scope === "shared" ? "is-active" : undefined}
                type="button"
                key={group}
                onClick={() => handleShareGroupSelect(group)}
              >
                <span>{group}</span>
                <span className="num">{shareGroupCounts.get(group) ?? 0}</span>
              </button>
            ))}
          </div>
        ) : null}


        <div className="sidebar-foot">
          <span>{userId ? "Synced workspace" : "On this device"}</span>
          <strong>{email ?? "Local workspace"}</strong>
        </div>
      </aside>

      {membersDialog ? (
        <div className="pin-backdrop" role="dialog" aria-modal="true" aria-label={`Members of ${membersDialog.name}`}>
          <div className="pin-dialog">
            <h2>{membersDialog.name}</h2>
            <p>Members can read and edit every note in this workspace. Invite by account email.</p>
            {membersDialog.role === "owner" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleInviteMember();
                }}
              >
                <label className="sr-only" htmlFor="invite-email">Email</label>
                <input
                  id="invite-email"
                  type="email"
                  autoComplete="off"
                  placeholder="name@example.com"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
                <div className="pin-actions">
                  <button className="primary-button" type="submit" disabled={membersBusy || !inviteEmail.trim()}>
                    {membersBusy ? "Working…" : "Invite"}
                  </button>
                </div>
              </form>
            ) : null}
            {members.length > 0 ? (
              <ul className="grant-list">
                {members.map((member) => (
                  <li key={member.userId}>
                    <span className="grant-who">
                      <span className="grant-email">{member.email}</span>
                      <span className="grant-role">{member.role}</span>
                    </span>
                    {membersDialog.role === "owner" && member.role !== "owner" ? (
                      <button
                        type="button"
                        className="grant-remove"
                        disabled={membersBusy}
                        onClick={() => void handleRemoveMember(member)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="grant-empty">No members yet.</p>
            )}
            {workspaceError ? <p className="form-error" role="alert">{workspaceError}</p> : null}
            <div className="pin-actions">
              {membersDialog.role === "owner" ? (
                confirmDeleteWs ? (
                  <>
                    <button
                      type="button"
                      className="danger-link"
                      disabled={membersBusy}
                      onClick={() => void handleDeleteWorkspace()}
                    >
                      {membersBusy ? "Deleting…" : "Confirm delete"}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => setConfirmDeleteWs(false)}>
                      Keep it
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="danger-link"
                    onClick={() => setConfirmDeleteWs(true)}
                  >
                    Delete workspace…
                  </button>
                )
              ) : (
                <button type="button" className="danger-link" disabled={membersBusy} onClick={() => void handleLeaveWorkspace()}>
                  Leave workspace
                </button>
              )}
              <button type="button" className="secondary-button" onClick={() => { setMembersDialog(null); setConfirmDeleteWs(false); }}>Close</button>
            </div>
            {confirmDeleteWs ? (
              <p className="form-error" role="alert">
                Deleting removes the workspace for everyone. Notes are kept and become personal.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <header className="topbar">
        <button
          className="icon-button nav-toggle"
          type="button"
          aria-label="Open navigation"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}
        >
          <Menu aria-hidden="true" />
        </button>
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
                {userId ? (
                  <>
                    <button type="button" onClick={handleExport}>
                      <Download aria-hidden="true" /> Export all notes (.json)
                    </button>
                    <button type="button" onClick={() => importInputRef.current?.click()}>
                      <Upload aria-hidden="true" /> Import notes (.json)
                    </button>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept="application/json,.json"
                      className="sr-only"
                      aria-label="Import notes file"
                      onChange={(event) => void handleImportFile(event.target.files?.[0])}
                    />
                    <button
                      type="button"
                      onClick={() => void ensureNotificationPermission()}
                    >
                      <Bell aria-hidden="true" /> Enable reminder notifications
                    </button>
                  </>
                ) : null}
                {importError ? <p className="form-error" role="alert">{importError}</p> : null}
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
              selectedFolder={effectiveFolder}
              showCalendar={showCalendar}
              calendarDay={calendarDay}
              calendarNotes={notesWithDraft}
              onSelect={handleSelect}
              onTagSelect={handleTagSelect}
              onFolderSelect={handleFolderSelect}
              shareGroups={shareGroups}
              selectedShareGroup={selectedShareGroup}
              workspaces={workspaces}
              selectedWorkspace={selectedWorkspace}
              onWorkspaceSelect={handleWorkspaceSelect}
              onShareGroupSelect={handleShareGroupSelect}
              onAssignShareGroup={(note, group, autogroup) =>
                void handleAssignShareGroup(note, group, autogroup)
              }
              onToggleCalendar={() => setShowCalendar((value) => !value)}
              onSelectDay={setCalendarDay}
              onCreate={() => void handleCreate()}
              hiddenOnMobile={mobilePane === "editor"}
            />
            <NoteEditor
              note={activeDraft}
              currentUserId={userId}
              isDirty={isDirty}
              isLocalOnly={workspace.syncState.phase === "local-only"}
              folders={folders}
              workspaces={workspaces}
              onChange={handleDraftChange}
            onSave={flushCurrentDraft}
            onTogglePin={handleTogglePin}
            onToggleArchive={handleToggleArchive}
            onDelete={() => void handleDelete()}
            onRestore={() => void handleRestore()}
            onDeleteForever={() => void handleDeleteForever()}
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
    return <NotesWorkspace userId={null} email={null} adapter={null} client={null} />;
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
      client={client}
      onSignOut={async () => {
        const { error } = await client.auth.signOut();
        if (error) throw error;
        // Privacy on shared machines: wipe this account's local cache, but only
        // when nothing is pending sync (otherwise the next sign-in resumes it).
        const database = getNotesDatabase();
        if (database) {
          const repository = new NotesRepository(database);
          const pending = await repository.listOutbox(session.user.id);
          if (pending.length === 0) {
            await repository.clearUserData(session.user.id);
          }
        }
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
          client={null}
          bootWarning={boot.error}
        />
      );
  }

  return (
    <CloudWorkspace client={boot.client} onUseLocalMode={() => setForceLocalMode(true)} />
  );
}








