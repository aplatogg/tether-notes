import DOMPurify from "isomorphic-dompurify";
import { parseBlocks, parseInline } from "@/lib/notes/format";

const HTML_PATTERN = /^\s*<[a-z][\s\S]*>/i;

/** Notes written by the rich editor store HTML; older notes store markdown. */
export function isHtmlBody(body: string): boolean {
  return HTML_PATTERN.test(body);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineToHtml(text: string): string {
  return parseInline(text)
    .map((token) => {
      if (token.type === "bold") return `<strong>${escapeHtml(token.text)}</strong>`;
      if (token.type === "italic") return `<em>${escapeHtml(token.text)}</em>`;
      if (token.type === "code") return `<code>${escapeHtml(token.text)}</code>`;
      return escapeHtml(token.text);
    })
    .join("");
}

/** Converts the legacy markdown subset into editor HTML. */
export function markdownToHtml(body: string): string {
  if (isHtmlBody(body)) return body;
  if (!body.trim()) return "<p></p>";

  const blocks = parseBlocks(body);
  const html: string[] = [];
  let list: { type: "bullet" | "task" | "ordered"; items: string[] } | null = null;

  const flush = () => {
    if (!list) return;
    if (list.type === "ordered") {
      html.push(`<ol>${list.items.map((item) => `<li><p>${item}</p></li>`).join("")}</ol>`);
    } else if (list.type === "task") {
      html.push(
        `<ul data-type="taskList">${list.items
          .map(
            (item) =>
              `<li data-type="taskItem" data-checked="${item.startsWith("[x]")}">` +
              `<p>${item.replace(/^\[[ x]\]\s?/, "")}</p></li>`,
          )
          .join("")}</ul>`,
      );
    } else {
      html.push(`<ul>${list.items.map((item) => `<li><p>${item}</p></li>`).join("")}</ul>`);
    }
    list = null;
  };

  for (const block of blocks) {
    if (block.type === "bullet" || block.type === "checklist" || block.type === "ordered") {
      const type = block.type === "checklist" ? "task" : block.type;
      if (!list || list.type !== type) {
        flush();
        list = { type, items: [] };
      }
      const prefix = block.type === "checklist" ? (block.checked ? "[x] " : "[ ] ") : "";
      list.items.push(`${prefix}${inlineToHtml(block.text || "")}`);
      continue;
    }

    flush();

    if (block.type === "heading") html.push(`<h1>${inlineToHtml(block.text)}</h1>`);
    else if (block.type === "subheading") html.push(`<h2>${inlineToHtml(block.text)}</h2>`);
    else if (block.type === "code") {
      html.push(`<pre><code>${escapeHtml(block.text)}</code></pre>`);
    } else if (block.text.trim().length > 0) {
      html.push(`<p>${inlineToHtml(block.text)}</p>`);
    }
  }

  flush();
  return html.join("") || "<p></p>";
}

/** Schemes a note may link to. Relative URLs are allowed separately. */
const SAFE_URL_SCHEME = /^(?:https?:|mailto:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (SAFE_URL_SCHEME.test(trimmed)) return true;
  // Anything without a scheme is a relative reference and stays in-app.
  return !HAS_SCHEME.test(trimmed);
}

function closestTaskItem(element: Element): Element | null {
  let node: Element | null = element.parentElement;
  while (node) {
    if (node.tagName === "LI" && node.getAttribute("data-type") === "taskItem") return node;
    node = node.parentElement;
  }
  return null;
}

// Hooks run for every sanitizeHtml() call, which is the only path that writes
// remote HTML into the DOM. They narrow what DOMPurify's allowlist already lets
// through, rather than replacing it.
DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  // DOMPurify's global ALLOWED_URI_REGEXP also vets unrelated attributes, which
  // dropped start="3" and type="checkbox". Scheme checks live here instead.
  if (data.attrName === "href" || data.attrName === "src") {
    if (!isSafeUrl(data.attrValue)) data.keepAttr = false;
  }
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  const element = node as Element;

  if (element.tagName === "INPUT") {
    // Only the disabled checkbox a task list renders survives; this removes the
    // fake-password-field shape a phishing overlay needs.
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    const parent = element.parentElement;
    const validTaskCheckbox =
      type === "checkbox" && parent?.tagName === "LABEL" && closestTaskItem(element) !== null;
    if (!validTaskCheckbox) {
      element.remove();
      return;
    }
    for (const attribute of [...element.attributes]) {
      if (attribute.name !== "type" && attribute.name !== "disabled") {
        element.removeAttribute(attribute.name);
      }
    }
    element.setAttribute("type", "checkbox");
    element.setAttribute("disabled", "");
    return;
  }

  if (element.tagName === "LABEL" && closestTaskItem(element) === null) {
    element.remove();
    return;
  }

  if (element.tagName === "A") {
    element.setAttribute("rel", "noopener noreferrer nofollow ugc");
    // Relative links stay in-app; external ones open in a new tab safely.
    if (/^https?:\/\//i.test(element.getAttribute("href") ?? "")) {
      element.setAttribute("target", "_blank");
    } else {
      element.removeAttribute("target");
    }
  }
});

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "h1", "h2", "h3", "h4", "strong", "em", "u", "s", "code", "pre",
      "ul", "ol", "li", "blockquote", "br", "hr", "a", "img", "mark",
      "table", "tbody", "thead", "tr", "th", "td", "colgroup", "col", "span", "div",
      "label", "input",
    ],
    // No style and no class: a shared note must not restyle or overlay the page.
    // Links are checked by the hook above; data-* and list attrs stay for the editor.
    ALLOWED_ATTR: [
      "href", "target", "rel", "src", "alt", "title", "data-type",
      "data-checked", "colspan", "rowspan", "colwidth", "start",
      "type", "disabled",
    ],
  });
}

/** Plain text used for list previews, search and titles. */
export function bodyToPlainText(body: string): string {
  const html = isHtmlBody(body) ? body : markdownToHtml(body);
  const text = sanitizeHtml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|h3|h4|li|blockquote|pre|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');

  return text.replace(/\n{2,}/g, "\n").trim();
}

export function countWords(body: string): number {
  const text = bodyToPlainText(body);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

