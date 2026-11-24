import { afterEach, describe, expect, test, vi } from "vitest";
import { clearAiConfig, loadAiConfig, saveAiConfig, summarizeText } from "./summary";

describe("ai summary (BYOK)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("config round-trips through localStorage only", () => {
    expect(loadAiConfig()).toBeNull();
    saveAiConfig({ apiKey: "sk-x", endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini" });
    expect(loadAiConfig()?.apiKey).toBe("sk-x");
    clearAiConfig();
    expect(loadAiConfig()).toBeNull();
  });

  test("sends the key only to the configured endpoint", async () => {
    const calls: { url: string; auth: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
      calls.push({
        url: String(url),
        auth: String((init?.headers as Record<string, string>)?.Authorization ?? ""),
        body: String(init?.body ?? ""),
      });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "- point A\n- point B" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const summary = await summarizeText(
      { apiKey: "sk-secret", endpoint: "https://llm.example.test/v1/", model: "my-model" },
      "long note text",
    );

    expect(summary).toBe("- point A\n- point B");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://llm.example.test/v1/chat/completions");
    expect(calls[0].auth).toBe("Bearer sk-secret");
    expect(JSON.parse(calls[0].body).model).toBe("my-model");
  });

  test("surfaces API errors", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }),
    );
    await expect(
      summarizeText({ apiKey: "sk-bad", endpoint: "https://x.test/v1", model: "m" }, "text"),
    ).rejects.toThrow("401");
  });

  test("refuses empty notes", async () => {
    await expect(
      summarizeText({ apiKey: "k", endpoint: "https://x.test/v1", model: "m" }, "   "),
    ).rejects.toThrow("empty");
  });
});
