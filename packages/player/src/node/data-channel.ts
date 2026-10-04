// The data channel: work on values earlier steps saved (rows read from a sheet or table, extracted text).
//   data.pick  a rule, written once when the skill was compiled. No model call; the same answer on every run.
//   data.ai    a Nemotron call on every run, only for what no rule can express. Hard limits, so a skill that runs
//              every hour cannot quietly run up a bill: calls per run, input size, and an answer cache.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Step } from "@taskplayer/core";
import { today } from "../template.ts";
import type { ChannelExecutor, RunContext, StepResult } from "../types.ts";
import { rowsOf } from "../web/csv.ts";

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

const OUTPUTS = {
  text: "plain text",
  number: "a number only, digits and an optional decimal point, no currency or thousands separators",
  date: "a date as YYYY-MM-DD",
  json: "JSON only",
} as const;
type Output = keyof typeof OUTPUTS;

const fail = (error: string): StepResult => ({ ok: false, error });

export function dataChannel(options: { ask?: Ask; cacheDir?: string; limits?: AiLimits } = {}): ChannelExecutor {
  const limits = options.limits ?? DEFAULT_AI_LIMITS;
  const callsByRun = new Map<string, number>();

  const ai = async (step: Step, ctx: RunContext): Promise<StepResult> => {
    const { instruction, from } = step.args;
    const output: Output = String(step.args.output ?? "text") in OUTPUTS ? (step.args.output as Output) : "text";
    if (typeof instruction !== "string" || !instruction) return fail("data.ai needs an instruction");
    const input = typeof from === "string" ? from : JSON.stringify(from ?? null);
    if (input.length > limits.maxInputChars) {
      return fail(
        `data.ai input is ${input.length} characters, over the ${limits.maxInputChars} limit: narrow it first (a data.pick, or extract fewer rows)`,
      );
    }
    // The model has no calendar: the run's date goes into the question, and into the cache key, so "today's row"
    // is never answered from yesterday's cache when the data hasn't changed.
    const day = today(new Date(ctx.startedAt || Date.now()));
    const key = createHash("sha256").update(`${day}\n${instruction}\n${output}\n${input}`).digest("hex");
    const cached = options.cacheDir ? join(options.cacheDir, `${key}.json`) : undefined;
    if (cached && existsSync(cached)) return { ok: true, value: JSON.parse(readFileSync(cached, "utf8")).answer };
    if (!options.ask) return fail("data.ai needs a model: set NEBIUS_BASE_URL, NEBIUS_API_KEY and NEMOTRON_MODEL");
    const used = callsByRun.get(ctx.runId) ?? 0;
    if (used >= limits.maxCallsPerRun) {
      return fail(`this run already made ${used} model calls, the limit (TASKPLAYER_AI_MAX_CALLS_PER_RUN)`);
    }
    callsByRun.set(ctx.runId, used + 1);
    const reply = await options.ask(
      `You answer one question about the data you are given. Reply with ${OUTPUTS[output]}, and nothing else.`,
      `Today is ${day}.\n${instruction}\n\nData:\n${input}`,
    );
    const answer = parseAnswer(reply, output);
    if (answer === undefined) return fail(`the model's answer is not ${OUTPUTS[output]}: ${reply.slice(0, 120)}`);
    if (cached && options.cacheDir) {
      mkdirSync(options.cacheDir, { recursive: true });
      writeFileSync(cached, JSON.stringify({ answer, at: Date.now() }));
    }
    return { ok: true, value: answer };
  };

  return async (step, ctx) => {
    if (step.action === "pick") return pick(step.args);
    if (step.action === "ai") return ai(step, ctx);
    return fail(`data.${step.action} is not supported`);
  };
}

// data.pick: the `column` of the row whose cells equal every value in `where`. Dates compare as dates, so a rule
// written as {{today}} (YYYY-MM-DD) matches a sheet that shows 10/3/2026.
export function pick(args: Record<string, unknown>): StepResult {
  const rows = typeof args.from === "string" ? rowsOf(args.from) : (args.from as Record<string, unknown>[] | undefined);
  if (!Array.isArray(rows)) return fail("data.pick needs rows in `from` (from an extract step's save_as)");
  const where = (args.where ?? {}) as Record<string, unknown>;
  const cell = (row: Record<string, unknown>, column: string) => {
    const key = Object.keys(row).find((k) => k.trim().toLowerCase() === column.trim().toLowerCase());
    return key === undefined ? undefined : String(row[key] ?? "");
  };
  const found = rows.filter((row) =>
    Object.entries(where).every(([column, wanted]) => same(cell(row, column), String(wanted))),
  );
  const row = args.pick === "last" ? found.at(-1) : found[0];
  const conditions = Object.entries(where)
    .map(([c, v]) => `${c} = ${v}`)
    .join(" and ");
  if (!row) return fail(`no row where ${conditions || "(no conditions)"}`);
  if (typeof args.column !== "string") return { ok: true, value: row };
  const value = cell(row, args.column);
  return value === undefined ? fail(`no column ${args.column}`) : { ok: true, value };
}

function same(actual: string | undefined, wanted: string): boolean {
  if (actual === undefined) return false;
  if (actual.trim().toLowerCase() === wanted.trim().toLowerCase()) return true;
  const a = asDates(actual);
  const w = asDates(wanted);
  return a.some((d) => w.includes(d));
}

// The ISO dates a cell could mean. 10/3/2026 is October 3 in the US and 10 March elsewhere: both are kept.
function asDates(text: string): string[] {
  const t = text.trim();
  const pad = (n: string | number) => String(n).padStart(2, "0");
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return [`${iso[1]}-${pad(iso[2] ?? "")}-${pad(iso[3] ?? "")}`];
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t);
  if (slash) {
    const [a = "", b = "", y = ""] = slash.slice(1);
    return [`${y}-${pad(a)}-${pad(b)}`, `${y}-${pad(b)}-${pad(a)}`];
  }
  const parsed = /[a-z]/i.test(t) ? new Date(t) : undefined;
  return parsed && !Number.isNaN(parsed.getTime())
    ? [`${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`]
    : [];
}

function parseAnswer(reply: string, output: Output): unknown {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (output === "number") {
    const n = Number(text.replace(/[^\d.-]/g, ""));
    return text && Number.isFinite(n) ? n : undefined;
  }
  if (output === "date") return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
  if (output === "json") {
    try {
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      return undefined;
    }
  }
  return text || undefined;
}
