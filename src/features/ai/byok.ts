/**
 * Bring-your-own-key AI: call Gemini or any OpenAI-compatible endpoint
 * with the user's own API key (stored in SecretStorage by the caller —
 * keys never touch settings or this module's state). When no key
 * applies, callers fall back to the platform model (`vscode.lm`).
 * Pure request/response shaping — unit-tested.
 */

export interface ByokConfig {
  /** "auto" | "lm" | "gemini" | "openai" (from gitnexus.ai.provider). */
  provider: string;
  geminiModel: string;
  openAiBaseUrl: string;
  openAiModel: string;
}

export const GEMINI_KEY_SECRET = "gitnexus.ai.geminiKey";
export const OPENAI_KEY_SECRET = "gitnexus.ai.openaiKey";

export type ByokProvider = "gemini" | "openai";

/** Which BYOK provider applies, given the config and which keys exist. */
export function chooseByokProvider(
  config: ByokConfig,
  hasGeminiKey: boolean,
  hasOpenAiKey: boolean
): ByokProvider | undefined {
  switch (config.provider) {
    case "gemini": return hasGeminiKey ? "gemini" : undefined;
    case "openai": return hasOpenAiKey ? "openai" : undefined;
    case "lm": return undefined;
    default: // "auto": BYOK first, Gemini preferred
      if (hasGeminiKey) return "gemini";
      if (hasOpenAiKey) return "openai";
      return undefined;
  }
}

export function geminiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export function parseGeminiResponse(json: unknown): string {
  const data = json as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map(part => part.text ?? "").join("").trim();
}

export function openAiUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

export function parseOpenAiResponse(json: unknown): string {
  const data = json as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

/**
 * Ask a BYOK provider. Returns undefined when no BYOK provider applies
 * (caller falls back to the platform model); throws on HTTP errors so
 * the user sees why their key did not work.
 */
export async function askByok(
  prompt: string,
  config: ByokConfig,
  getKey: (secret: string) => Promise<string | undefined>,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<string | undefined> {
  const [geminiKey, openAiKey] = await Promise.all([
    getKey(GEMINI_KEY_SECRET),
    getKey(OPENAI_KEY_SECRET)
  ]);
  const provider = chooseByokProvider(config, Boolean(geminiKey), Boolean(openAiKey));
  if (!provider) return undefined;

  if (provider === "gemini") {
    const response = await fetchFn(geminiUrl(config.geminiModel), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": geminiKey! },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal
    });
    if (!response.ok) {
      throw new Error(`Gemini API ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`);
    }
    return parseGeminiResponse(await response.json());
  }

  const response = await fetchFn(openAiUrl(config.openAiBaseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${openAiKey!}` },
    body: JSON.stringify({
      model: config.openAiModel,
      messages: [{ role: "user", content: prompt }]
    }),
    signal
  });
  if (!response.ok) {
    throw new Error(`OpenAI-compatible API ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`);
  }
  return parseOpenAiResponse(await response.json());
}
