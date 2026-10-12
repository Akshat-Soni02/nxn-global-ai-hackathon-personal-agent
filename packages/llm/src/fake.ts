// A scripted model for tests: the real client with a fake HTTP layer, so request building, retries, structured-output
// fallbacks and cost accounting are exercised exactly as in production. No network.
import { type ClientDeps, createLlm, type Llm } from "./client.ts";
import { type LlmSettings, llmConfig } from "./config.ts";

export type FakeReply =
  | string
  | {
      text?: string;
      toolCalls?: { name: string; arguments: unknown }[];
      usage?: { input: number; output: number };
      finishReason?: string;
      // Answer with an HTTP error instead (429 to test retries, 400 to test a rejected response_format).
      status?: number;
      error?: string;
    };

export interface FakeLlm extends Llm {
  // Every request body sent, in order.
  readonly requests: Record<string, unknown>[];
}

export function fakeLlm(
  replies: FakeReply[] | ((body: Record<string, unknown>, index: number) => FakeReply),
  settings: Partial<LlmSettings> = {},
  deps: Omit<ClientDeps, "fetch"> = {},
): FakeLlm {
  const requests: Record<string, unknown>[] = [];
  const script = Array.isArray(replies) ? [...replies] : undefined;
  const fakeFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(url).endsWith("/models")) {
      return Response.json({ data: Object.keys(llm.config.catalog).map((id) => ({ id })) });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push(body);
    const next = script
      ? script.shift()
      : (replies as (b: Record<string, unknown>, i: number) => FakeReply)(body, requests.length - 1);
    const reply = typeof next === "string" ? { text: next } : (next ?? { text: "" });
    if (reply.status && reply.status >= 400) return new Response(reply.error ?? "error", { status: reply.status });
    return Response.json({
      choices: [
        {
          finish_reason: reply.finishReason ?? "stop",
          message: {
            content: reply.text ?? "",
            tool_calls: reply.toolCalls?.map((c, i) => ({
              id: `call_${requests.length}_${i}`,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.arguments) },
            })),
          },
        },
      ],
      usage: { prompt_tokens: reply.usage?.input ?? 100, completion_tokens: reply.usage?.output ?? 20 },
    });
  };
  const llm = createLlm(llmConfig({ apiKey: "test-key", ...settings }), {
    sleep: async () => {},
    ...deps,
    fetch: fakeFetch as typeof fetch,
  });
  return Object.assign(llm, { requests });
}
