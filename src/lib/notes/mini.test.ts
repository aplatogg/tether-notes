import { describe, expect, test } from "vitest";
import { miniPrefillFromSearch } from "./mini";

describe("miniPrefillFromSearch", () => {
  test("combines title, text, and url params into the note text", () => {
    expect(
      miniPrefillFromSearch("?title=Hello&text=body+text&url=https%3A%2F%2Fexample.com"),
    ).toEqual({ text: "Hello\nbody text\nhttps://example.com", autoSave: false });
  });

  test("works with only a text param, as an iOS Shortcut passes it", () => {
    expect(miniPrefillFromSearch("?text=quick%20thought")).toEqual({
      text: "quick thought",
      autoSave: false,
    });
  });

  test("save=1 requests an immediate save", () => {
    expect(miniPrefillFromSearch("?text=hi&save=1")).toEqual({ text: "hi", autoSave: true });
  });

  test("empty or blank params produce an empty prefill", () => {
    expect(miniPrefillFromSearch("")).toEqual({ text: "", autoSave: false });
    expect(miniPrefillFromSearch("?text=%20%20")).toEqual({ text: "", autoSave: false });
  });
});
