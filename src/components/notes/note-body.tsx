"use client";

import type { ReactNode } from "react";
import {
  parseBlocks,
  parseInline,
  type NoteBlock,
} from "@/lib/notes/format";
import { isHtmlBody, sanitizeHtml } from "@/lib/notes/rich";

export function InlineText({ text }: { text: string }): ReactNode {
  return parseInline(text).map((token, index) => {
if (token.type === "bold") return <strong key={index}>{token.text}</strong>;
    if (token.type === "italic") return <em key={index}>{token.text}</em>;
    if (token.type === "code") return <code key={index} className="inline-code">{token.text}</code>;
    if (token.type === "highlight") {
      return (
        <mark key={index} data-color="yellow">
          {token.text}
        </mark>
      );
    }
    return <span key={index}>{token.text}</span>;
  });
}

interface NoteBodyProps {
  body: string;
  onToggleChecklist?: (lineIndex: number) => void;
}

export function NoteBody({ body, onToggleChecklist }: NoteBodyProps) {
  if (isHtmlBody(body)) {
    return (
      <div
        className="note-preview rich-content"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }}
      />
    );
  }

  const blocks = parseBlocks(body);
  const nodes: ReactNode[] = [];
  let listType: "bullet" | "checklist" | "ordered" | null = null;
  let items: { block: NoteBlock; index: number }[] = [];

  const flush = () => {
    if (!listType || items.length === 0) return;

    if (listType === "ordered") {
      const counters: number[] = [];
      const numbered = items.map(({ block, index }) => {
        const depth = block.depth ?? 0;
        counters[depth] = (counters[depth] ?? 0) + 1;
        for (let deeper = depth + 1; deeper < counters.length; deeper += 1) counters[deeper] = 0;
        return { block, index, number: counters[depth] };
      });
      nodes.push(
        <ol key={`ol-${items[0].index}`} className="note-ordered">
          {numbered.map(({ block, index, number }) => (
            <li key={index} data-index={number} style={{ paddingLeft: (block.depth ?? 0) * 20 }}>
              <InlineText text={block.text || "\u00A0"} />
            </li>
          ))}
        </ol>,
      );
    } else {
      nodes.push(
        <ul
          key={`ul-${items[0].index}`}
          className={listType === "checklist" ? "note-checklist" : "note-bullets"}
        >
          {items.map(({ block, index }) => {
            const interactive = listType === "checklist" && typeof onToggleChecklist === "function";

            return (
              <li key={index} style={{ paddingLeft: (block.depth ?? 0) * 20 }}>
                {listType === "checklist" ? (
                  <button
                    type="button"
                    role={interactive ? "checkbox" : undefined}
                    aria-checked={interactive ? block.checked === true : undefined}
                    aria-label={block.text || "Checklist item"}
                    disabled={!interactive}
                    className={block.checked ? "note-check is-checked" : "note-check"}
                    onClick={() => onToggleChecklist?.(index)}
                  >
                    {block.checked ? <span className="note-check-mark" aria-hidden="true" /> : null}
                  </button>
                ) : (
                  <span className="note-bullet" aria-hidden="true" />
                )}
                <span className={block.checked ? "note-checked-text" : undefined}>
                  <InlineText text={block.text || "\u00A0"} />
                </span>
              </li>
            );
          })}
        </ul>,
      );
    }

    listType = null;
    items = [];
  };

  blocks.forEach((block, index) => {
    const isList = block.type === "bullet" || block.type === "checklist" || block.type === "ordered";

    if (!isList) {
      flush();

      if (block.type === "heading") {
        nodes.push(<h2 key={index} className="note-h1"><InlineText text={block.text || "\u00A0"} /></h2>);
      } else if (block.type === "subheading") {
        nodes.push(<h3 key={index} className="note-h2"><InlineText text={block.text || "\u00A0"} /></h3>);
      } else if (block.type === "code") {
        nodes.push(
          <pre key={index} className="note-code" data-language={block.language}>
            <code>{block.text}</code>
          </pre>,
        );
      } else if (block.text.trim().length === 0) {
        nodes.push(<div key={index} className="note-gap" />);
      } else {
        nodes.push(<p key={index}><InlineText text={block.text} /></p>);
      }
      return;
    }

    const currentType = block.type as "bullet" | "checklist" | "ordered";
    if (listType !== currentType) {
      flush();
      listType = currentType;
    }
    items.push({ block, index });
  });

  flush();
  return <div className="note-preview">{nodes}</div>;
}



