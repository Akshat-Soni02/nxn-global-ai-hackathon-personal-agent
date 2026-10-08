import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LlmStep, Skill } from "@taskplayer/core";
import { describe, expect, it } from "vitest";
import { llmExecutor, parseAnswer } from "./llm-step.ts";

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
      {
        id: "s1",
        type: "llm",
        intent: "Amount of today's row",
        instruction: "Amount of today's row",
        inputs: [JSON.stringify(rows)],
        output: { type: "number" },
        save_as: "amount",
        ...extra,
      },
    ],
  }).steps[0] as LlmStep;
const ctx = (runId: string) => ({ runId, startedAt: 0, inputs: {}, vars: {} });

describe("llm steps: one model call, capped, cached, typed", () => {
  it("caps calls per run, caps input size, caches answers, and checks the answer's type", async () => {
    let calls = 0;
    const ask = async () => {
      calls++;
      return "<think>today is 10/3</think> 1,234";
    };
    const run = llmExecutor({
      ask,
      cacheDir: mkdtempSync(join(tmpdir(), "tp-ai-")),
      limits: { maxCallsPerRun: 1, maxInputChars: 500 },
    });
    expect(await run(step(), ctx("r1"))).toEqual({ ok: true, value: 1234 });
    expect(await run(step(), ctx("r2"))).toEqual({ ok: true, value: 1234 }); // same question and data: from the cache
    expect(calls).toBe(1);
    expect((await run(step({ instruction: "something else" }), ctx("r1"))).error).toMatch(/already made 1 model calls/);
    expect((await run(step({ inputs: ["x".repeat(600)] }), ctx("r3"))).error).toMatch(/over the 500 limit/);
    // The same data on another day is a new question: "today's row" must not come from yesterday's answer.
    const tomorrow = { ...ctx("r6"), startedAt: Date.now() + 86_400_000 };
    let asked = "";
    const dated = llmExecutor({
      ask: async (_s, user) => {
        asked = user;
        return "990";
      },
      cacheDir: mkdtempSync(join(tmpdir(), "tp-ai-")),
    });
    await dated(step(), ctx("r7"));
    expect(await dated(step(), tomorrow)).toEqual({ ok: true, value: 990 });
    expect(asked).toMatch(/^Today is \d{4}-\d{2}-\d{2}\./);
    const wrong = llmExecutor({ ask: async () => "about twelve hundred" });
    expect((await wrong(step({ output: { type: "date" } }), ctx("r4"))).error).toMatch(/not a date as YYYY-MM-DD/);
    expect((await llmExecutor({})(step(), ctx("r5"))).error).toMatch(/need a model/);
  });

  it("checks objects and lists against their fields", () => {
    const kpis = { type: "object" as const, fields: { revenue: "number" as const, note: "text" as const } };
    expect(parseAnswer('```json\n{"revenue": "12,400", "note": "up", "extra": 1}\n```', kpis)).toEqual({
      revenue: 12400,
      note: "up",
    });
    expect(parseAnswer('{"note": "up"}', kpis)).toBeUndefined(); // revenue missing
    expect(parseAnswer('["a", "b"]', { type: "list", items: "text" })).toEqual(["a", "b"]);
    expect(parseAnswer('[{"ok": "yes"}]', { type: "list", fields: { ok: "boolean" } })).toEqual([{ ok: true }]);
    expect(parseAnswer("maybe", { type: "boolean" })).toBeUndefined();
  });
});
