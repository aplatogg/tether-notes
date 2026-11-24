import { describe, expect, it } from "vitest";
import { displayTitle, matchesSearch } from "@/lib/notes/model";
import { createDraftNote } from "@/lib/notes/model";

describe("displayTitle with markdown bodies", () => {
  it("strips heading and list markers from the fallback title", () => {
    expect(displayTitle(createDraftNote({ body: "## Weekly plan\nmore" }))).toBe("Weekly plan");
    expect(displayTitle(createDraftNote({ body: "- milk" }))).toBe("milk");
    expect(displayTitle(createDraftNote({ body: "- [ ] eggs" }))).toBe("eggs");
  });

  it("prefers an explicit title", () => {
    expect(displayTitle(createDraftNote({ title: "Real title", body: "# Other" }))).toBe("Real title");
  });
});

describe("search does not read locked bodies", () => {
  const note = createDraftNote({ title: "Secret note", body: "api-key-super-secret" });

  it("finds the body when the note is unlocked", () => {
    expect(matchesSearch(note, "super-secret")).toBe(true);
  });

  it("ignores the body once the note is locked", () => {
    expect(matchesSearch({ ...note, lockHash: "salt:hash" }, "super-secret")).toBe(false);
    expect(matchesSearch({ ...note, lockHash: "salt:hash" }, "secret note")).toBe(true);
  });
});
