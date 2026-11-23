import { describe, expect, it } from "vitest";
import {
  applyCodeBlock,
  applyInlineStyle,
  checklistProgress,
  parseBlocks,
  parseInline,
  plainPreview,
} from "@/lib/notes/format";

describe("parseInline", () => {
  it("splits bold, italic and inline code", () => {
    expect(parseInline("a **b** c *d* e `f`")).toEqual([
      { type: "text", text: "a " },
      { type: "bold", text: "b" },
      { type: "text", text: " c " },
      { type: "italic", text: "d" },
      { type: "text", text: " e " },
      { type: "code", text: "f" },
    ]);
  });

  it("returns plain text untouched", () => {
    expect(parseInline("plain")).toEqual([{ type: "text", text: "plain" }]);
  });
});

describe("parseBlocks code fences", () => {
  it("groups a fenced block into a single code block", () => {
    const blocks = parseBlocks("before\n```ts\nconst a = 1;\nconst b = 2;\n```\nafter");

    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "code", "paragraph"]);
    expect(blocks[1].text).toBe("const a = 1;\nconst b = 2;");
    expect(blocks[1].language).toBe("ts");
  });

  it("treats an unterminated fence as code until the end", () => {
    const blocks = parseBlocks("```\nabc");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("code");
  });
});

describe("applyInlineStyle", () => {
  it("wraps the selection and keeps it selected", () => {
    const result = applyInlineStyle("hello world", 6, 11, "**");
    expect(result.body).toBe("hello **world**");
    expect(result.selectionStart).toBe(8);
    expect(result.selectionEnd).toBe(13);
  });

  it("unwraps an already wrapped selection", () => {
    expect(applyInlineStyle("hello **world**", 6, 15, "**").body).toBe("hello world");
  });
});

describe("applyCodeBlock", () => {
  it("wraps the selection in a fence", () => {
    const result = applyCodeBlock("line", 0, 4);
    expect(result.body).toBe("```\nline\n```\n");
  });
});

describe("checklistProgress", () => {
  it("counts done and total items", () => {
    expect(checklistProgress("- [x] a\n- [ ] b\n- text")).toEqual({ done: 1, total: 2 });
  });
});

describe("plainPreview with markdown", () => {
  it("strips markers and inline formatting", () => {
    expect(plainPreview("## **Shipping** `today`")).toBe("Shipping today");
  });
});
