import { describe, expect, test, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES, uploadAttachment } from "./attachments";

function makeClient(options: { note: { id: string } | null; insertError?: { message: string } | null }) {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const single = vi.fn().mockResolvedValue({
    data: {
      id: "00000000-0000-4000-8000-000000000001",
      note_id: "00000000-0000-4000-8000-000000000002",
      path: "p",
      name: "ok.bin",
      mime: "application/octet-stream",
      size_bytes: 1024,
      created_at: new Date().toISOString(),
    },
    error: null,
  });
  const insert = vi.fn().mockReturnValue({
    select: () => ({ single }),
  });
  if (options.insertError !== undefined) {
    single.mockResolvedValue({ data: null, error: options.insertError });
  }
  const maybeSingle = vi.fn().mockResolvedValue({ data: options.note, error: null });

  const client = {
    storage: { from: () => ({ upload, remove }) },
    from: (table: string) =>
      table === "notes"
        ? { select: () => ({ eq: () => ({ maybeSingle }) }) }
        : { insert },
  };
  return { client, upload, remove, insert };
}

const okFile = () => new Blob([new Uint8Array(1024)]);

describe("uploadAttachment", () => {
  test("rejects files above the cap before any network call", async () => {
    const { client, upload } = makeClient({ note: { id: "n" } });
    const big = new Blob([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)]);
    await expect(
      uploadAttachment(client as never, "n", "u", big, "big.bin"),
    ).rejects.toThrow(/too large/i);
    expect(upload).not.toHaveBeenCalled();
  });

  test("refuses to upload when the note is not visible to the caller", async () => {
    const { client, upload, insert } = makeClient({ note: null });
    await expect(
      uploadAttachment(client as never, "n", "u", okFile(), "ok.bin"),
    ).rejects.toThrow(/cannot attach/i);
    // No bytes, no metadata row -> nothing to orphan.
    expect(upload).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  test("uploads under the caller's folder and registers metadata", async () => {
    const { client, upload } = makeClient({ note: { id: "n" } });
    const result = await uploadAttachment(
      client as never,
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      okFile(),
      "ok.bin",
    );
    expect(result.name).toBe("ok.bin");
    expect(upload).toHaveBeenCalledOnce();
    const [path] = upload.mock.calls[0] as [string];
    expect(path.startsWith("00000000-0000-4000-8000-000000000003/")).toBe(true);
  });

  test("strips traversal-ish dot runs from the stored file name", async () => {
    const { client, upload, insert } = makeClient({ note: { id: "n" } });
    await uploadAttachment(
      client as never,
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      okFile(),
      "..%2f..passwd.txt",
    );
    const [path] = upload.mock.calls[0] as [string];
    expect(path).not.toContain("..");
    const row = insert.mock.calls[0][0] as { name: string };
    expect(row.name).not.toContain("..");
  });

  test("reports a failed orphan cleanup instead of hiding it", async () => {
    const { client, remove, upload } = makeClient({
      note: { id: "n" },
      insertError: { message: "row-level security" },
    });
    remove.mockResolvedValue({ error: { message: "storage denied" } });
    await expect(
      uploadAttachment(client as never, "n", "u", okFile(), "ok.bin"),
    ).rejects.toThrow(/orphan cleanup failed: storage denied/);
    expect(upload).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });
});
