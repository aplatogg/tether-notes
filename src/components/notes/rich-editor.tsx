"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, Extension, InputRule, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import BoldMark from "@tiptap/extension-bold";
import ItalicMark from "@tiptap/extension-italic";
import StrikeMark from "@tiptap/extension-strike";
import { TextSelection } from "@tiptap/pm/state";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  SafeHighlight,
  collectDocHighlights,
  getLastHighlightColor,
  setLastHighlightColor,
  HIGHLIGHT_COLORS,
  normalizeHighlightColor,
  type HighlightColor,
} from "@/lib/notes/highlight";
import { NoteHighlightsPanel } from "@/components/notes/highlight-panel";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import Image from "@tiptap/extension-image";
import {
  Bold,
  Code,
  ChevronDown,
  Highlighter,
  ImagePlus,
  PanelRight,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { countWords, markdownToHtml } from "@/lib/notes/rich";

/**
 * Word-like autoformat. Markdown markers convert only when the closing marker is
 * followed by a space (typing `**bold**x` stays literal), and only asterisks are
 * supported — underscore variants are never converted because they destroy
 * snake_case and __dunder__ code text.
 */
const WordLikeMarks = Extension.create({
  name: "wordLikeMarks",
  priority: 1000,
  addInputRules() {
    const build = (markName: "bold" | "italic", find: RegExp) =>
      new InputRule({
        find,
        handler: ({ state, range, match }) => {
          const inner = match[1];
          const mark = state.schema.marks[markName]?.create();
          if (!inner || !mark) return null;

          // Mutate the rule's transaction: replace the whole `**text** ` run with
          // the marked text plus the space that triggered the rule.
          state.tr.replaceWith(range.from, range.to, [
            state.schema.text(inner, [mark]),
            state.schema.text(" "),
          ]);
          state.tr.setSelection(
            TextSelection.create(state.tr.doc, range.from + inner.length + 1),
          );
        },
      });

    return [
      build("bold", /(?<!\S)\*\*([^*\n]+)\*\*\s$/),
      build("italic", /(?<!\S)\*(?!\*)([^*\n]+)\*\s$/),
    ];
  },
});

/** Tab nests list items, moves through tables, or inserts spaces in prose. */
const TabKeymap = Extension.create({
  name: "tabKeymap",
  // Run before the task/list Enter handlers so our behaviour wins.
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { editor } = this;
        if (editor.isActive("table")) return editor.commands.goToNextCell();
        if (editor.can().sinkListItem("taskItem")) return editor.commands.sinkListItem("taskItem");
        if (editor.can().sinkListItem("listItem")) return editor.commands.sinkListItem("listItem");
        // In prose Tab stays inert instead of inserting loose spaces.
        return true;
      },
      Enter: () => {
        const { editor } = this;
        if (!editor.isActive("taskItem")) return false;

        const { state } = editor;
        const { $from } = state.selection;
        const item = $from.node($from.depth - 1);
        if (!item || item.type.name !== "taskItem") return false;

        // An empty checklist item used to end the list; append a sibling task
        // item instead so the checkbox stays on screen.
        if (item.textContent.trim().length === 0) {
          const after = $from.after($from.depth - 1);
          return editor
            .chain()
            .focus()
            .insertContentAt(after, {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph" }],
            })
            .run();
        }

        return false;
      },
      Backspace: () => {
        const { editor } = this;
        const { selection } = editor.state;
        if (!selection.empty) return false;

        const { $from } = selection;
        if ($from.parentOffset !== 0) return false;

        if (editor.isActive("taskItem") && $from.depth > 2) {
          return editor.commands.liftListItem("taskItem");
        }
        if (editor.isActive("listItem") && $from.depth > 2) {
          return editor.commands.liftListItem("listItem");
        }

        return false;
      },
      "Shift-Tab": () => {
        const { editor } = this;
        if (editor.isActive("table")) return editor.commands.goToPreviousCell();
        if (editor.can().liftListItem("taskItem")) return editor.commands.liftListItem("taskItem");
        if (editor.can().liftListItem("listItem")) return editor.commands.liftListItem("listItem");
        return true;
      },
    };
  },
});
interface RichEditorProps {
  value: string;
  readOnly?: boolean;
  onChange: (html: string) => void;
  onSaveShortcut?: () => void;
  /** Zero-based highlight to select once the editor is ready (global view jump). */
  highlightTargetIndex?: number | null;
  onHighlightTargetHandled?: () => void;
}

interface ToolButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolButton({ label, active, disabled, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={active ? "format-button is-active" : "format-button"}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function HighlightControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState<HighlightColor>(() => getLastHighlightColor());
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const active = editor.isActive("highlight");
  const activeColor = normalizeHighlightColor(editor.getAttributes("highlight").color);
  const shownColor = active ? activeColor : color;

  function apply(next: HighlightColor) {
    setColor(next);
    setLastHighlightColor(next);
    editor.chain().focus().setHighlight({ color: next }).run();
    setOpen(false);
  }

  return (
    <div className="highlight-control" ref={wrapRef}>
      <button
        type="button"
        className={active ? "format-button is-active has-caret" : "format-button has-caret"}
        onClick={() => apply(color)}
        aria-label="Highlight"
        title="Highlight (Ctrl/Cmd+Shift+H)"
        aria-pressed={active}
      >
        <Highlighter aria-hidden="true" />
        <span className="highlight-current" data-color={shownColor} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="format-caret"
        onClick={() => setOpen((value) => !value)}
        aria-label="Highlight colors"
        aria-expanded={open}
        title="Highlight colors"
      >
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className="highlight-menu" role="menu">
          {HIGHLIGHT_COLORS.map((name) => (
            <button
              key={name}
              type="button"
              role="menuitem"
              className={
                name === shownColor ? "highlight-menu-item is-active" : "highlight-menu-item"
              }
              onClick={() => apply(name)}
            >
              <span className="highlight-dot" data-color={name} aria-hidden="true" />
              {name}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="highlight-menu-item"
            onClick={() => {
              editor.chain().focus().unsetHighlight().run();
              setOpen(false);
            }}
          >
            Remove highlight
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Toolbar({
  editor,
  panelOpen,
  onTogglePanel,
}: {
  editor: Editor;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  const [, force] = useState(0);

  useEffect(() => {
    const rerender = () => force((value) => value + 1);
    editor.on("transaction", rerender);
    editor.on("selectionUpdate", rerender);
    return () => {
      editor.off("transaction", rerender);
      editor.off("selectionUpdate", rerender);
    };
  }, [editor]);

  function promptLink() {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  function promptImage() {
    const url = window.prompt("Image URL", "https://");
    if (!url?.trim()) return;
    editor.chain().focus().setImage({ src: url.trim() }).run();
  }

  return (
    <div className="editor-format-bar rich-toolbar" role="toolbar" aria-label="Text formatting">
      <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough aria-hidden="true" />
      </ToolButton>
      <HighlightControl editor={editor} />

      <span className="format-divider" aria-hidden="true" />

      <button
        type="button"
        className={editor.isActive("heading", { level: 1 }) ? "format-button is-active" : "format-button"}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        aria-label="Heading 1"
        title="Heading 1"
      >
        H1
      </button>
      <button
        type="button"
        className={editor.isActive("heading", { level: 2 }) ? "format-button is-active" : "format-button"}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        aria-label="Heading 2"
        title="Heading 2"
      >
        H2
      </button>
      <button
        type="button"
        className={editor.isActive("heading", { level: 3 }) ? "format-button is-active" : "format-button"}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        aria-label="Heading 3"
        title="Heading 3"
      >
        H3
      </button>

      <span className="format-divider" aria-hidden="true" />

      <ToolButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Checklist" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListChecks aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Code block" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        <Code aria-hidden="true" />
      </ToolButton>

      <span className="format-divider" aria-hidden="true" />

      <ToolButton label="Link" active={editor.isActive("link")} onClick={promptLink}>
        <Link2 aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Image" onClick={promptImage}>
        <ImagePlus aria-hidden="true" />
      </ToolButton>
      <ToolButton
        label="Table"
        active={editor.isActive("table")}
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <Table2 aria-hidden="true" />
      </ToolButton>

      <span className="format-divider" aria-hidden="true" />

      <ToolButton label="Highlights" active={panelOpen} onClick={onTogglePanel}>
        <PanelRight aria-hidden="true" />
      </ToolButton>

      <span className="format-divider" aria-hidden="true" />

      <ToolButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 aria-hidden="true" />
      </ToolButton>
    </div>
  );
}

export function RichEditor({
  value,
  readOnly = false,
  onChange,
  onSaveShortcut,
  highlightTargetIndex = null,
  onHighlightTargetHandled,
}: RichEditorProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
        // Replaced below: built-in markdown mark rules fired too eagerly.
        bold: false,
        italic: false,
        strike: false,
      }),
      BoldMark.extend({ addInputRules: () => [] }),
      ItalicMark.extend({ addInputRules: () => [] }),
      StrikeMark.extend({ addInputRules: () => [] }),
      WordLikeMarks,
      TabKeymap,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      SafeHighlight.configure({ multicolor: true }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: "Start writing. Use the toolbar or type / for structure." }),
    ],
    content: markdownToHtml(value),
    editable: !readOnly,
    editorProps: {
      attributes: { class: "rich-content", spellcheck: "true" },
    },
    onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
  });

  useEffect(() => {
    if (!editor) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSaveShortcut?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editor, onSaveShortcut]);

  // Remote updates (Realtime from another device) refresh the document only while
  // this editor is unfocused, so typing never loses the caret.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const incoming = markdownToHtml(value);
    if (incoming !== editor.getHTML()) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
  }, [editor, value]);
  useEffect(() => {
    if (!editor || highlightTargetIndex === null) return;
    const item = collectDocHighlights(editor.state.doc)[highlightTargetIndex];
    if (item) {
      editor.chain().focus().setTextSelection({ from: item.from, to: item.to }).scrollIntoView().run();
    }
    onHighlightTargetHandled?.();
  }, [editor, highlightTargetIndex, onHighlightTargetHandled]);

  if (!editor) {
    return <div className="rich-editor-skeleton" aria-hidden="true" />;
  }

  return (
    <div className="rich-editor">
      {readOnly ? null : (
        <Toolbar editor={editor} panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((value) => !value)} />
      )}
      <div className="rich-editor-body">
        <div className="rich-editor-scroll">
          <EditorContent editor={editor} />
        </div>
        {panelOpen && !readOnly ? (
          <NoteHighlightsPanel editor={editor} onClose={() => setPanelOpen(false)} />
        ) : null}
      </div>
      <div className="rich-footer">
        <span>{countWords(editor.getHTML())} words</span>

      </div>
    </div>
  );
}









