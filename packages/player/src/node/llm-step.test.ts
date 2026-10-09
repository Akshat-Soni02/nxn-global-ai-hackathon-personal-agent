import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LlmStep, Skill, type VarType } from "@taskplayer/core";
import { fakeLlm } from "@taskplayer/llm";
import { describe, expect, it } from "vitest";
import { answerSchema, llmExecutor } from "./llm-step.ts";

const rows = [
  { Date: "10/2/2026", Client: "Acme", Amount: "1,180" },
  { Date: "10/3/2026", Client: "Globex", Amount: "1,234" },
];
const step = (extra: Partial<LlmStep> = {}): LlmStep =>
  Skill.parse({
    id: "t",
    name: "t",
    version: 1,
    description: { goal: "t" },
    steps: [
      { id: "start", type: "trigger", intent: "t" },
      {
        id: "s1",
        type: "llm",
        intent: "Amount of today's row",
        instruction: "Amount of today's row",
        inputs: [JSON.stringify(rows)],
        output: { name: "amount", type: { type: "number" } },
        ...extra,
      },
    ],
  }).steps[1] as LlmStep;
const ctx = (runId: string) => ({ runId, startedAt: 0, inputs: {}, vars: {} });

describe("llm steps: one model call, capped, cached, typed", () => {
  it("caps calls per run, caps input size, caches answers, and checks the answer's type", async () => {
    const llm = fakeLlm(() => '<think>today is 10/3</think> {"answer": "1,234"}');
    const run = llmExecutor({
      llm,
      cacheDir: mkdtempSync(join(tmpdir(), "tp-ai-")),
      limits: { maxCallsPerRun: 1, maxInputChars: 500 },
    });
    expect(await run(step(), ctx("r1"))).toEqual({ ok: true, value: 1234 });
    expect(await run(step(), ctx("r2"))).toEqual({ ok: true, value: 1234 }); // same question and data: from the cache
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]).toMatchObject({
      model: "nvidia/Nemotron-3_5-Lightning", // the fast profile
      response_format: { type: "json_schema", json_schema: { schema: { properties: { answer: { type: "number" } } } } },
    });
    expect((await run(step({ instruction: "something else" }), ctx("r1"))).error).toMatch(/already made 1 model calls/);
    expect((await run(step({ inputs: ["x".repeat(600)] }), ctx("r3"))).error).toMatch(/over the 500 limit/);
  });

  it("puts the run's date in the question and the cache key", async () => {
    // The same data on another day is a new question: "today's row" must not come from yesterday's answer.
    const llm = fakeLlm(['{"answer": 1180}', '{"answer": 990}']);
    const dated = llmExecutor({ llm, cacheDir: mkdtempSync(join(tmpdir(), "tp-ai-")) });
    await dated(step(), ctx("r7"));
    const tomorrow = { ...ctx("r6"), startedAt: Date.now() + 86_400_000 };
    expect(await dated(step(), tomorrow)).toEqual({ ok: true, value: 990 });
    const user = (llm.requests[1]?.messages as { content: string }[] | undefined)?.at(-1)?.content;
    expect(user).toMatch(/^Today is \d{4}-\d{2}-\d{2}\./);
  });

  it("fails clearly on an answer of the wrong type, and without a model", async () => {
    const wrong = llmExecutor({ llm: fakeLlm(() => '{"answer": "about twelve hundred"}') });
    expect((await wrong(step({ output: { name: "when", type: { type: "date" } } }), ctx("r4"))).error).toMatch(
      /"answer" must be date \(YYYY-MM-DD\)/,
    );
    expect((await llmExecutor({})(step(), ctx("r5"))).error).toMatch(/need a model/);
  });

  it("checks objects and lists against their fields", () => {
    const kpis = {
      type: "object" as const,
      fields: { revenue: { type: "number" as const }, note: { type: "text" as const } },
    };
    const fits = (type: VarType, answer: unknown) => answerSchema(type).check({ answer });
    expect(fits(kpis, { revenue: "12,400", note: "up", extra: 1 })).toEqual({
      ok: true,
      value: { revenue: 12400, note: "up" },
    });
    expect(fits(kpis, { note: "up" }).ok).toBe(false); // revenue missing
    expect(fits({ type: "list", items: { type: "text" } }, ["a", "b"])).toEqual({ ok: true, value: ["a", "b"] });
    expect(
      fits({ type: "list", items: { type: "object", fields: { ok: { type: "boolean" } } } }, [{ ok: "yes" }]),
    ).toEqual({ ok: true, value: [{ ok: true }] });
    expect(fits({ type: "boolean" }, "maybe").ok).toBe(false);
    expect(answerSchema(kpis).jsonSchema).toEqual({
      type: "object",
      properties: {
        answer: {
          type: "object",
          properties: { revenue: { type: "number" }, note: { type: "string" } },
          required: ["revenue", "note"],
          additionalProperties: false,
        },
      },
      required: ["answer"],
      additionalProperties: false,
    });
  });
});
