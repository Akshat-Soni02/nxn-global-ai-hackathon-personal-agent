// llm steps: a transform. Instruction + input data in, a typed value out, saved to the step's variable.
// The model never drives the UI and gets no tools; it only sees the data the step names in `inputs`. It is the `fast`
// profile, asked for the step's output type as structured output.
// Hard limits, so a workflow that runs every hour cannot quietly run up a bill: calls per run, input size, and an
// answer cache keyed by the run's date, the instruction, the output type and the data.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fitValue, jsonSchemaOf, type LlmStep, typeText, type VarType } from "@taskplayer/core";
import type { JsonSchema, Llm, UsageMeter } from "@taskplayer/llm";
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

export type LlmExecutor = (step: LlmStep, ctx: RunContext) => Promise<StepResult>;

const fail = (error: string): StepResult => ({ ok: false, error });

export interface LlmStepOptions {
  llm?: Llm;
  cacheDir?: string;
  limits?: AiLimits;
  // Where the calls' tokens and cost are counted (the daemon's meter, say).
  meter?: UsageMeter;
}

export function llmExecutor(options: LlmStepOptions = {}): LlmExecutor {
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
    const type = step.output.type;
    const key = createHash("sha256")
      .update(`${day}\n${step.instruction}\n${JSON.stringify(type)}\n${input}`)
      .digest("hex");
    const cached = options.cacheDir ? join(options.cacheDir, `${key}.json`) : undefined;
    if (cached && existsSync(cached)) return { ok: true, value: JSON.parse(readFileSync(cached, "utf8")).answer };
    if (!options.llm) return fail("llm steps need a model: set NEBIUS_API_KEY (see .env.example)");
    const used = callsByRun.get(ctx.runId) ?? 0;
    if (used >= limits.maxCallsPerRun) {
      return fail(`this run already made ${used} model calls, the limit (TASKPLAYER_AI_MAX_CALLS_PER_RUN)`);
    }
    callsByRun.set(ctx.runId, used + 1);
    let answer: unknown;
    try {
      const result = await options.llm.generate({
        profile: "fast",
        system: "You transform the data you are given into the answer asked for.",
        user: `Today is ${day}.\n${step.instruction}\n\nData:\n${input}`,
        schema: answerSchema(type),
        schemaName: "answer",
        meter: options.meter,
      });
      answer = result.value;
    } catch (error) {
      return fail(`the model gave no usable answer: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (cached && options.cacheDir) {
      mkdirSync(options.cacheDir, { recursive: true });
      writeFileSync(cached, JSON.stringify({ answer, at: Date.now() }));
    }
    return { ok: true, value: answer };
  };
}

// The step's output type as structured output: `{"answer": <value>}`, so a number or a list is asked for the same
// way as an object. The answer is checked and converted by the type (vars.ts fitValue).
export function answerSchema(type: VarType): JsonSchema<unknown> {
  return {
    jsonSchema: {
      type: "object",
      properties: { answer: jsonSchemaOf(type) },
      required: ["answer"],
      additionalProperties: false,
    },
    check(value) {
      const answer =
        typeof value === "object" && value !== null && "answer" in value
          ? fitValue(type, (value as { answer: unknown }).answer)
          : undefined;
      return answer === undefined
        ? { ok: false, error: `"answer" must be ${typeText(type)}${type.type === "date" ? " (YYYY-MM-DD)" : ""}` }
        : { ok: true, value: answer };
    },
  };
}
