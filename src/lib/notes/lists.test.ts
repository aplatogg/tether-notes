import { describe, expect, it } from "vitest";
import {
  continueList,
  indentOf,
  indentSelection,
  parseBlocks,
} from "@/lib/notes/format";

describe("list indentation", () => {
  it("reads nesting depth from leading spaces", () => {
    expect(indentOf("item")).toBe(0);
    expect(indentOf("  item")).toBe(1);
    expect(indentOf("    item")).toBe(2);
    expect(parseBlocks("  - nested")[0].depth).toBe(1);
  });

  it("indents and outdents a selection", () => {
    const indented = indentSelection("one\ntwo", 0, 7, 1);
    expect(indented.body).toBe("  one\n  two");
    expect(indentSelection(indented.body, 0, 11, -1).body).toBe("one\ntwo");
  });

  it("never indents below zero", () => {
    expect(indentSelection("one", 0, 3, -1).body).toBe("one");
  });
});

describe("continueList", () => {
  it("continues a numbered list with the next number", () => {
    const first = continueList("1. first", 8);
    expect(first?.body).toBe("1. first\n2. ");
    expect(first?.selectionStart).toBe(12);
  });

  it("keeps counting after a third item", () => {
    const next = continueList("1. a\n2. b", 8);
    expect(next?.body).toBe("1. a\n2. b\n3. ");
  });

  it("continues bullets and checklists", () => {
    expect(continueList("- milk", 6)?.body).toBe("- milk\n- ");
    expect(continueList("- [x] done", 10)?.body).toBe("- [x] done\n- [ ] ");
  });

  it("preserves nesting when continuing", () => {
    expect(continueList("  - nested", 10)?.body).toBe("  - nested\n  - ");
  });

  it("exits the list when the current item is empty", () => {
    expect(continueList("1. a\n2. ", 8)?.body).toBe("1. a\n");
  });

  it("ignores plain paragraphs", () => {
    expect(continueList("plain", 5)).toBeNull();
  });
});

