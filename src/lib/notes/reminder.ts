import type { Note } from "./types";

/** Reminder identity: a note may legitimately ring again after its time is changed. */
export function reminderKey(note: Pick<Note, "id" | "reminderAt">): string | null {
  if (!note.reminderAt) return null;
  return `${note.id}:${note.reminderAt}`;
}

/** Notes whose reminder is due at or before `now` and not yet in the fired set. */
export function dueReminders(notes: readonly Note[], now: Date, fired: ReadonlySet<string>): Note[] {
  const time = now.getTime();
  return notes.filter((note) => {
    const key = reminderKey(note);
    if (!key || note.deletedAt !== null) return false;
    if (fired.has(key)) return false;
    const due = new Date(note.reminderAt as string).getTime();
    return !Number.isNaN(due) && due <= time;
  });
}

export interface FiredReconciliation {
  fired: Set<string>;
  changed: boolean;
}

/**
 * Rebuilds the fired set from the notes that still exist, which prunes deleted
 * notes and reminders whose time was changed. Legacy entries stored only the
 * note id (pre-0.4): a past-due reminder of such a note was already delivered,
 * so it is marked under the new key instead of ringing a second time. Future
 * reminders are left unmarked so they still fire when due.
 */
export function reconcileFiredReminders(
  notes: readonly Note[],
  fired: ReadonlySet<string>,
  now: Date,
): FiredReconciliation {
  const next = new Set<string>();
  const time = now.getTime();

  for (const note of notes) {
    if (!note.reminderAt) continue;
    const key = `${note.id}:${note.reminderAt}`;
    if (fired.has(key)) {
      next.add(key);
      continue;
    }
    if (fired.has(note.id)) {
      const at = new Date(note.reminderAt).getTime();
      if (!Number.isNaN(at) && at <= time) next.add(key);
    }
  }

  const changed = next.size !== fired.size || [...next].some((key) => !fired.has(key));
  return { fired: next, changed };
}

const NOTIFIED_KEY = "tether-reminders-fired";

export function loadFiredReminders(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(NOTIFIED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveFiredReminders(fired: ReadonlySet<string>): void {
  try {
    globalThis.localStorage?.setItem(NOTIFIED_KEY, JSON.stringify([...fired]));
  } catch {
    // Storage full/blocked: reminders simply re-fire next check.
  }
}

export async function notifyDue(note: Note): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const title = note.title.trim() || "Reminder";
  new Notification(`⏰ ${title}`, {
    body: "Reminder from Tether Notes",
    tag: `reminder-${note.id}`,
  });
}

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission === "granted") return "granted";
  return Notification.requestPermission();
}
