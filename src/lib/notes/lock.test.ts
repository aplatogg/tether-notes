import { describe, expect, it } from "vitest";
import { createLockSecret, isLockSecret, verifyLockPin } from "@/lib/notes/lock";
import { tagColor } from "@/lib/notes/tags";

describe("tagColor", () => {
  it("is stable for the same label regardless of case or padding", () => {
    expect(tagColor("Work")).toEqual(tagColor("  work "));
  });

  it("separates different labels", () => {
    const samples = new Set(
      ["work", "ideas", "release", "home", "travel", "finance"].map(
        (tag) => `${tagColor(tag).bg}/${tagColor(tag).ink}`,
      ),
    );
    expect(samples.size).toBeGreaterThan(1);
  });
});

describe("note lock", () => {
  it("verifies the correct PIN and rejects others", async () => {
    const secret = await createLockSecret("4821");

    expect(isLockSecret(secret)).toBe(true);
    await expect(verifyLockPin("4821", secret)).resolves.toBe(true);
    await expect(verifyLockPin("1111", secret)).resolves.toBe(false);
  });

  it("uses a fresh salt for every lock", async () => {
    const [first, second] = await Promise.all([createLockSecret("4821"), createLockSecret("4821")]);
    expect(first).not.toBe(second);
  });

  it("rejects malformed secrets", async () => {
    await expect(verifyLockPin("4821", "garbage")).resolves.toBe(false);
    expect(isLockSecret("nope")).toBe(false);
  });
});
