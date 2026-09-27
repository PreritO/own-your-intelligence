// Minimal Anthropic Messages API client (fetch, no SDK). Key from ANTHROPIC_API_KEY (.env; Bun loads it).
// Never logs the key. Returns null on any failure so callers can fall back honestly.
export const MODEL = process.env.COMMISSION_MODEL ?? "claude-sonnet-5";

export async function claude(system: string, user: string, maxTokens = 800, timeoutMs = 45000): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = (await res.json()) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
      if (!res.ok) {
        console.warn(`claude ${res.status}: ${j.error?.message ?? "error"}`);
        if (res.status >= 500 || res.status === 429) continue;
        return null;
      }
      return (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
    } catch (e) {
      console.warn(`claude call failed: ${(e as Error).message}`);
    }
  }
  return null;
}

// First JSON object in a model reply (tolerates ```json fences and prose around it).
export function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

if (import.meta.main) {
  const t0 = Date.now();
  console.log(JSON.stringify(await claude("Reply with one word.", "Say ok", 20)), `${Date.now() - t0}ms`, MODEL);
}
