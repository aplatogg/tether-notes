import { z } from "zod";

/**
 * BYOK AI summary: the API key lives only in this device's localStorage and is
 * sent solely to the user-configured OpenAI-compatible endpoint. Tether Notes
 * servers never see it.
 */

const CONFIG_KEY = "tether-ai-config";

export const aiConfigSchema = z.object({
  apiKey: z.string().min(1),
  endpoint: z.string().url().default("https://api.openai.com/v1"),
  model: z.string().min(1).default("gpt-4o-mini"),
});

export type AiConfig = z.infer<typeof aiConfigSchema>;

export function loadAiConfig(): AiConfig | null {
  try {
    const raw = globalThis.localStorage?.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = aiConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveAiConfig(config: AiConfig): void {
  globalThis.localStorage?.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearAiConfig(): void {
  globalThis.localStorage?.removeItem(CONFIG_KEY);
}

export interface SummarizeOptions {
  maxChars?: number;
}

export async function summarizeText(
  config: AiConfig,
  text: string,
  options: SummarizeOptions = {},
): Promise<string> {
  const maxChars = options.maxChars ?? 20_000;
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The note is empty — nothing to summarize.");

  const endpoint = config.endpoint.replace(/\/+$/u, "");
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content:
            "You are a concise note-summarizer. Summarize the user's note in 3-6 bullet points. Reply in the note's language. Do not add a title.",
        },
        { role: "user", content: trimmed.slice(0, maxChars) },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `AI request failed (${response.status}): ${detail.slice(0, 200) || response.statusText}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("The AI returned an empty summary.");
  return content;
}
