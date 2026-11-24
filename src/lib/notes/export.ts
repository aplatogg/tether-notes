import { z } from "zod";
import type { Note } from "./types";
import { bodyToPlainText, isHtmlBody } from "./rich";

/* ---------- Markdown export ---------- */

function escapeMd(text: string): string {
  return text.replace(/([\\`*_[\]{}()#+\-.!|])/gu, "\\$1");
}

/** Very small HTML → Markdown converter covering the editor's node set. */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const inline = (el: Element): string => {
    let out = "";
    el.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.textContent ?? "").replace(/\s+/gu, " ");
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const node = child as Element;
        const inner = inline(node);
        switch (node.tagName.toLowerCase()) {
          case "strong":
          case "b":
            return void (out += `**${inner}**`);
          case "em":
          case "i":
            return void (out += `*${inner}*`);
          case "u":
            return void (out += inner);
          case "s":
          case "del":
            return void (out += `~~${inner}~~`);
          case "mark":
            return void (out += `==${inner}==`);
          case "code":
            return void (out += `\`${inner}\``);
          case "a": {
            const href = node.getAttribute("href") ?? "";
            return void (out += href ? `[${inner}](${href})` : inner);
          }
          case "img": {
            const src = node.getAttribute("src") ?? "";
            const alt = node.getAttribute("alt") ?? "image";
            return void (out += `![${alt}](${src})`);
          }
          case "br":
            return void (out += "  \n");
          default:
            out += inner;
        }
      }
    });
    return out;
  };

  const block = (el: Element): string => {
    switch (el.tagName.toLowerCase()) {
      case "h1":
        return `\n# ${inline(el).trim()}\n`;
      case "h2":
        return `\n## ${inline(el).trim()}\n`;
      case "h3":
        return `\n### ${inline(el).trim()}\n`;
      case "p":
        return `${inline(el).trim()}\n`;
      case "blockquote":
        return `${inline(el).trim().split("\n").map((line) => `> ${line}`).join("\n")}\n`;
      case "pre":
        return `\n\`\`\`\n${(el.textContent ?? "").replace(/\n$/u, "")}\n\`\`\`\n`;
      case "ul": {
        const items = [...el.querySelectorAll(":scope > li")].map((li) => {
          const isTask = el.getAttribute("data-type") === "taskList" || li.hasAttribute("data-checked");
          const checked = li.getAttribute("data-checked") === "true";
          const text = inline(li).trim();
          return isTask ? `- [${checked ? "x" : " "}] ${text}` : `- ${text}`;
        });
        return `${items.join("\n")}\n`;
      }
      case "ol": {
        const items = [...el.querySelectorAll(":scope > li")].map(
          (li, index) => `${index + 1}. ${inline(li).trim()}`,
        );
        return `${items.join("\n")}\n`;
      }
      case "table": {
        const rows = [...el.querySelectorAll("tr")].map((tr) =>
          [...tr.querySelectorAll("th,td")].map((cell) => inline(cell).trim()).join(" | "),
        );
        if (rows.length === 0) return "";
        const header = rows[0];
        const separator = header.split(" | ").map(() => "---");
        return `\n${header}\n${separator.join(" | ")}\n${rows.slice(1).join("\n")}\n`;
      }
      default:
        return [...el.children].map(block).join("") || inline(el);
    }
  };

  return [...doc.body.children].map(block).join("\n").replace(/\n{3,}/gu, "\n\n").trim() + "\n";
}

export function noteToMarkdown(note: Note): string {
  const title = note.title.trim() ? `# ${escapeMd(note.title.trim())}\n\n` : "";
  const folder = note.folder?.trim() ? `<!-- folder: ${note.folder.trim()} -->\n` : "";
  const reminder = note.reminderAt ? `<!-- reminder: ${note.reminderAt} -->\n` : "";
  const tags = note.tags.length > 0 ? `\nTags: ${note.tags.map((tag) => `#${tag}`).join(" ")}\n` : "";
  const body = isHtmlBody(note.body) ? htmlToMarkdown(note.body) : `${note.body}\n`;

  return `${title}${folder}${reminder}${body}${tags}`;
}

/* ---------- JSON export / import ---------- */

const exportFileSchema = z.object({
  app: z.literal("tether-notes"),
  version: z.literal(1),
  exportedAt: z.string(),
  notes: z.array(z.unknown()),
});

const importNoteSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1).nullable(),
    title: z.string(),
    body: z.string(),
    tags: z.array(z.string()),
    isPinned: z.boolean(),
    isArchived: z.boolean(),
    lockHash: z.string().nullable().optional(),
    reminderAt: z.string().nullable().optional(),
    folder: z.string().optional(),
    deletedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    syncStatus: z.enum(["local", "pending", "synced", "error"]).optional(),
  })
  .passthrough();

export function exportNotesJson(notes: readonly Note[]): string {
  return JSON.stringify(
    {
      app: "tether-notes",
      version: 1,
      exportedAt: new Date().toISOString(),
      notes: notes.map((note) => {
        const copy = { ...note } as Record<string, unknown>;
        delete copy.lastSyncError;
        delete copy.shared;
        delete copy.sharedFor;
        delete copy.ownerEmail;
        return copy;
      }),
    },
    null,
    2,
  );
}

export function parseImportJson(text: string): Note[] {
  const parsed = exportFileSchema.parse(JSON.parse(text));
  return parsed.notes.map((value) => {
    const note = importNoteSchema.parse(value) as Note;
    return {
      ...note,
      deletedAt: note.deletedAt ?? null,
      syncStatus: "pending",
      lastSyncError: undefined,
    };
  });
}

export function downloadText(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function notePlainText(note: Note): string {
  return isHtmlBody(note.body) ? bodyToPlainText(note.body) : note.body;
}
