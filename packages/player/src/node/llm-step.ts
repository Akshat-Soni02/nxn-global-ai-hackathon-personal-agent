// llm steps: a transform. Instruction + input data in, a typed value out, saved to the step's variable.
// The model never drives the UI and gets no tools; it only sees the data the step names in `inputs`.
// Hard limits, so a workflow that runs every hour cannot quietly run up a bill: calls per run, input size, and an
// answer cache keyed by the run's date, the instruction, the output type and the data.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmOutput, LlmStep } from "@taskplayer/core";
import { today } from "../template.ts";
import type { RunContext, StepResult } from "../types.ts";

export interface AiLimits {
  maxCallsPerRun: number;
  maxInputChars: number;
}
export const DEFAULT_AI_LIMITS: AiLimits = { maxCallsPerRun: 3, maxInputChars: 20_000 };

export function aiLimitsFromEnv(env: Record<string, string | undefined> = process.env): AiLimits {
  const num = (v: string | undefined, fallback: number) => (v && Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    maxCallsPerRun: num(env.TASKPLAYER_AI_MAX_CALLS_PER_RUN, DEFAULT_AI_LIMITS.maxCallsPerRun),
    maxInputChars: num(env.TASKPLAYER_AI_MAX_INPUT_CHARS, DEFAULT_AI_LIMITS.maxInputChars),
  };
}

// One model call: a system prompt and a user message in, the reply text out.
export type Ask = (system: string, user: string) => Promise<string>;

export type LlmExecutor = (step: LlmStep, ctx: RunContext) => Promise<StepResult>;

const fail = (error: string): StepResult => ({ ok: false, error });

export function llmExecutor(options: { ask?: Ask; cacheDir?: string; limits?: AiLimits } = {}): LlmExecutor {
  const limits = options.limits ?? DEFAULT_AI_LIMITS;
  const callsByRun = new Map<string, number>();

  return async (step, ctx) => {
    // The step's inputs are already resolved: each is text, or a value shown as JSON.
    const input = step.inputs.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("\n\n");
    if (input.length > limits.maxInputChars) {
      return fail(
        `the llm step's input is ${input.length} characters, over the ${limits.maxInputChars} limit: narrow it first (a data.pick, or extract less)`,
      );
    }
    // The model has no calendar: the run's date goes into the question, and into the cache key, so "today's row"
    // is never answered from yesterday's cache when the data hasn't changed.
    const day = today(new Date(ctx.startedAt || Date.now()));
    const shape = describeOutput(step.output);
    const key = createHash("sha256").update(`${day}\n${step.instruction}\n${shape}\n${input}`).digest("hex");
    const cached = options.cacheDir ? join(options.cacheDir, `${key}.json`) : undefined;
    if (cached && existsSync(cached)) return { ok: true, value: JSON.parse(readFileSync(cached, "utf8")).answer };
    if (!options.ask) return fail("llm steps need a model: set NEBIUS_BASE_URL, NEBIUS_API_KEY and NEMOTRON_MODEL");
    const used = callsByRun.get(ctx.runId) ?? 0;
    if (used >= limits.maxCallsPerRun) {
      return fail(`this run already made ${used} model calls, the limit (TASKPLAYER_AI_MAX_CALLS_PER_RUN)`);
    }
    callsByRun.set(ctx.runId, used + 1);
    const reply = await options.ask(
      `You transform the data you are given. Reply with ${shape}, and nothing else.`,
      `Today is ${day}.\n${step.instruction}\n\nData:\n${input}`,
    );
    const answer = parseAnswer(reply, step.output);
    if (answer === undefined) return fail(`the model's answer is not ${shape}: ${reply.slice(0, 120)}`);
    if (cached && options.cacheDir) {
      mkdirSync(options.cacheDir, { recursive: true });
      writeFileSync(cached, JSON.stringify({ answer, at: Date.now() }));
    }
    return { ok: true, value: answer };
  };
}

const SCALAR = {
  text: "plain text",
  number: "a number only, digits and an optional decimal point, no currency or thousands separators",
  boolean: "true or false only",
  date: "a date as YYYY-MM-DD",
} as const;
type Scalar = keyof typeof SCALAR;

export function describeOutput(output: LlmOutput): string {
  const fields = output.fields
    ? `{ ${Object.entries(output.fields)
        .map(([k, t]) => `"${k}": ${t}`)
        .join(", ")} }`
    : undefined;
  if (output.type === "object") return `a JSON object ${fields ?? "{}"}`;
  if (output.type === "list")
    return `a JSON array of ${fields ? `objects ${fields}` : (output.items ?? "text")} values`;
  return SCALAR[output.type];
}

// The reply, checked against the step's output type; undefined when it does not fit.
export function parseAnswer(reply: string, output: LlmOutput): unknown {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (output.type === "object" || output.type === "list") {
    let value: unknown;
    try {
      value = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      return undefined;
    }
    if (output.type === "object") return isRecord(value) ? fitObject(value, output.fields) : undefined;
    if (!Array.isArray(value)) return undefined;
    const items = value.map((item) =>
      output.fields
        ? isRecord(item)
          ? fitObject(item, output.fields)
          : undefined
        : scalar(item, output.items ?? "text"),
    );
    return items.every((i) => i !== undefined) ? items : undefined;
  }
  return scalar(text, output.type);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function fitObject(value: Record<string, unknown>, fields: LlmOutput["fields"]): Record<string, unknown> | undefined {
  if (!fields) return value;
  const out: Record<string, unknown> = {};
  for (const [name, type] of Object.entries(fields)) {
    const fitted = scalar(value[name], type);
    if (fitted === undefined) return undefined;
    out[name] = fitted;
  }
  return out;
}

function scalar(value: unknown, type: Scalar): unknown {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (type === "number") {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    const n = Number(text.replace(/[^\d.-]/g, ""));
    return text && Number.isFinite(n) ? n : undefined;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    return /^(true|yes)$/i.test(text) ? true : /^(false|no)$/i.test(text) ? false : undefined;
  }
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
  return text || undefined;
}
