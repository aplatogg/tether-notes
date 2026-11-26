import { exportNotesJson } from "@/lib/notes/export";
import type { Note } from "@/lib/notes/types";

const MIRROR_DB_NAME = "tether-local-mirror-v1";
const MIRROR_STORE_NAME = "handles";
const MIRROR_KEY = "backup-dir";

interface FileSystemWritableFileStreamLike {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

interface FileSystemFileHandleLike {
  createWritable: () => Promise<FileSystemWritableFileStreamLike>;
}

export interface DirectoryHandleLike {
  name: string;
  getFileHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<FileSystemFileHandleLike>;
  queryPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
}

type WindowWithMirrorApis = Window & {
  __TAURI_INTERNALS__?: {
    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: "desktop" | "documents" | "downloads";
  }) => Promise<DirectoryHandleLike>;
};

export function isTauriDesktop(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as WindowWithMirrorApis;
  return typeof w.__TAURI_INTERNALS__?.invoke === "function";
}

export function supportsDirectoryPicker(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as WindowWithMirrorApis;
  return typeof w.showDirectoryPicker === "function";
}

function openHandleDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(MIRROR_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(MIRROR_STORE_NAME)) {
          db.createObjectStore(MIRROR_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getSavedBackupDirectoryHandle(): Promise<DirectoryHandleLike | null> {
  const db = await openHandleDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(MIRROR_STORE_NAME, "readonly");
      const req = tx.objectStore(MIRROR_STORE_NAME).get(MIRROR_KEY);
      req.onsuccess = () => resolve((req.result as DirectoryHandleLike | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveBackupDirectoryHandle(handle: DirectoryHandleLike | null): Promise<void> {
  const db = await openHandleDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(MIRROR_STORE_NAME, "readwrite");
      const store = tx.objectStore(MIRROR_STORE_NAME);
      if (handle) {
        store.put(handle, MIRROR_KEY);
      } else {
        store.delete(MIRROR_KEY);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function pickBackupDirectory(notes?: Note[]): Promise<string | null> {
  if (!supportsDirectoryPicker()) return null;
  const w = window as WindowWithMirrorApis;
  const handle = await w.showDirectoryPicker?.({
    id: "tether-notes-backup",
    mode: "readwrite",
    startIn: "documents",
  });
  if (!handle) return null;
  await saveBackupDirectoryHandle(handle);
  if (notes && notes.length > 0) {
    await mirrorNotesToLocalDisk(notes);
  }
  return handle.name;
}

export async function clearBackupDirectory(): Promise<void> {
  await saveBackupDirectoryHandle(null);
}

async function writeToDirectoryHandle(
  dir: DirectoryHandleLike,
  fileName: string,
  content: string,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function mirrorNotesToLocalDisk(notes: Note[]): Promise<void> {
  if (typeof window === "undefined" || notes.length === 0) return;

  const ownNotes = notes.filter((n) => !n.shared);
  if (ownNotes.length === 0) return;

  const payload = exportNotesJson(ownNotes);
  const dateStamp = new Date().toISOString().slice(0, 10);

  // 1) Windows Desktop App (Tauri): automatic silent mirror to C:\Users\<User>\AppData\Local\com.tethernotes.app\backups\
  const w = window as WindowWithMirrorApis;
  if (typeof w.__TAURI_INTERNALS__?.invoke === "function") {
    try {
      await w.__TAURI_INTERNALS__.invoke("save_local_backup", {
        payload,
        dateStamp,
      });
    } catch {
      // Ignore background desktop write failure
    }
  }

  // 2) Chromium Browser (Chrome / Edge on Windows): mirror to user-selected local directory handle
  try {
    const dir = await getSavedBackupDirectoryHandle();
    if (!dir) return;
    if (typeof dir.queryPermission === "function") {
      const perm = await dir.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") return;
    }
    await writeToDirectoryHandle(dir, "tether-notes-live.json", payload);
    await writeToDirectoryHandle(dir, `tether-notes-${dateStamp}.json`, payload);
  } catch {
    // Ignore background browser File System write failure
  }
}
