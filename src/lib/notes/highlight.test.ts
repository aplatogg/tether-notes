import { describe, expect, it } from "vitest";
import {
  bodyHasHighlight,
  collectDocHighlights,
  extractHighlights,
  normalizeHighlightColor,
} from "./highlight";

describe("highlight helpers", () => {
  it("normalizes unknown colors to yellow", () => {
    expect(normalizeHighlightColor("green")).toBe("green");
    expect(normalizeHighlightColor("#bbf7d0")).toBe("green");
    expect(normalizeHighlightColor("maroon")).toBe("yellow");
    expect(normalizeHighlightColor(undefined)).toBe("yellow");
  });

  it("extracts highlights in document order with their colors", () => {
    const html =
      '<p><mark data-color="green">first</mark> plain <mark data-color="pink">second <strong>bold</strong></mark></p>' +
      '<p><mark data-color="weird">third</mark></p>';

    expect(extractHighlights(html)).toEqual([
      { index: 0, text: "first", color: "green" },
      { index: 1, text: "second bold", color: "pink" },
      { index: 2, text: "third", color: "yellow" },
    ]);
  });

  it("ignores empty marks", () => {
    expect(extractHighlights('<p><mark data-color="blue"> </mark></p>')).toEqual([]);
  });

  it("merges adjacent text nodes that share a highlight", () => {
    const nodes = [
      { isText: true, text: "one ", nodeSize: 4, marks: [{ type: { name: "highlight" }, attrs: { color: "blue" } }] },
      { isText: true, text: "two", nodeSize: 3, marks: [{ type: { name: "highlight" }, attrs: { color: "blue" } }] },
      { isText: false, text: null, nodeSize: 1, marks: [] },
      { isText: true, text: "three", nodeSize: 5, marks: [{ type: { name: "highlight" }, attrs: { color: "pink" } }] },
      { isText: true, text: "plain", nodeSize: 5, marks: [{ type: { name: "bold" }, attrs: {} }] },
    ];

    const doc = {
      descendants(callback: (node: never, pos: number) => void) {
        let pos = 0;
        for (const node of nodes) {
          callback(node as never, pos);
          pos += node.nodeSize;
        }
      },
    };

    expect(collectDocHighlights(doc as never)).toEqual([
      { text: "one two", color: "blue", from: 0, to: 7 },
      { text: "three", color: "pink", from: 8, to: 13 },
    ]);
  });

  it("detects highlights in html and legacy markdown", () => {
    expect(bodyHasHighlight('<p><mark data-color="yellow">x</mark></p>')).toBe(true);
    expect(bodyHasHighlight("plain ==marked== text")).toBe(true);
    expect(bodyHasHighlight("plain text")).toBe(false);
  });
});