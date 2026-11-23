export type InlineType = "text" | "bold" | "italic" | "code";

export interface InlineToken {
  type: InlineType;
  text: string;
}

const INLINE_PATTERN = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;

/** Tokenizes the small inline subset we render: **bold**, *italic*, `code`. */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];

  for (const chunk of text.split(INLINE_PATTERN)) {
    if (!chunk) continue;

    if (/^\*\*[^*]+\*\*$/.test(chunk) || /^__[^_]+__$/.test(chunk)) {
      tokens.push({ type: "bold", text: chunk.slice(2, -2) });
    } else if (/^\*[^*\n]+\*$/.test(chunk) || /^_[^_\n]+_$/.test(chunk)) {
      tokens.push({ type: "italic", text: chunk.slice(1, -1) });
    } else if (/^`[^`\n]+`$/.test(chunk)) {
      tokens.push({ type: "code", text: chunk.slice(1, -1) });
    } else {
      tokens.push({ type: "text", text: chunk });
    }
  }

  return tokens.length > 0 ? tokens : [{ type: "text", text: "" }];
}

export type BlockType =
  | "heading"
  | "subheading"
  | "paragraph"
  | "bullet"
  | "ordered"
  | "checklist"
  | "code";

export interface NoteBlock {
  type: BlockType;
  text: string;
  checked?: boolean;
  /** 1-based position inside an ordered list. */
  number?: number;
  /** Fenced code language hint. */
  language?: string;
}

const HEADING = /^#\s+(.*)$/;
const SUBHEADING = /^##\s+(.*)$/;
const CHECKLIST = /^[-*]\s+\[( |x|X)\]\s?(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const ORDERED = /^(\d{1,3})[.)]\s+(.*)$/;
const FENCE = /^```([A-Za-z0-9+#._-]*)\s*$/;

export function parseLine(line: string): NoteBlock {
  const heading = HEADING.exec(line);
  if (heading) return { type: "heading", text: heading[1] };

  const subheading = SUBHEADING.exec(line);
  if (subheading) return { type: "subheading", text: subheading[1] };

  const checklist = CHECKLIST.exec(line);
  if (checklist) {
    return {
      type: "checklist",
      text: checklist[2],
      checked: checklist[1].toLowerCase() === "x",
    };
  }

  const bullet = BULLET.exec(line);
  if (bullet) return { type: "bullet", text: bullet[1] };

  const ordered = ORDERED.exec(line);
  if (ordered) return { type: "ordered", text: ordered[2], number: Number(ordered[1]) };

  return { type: "paragraph", text: line };
}

export function parseBlocks(body: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  const lines = body.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const fence = FENCE.exec(lines[index]);

    if (fence) {
      const code: string[] = [];
      let cursor = index + 1;

      while (cursor < lines.length && !FENCE.test(lines[cursor])) {
        code.push(lines[cursor]);
        cursor += 1;
      }

      blocks.push({
        type: "code",
        text: code.join("\n"),
        language: fence[1] || undefined,
      });
      index = cursor;
      continue;
    }

    blocks.push(parseLine(lines[index]));
  }

  return blocks;
}

export function stripBlockPrefix(line: string): string {
  const parsed = parseLine(line);
  if (parsed.type === "code") return line;
  return parsed.text.trim();
}

/** First non-empty snippet with formatting markers removed, for list previews. */
export function plainPreview(body: string, maxLength = 160): string {
  const line = body
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0 && !FENCE.test(value));

  if (!line) return "";

  const text = parseInline(stripBlockPrefix(line))
    .map((token) => token.text)
    .join("");

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function prefixFor(type: BlockType | "paragraph", line: string, position: number): string {
  switch (type) {
    case "heading":
      return "# ";
    case "subheading":
      return "## ";
    case "bullet":
      return "- ";
    case "checklist": {
      const existing = CHECKLIST.exec(line);
      return existing ? `- [${existing[1].toLowerCase() === "x" ? "x" : " "}] ` : "- [ ] ";
    }
    case "ordered":
      return `${position}. `;
    default:
      return "";
  }
}

interface LineRange {
  start: number;
  end: number;
}

function lineRangeAt(body: string, offset: number): LineRange {
  const start = body.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const newline = body.indexOf("\n", offset);
  return { start, end: newline === -1 ? body.length : newline };
}

function hasStyle(line: string, type: BlockType | "paragraph"): boolean {
  const parsed = parseLine(line);
  if (type === "paragraph") return parsed.type === "paragraph";
  return parsed.type === type;
}

export interface FormatResult {
  body: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Applies (or removes, when every selected line already has it) a block style to
 * the selected lines. Selection offsets are remapped to the rewritten text.
 */
export function applyBlockStyle(
  body: string,
  selectionStart: number,
  selectionEnd: number,
  type: BlockType | "paragraph",
): FormatResult {
  const first = lineRangeAt(body, Math.min(selectionStart, body.length));
  const last = lineRangeAt(body, Math.max(selectionStart, selectionEnd));

  const before = body.slice(0, first.start);
  const target = body.slice(first.start, last.end);
  const after = body.slice(last.end);

  const lines = target.split("\n");
  const remove = type !== "paragraph" && lines.every((line) => hasStyle(line, type));
  let orderedPosition = 1;
  let firstLineDelta = 0;
  let totalDelta = 0;

  const next = lines.map((line, index) => {
    const stripped = stripBlockPrefix(line);
    const nextType = remove ? "paragraph" : type;
    const prefix = nextType === "paragraph" ? "" : prefixFor(nextType, line, orderedPosition);
    if (nextType === "ordered") orderedPosition += 1;

    const rebuilt = stripped.length === 0 && nextType === "paragraph" ? "" : `${prefix}${stripped}`;
    const delta = rebuilt.length - line.length;
    if (index === 0) firstLineDelta = delta;
    totalDelta += delta;
    return rebuilt;
  });

  const newBody = `${before}${next.join("\n")}${after}`;
  const rawStart = selectionStart + firstLineDelta;
  const rawEnd = selectionEnd + totalDelta;

  return {
    body: newBody,
    selectionStart: Math.max(first.start, Math.min(rawStart, newBody.length)),
    selectionEnd: Math.max(first.start, Math.min(rawEnd, newBody.length)),
  };
}

/** Wraps or unwraps the selection with inline markers (bold, italic, code). */
export function applyInlineStyle(
  body: string,
  selectionStart: number,
  selectionEnd: number,
  marker: "**" | "*" | "`",
): FormatResult {
  const start = Math.min(selectionStart, body.length);
  const end = Math.min(Math.max(selectionEnd, start), body.length);
  const selected = body.slice(start, end);
  const markerLength = marker.length;

  const alreadyWrapped =
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    selected.length > markerLength * 2;

  let nextSelection: string;
  let caretStart: number;
  let caretEnd: number;

  if (alreadyWrapped) {
    nextSelection = selected.slice(markerLength, -markerLength);
    caretStart = start;
    caretEnd = end - markerLength * 2;
  } else {
    nextSelection = `${marker}${selected}${marker}`;
    caretStart = start + markerLength;
    caretEnd = end + markerLength;
  }

  const newBody = `${body.slice(0, start)}${nextSelection}${body.slice(end)}`;
  return { body: newBody, selectionStart: caretStart, selectionEnd: caretEnd };
}

/** Inserts a fenced code block around the selected lines. */
export function applyCodeBlock(
  body: string,
  selectionStart: number,
  selectionEnd: number,
): FormatResult {
  const start = Math.min(selectionStart, body.length);
  const end = Math.min(Math.max(selectionEnd, start), body.length);
  const selected = body.slice(start, end);
  const needsLeadingBreak = start > 0 && body[start - 1] !== "\n";
  const prefix = `${needsLeadingBreak ? "\n" : ""}\`\`\`\n`;
  const suffix = `${selected.endsWith("\n") || selected.length === 0 ? "" : "\n"}\`\`\`\n`;

  const newBody = `${body.slice(0, start)}${prefix}${selected}${suffix}${body.slice(end)}`;
  const caret = start + prefix.length;

  return {
    body: newBody,
    selectionStart: caret,
    selectionEnd: caret + selected.length,
  };
}

/** Flips a checklist line; returns the body unchanged when the line is not a checklist. */
export function toggleChecklistLine(body: string, lineIndex: number): string {
  const lines = body.split(/\r?\n/);
  const line = lines[lineIndex];
  if (line === undefined) return body;

  const match = CHECKLIST.exec(line);
  if (!match) return body;

  const nextMark = match[1].toLowerCase() === "x" ? " " : "x";
  lines[lineIndex] = `- [${nextMark}] ${match[2]}`;
  return lines.join("\n");
}

/** Progress for the checklist summary shown in the editor. */
export function checklistProgress(body: string): { done: number; total: number } {
  let done = 0;
  let total = 0;

  for (const line of body.split(/\r?\n/)) {
    const match = CHECKLIST.exec(line);
    if (!match) continue;
    total += 1;
    if (match[1].toLowerCase() === "x") done += 1;
  }

  return { done, total };
}

/** True when the body contains at least one structural line. */
export function hasBlocks(body: string): boolean {
  return body.split(/\r?\n/).some((line) => parseLine(line).type !== "paragraph" || FENCE.test(line));
}
