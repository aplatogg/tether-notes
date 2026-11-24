import { describe, expect, test } from "vitest";
import { exportNotesJson, htmlToMarkdown, noteToMarkdown, parseImportJson } from "./export";
import type { Note } from "./types";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    userId: "u1",
    title: "Trip",
    body: "<h2>Pack</h2><p>Bring <strong>charger</strong> and <a href=\"https://example.com\">passport</a></p><ul data-type=\"taskList\"><li data-checked=\"true\"><div><p>Book hotel</p></div></li><li data-checked=\"false\"><div><p>Print ticket</p></div></li></ul>",
    tags: ["travel"],
    isPinned: false,
    isArchived: false,
    deletedAt: null,
    createdAt: "2026-11-24T10:00:00.000Z",
    updatedAt: "2026-11-24T11:00:00.000Z",
    syncStatus: "synced",
    folder: "Personal",
    reminderAt: "2026-11-25T09:00:00.000Z",
    ...overrides,
  };
}

describe("htmlToMarkdown", () => {
  test("converts headings, marks, links, and task lists", () => {
    const md = htmlToMarkdown(makeNote().body);
    expect(md).toContain("## Pack");
    expect(md).toContain("**charger**");
    expect(md).toContain("[passport](https://example.com)");
    expect(md).toContain("- [x] Book hotel");
    expect(md).toContain("- [ ] Print ticket");
  });
});

describe("noteToMarkdown", () => {
  test("includes title, folder and reminder metadata", () => {
    const md = noteToMarkdown(makeNote());
    expect(md).toContain("# Trip");
    expect(md).toContain("<!-- folder: Personal -->");
    expect(md).toContain("<!-- reminder: 2026-11-25T09:00:00.000Z -->");
    expect(md).toContain("Tags: #travel");
  });
});

describe("export/import JSON round-trip", () => {
  test("exported notes parse back with sync reset to pending", () => {
    const notes = [makeNote(), makeNote({ id: "n2", title: "Second", shared: true, ownerEmail: "a@x.io" })];
    const json = exportNotesJson(notes);
    const parsed = parseImportJson(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ id: "n1", title: "Trip", syncStatus: "pending", folder: "Personal" });
    // Client-only share markers are stripped on export.
    expect(json).not.toContain("ownerEmail");
    expect(parsed[1].syncStatus).toBe("pending");
  });

  test("rejects files that are not tether-notes exports", () => {
    expect(() => parseImportJson(JSON.stringify({ app: "other", notes: [] }))).toThrow();
  });
});
