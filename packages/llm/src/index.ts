// Client for Nemotron on our own Nebius Serverless endpoint (OpenAI-compatible chat completions API).
// Used by the recorder's compiler and the player's agent fallback. Runs in the daemon only:
// the API key never goes into the extension.

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig {
  const baseUrl = env.NEBIUS_BASE_URL;
  const apiKey = env.NEBIUS_API_KEY;
  const model = env.NEMOTRON_MODEL;
  if (!baseUrl || !apiKey || !model) {
    throw new Error("Set NEBIUS_BASE_URL, NEBIUS_API_KEY and NEMOTRON_MODEL (see .env.example)");
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model };
}

export async function chat(
  config: LlmConfig,
  messages: ChatMessage[],
  options: { temperature?: number; json?: boolean; signal?: AbortSignal } = {},
): Promise<string> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: options.temperature ?? 0,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: options.signal,
  });
  if (!res.ok) {
    throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("LLM response had no message content");
  }
  return content;
}
