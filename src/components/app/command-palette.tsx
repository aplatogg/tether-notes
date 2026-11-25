"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Briefcase,
  Download,
  FileText,
  Folder,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  Pin,
  Plus,
  Search,
  Sun,
  Trash2,
  UsersRound,
} from "lucide-react";
import { displayTitle } from "@/lib/notes/model";
import { bodyToPlainText } from "@/lib/notes/rich";
import type { Note, NoteScope } from "@/lib/notes/types";
import type { Workspace } from "@/lib/supabase/workspaces";

export type ThemeMode = "light" | "dark" | "system";

export interface CommandPaletteProps {
  open: boolean;
  notes: Note[];
  workspaces: Workspace[];
  folders: string[];
  themeMode: ThemeMode;
  focusMode: boolean;
  onClose: () => void;
  onSelectNote: (note: Note) => void;
  onCreateNote: () => void;
  onSelectScope: (scope: NoteScope) => void;
  onSelectWorkspace: (workspaceId: string | "personal" | null) => void;
  onSelectFolder: (folder: string) => void;
  onChangeTheme: (theme: ThemeMode) => void;
  onToggleFocusMode: () => void;
  onExportAll: () => void;
}

interface PaletteEntry {
  id: string;
  section: "Actions" | "Navigation" | "Notes";
  title: string;
  subtitle?: string;
  shortcut?: string;
  icon: React.ComponentType<{ "aria-hidden"?: boolean }>;
  keywords: string;
  run: () => void;
}

export function CommandPalette({
  open,
  notes,
  workspaces,
  folders,
  themeMode,
  focusMode,
  onClose,
  onSelectNote,
  onCreateNote,
  onSelectScope,
  onSelectWorkspace,
  onSelectFolder,
  onChangeTheme,
  onToggleFocusMode,
  onExportAll,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setQuery("");
      setSelectedIndex(0);
      inputRef.current?.focus();
    });
  }, [open]);

  const entries = useMemo<PaletteEntry[]>(() => {
    if (!open) return [];

    const actionEntries: PaletteEntry[] = [
      {
        id: "action:new-note",
        section: "Actions",
        title: "Create new note",
        shortcut: "⌘ N",
        icon: Plus,
        keywords: "new create add note tulis buat",
        run: () => {
          onClose();
          onCreateNote();
        },
      },
      {
        id: "action:focus-mode",
        section: "Actions",
        title: focusMode ? "Exit Focus / Zen mode" : "Toggle Focus / Zen mode",
        shortcut: "⌘ \\",
        icon: focusMode ? Minimize2 : Maximize2,
        keywords: "focus zen fullscreen expand collapse sidebar",
        run: () => {
          onClose();
          onToggleFocusMode();
        },
      },
      {
        id: "action:theme-dark",
        section: "Actions",
        title: "Theme: Dark mode",
        subtitle: themeMode === "dark" ? "Active" : undefined,
        icon: Moon,
        keywords: "dark theme night mode gelap",
        run: () => {
          onChangeTheme("dark");
          onClose();
        },
      },
      {
        id: "action:theme-light",
        section: "Actions",
        title: "Theme: Light mode",
        subtitle: themeMode === "light" ? "Active" : undefined,
        icon: Sun,
        keywords: "light theme day mode terang",
        run: () => {
          onChangeTheme("light");
          onClose();
        },
      },
      {
        id: "action:theme-system",
        section: "Actions",
        title: "Theme: Match system",
        subtitle: themeMode === "system" ? "Active" : undefined,
        icon: Monitor,
        keywords: "system auto theme",
        run: () => {
          onChangeTheme("system");
          onClose();
        },
      },
      {
        id: "action:export-json",
        section: "Actions",
        title: "Export all notes (.json)",
        icon: Download,
        keywords: "export backup download json",
        run: () => {
          onClose();
          onExportAll();
        },
      },
    ];

    const navEntries: PaletteEntry[] = [
      {
        id: "nav:all",
        section: "Navigation",
        title: "Go to All notes",
        icon: FileText,
        keywords: "all notes semua",
        run: () => {
          onClose();
          onSelectScope("all");
        },
      },
      {
        id: "nav:pinned",
        section: "Navigation",
        title: "Go to Pinned notes",
        icon: Pin,
        keywords: "pinned star",
        run: () => {
          onClose();
          onSelectScope("pinned");
        },
      },
      {
        id: "nav:archived",
        section: "Navigation",
        title: "Go to Archived notes",
        icon: Archive,
        keywords: "archived arsip",
        run: () => {
          onClose();
          onSelectScope("archived");
        },
      },
      {
        id: "nav:shared",
        section: "Navigation",
        title: "Go to Shared with me",
        icon: UsersRound,
        keywords: "shared with me",
        run: () => {
          onClose();
          onSelectScope("shared");
        },
      },
      {
        id: "nav:trash",
        section: "Navigation",
        title: "Go to Trash",
        icon: Trash2,
        keywords: "trash deleted bin",
        run: () => {
          onClose();
          onSelectScope("trash");
        },
      },
      {
        id: "nav:ws-personal",
        section: "Navigation",
        title: "Workspace: Personal",
        icon: Briefcase,
        keywords: "workspace personal",
        run: () => {
          onClose();
          onSelectWorkspace("personal");
        },
      },
      ...workspaces.map<PaletteEntry>((ws) => ({
        id: `nav:ws-${ws.id}`,
        section: "Navigation",
        title: `Workspace: ${ws.name}`,
        icon: Briefcase,
        keywords: `workspace ${ws.name.toLowerCase()}`,
        run: () => {
          onClose();
          onSelectWorkspace(ws.id);
        },
      })),
      ...folders.slice(0, 12).map<PaletteEntry>((folder) => ({
        id: `nav:folder-${folder}`,
        section: "Navigation",
        title: `Group: ${folder}`,
        icon: Folder,
        keywords: `group folder ${folder.toLowerCase()}`,
        run: () => {
          onClose();
          onSelectFolder(folder);
        },
      })),
    ];

    const activeNotes = notes.filter((note) => note.deletedAt === null);
    const noteEntries: PaletteEntry[] = activeNotes.slice(0, 60).map((note) => {
      const title = displayTitle(note);
      const preview = note.lockHash
        ? "Locked note"
        : bodyToPlainText(note.body).slice(0, 90);
      return {
        id: `note:${note.id}`,
        section: "Notes",
        title,
        subtitle: [note.folder?.trim(), preview].filter(Boolean).join(" · "),
        icon: FileText,
        keywords: `${title.toLowerCase()} ${note.tags.join(" ")} ${note.folder ?? ""} ${
          note.lockHash ? "" : preview.toLowerCase()
        }`,
        run: () => {
          onClose();
          onSelectNote(note);
        },
      };
    });

    const needle = query.trim().toLowerCase();
    if (!needle) {
      return [...actionEntries, ...noteEntries.slice(0, 10), ...navEntries.slice(0, 8)];
    }

    const terms = needle.split(/\s+/).filter(Boolean);
    const all = [...noteEntries, ...actionEntries, ...navEntries];
    return all.filter((entry) => {
      const hay = `${entry.title.toLowerCase()} ${entry.subtitle?.toLowerCase() ?? ""} ${entry.keywords}`;
      return terms.every((term) => hay.includes(term));
    });
  }, [
    open,
    notes,
    workspaces,
    folders,
    themeMode,
    focusMode,
    query,
    onClose,
    onCreateNote,
    onToggleFocusMode,
    onChangeTheme,
    onExportAll,
    onSelectScope,
    onSelectWorkspace,
    onSelectFolder,
    onSelectNote,
  ]);

  if (!open) return null;

  const clampedIndex = entries.length > 0 ? Math.min(selectedIndex, entries.length - 1) : 0;

  return (
    <div className="pin-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-palette-head">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Type a command or search notes…"
            aria-label="Command palette search"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && entries.length > 0) {
                event.preventDefault();
                setSelectedIndex((current) => (current + 1) % entries.length);
              } else if (event.key === "ArrowUp" && entries.length > 0) {
                event.preventDefault();
                setSelectedIndex((current) => (current - 1 + entries.length) % entries.length);
              } else if (event.key === "Enter" && entries.length > 0) {
                event.preventDefault();
                entries[clampedIndex]?.run();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-palette-list" role="listbox" aria-label="Commands and notes">
          {entries.length === 0 ? (
            <p className="command-palette-empty">No matching notes or commands.</p>
          ) : (
            entries.map((entry, idx) => {
              const Icon = entry.icon;
              const prevSection = idx > 0 ? entries[idx - 1]?.section : null;
              return (
                <div key={entry.id}>
                  {entry.section !== prevSection ? (
                    <div className="command-palette-section">{entry.section}</div>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={idx === clampedIndex}
                    className={
                      idx === clampedIndex
                        ? "command-palette-item is-active"
                        : "command-palette-item"
                    }
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={entry.run}
                  >
                    <Icon aria-hidden={true} />
                    <span className="command-palette-text">
                      <span className="command-palette-title">{entry.title}</span>
                      {entry.subtitle ? (
                        <span className="command-palette-sub">{entry.subtitle}</span>
                      ) : null}
                    </span>
                    {entry.shortcut ? <kbd>{entry.shortcut}</kbd> : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
