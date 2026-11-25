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

describe("sanitizeHtml hardening", () => {
  it("drops the full-screen overlay and the fake login field", () => {
    const dirty =
      '<div style="position:fixed;inset:0;z-index:99999;background:#fff">' +
      '<label style="font:16px sans-serif">Sign in to continue</label>' +
      '<input type="password" name="pw" placeholder="Password">' +
      "</div>";

    const clean = sanitizeHtml(dirty);

    expect(clean).not.toContain("position");
    expect(clean).not.toContain("inset");
    expect(clean).not.toContain("z-index");
    expect(clean).not.toContain("background");
    expect(clean).not.toContain("<input");
    expect(clean).not.toContain("<label");
  });

  it("drops style and class entirely", () => {
    const clean = sanitizeHtml(
      '<p class="app-frame" style="text-align: center; width: 40%; position: absolute">x</p>',
    );

    expect(clean).not.toContain("style=");
    expect(clean).not.toContain("class=");
    expect(clean).toContain("<p>x</p>");
  });

  it("preserves the editor's task list markup", () => {
    // Exact shape stored by the TipTap task list in note MENYURAT.
    const taskHtml =
      '<ul data-type="taskList">' +
      '<li data-checked="false" data-type="taskItem">' +
      '<label><input type="checkbox" checked><span></span></label>' +
      "<div><p>Mistral PRO</p></div>" +
      "</li></ul>";

    const clean = sanitizeHtml(taskHtml);

    expect(clean).toContain('data-type="taskList"');
    expect(clean).toContain('data-type="taskItem"');
    expect(clean).toContain('data-checked="false"');
    expect(clean).toContain("<label>");
    expect(clean).toContain('<input type="checkbox" disabled="">');
    // Multiple checkboxes per row could re-create a form; the state attribute
    // belongs on the li, so the input's own checked flag is stripped.
    expect(clean).not.toMatch(/<input[^>]*\schecked/);
  });

  it("removes checkboxes that are not inside a task item", () => {
    const clean = sanitizeHtml('<p><label><input type="checkbox"></label></p>');

    expect(clean).not.toContain("<input");
    expect(clean).not.toContain("<label");
    expect(clean).toContain("<p></p>");
  });

  it("normalizes link target and rel", () => {
    const external = sanitizeHtml('<a href="https://example.com" target="_self">x</a>');
    expect(external).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(external).toContain('target="_blank"');

    const internal = sanitizeHtml('<a href="/notes" target="_blank">x</a>');
    expect(internal).not.toContain("target=");
  });

  it("keeps valid highlight colors on mark and clamps others", () => {
    const clean = sanitizeHtml(
      '<p><mark data-color="green">ok</mark><mark data-color="maroon">bad</mark><mark>bare</mark></p>',
    );

    expect(clean).toContain('<mark data-color="green">ok</mark>');
    expect(clean).toContain('<mark data-color="yellow">bad</mark>');
    expect(clean).toContain('<mark data-color="yellow">bare</mark>');
  });

  it("drops data-color from non-mark elements and any style", () => {
    const clean = sanitizeHtml(
      '<p data-color="pink" style="color:red;position:fixed">x</p><span data-color="blue">y</span>',
    );

    expect(clean).not.toContain('data-color="pink"');
    expect(clean).not.toContain('data-color="blue"');
    expect(clean).not.toContain("style=");
    expect(clean).toContain("<p>x</p>");
  });

  it("renders ==highlight== markdown as a yellow mark", () => {
    expect(markdownToHtml("a ==marked== b")).toContain(
      '<mark data-color="yellow">marked</mark>',
    );
    expect(bodyToPlainText("a ==marked== b")).toBe("a marked b");
  });

  it("keeps ordered-list start numbers", () => {
    expect(sanitizeHtml('<ol start="3"><li>three</li></ol>')).toContain('start="3"');
  });

  it("allows only safe link and image schemes", () => {
    expect(sanitizeHtml('<a href="https://example.com">ok</a>')).toContain('href="https://example.com"');
    expect(sanitizeHtml('<a href="/notes">ok</a>')).toContain('href="/notes"');
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
    expect(sanitizeHtml('<a href="data:text/html;base64,AA">x</a>')).not.toContain("data:text");

    expect(sanitizeHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">')).toContain(
      'src="data:image/png;base64,iVBORw0KGgo="',
    );
    expect(sanitizeHtml('<img src="data:text/html;base64,AA" alt="x">')).not.toContain("data:text");
    expect(sanitizeHtml('<img src="file:///etc/passwd" alt="x">')).not.toContain("file:");
  });

  it("blocks external tracking pixel img src (Exploit 4: blind SSRF / IP leak)", () => {
    const clean = sanitizeHtml(
      '<p><img src="https://evil.example/pixel.png" alt="track"><img src="http://169.254.169.254/latest/meta-data" alt="ssrf"></p>',
    );

    expect(clean).not.toContain("evil.example");
    expect(clean).not.toContain("169.254.169.254");
    expect(clean).not.toContain("src=");
  });

  it("blocks protocol-relative URLs //evil.com in href and src (Exploit 7: phishing / tab hijack)", () => {
    const clean = sanitizeHtml(
      '<p><a href="//evil.example/login">Sign in</a><a href="\\\\evil.example/login">Backslash</a><img src="//evil.example/p.png"></p>',
    );

    expect(clean).not.toContain("href=");
    expect(clean).not.toContain("src=");
    expect(clean).not.toContain("evil.example");
  });
});
