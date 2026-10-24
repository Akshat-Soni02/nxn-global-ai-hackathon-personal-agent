// llm steps: a transform. Instruction + input data in, a typed value out, saved to the step's variable.
// The model never drives the UI and gets no tools; it only sees the data the step names in `inputs`. It is the `fast`
// profile, asked for the step's output type as structured output.
// Hard limits, so a workflow that runs every hour cannot quietly run up a bill: calls per run, input size, and an
// answer cache keyed by the run's date, the instruction, the output type and the data.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fitValue, jsonSchemaOf, type LlmStep, typeText, type VarType } from "@shadow/core";
import type { JsonSchema, Llm, UsageMeter } from "@shadow/llm";
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
    maxCallsPerRun: num(env.SHADOW_AI_MAX_CALLS_PER_RUN, DEFAULT_AI_LIMITS.maxCallsPerRun),
    maxInputChars: num(env.SHADOW_AI_MAX_INPUT_CHARS, DEFAULT_AI_LIMITS.maxInputChars),
  };
}

// `names`: the step's inputs as written ("{{hn_titles}}"), so each value is shown under its name.
export type LlmExecutor = (step: LlmStep, ctx: RunContext, names?: string[]) => Promise<StepResult>;

// The data as the model reads it: each input under its name, a list's items numbered in the order they came (A, 24 Oct:
// three unnamed JSON lists, and "the top 3 not already saved" came back as items 7, 15 and 10).
export function dataText(values: unknown[], names: string[] = []): string {
  const one = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  const shown = (v: unknown) => (Array.isArray(v) ? v.map((x, i) => `${i + 1}. ${one(x)}`).join("\n") : one(v));
  return values
    .map((v, i) => {
      const name = /^\s*\{\{\s*([^}|]+?)\s*\}\}\s*$/.exec(names[i] ?? "")?.[1];
      return name ? `${name}:\n${shown(v)}` : shown(v);
    })
    .join("\n\n");
}
const SYSTEM = [
  "You transform the data you are given into the answer asked for.",
  'Lists are numbered in the order they came, the page\'s order: "top" and "first" mean the lowest numbers.',
  "Lists of the same length side by side go together item by item (the 3rd title with the 3rd score).",
].join("\n");

const fail = (error: string): StepResult => ({ ok: false, error });

export interface LlmStepOptions {
  llm?: Llm;
  cacheDir?: string;
  limits?: AiLimits;
  // Where the calls' tokens and cost are counted (the daemon's meter, say).
  meter?: UsageMeter;
}

// An AI step that picks the first items of a list (A, 24 Oct: "the first 3 not already saved" came back as items 7, 15
// and 10, then 2, 3 and 4 with nothing saved, and the run said it succeeded): code checks the pick against the data.
// Its picks keep the list's order, and an item before its last pick that it left out must be in the rest of its data
// (what it was told to leave out). From page text, only the order can be checked.
const FIRST_N =
  /\b(first|top|newest|latest)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b|\bin (the )?(list'?s|page'?s) order\b/i;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const texts = (v: unknown): string[] =>
  typeof v === "string"
    ? [v]
    : typeof v === "number"
      ? [String(v)]
      : v && typeof v === "object"
        ? Object.values(v).flatMap(texts)
        : [];
// A pick's own words: its longest text (the title, not its points).
const ownText = (v: unknown) => norm(texts(v).sort((a, b) => b.length - a.length)[0] ?? "");
// Whether an item is in other data, as a person would say it is: a saved title may lack the page's "(kimi.ai)".
const holds = (text: string, item: string) => {
  const bare = item.replace(/\s*\([^)]*\)\s*$/, "");
  return text.includes(item) || text.includes(bare.slice(0, 40));
};

export function pickProblem(
  instruction: string,
  values: unknown[],
  answer: unknown,
  names: string[] = [],
): string | undefined {
  if (!FIRST_N.test(instruction) || !Array.isArray(answer) || answer.length === 0) return undefined;
  const picks = answer.map(ownText);
  if (picks.some((p) => p.length < 4)) return undefined;
  const label = (i: number) => /\{\{\s*([^}|]+?)\s*\}\}/.exec(names[i] ?? "")?.[1] ?? `input ${i + 1}`;
  const numbers = (at: number[]) => at.map((i) => i + 1).join(", ");
  for (const [li, list] of values.entries()) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const items = list.map((x) => norm(texts(x).join(" ")));
    const at = picks.map((p) => items.findIndex((it) => it === p || it.includes(p) || p.includes(it)));
    if (at.some((i) => i < 0)) continue;
    if (at.some((i, k) => k > 0 && i <= (at[k - 1] as number)))
      return `it picked items ${numbers(at)} of ${label(li)}, out of the list's order`;
    const rest = norm(
      values
        .filter((_, k) => k !== li)
        .flatMap(texts)
        .join("\n"),
    );
    for (let j = 0; j < Math.max(...at); j++) {
      if (at.includes(j) || holds(rest, items[j] as string)) continue;
      const left = String(texts(list[j])[0] ?? "").slice(0, 80);
      return `it left out item ${j + 1} of ${label(li)} ("${left}"), which isn't in the rest of its data, and picked items ${numbers(at)}`;
    }
    return undefined;
  }
  // From page text: the picks' places in it keep the page's order.
  const page = norm(values.filter((v): v is string => typeof v === "string").join("\n"));
  const at = picks.map((p) => page.indexOf(p));
  if (page && at.every((i) => i >= 0) && at.some((i, k) => k > 0 && i <= (at[k - 1] as number)))
    return "its picks are out of the page's order";
  return undefined;
}

export function llmExecutor(options: LlmStepOptions = {}): LlmExecutor {
  const limits = options.limits ?? DEFAULT_AI_LIMITS;
  const callsByRun = new Map<string, number>();

  return async (step, ctx, names) => {
    // The step's inputs are already resolved: each is text, or a value shown as JSON, a list numbered.
    const input = dataText(step.inputs, names);
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
    const wrong = (a: unknown) => pickProblem(step.instruction, step.inputs, a, names);
    if (cached && existsSync(cached)) {
      const answer = JSON.parse(readFileSync(cached, "utf8")).answer;
      if (!wrong(answer)) return { ok: true, value: answer };
    }
    if (!options.llm) return fail("llm steps need a model: set NEBIUS_API_KEY (see .env.example)");
    const used = callsByRun.get(ctx.runId) ?? 0;
    if (used >= limits.maxCallsPerRun) {
      return fail(`this run already made ${used} model calls, the limit (SHADOW_AI_MAX_CALLS_PER_RUN)`);
    }
    callsByRun.set(ctx.runId, used + 1);
    let answer: unknown;
    let problem: string | undefined;
    // A wrong pick is asked once more, told what was wrong (that call is part of this step's answer, not counted
    // against the run's limit); wrong again, the step fails: a run never saves a pick code knows is wrong.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await options.llm.generate({
          profile: "fast",
          system: SYSTEM,
          user: `Today is ${day}.\n${step.instruction}\n\nData:\n${input}${problem ? `\n\nYour last answer was wrong: ${problem}. Answer again.` : ""}`,
          schema: answerSchema(type),
          schemaName: "answer",
          meter: options.meter,
        });
        answer = result.value;
      } catch (error) {
        return fail(`the model gave no usable answer: ${error instanceof Error ? error.message : String(error)}`);
      }
      problem = wrong(answer);
      if (!problem) break;
    }
    if (problem) return fail(`its pick is wrong, asked twice: ${problem}`);
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
