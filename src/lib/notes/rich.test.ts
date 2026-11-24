import { describe, expect, it } from "vitest";
import {
  bodyToPlainText,
  countWords,
  isHtmlBody,
  markdownToHtml,
  sanitizeHtml,
} from "@/lib/notes/rich";

describe("rich body helpers", () => {
  it("detects html bodies", () => {
    expect(isHtmlBody("<p>hi</p>")).toBe(true);
    expect(isHtmlBody("# markdown")).toBe(false);
    expect(isHtmlBody("- [ ] task")).toBe(false);
  });

  it("converts the legacy markdown subset", () => {
    const html = markdownToHtml("# Title\n## Sub\n- one\n1. first\n- [x] done\n\n**bold** and `code`");

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<h2>Sub</h2>");
    expect(html).toContain("<ul><li><p>one</p></li></ul>");
    expect(html).toContain("<ol><li><p>first</p></li></ol>");
    expect(html).toContain('data-type="taskItem" data-checked="true"');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("keeps fenced code as a pre block", () => {
    expect(markdownToHtml("```js\nconst a = 1;\n```")).toContain("<pre><code>const a = 1;</code></pre>");
  });

  it("returns html unchanged", () => {
    expect(markdownToHtml("<p>already</p>")).toBe("<p>already</p>");
  });

  it("strips scripts and event handlers", () => {
    const dirty = '<p onclick="alert(1)">safe</p><script>alert(1)</script><img src="javascript:alert(1)">';
    const clean = sanitizeHtml(dirty);

    expect(clean).toContain("safe");
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("javascript:");
  });

  it("extracts plain text for previews and search", () => {
    expect(bodyToPlainText("<h1>Title</h1><p>Hello <strong>world</strong></p>")).toBe("Title\nHello world");
    expect(bodyToPlainText("# Title\nbody")).toBe("Title\nbody");
  });

  it("counts words from rich or markdown bodies", () => {
    expect(countWords("<p>one two three</p>")).toBe(3);
    expect(countWords("# head\nbody text")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});
