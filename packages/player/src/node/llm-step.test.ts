import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LlmStep, Skill, type VarType } from "@shadow/core";
import { fakeLlm } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import { answerSchema, dataText, llmExecutor, pickProblem } from "./llm-step.ts";

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

// A's live run on 24 Oct: Hacker News's first 8 titles and points, and an empty notes page.
const titles = [
  "Kimi K3.1 Pro and K3.1 Pro Highspeed",
  "Twelve years of distributed SQLite",
  "Apple Music 404 Not Found",
  "How close can pure functional programming get to C?",
  "Local Wikipedia: Wikipedia, but only for things a half hour walk from you",
  "Dessa: Conversation Model trained only on speech",
  "A practical guide to AI image generation, from diffusion to agents",
  "Today, we hacked what we'd set out to hack: the iPhone",
];
const points = [
  "823 points",
  "109 points",
  "692 points",
  "34 points",
  "1331 points",
  "323 points",
  "20 points",
  "809 points",
];
const emptyNotes = ["My notes\nTitle  Value  Date  Currency \n—\nUSD\nEUR\nINR\n Save"];
const pick = "Select the first 3 Hacker News stories in the list's order whose titles are not already in the notes.";
const names = ["{{hn_titles}}", "{{hn_points}}", "{{notes_text}}"];
const story = (i: number) => ({ title: titles[i], points: points[i]?.split(" ")[0] });

describe("an AI step's pick, checked by code (A, 24 Oct: the run said it succeeded and saved the wrong stories)", () => {
  it("catches both wrong picks A's runs saved, and passes the right one", () => {
    const data = [titles, points, emptyNotes];
    expect(pickProblem(pick, data, [story(6), story(14 - 7), story(9 - 4)], names)).toMatch(/out of the list's order/);
    expect(pickProblem(pick, data, [story(1), story(2), story(3)], names)).toBe(
      'it left out item 1 of hn_titles ("Kimi K3.1 Pro and K3.1 Pro Highspeed"), which isn\'t in the rest of its data, and picked items 2, 3, 4',
    );
    expect(pickProblem(pick, data, [story(0), story(1), story(2)], names)).toBeUndefined();
  });

  it("lets it skip what the rest of its data holds: a saved story, even without the page's (domain)", () => {
    const saved = ["My notes\nKimi K3.1 Pro and K3.1 Pro Highspeed\t823"];
    const withDomain = [`${titles[0]} (kimi.ai)`, ...titles.slice(1)];
    expect(pickProblem(pick, [withDomain, points, saved], [story(1), story(2), story(3)], names)).toBeUndefined();
  });

  it("checks only picks of the first items, and page text by its order", () => {
    const kpi = "the subjects of KPI emails not already in the sheet"; // a filter may skip what doesn't match
    expect(pickProblem(kpi, [titles, emptyNotes], [story(4)], names)).toBeUndefined();
    const page = titles.map((t, i) => `${i + 1}. ${t}\n${points[i]}`).join("\n");
    expect(pickProblem(pick, [page], [story(2), story(0)])).toBe("its picks are out of the page's order");
    expect(pickProblem(pick, [page], [story(0), story(2)])).toBeUndefined();
  });

  it("asks once more, told what was wrong, then fails the step rather than save a wrong pick", async () => {
    const step3 = (answers: unknown[]) => {
      const replies = answers.map((a) => JSON.stringify({ answer: a }));
      return fakeLlm(replies);
    };
    const type = {
      type: "list",
      items: { type: "object", fields: { title: { type: "text" }, points: { type: "text" } } },
    };
    // As the runner hands it over: its inputs already resolved to the values they name.
    const s = {
      ...step(),
      instruction: pick,
      inputs: [titles, points, emptyNotes],
      output: { name: "stories", type },
    } as unknown as LlmStep;
    const fixed = step3([
      [story(1), story(2), story(3)],
      [story(0), story(1), story(2)],
    ]);
    expect(await llmExecutor({ llm: fixed })(s, ctx("p1"), names)).toEqual({
      ok: true,
      value: [story(0), story(1), story(2)],
    });
    expect(JSON.stringify(fixed.requests[1])).toContain("Your last answer was wrong: it left out item 1 of hn_titles");
    const stubborn = step3([
      [story(1), story(2), story(3)],
      [story(1), story(2), story(3)],
    ]);
    const out = await llmExecutor({ llm: stubborn })(s, ctx("p2"), names);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/^its pick is wrong, asked twice: it left out item 1/);
  });
});

describe("llm steps: one model call, capped, cached, typed", () => {
  it("shows each input under its name, a list numbered in its order (A, 24 Oct: items 7, 15, 10 for the top 3)", async () => {
    const values = [["Kimi K3.1 Pro", "Twelve years of SQLite"], ["822 points", "108 points"], "My notes"];
    expect(dataText(values, ["{{hn_titles}}", "{{ hn_points }}", "{{notes}}"])).toBe(
      "hn_titles:\n1. Kimi K3.1 Pro\n2. Twelve years of SQLite\n\nhn_points:\n1. 822 points\n2. 108 points\n\nnotes:\nMy notes",
    );
    // An input written with text around the reference has no single name: shown as it is.
    expect(dataText(["x"], ["Title: {{t}}"])).toBe("x");
    const llm = fakeLlm(() => '{"answer": 1}');
    await llmExecutor({ llm })(step(), ctx("r9"), ["{{rows}}"]);
    const sent = JSON.stringify(llm.requests[0]);
    expect(sent).toContain("rows:\\n");
    expect(sent).toContain('\\"top\\" and \\"first\\" mean the lowest numbers');
  });

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
