// The Token Factory client (OpenAI-compatible chat completions). One function does every kind of call: plain text,
// structured output, tool calls for agents, and images for the vision profile. It knows nothing about skills.
import { z } from "zod";
import { costOf, type ModelInfo, type ProfileName } from "./catalog.ts";
import type { LlmConfig } from "./config.ts";
import { extractJson, stripThinking } from "./json.ts";
import type { UsageMeter } from "./usage.ts";

// ---- Messages and tools ----------------------------------------------------------------------------------------

// The simple form many callers use.
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type Message =
  | ChatMessage
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolDef {
  name: string;
  description: string;
  // JSON Schema of the arguments.
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  // Parsed arguments, or undefined when the model's arguments were not valid JSON (`raw` has them).
  arguments: unknown;
  raw: string;
}

// A schema for structured output: a zod schema, or a JSON Schema with its own check (for types built elsewhere).
export type Schema<T> = z.ZodType<T> | JsonSchema<T>;

export interface JsonSchema<T> {
  jsonSchema: Record<string, unknown>;
  check(value: unknown): { ok: true; value: T } | { ok: false; error: string };
}

export interface Image {
  // A data URL (data:image/png;base64,...). Only redacted screenshots, and only with the user's screen consent.
  dataUrl: string;
}

export interface GenerateRequest<T = unknown> {
  profile: ProfileName;
  // Either messages, or system + user for the common case.
  messages?: Message[];
  system?: string;
  user?: string;
  // Structured output: the reply is validated and returned in `value`. One retry with the errors if it doesn't fit.
  schema?: Schema<T>;
  schemaName?: string;
  // Any JSON object, parsed into `value` without a schema.
  json?: boolean;
  tools?: ToolDef[];
  toolChoice?: "auto" | "required" | "none";
  images?: Image[];
  // Set by the caller only when the user gave screen consent. Without it, images are refused.
  imagesConsented?: boolean;
  thinking?: boolean;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  meter?: UsageMeter;
}

export type StructuredMode = "json_schema" | "json_object" | "prompt";

export interface GenerateResult<T = unknown> {
  text: string;
  value?: T;
  toolCalls: ToolCall[];
  usage: { input: number; output: number };
  costUsd: number;
  model: string;
  ms: number;
  // How structured output was asked for, after any fallback.
  structuredMode?: StructuredMode;
}

export interface Llm {
  readonly config: LlmConfig;
  generate<T = unknown>(request: GenerateRequest<T>): Promise<GenerateResult<T>>;
  listModels(): Promise<string[]>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly details: { status?: number; retryable?: boolean; reply?: string } = {},
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface ClientDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  // Transient failures (network, 408, 429, 5xx) are retried this many times, with backoff.
  retries?: number;
  backoffMs?: number;
}

// ---- The client ----------------------------------------------------------------------------------------------

export function createLlm(config: LlmConfig, deps: ClientDeps = {}): Llm {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const retries = deps.retries ?? 3;
  const backoffMs = deps.backoffMs ?? 500;
  // A model that rejected json_schema is asked with json_object next time, without trying again.
  const downgraded = new Map<string, StructuredMode>();

  async function post(body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(timeoutMs);
      let res: Response;
      try {
        res = await doFetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (error) {
        if (signal?.aborted) throw new LlmError("cancelled", { retryable: false });
        const timedOut = timeout.aborted;
        if (attempt < retries) {
          await sleep(backoffMs * 2 ** attempt);
          continue;
        }
        throw new LlmError(
          timedOut ? `no answer within ${timeoutMs} ms` : `network error: ${(error as Error).message}`,
          {
            retryable: true,
          },
        );
      }
      if (res.ok) return (await res.json()) as CompletionBody;
      const text = await res.text().catch(() => "");
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      if (retryable && attempt < retries) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : backoffMs * 2 ** attempt);
        continue;
      }
      throw new LlmError(`Token Factory answered ${res.status}: ${text.slice(0, 300)}`, {
        status: res.status,
        retryable,
      });
    }
  }

  async function generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const profile = config.profiles[request.profile];
    const model: ModelInfo | undefined = config.catalog[profile.model];
    const started = Date.now();

    if (request.images?.length) {
      if (!request.imagesConsented) throw new LlmError("images need the user's screen consent");
      if (model && !model.vision) throw new LlmError(`${profile.model} does not take images: use the vision profile`);
    }
    if (request.tools?.length && model && !model.tools) throw new LlmError(`${profile.model} does not support tools`);

    const structured = request.schema !== undefined || request.json === true;
    const jsonSchema = request.schema ? toJsonSchema(request.schema) : undefined;
    let mode: StructuredMode | undefined = structured
      ? (downgraded.get(profile.model) ?? (jsonSchema && model?.jsonSchema !== false ? "json_schema" : "json_object"))
      : undefined;

    let messages = initialMessages(request, jsonSchema);
    const usage = { input: 0, output: 0 };
    let cost = 0;
    let validationRetried = false;

    for (;;) {
      const body: Record<string, unknown> = {
        model: profile.model,
        messages: toWire(messages, request.images),
        temperature: request.temperature ?? profile.temperature,
        max_tokens: request.maxTokens ?? profile.maxTokens,
      };
      // Only to models known to take it: an unknown model (swapped in by config) might reject the parameter.
      if (model?.thinkingControl) {
        body.chat_template_kwargs = { enable_thinking: request.thinking ?? profile.thinking };
      }
      if (mode === "json_schema" && jsonSchema) {
        body.response_format = {
          type: "json_schema",
          json_schema: { name: request.schemaName ?? "answer", schema: jsonSchema, strict: true },
        };
      } else if (mode === "json_object") {
        body.response_format = { type: "json_object" };
      }
      if (request.tools?.length) {
        body.tools = request.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
        body.tool_choice = request.toolChoice ?? "auto";
      }

      let reply: CompletionBody;
      try {
        reply = await post(body, request.timeoutMs ?? profile.timeoutMs, request.signal);
      } catch (error) {
        // A model or endpoint that rejects a response format: ask again with the next simpler one.
        const status = error instanceof LlmError ? error.details.status : undefined;
        if (
          mode &&
          status === 400 &&
          /response_format|json_schema|json_object|guided/i.test((error as Error).message)
        ) {
          mode = mode === "json_schema" ? "json_object" : "prompt";
          downgraded.set(profile.model, mode);
          continue;
        }
        throw error;
      }

      const input = reply.usage?.prompt_tokens ?? 0;
      const output = reply.usage?.completion_tokens ?? 0;
      const callCost = costOf(model, input, output);
      usage.input += input;
      usage.output += output;
      cost += callCost;
      request.meter?.add(input, output, callCost);

      const choice = reply.choices?.[0];
      const message = choice?.message ?? {};
      const text = stripThinking(typeof message.content === "string" ? message.content : "");
      const toolCalls = (message.tool_calls ?? []).map(parseToolCall);
      if (!text && toolCalls.length === 0 && choice?.finish_reason === "length") {
        throw new LlmError(
          "the model used its whole token budget (reasoning counts too) and gave no answer: raise maxTokens or turn thinking off",
        );
      }
      const result: GenerateResult<T> = {
        text,
        toolCalls,
        usage,
        costUsd: cost,
        model: profile.model,
        ms: Date.now() - started,
        structuredMode: mode,
      };
      if (!structured || toolCalls.length > 0) return result;

      // Structured output: parse, then check against the schema; one retry with the problem if it doesn't fit.
      const checked = check(request, text);
      if (checked.ok) return { ...result, value: checked.value };
      if (validationRetried) throw new LlmError(`the reply did not fit the schema: ${checked.error}`, { reply: text });
      validationRetried = true;
      messages = [
        ...messages,
        { role: "assistant", content: text },
        { role: "user", content: `That reply was rejected: ${checked.error}. Reply with the corrected JSON only.` },
      ];
    }
  }

  async function listModels(): Promise<string[]> {
    const res = await doFetch(`${config.baseUrl}/models`, { headers: { authorization: `Bearer ${config.apiKey}` } });
    if (!res.ok) throw new LlmError(`Token Factory answered ${res.status} listing models`, { status: res.status });
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => m.id);
  }

  return { config, generate, listModels };
}

// ---- Helpers ---------------------------------------------------------------------------------------------------

interface CompletionBody {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function isZod<T>(schema: Schema<T>): schema is z.ZodType<T> {
  return typeof (schema as z.ZodType<T>).safeParse === "function";
}

function toJsonSchema<T>(schema: Schema<T>): Record<string, unknown> {
  if (!isZod(schema)) return schema.jsonSchema;
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  return json;
}

function check<T>(request: GenerateRequest<T>, text: string): { ok: true; value: T } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  if (!request.schema) return { ok: true, value: parsed as T };
  if (!isZod(request.schema)) return request.schema.check(parsed);
  const result = request.schema.safeParse(parsed);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error.issues.map((i) => `${i.path.join(".") || "(top)"}: ${i.message}`).join("; ") };
}

// Nebius recommends giving the schema in the prompt as well as in response_format.
function initialMessages<T>(request: GenerateRequest<T>, jsonSchema: Record<string, unknown> | undefined): Message[] {
  const messages: Message[] = [...(request.messages ?? [])];
  if (request.system) messages.unshift({ role: "system", content: request.system });
  if (request.user) messages.push({ role: "user", content: request.user });
  const rule = jsonSchema
    ? `Reply with JSON only, matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`
    : request.json
      ? "Reply with one JSON object only."
      : undefined;
  if (!rule) return messages;
  const first = messages[0];
  if (first?.role === "system")
    return [{ role: "system", content: `${first.content}\n\n${rule}` }, ...messages.slice(1)];
  return [{ role: "system", content: rule }, ...messages];
}

function toWire(messages: Message[], images: Image[] | undefined): Record<string, unknown>[] {
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  return messages.map((m, i) => {
    if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    if (m.role === "assistant" && "toolCalls" in m) {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.raw },
        })),
      };
    }
    // Images go with the last user message.
    if (i === lastUser && images?.length) {
      return {
        role: "user",
        content: [
          { type: "text", text: m.content },
          ...images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

function parseToolCall(call: { id?: string; function?: { name?: string; arguments?: string } }, i: number): ToolCall {
  const raw = call.function?.arguments ?? "";
  let args: unknown;
  try {
    args = raw ? JSON.parse(raw) : {};
  } catch {
    args = undefined;
  }
  return { id: call.id ?? `call_${i}`, name: call.function?.name ?? "", arguments: args, raw };
}
