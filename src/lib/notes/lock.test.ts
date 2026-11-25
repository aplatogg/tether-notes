import { describe, expect, it } from "vitest";
import {
  createLockSecret,
  decryptLockedBody,
  encryptLockedBody,
  isEncryptedBody,
  isLockSecret,
  verifyLockPin,
} from "@/lib/notes/lock";
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

  it("encrypts and decrypts locked note bodies with AES-256-GCM", async () => {
    const secret = await createLockSecret("9081");
    const plaintext = "<p>Top secret <strong>VPS credentials</strong> — root@10.0.0.1</p>";
    const encrypted = await encryptLockedBody(plaintext, "9081", secret);

    expect(isEncryptedBody(encrypted)).toBe(true);
    expect(encrypted).not.toContain("VPS credentials");
    expect(encrypted).not.toContain("root@10.0.0.1");

    await expect(decryptLockedBody(encrypted, "9081", secret)).resolves.toBe(plaintext);
    await expect(decryptLockedBody(encrypted, "0000", secret)).resolves.toBeNull();
  });

  it("remains backward-compatible with legacy unencrypted locked bodies", async () => {
    const secret = await createLockSecret("4821");
    await expect(decryptLockedBody("<p>legacy</p>", "4821", secret)).resolves.toBe("<p>legacy</p>");
    await expect(decryptLockedBody("<p>legacy</p>", "9999", secret)).resolves.toBeNull();
  });
});
