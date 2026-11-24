import { describe, expect, test, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES, uploadAttachment } from "./attachments";

// uploadAttachment throws on oversize before touching the network, so a stub client is enough.
const stubClient = { storage: { from: vi.fn() }, from: vi.fn() } as never;

describe("uploadAttachment size guard", () => {
  test("rejects files above the cap", async () => {
    const big = new Blob([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)]);
    await expect(
      uploadAttachment(stubClient, "note-id", "user-id", big, "big.bin"),
    ).rejects.toThrow(/too large/i);
  });

  test("accepts files at the cap", async () => {
    const ok = new Blob([new Uint8Array(1024)]);
    const upload = vi.fn().mockResolvedValue({ error: null });
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        note_id: "note-id",
        path: "p",
        name: "ok.bin",
        mime: "application/octet-stream",
        size_bytes: 1024,
        created_at: new Date().toISOString(),
      },
      error: null,
    });
    const client = {
      storage: { from: () => ({ upload }) },
      from: () => ({ insert: () => ({ select: () => ({ single }) }) }),
    } as never;

    const result = await uploadAttachment(client, "note-id", "user-id", ok, "ok.bin");
    expect(result.name).toBe("ok.bin");
    expect(upload).toHaveBeenCalledOnce();
  });
});
