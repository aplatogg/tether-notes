import type { Note } from "./types";

/** Notes whose reminder is due at or before `now` and not yet in the past-snoozed set. */
export function dueReminders(notes: readonly Note[], now: Date, fired: ReadonlySet<string>): Note[] {
  const time = now.getTime();
  return notes.filter((note) => {
    if (!note.reminderAt || note.deletedAt !== null) return false;
    if (fired.has(note.id)) return false;
    const due = new Date(note.reminderAt).getTime();
    return !Number.isNaN(due) && due <= time;
  });
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
