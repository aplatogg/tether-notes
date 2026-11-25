"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  EditorContent,
  Extension,
  InputRule,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type Editor,
  type NodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlock from "@tiptap/extension-code-block";
import BoldMark from "@tiptap/extension-bold";
import ItalicMark from "@tiptap/extension-italic";
import StrikeMark from "@tiptap/extension-strike";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  SafeHighlight,
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
  Check,
  Code,
  Copy,
  ChevronDown,
  Highlighter,
  ImagePlus,
  Minus,
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

const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = /^image\/(?:png|jpe?g|gif|webp)$/i;

function insertImageFileIntoEditor(editor: Editor, file: File | undefined): boolean {
  if (!file || !ALLOWED_IMAGE_MIME.test(file.type)) return false;
  if (file.size > MAX_INLINE_IMAGE_BYTES) {
    window.alert("Inline image must be under 2 MB. Use the Attachments panel for larger files.");
    return true;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") {
      editor.chain().focus().setImage({ src: reader.result, alt: file.name }).run();
    }
  };
  reader.readAsDataURL(file);
  return true;
}

function insertImageFileIntoView(view: EditorView, file: File | undefined): boolean {
  if (!file || !ALLOWED_IMAGE_MIME.test(file.type)) return false;
  if (file.size > MAX_INLINE_IMAGE_BYTES) {
    window.alert("Inline image must be under 2 MB. Use the Attachments panel for larger files.");
    return true;
  }
  const imageType = view.state.schema.nodes.image;
  if (!imageType) return false;
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") {
      const node = imageType.create({ src: reader.result, alt: file.name });
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    }
  };
  reader.readAsDataURL(file);
  return true;
}

function CopyableCodeBlockView({ node }: NodeViewProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const text = node.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard blocked in non-secure context
    }
  }

  return (
    <NodeViewWrapper className="code-block-wrap">
      <button
        type="button"
        contentEditable={false}
        className={copied ? "code-copy-button is-copied" : "code-copy-button"}
        onClick={() => void handleCopy()}
        aria-label="Copy code block"
        title="Copy code"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      <pre>
        <NodeViewContent as={"code" as never} />
      </pre>
    </NodeViewWrapper>
  );
}

const CopyableCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CopyableCodeBlockView);
  },
});

export interface SlashCommandItem {
  id: string;
  label: string;
  shortcut: string;
  keywords: string[];
  run: (editor: Editor) => void;
}

export const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    id: "h1",
    label: "Heading 1",
    shortcut: "/h1",
    keywords: ["h1", "heading1", "title", "header"],
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    label: "Heading 2",
    shortcut: "/h2",
    keywords: ["h2", "heading2", "subtitle", "subheading"],
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    label: "Heading 3",
    shortcut: "/h3",
    keywords: ["h3", "heading3"],
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: "todo",
    label: "Checklist",
    shortcut: "/todo",
    keywords: ["todo", "task", "check", "checklist", "checkbox"],
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: "bullet",
    label: "Bulleted list",
    shortcut: "/bullet",
    keywords: ["bullet", "list", "ul"],
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "numbered",
    label: "Numbered list",
    shortcut: "/num",
    keywords: ["num", "numbered", "ordered", "ol"],
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "code",
    label: "Code block",
    shortcut: "/code",
    keywords: ["code", "pre", "snippet", "terminal"],
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "quote",
    label: "Quote",
    shortcut: "/quote",
    keywords: ["quote", "blockquote", "callout"],
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "table",
    label: "Table (3×3)",
    shortcut: "/table",
    keywords: ["table", "grid"],
    run: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "divider",
    label: "Divider line",
    shortcut: "/divider",
    keywords: ["divider", "hr", "line", "rule"],
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

interface SlashMatch {
  query: string;
  from: number;
  to: number;
}

function detectSlashMatch(editor: Editor): SlashMatch | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  if (editor.isActive("codeBlock")) return null;

  const { $from } = selection;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "\0");
  const match = /(?:^|\s)\/([a-z0-9-]{0,16})$/i.exec(textBefore);
  if (!match) return null;

  const query = (match[1] ?? "").toLowerCase();
  const slashLength = query.length + 1;
  return {
    query,
    from: $from.pos - slashLength,
    to: $from.pos,
  };
}

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

  const imageInputRef = useRef<HTMLInputElement>(null);

  function promptLink() {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    const trimmed = url.trim();
    if (trimmed === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    if (/^[/\\]{2}/.test(trimmed)) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
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
      <ToolButton label="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus aria-hidden="true" />
      </ToolButton>

      <span className="format-divider" aria-hidden="true" />

      <ToolButton label="Link" active={editor.isActive("link")} onClick={promptLink}>
        <Link2 aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Image" onClick={() => imageInputRef.current?.click()}>
        <ImagePlus aria-hidden="true" />
      </ToolButton>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="sr-only"
        aria-label="Insert image"
        onChange={(event) => {
          insertImageFileIntoEditor(editor, event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
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
}: RichEditorProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [slashMatch, setSlashMatch] = useState<SlashMatch | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
        codeBlock: false,
        // Replaced below: built-in markdown mark rules fired too eagerly.
        bold: false,
        italic: false,
        strike: false,
      }),
      CopyableCodeBlock,
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
      handlePaste: (view, event): boolean => {
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItem = items.find((item) => ALLOWED_IMAGE_MIME.test(item.type));
        if (!imageItem) return false;
        const file = imageItem.getAsFile();
        if (!file) return false;
        event.preventDefault();
        return insertImageFileIntoView(view, file);
      },
      handleDrop: (view, event, _slice, moved): boolean => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        const imageFile = files.find((file) => ALLOWED_IMAGE_MIME.test(file.type));
        if (!imageFile) return false;
        event.preventDefault();
        return insertImageFileIntoView(view, imageFile);
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange(instance.getHTML());
      const match = detectSlashMatch(instance);
      setSlashMatch(match);
      setSlashIndex(0);
    },
    onSelectionUpdate: ({ editor: instance }) => {
      const match = detectSlashMatch(instance);
      setSlashMatch(match);
    },
    onBlur: () => {
      setSlashMatch(null);
    },
  });

  const filteredSlashCommands = useMemo(() => {
    if (!slashMatch) return [];
    const q = slashMatch.query;
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.id.startsWith(q) ||
        cmd.label.toLowerCase().includes(q) ||
        cmd.keywords.some((kw) => kw.startsWith(q)),
    );
  }, [slashMatch]);

  function executeSlashCommand(cmd: SlashCommandItem) {
    if (!editor || !slashMatch) return;
    editor.chain().focus().deleteRange({ from: slashMatch.from, to: slashMatch.to }).run();
    cmd.run(editor);
    setSlashMatch(null);
  }

  useEffect(() => {
    if (!editor) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSaveShortcut?.();
        return;
      }

      if (slashMatch && filteredSlashCommands.length > 0 && editor.isFocused) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          setSlashIndex((current) => (current + 1) % filteredSlashCommands.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          setSlashIndex((current) =>
            (current - 1 + filteredSlashCommands.length) % filteredSlashCommands.length,
          );
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          const picked = filteredSlashCommands[slashIndex] ?? filteredSlashCommands[0];
          if (picked) executeSlashCommand(picked);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setSlashMatch(null);
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, onSaveShortcut, slashMatch, filteredSlashCommands, slashIndex]);

  // Remote updates (Realtime from another device) refresh the document only while
  // this editor is unfocused, so typing never loses the caret.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const incoming = markdownToHtml(value);
    if (incoming !== editor.getHTML()) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
  }, [editor, value]);

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
          {slashMatch && filteredSlashCommands.length > 0 && !readOnly ? (
            <div className="slash-menu" role="listbox" aria-label="Insert block">
              {filteredSlashCommands.map((cmd, idx) => (
                <button
                  key={cmd.id}
                  type="button"
                  role="option"
                  aria-selected={idx === slashIndex}
                  className={idx === slashIndex ? "slash-menu-item is-active" : "slash-menu-item"}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    executeSlashCommand(cmd);
                  }}
                >
                  <span>{cmd.label}</span>
                  <kbd>{cmd.shortcut}</kbd>
                </button>
              ))}
            </div>
          ) : null}
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
