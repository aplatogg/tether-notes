"use client";

import { useEffect, useState, type ReactNode } from "react";
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
  const [checkedOverrides, setCheckedOverrides] = useState<Record<number, boolean>>({});
  const [htmlState, setHtmlState] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setCheckedOverrides({});
      setHtmlState(null);
    });
  }, [body]);

  if (isHtmlBody(body)) {
    const currentHtml = htmlState ?? sanitizeHtml(body);

    function handleHtmlClick(event: React.MouseEvent<HTMLDivElement>) {
      const target = event.target as HTMLElement | null;
      const item = target?.closest('li[data-type="taskItem"]');
      if (!item || !event.currentTarget.contains(item)) return;
      const allItems = Array.from(
        event.currentTarget.querySelectorAll('li[data-type="taskItem"]'),
      );
      const itemIndex = allItems.indexOf(item);
      if (itemIndex < 0) return;

      const doc = new DOMParser().parseFromString(currentHtml, "text/html");
      const targetLi = doc.querySelectorAll('li[data-type="taskItem"]')[itemIndex];
      if (!targetLi) return;
      const nextChecked = targetLi.getAttribute("data-checked") !== "true";
      targetLi.setAttribute("data-checked", nextChecked ? "true" : "false");
      setHtmlState(doc.body.innerHTML);
      onToggleChecklist?.(itemIndex);
    }

    return (
      <div
        className="note-preview rich-content"
        onClick={handleHtmlClick}
        dangerouslySetInnerHTML={{ __html: currentHtml }}
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
            const isChecked = checkedOverrides[index] ?? block.checked === true;

            return (
              <li key={index} style={{ paddingLeft: (block.depth ?? 0) * 20 }}>
                {listType === "checklist" ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isChecked}
                    aria-label={block.text || "Checklist item"}
                    className={isChecked ? "note-check is-checked" : "note-check"}
                    onClick={() => {
                      setCheckedOverrides((prev) => ({ ...prev, [index]: !isChecked }));
                      onToggleChecklist?.(index);
                    }}
                  >
                    {isChecked ? <span className="note-check-mark" aria-hidden="true" /> : null}
                  </button>
                ) : (
                  <span className="note-bullet" aria-hidden="true" />
                )}
                <span className={isChecked ? "note-checked-text" : undefined}>
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



