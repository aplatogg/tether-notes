import type { NotesRepository } from "@/lib/db/repository";
import type { Note } from "@/lib/notes/types";

export type SyncPhase =
  | "idle"
  | "local-only"
  | "offline"
  | "syncing"
  | "synced"
  | "error";

export interface SyncEngineState {
  phase: SyncPhase;
  pending: number;
  attempt: number;
  lastSyncedAt?: string;
  error?: string;
}

export interface SyncAdapter {
  pull(userId: string): Promise<Note[]>;
  upsert(note: Note): Promise<void>;
  softDelete(note: Note): Promise<void>;
  /** Permanent removal, used by the 30-day trash. */
  purge?(noteId: string): Promise<void>;
  subscribe?: (
    userId: string,
    onRemoteNote: (note: Note) => void | Promise<void>,
    onError: (error: unknown) => void,
    onRemoteDelete?: (noteId: string) => void | Promise<void>,
  ) => (() => void | Promise<void>) | Promise<() => void | Promise<void>>;
}

export interface SyncEngineOptions {
  maxAttempts?: number;
  retryDelayMs?: (attempt: number) => number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => string;
  isOnline?: () => boolean;
  /** Monotonic-ish millisecond clock used by the pull throttle (tests inject it). */
  nowMs?: () => number;
  /** Background refresh while started; 0 disables. Default 30s. */
  pollIntervalMs?: number;
  /** `syncSoon()` skips a pull made less than this long ago. Default 5s. */
  minPullIntervalMs?: number;
}

type StateListener = (state: SyncEngineState) => void;

export type RemoteEvent =
  | { type: "note"; note: Note }
  | { type: "delete"; noteId: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SyncEngine {
  private readonly listeners = new Set<StateListener>();
  private readonly remoteListeners = new Set<(event: RemoteEvent) => void>();
  private lastPull: Note[] | null = null;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: (attempt: number) => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
private readonly now: () => string;
  private readonly nowMs: () => number;
  private readonly isOnline: () => boolean;
  private readonly pollIntervalMs: number;
  private readonly minPullIntervalMs: number;
  private state: SyncEngineState = { phase: "idle", pending: 0, attempt: 0 };
  private syncPromise: Promise<void> | null = null;
  private releaseSubscription: (() => void | Promise<void>) | null = null;
  private pollTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private lastPullAt = 0;

  constructor(
    private readonly repository: NotesRepository,
    private readonly adapter: SyncAdapter | null,
    private readonly userId: string,
    options: SyncEngineOptions = {},
  ) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.retryDelayMs =
      options.retryDelayMs ?? ((attempt) => Math.min(4_000, 300 * 3 ** (attempt - 1)));
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)));
    this.now = options.now ?? (() => new Date().toISOString());
    this.nowMs = options.nowMs ?? (() => Date.now());
this.isOnline =
      options.isOnline ??
      (() => typeof navigator === "undefined" || navigator.onLine !== false);
    this.pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 30_000);
    this.minPullIntervalMs = Math.max(0, options.minPullIntervalMs ?? 5_000);
  }

  getState(): SyncEngineState {
    return { ...this.state };
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  /** Fires whenever a realtime remote note/delete arrives. */
  onRemote(listener: (event: RemoteEvent) => void): () => void {
    this.remoteListeners.add(listener);
    return () => {
      this.remoteListeners.delete(listener);
    };
  }

  /** Rows from the most recent successful pull (null until the first one). */
  getLastPull(): Note[] | null {
    return this.lastPull ? [...this.lastPull] : null;
  }

async start(): Promise<void> {
    await this.sync();

    // Background refresh: realtime channels can silently drop (sleep, NAT
    // timeout, missed WAL slot), leaving a stale list until the next user action.
    this.startPolling();

    if (!this.adapter?.subscribe || this.releaseSubscription || !this.isOnline()) {
      return;
    }

    this.releaseSubscription = await this.adapter.subscribe(
      this.userId,
      async (note) => {
        await this.repository.mergeRemote(note);
        await this.refreshPendingState();
        for (const listener of this.remoteListeners) listener({ type: "note", note });
      },
      (error) => {
        this.setState({
          ...this.state,
          phase: "error",
          error: errorMessage(error),
        });
      },
      async (noteId) => {
        // A remote hard delete (e.g. trash purge on another device): drop the
        // local row too, unless we have a pending local mutation for it.
        const pending = (await this.repository.listOutbox(this.userId)).some(
          (mutation) => mutation.noteId === noteId,
        );
        if (!pending) {
          await this.repository.hardDelete(noteId);
        }
        await this.refreshPendingState();
        for (const listener of this.remoteListeners) listener({ type: "delete", noteId });
      },
    );
  }

async stop(): Promise<void> {
    this.stopPolling();
    const release = this.releaseSubscription;
    this.releaseSubscription = null;
    await release?.();
  }

  private startPolling(): void {
    if (this.pollIntervalMs <= 0 || this.pollTimer !== null) return;
    this.pollTimer = globalThis.setInterval(() => {
      // Skip while offline, while hidden (focus/visibility handlers cover the
      // return), or while a sync is already in flight; sync() is idempotent.
      if (!this.isOnline()) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void this.sync();
    }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer === null) return;
    globalThis.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /**
   * Refresh for a view change: pull unless one just happened. Callers are user
   * actions worth a request, but rapid switching must not stampede the API.
   */
  async syncSoon(): Promise<void> {
    if (this.lastPullAt !== 0 && this.nowMs() - this.lastPullAt < this.minPullIntervalMs) {
      return;
    }
    await this.sync();
  }

  async sync(): Promise<void> {
    if (this.syncPromise) {
      return this.syncPromise;
    }

    this.syncPromise = this.runSync().finally(() => {
      this.syncPromise = null;
    });

    return this.syncPromise;
  }

  private async runSync(): Promise<void> {
    const pending = (await this.repository.listOutbox(this.userId)).length;

    if (!this.adapter) {
      this.setState({ phase: "local-only", pending, attempt: 0 });
      return;
    }

    if (!this.isOnline()) {
      this.setState({ phase: "offline", pending, attempt: 0 });
      return;
    }

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      this.setState({ phase: "syncing", pending, attempt });

      try {
        await this.performSyncCycle();
        const remaining = (await this.repository.listOutbox(this.userId)).length;
        this.setState({
          phase: "synced",
          pending: remaining,
          attempt,
          lastSyncedAt: this.now(),
        });
        return;
      } catch (error) {
        const remaining = (await this.repository.listOutbox(this.userId)).length;
        const message = errorMessage(error);

        if (attempt === this.maxAttempts) {
          this.setState({
            phase: "error",
            pending: remaining,
            attempt,
            error: message,
          });
          return;
        }

        this.setState({
          phase: "syncing",
          pending: remaining,
          attempt,
          error: message,
        });
        await this.sleep(this.retryDelayMs(attempt));
      }
    }
  }

  private async performSyncCycle(): Promise<void> {
    if (!this.adapter) {
      return;
    }

    const remoteNotes = await this.adapter.pull(this.userId);
    this.lastPull = remoteNotes;
    this.lastPullAt = this.nowMs();

    for (const note of remoteNotes) {
      // Own notes, grant-shared notes (read-only), and workspace notes (collaborative).
      if (note.userId === this.userId || note.shared || note.workspaceId) {
        await this.repository.mergeRemote(note);
      }
    }

    // Rows that vanished remotely (hard purge) and aren't pending locally.
    await this.repository.pruneRemoteMissing(
      this.userId,
      new Set(remoteNotes.map((note) => note.id)),
    );

    const mutations = await this.repository.listOutbox(this.userId);
    let firstError: unknown;

    for (const mutation of mutations) {
      try {
        if (mutation.kind === "delete") {
          await this.adapter.softDelete(mutation.payload);
        } else {
          await this.adapter.upsert(mutation.payload);
        }

        await this.repository.removeMutation(mutation.noteId, mutation.operationId);
      } catch (error) {
        firstError ??= error;
        await this.repository.markMutationFailed(
          mutation.noteId,
          mutation.operationId,
          error,
        );
      }
    }

    if (firstError !== undefined) {
      throw firstError;
    }
  }

  private async refreshPendingState(): Promise<void> {
    const pending = (await this.repository.listOutbox(this.userId)).length;
    this.setState({ ...this.state, pending });
  }

  private setState(state: SyncEngineState): void {
    this.state = state;
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}


