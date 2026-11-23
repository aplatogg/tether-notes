import { describe, expect, it } from "vitest";
import {
  applyBlockStyle,
  parseBlocks,
  plainPreview,
  stripBlockPrefix,
  toggleChecklistLine,
} from "@/lib/notes/format";

describe("parseBlocks", () => {
  it("parses headings, bullets, ordered items and checklists", () => {
    const blocks = parseBlocks("# Title\n## Sub\n- bullet\n1. first\n- [x] done");

    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "subheading",
      "bullet",
      "ordered",
      "checklist",
    ]);
    expect(blocks[3].number).toBe(1);
    expect(blocks[4].checked).toBe(true);
  });

  it("keeps unknown lines as paragraphs with their original text", () => {
    expect(parseBlocks("plain text")[0]).toEqual({ type: "paragraph", text: "plain text" });
  });
});

describe("plainPreview", () => {
  it("drops the block marker of the first non-empty line", () => {
    expect(plainPreview("\n## Shipping list\nmore")).toBe("Shipping list");
    expect(plainPreview("- milk")).toBe("milk");
  });

  it("returns an empty string for blank bodies", () => {
    expect(plainPreview("   \n\n")).toBe("");
  });

  it("truncates long text with an ellipsis", () => {
    expect(plainPreview("a".repeat(20), 10)).toHaveLength(10);
  });
});

describe("stripBlockPrefix", () => {
  it("removes list and heading markers", () => {
    expect(stripBlockPrefix("## Ideas")).toBe("Ideas");
    expect(stripBlockPrefix("1. Second")).toBe("Second");
    expect(stripBlockPrefix("- [ ] Task")).toBe("Task");
  });
});

describe("applyBlockStyle", () => {
  it("prefixes the selected line and keeps the caret after the marker", () => {
    const result = applyBlockStyle("hello", 0, 5, "subheading");

    expect(result.body).toBe("## hello");
    expect(result.selectionStart).toBe(3);
  });

  it("applies the style to every selected line", () => {
    const result = applyBlockStyle("one\ntwo", 0, 7, "bullet");

    expect(result.body).toBe("- one\n- two");
  });

  it("numbers ordered lists sequentially", () => {
    const result = applyBlockStyle("a\nb\nc", 0, 5, "ordered");

    expect(result.body).toBe("1. a\n2. b\n3. c");
  });

  it("removes the style when every selected line already has it", () => {
    expect(applyBlockStyle("- one\n- two", 0, 11, "bullet").body).toBe("one\ntwo");
    expect(applyBlockStyle("## a", 0, 4, "subheading").body).toBe("a");
  });

  it("switches between styles without stacking markers", () => {
    const result = applyBlockStyle("- one", 0, 5, "subheading");

    expect(result.body).toBe("## one");
  });

  it("keeps paragraph type untouched when applied to plain text", () => {
    expect(applyBlockStyle("plain", 0, 5, "paragraph").body).toBe("plain");
  });
});

describe("toggleChecklistLine", () => {
  it("checks and unchecks a checklist item", () => {
    const checked = toggleChecklistLine("- [ ] buy milk", 0);
    expect(checked).toBe("- [x] buy milk");
    expect(toggleChecklistLine(checked, 0)).toBe("- [ ] buy milk");
  });

  it("leaves non-checklist lines unchanged", () => {
    expect(toggleChecklistLine("plain", 0)).toBe("plain");
    expect(toggleChecklistLine("- [ ] task", 5)).toBe("- [ ] task");
  });
});
