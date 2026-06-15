// Minimal Anthropic Messages API client.
// Using raw fetch keeps dependencies tiny and avoids SDK version drift.
// Model strings current as of mid-2026 — if a call 400s on the model name,
// confirm the latest strings at https://docs.claude.com/en/api/overview

const API_URL = "https://api.anthropic.com/v1/messages";

// Cheap, fast: used once per episode (the high-volume "map" step).
export const MAP_MODEL = "claude-haiku-4-5-20251001";
// Stronger: used once per synthesis (the "reduce" step).
export const REDUCE_MODEL = "claude-sonnet-4-6";

interface ClaudeCallOpts {
  model: string;
  system?: string;
  user: string;
  maxTokens: number;
}

export async function claude({ model, system, user, maxTokens }: ClaudeCallOpts): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add your key.");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text}`);
  }

  const data = await res.json();
  return (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
}
