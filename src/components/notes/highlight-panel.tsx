"use client";

import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Highlighter, Search, X } from "lucide-react";
import {
  collectDocHighlights,
  extractHighlights,
  HIGHLIGHT_COLORS,
  normalizeHighlightColor,
  type DocHighlight,
  type HighlightColor,
} from "@/lib/notes/highlight";
import { isHtmlBody, markdownToHtml } from "@/lib/notes/rich";
import type { Note } from "@/lib/notes/types";

const COLOR_LABELS: Record<HighlightColor, string> = {
  yellow: "Yellow",
  green: "Green",
  pink: "Pink",
  blue: "Blue",
  orange: "Orange",
};

function ColorChips({
  value,
  onChange,
}: {
  value: HighlightColor | null;
  onChange: (color: HighlightColor | null) => void;
}) {
  return (
    <div className="highlight-filter" role="group" aria-label="Filter by highlight color">
      <button
        type="button"
        className={value === null ? "highlight-chip is-active" : "highlight-chip"}
        onClick={() => onChange(null)}
      >
        All
      </button>
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={value === color ? "highlight-chip is-active" : "highlight-chip"}
          onClick={() => onChange(value === color ? null : color)}
          aria-pressed={value === color}
          title={COLOR_LABELS[color]}
        >
          <span className="highlight-dot" data-color={color} aria-hidden="true" />
          <span className="sr-only">{COLOR_LABELS[color]}</span>
        </button>
      ))}
    </div>
  );
}

export function NoteHighlightsPanel({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [, bump] = useState(0);
  const [color, setColor] = useState<HighlightColor | null>(null);

  useEffect(() => {
    const refresh = () => bump((value) => value + 1);
    editor.on("transaction", refresh);
    return () => {
      editor.off("transaction", refresh);
    };
  }, [editor]);

  const highlights: DocHighlight[] = useMemo(
    () => collectDocHighlights(editor.state.doc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, editor.state.doc, color],
  );

  const visible = color ? highlights.filter((item) => item.color === color) : highlights;

  function jump(item: DocHighlight) {
    editor.chain().focus().setTextSelection({ from: item.from, to: item.to }).scrollIntoView().run();
  }

  return (
    <aside className="highlight-panel" aria-label="Note highlights">
      <header>
        <span>
          <Highlighter aria-hidden="true" /> Highlights ({visible.length})
        </span>
        <button type="button" onClick={onClose} aria-label="Close highlights">
          <X aria-hidden="true" />
        </button>
      </header>
      <ColorChips value={color} onChange={setColor} />
      {visible.length === 0 ? (
        <p className="highlight-empty">
          No highlights in this note yet. Select text and press Ctrl/Cmd+Shift+H.
        </p>
      ) : (
        <ul className="highlight-list">
          {visible.map((item, index) => (
            <li key={`${item.from}-${index}`}>
              <button type="button" onClick={() => jump(item)}>
                <span className="highlight-dot" data-color={item.color} aria-hidden="true" />
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

interface NoteGroup {
  note: Note;
  items: { index: number; text: string; color: HighlightColor }[];
}

export function AllHighlightsDialog({
  notes,
  onClose,
  onPick,
}: {
  notes: Note[];
  onClose: () => void;
  onPick: (noteId: string, index: number) => void;
}) {
  const [color, setColor] = useState<HighlightColor | null>(null);
  const [query, setQuery] = useState("");

  const groups: NoteGroup[] = useMemo(() => {
    const result: NoteGroup[] = [];
    const needle = query.trim().toLowerCase();

    for (const note of notes) {
      // Trashed and PIN-locked notes stay out of the global index.
      if (note.deletedAt !== null || note.lockHash) continue;
      const html = isHtmlBody(note.body) ? note.body : markdownToHtml(note.body);
      const items = extractHighlights(html).filter((item) => {
        if (color && item.color !== color) return false;
        if (needle && !item.text.toLowerCase().includes(needle)) return false;
        return true;
      });
      if (items.length === 0) continue;
      result.push({ note, items });
    }

    return result;
  }, [notes, color, query]);

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div className="pin-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="pin-dialog highlight-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="All highlights"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="highlight-dialog-head">
          <h2>All highlights ({total})</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="highlight-dialog-tools">
          <label className="highlight-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search highlighted text"
              aria-label="Search highlighted text"
            />
          </label>
          <ColorChips value={color} onChange={setColor} />
        </div>
        <div className="highlight-dialog-body">
          {groups.length === 0 ? (
            <p className="highlight-empty">No matching highlights.</p>
          ) : (
            groups.map((group) => (
              <section key={group.note.id} className="highlight-group">
                <h3>{group.note.title.trim() || "Untitled note"}</h3>
                <ul className="highlight-list">
                  {group.items.map((item) => (
                    <li key={`${group.note.id}-${item.index}`}>
                      <button type="button" onClick={() => onPick(group.note.id, item.index)}>
                        <span
                          className="highlight-dot"
                          data-color={normalizeHighlightColor(item.color)}
                          aria-hidden="true"
                        />
                        {item.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
