// The workflow interpreter: loops, branches, asks and approvals, with scopes. Channels are fakes that record what
// they were asked to do, after references were resolved.
import { type ActionStep, type Skill, Skill as SkillSchema, type Step } from "@taskplayer/core";
import { describe, expect, it } from "vitest";
import { evaluate } from "./conditions.ts";
import { runSkill } from "./run.ts";
import type { RunDeps, RunLogEvent, StepResult } from "./types.ts";

const T = { text: { type: "text" }, number: { type: "number" } } as const;
const row = { type: "object", fields: { name: T.text, amount: T.number } } as const;
const rows = { type: "list", items: row } as const;

const skill = (steps: unknown[], inputs: Record<string, unknown> = {}): Skill =>
  SkillSchema.parse({
    id: "t",
    name: "test",
    version: 1,
    description: { goal: "test" },
    steps: [{ id: "start", type: "trigger", intent: "by hand", inputs }, ...steps],
  });

// A step that "writes" its text: lets a test see which steps ran, with which values, in which order.
const write = (id: string, content: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "action",
  intent: `write ${content}`,
  channel: "fs",
  action: "write",
  args: { path: "~/out.txt", content },
  ...extra,
});
const read = (id: string, name: string, type: unknown = T.text) => ({
  id,
  type: "action",
  intent: "read",
  channel: "fs",
  action: "read",
  args: { path: `~/${name}.txt` },
  output: { name, type },
});
const loop = (id: string, over: string, item: unknown, steps: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  type: "control",
  kind: "loop",
  intent: "for each",
  over,
  item,
  steps,
  ...extra,
});
const branch = (id: string, condition: unknown, yes: unknown[], no: unknown[] = []) => ({
  id,
  type: "control",
  kind: "branch",
  intent: "if",
  if: condition,
  steps: yes,
  else: no,
});

function fake(results: Record<string, StepResult[]> = {}, overrides: Partial<RunDeps> = {}) {
  const wrote: string[] = [];
  const events: RunLogEvent[] = [];
  const channel = async (step: ActionStep) => {
    const scripted = results[step.id]?.shift();
    if (scripted) return scripted;
    if (step.action === "write") wrote.push(String(step.args.content));
    return { ok: true, value: step.action === "write" ? "~/out.txt" : undefined };
  };
  const deps: RunDeps = {
    web: channel,
    fs: channel,
    script: channel,
    fileExists: async () => true,
    webCheck: async () => true,
    approve: async () => true,
    log: (e) => events.push(e),
    ...overrides,
  };
  return { deps, wrote, events };
}

const people = [
  { name: "Acme", amount: 1200 },
  { name: "Globex", amount: 90 },
  { name: "Initech", amount: 5400 },
];

describe("loops", () => {
  it("runs its steps once per item, each with the item in scope", async () => {
    const s = skill([loop("l1", "{{list}}", { name: "p", type: row }, [write("s1", "{{p.name}}={{p.amount}}")])], {
      list: { type: rows },
    });
    const { deps, wrote, events } = fake();
    expect((await runSkill(s, deps, { inputs: { list: people } })).status).toBe("succeeded");
    expect(wrote).toEqual(["Acme=1200", "Globex=90", "Initech=5400"]);
    expect(events.filter((e) => e.type === "step.start").map((e) => (e as { path: string }).path)).toEqual([
      "l1[0] > s1",
      "l1[1] > s1",
      "l1[2] > s1",
    ]);
  });

  it("keeps what an item's steps produce inside that item", async () => {
    const s = skill(
      [loop("l1", "{{list}}", { name: "p", type: row }, [read("s1", "note"), write("s2", "{{p.name}}: {{note}}")])],
      { list: { type: rows } },
    );
    const { deps, wrote } = fake({
      s1: [
        { ok: true, value: "first" },
        { ok: true, value: "second" },
        { ok: true, value: "third" },
      ],
    });
    await runSkill(s, deps, { inputs: { list: people } });
    expect(wrote).toEqual(["Acme: first", "Globex: second", "Initech: third"]);
    // The save-time check refuses using {{note}} after the loop: it only exists inside an item.
    expect(() =>
      skill([loop("l1", "{{list}}", { name: "p", type: row }, [read("s1", "note")]), write("s2", "{{note}}")], {
        list: { type: rows },
      }),
    ).toThrow("note, which is not declared by an earlier step");
  });

  it("stops at the first failing item, or skips it and goes on", async () => {
    const steps = (onFail: string) => [
      loop("l1", "{{list}}", { name: "p", type: row }, [write("s1", "{{p.name}}")], { on_item_fail: onFail }),
    ];
    const failSecond = () => ({ s1: [{ ok: true }, { ok: false, error: "disk full" }] });
    const stop = fake(failSecond());
    expect(
      await runSkill(skill(steps("stop"), { list: { type: rows } }), stop.deps, { inputs: { list: people } }),
    ).toMatchObject({
      status: "failed",
      failedStep: "l1[1] > s1",
      error: "disk full",
    });
    const skip = fake(failSecond());
    expect(
      (await runSkill(skill(steps("skip"), { list: { type: rows } }), skip.deps, { inputs: { list: people } })).status,
    ).toBe("succeeded");
    expect(skip.wrote).toEqual(["Initech"]);
    expect(skip.events.find((e) => e.type === "loop.item_failed")).toMatchObject({
      index: 1,
      error: "l1[1] > s1: disk full",
    });
  });

  it("refuses a list longer than max_items, or an item of the wrong type", async () => {
    const s = (max: number) =>
      skill([loop("l1", "{{list}}", { name: "p", type: row }, [write("s1", "x")], { max_items: max })], {
        list: { type: rows },
      });
    expect(await runSkill(s(2), fake().deps, { inputs: { list: people } })).toMatchObject({
      status: "failed",
      failedStep: "l1",
      error: "{{list}} has 3 items, more than this loop's max_items (2)",
    });
    expect(await runSkill(s(5), fake().deps, { inputs: { list: [{ name: "Acme" }] } })).toMatchObject({
      failedStep: "l1[0]",
      error: "item 0 is not { name: text, amount: number }",
    });
  });

  it("runs loops inside loops, and names each step by where it ran", async () => {
    const grid = { type: "list", items: { type: "list", items: T.text } };
    const s = skill(
      [
        loop("l1", "{{grid}}", { name: "r", type: { type: "list", items: T.text } }, [
          loop("l2", "{{r}}", { name: "cell", type: T.text }, [write("s1", "{{cell}}")]),
        ]),
      ],
      { grid: { type: grid } },
    );
    const { deps, wrote, events } = fake();
    await runSkill(s, deps, { inputs: { grid: [["a", "b"], ["c"]] } });
    expect(wrote).toEqual(["a", "b", "c"]);
    expect(events.filter((e) => e.type === "step.start").map((e) => (e as { path: string }).path)).toEqual([
      "l1[0] > l2[0] > s1",
      "l1[0] > l2[1] > s1",
      "l1[1] > l2[0] > s1",
    ]);
  });

  it("asks for approval once for the loop, and for a step inside it once per item", async () => {
    const asked: string[] = [];
    const deps = fake(
      {},
      {
        approve: async (step: Step) => {
          asked.push(step.id);
          return true;
        },
      },
    ).deps;
    const s = skill(
      [
        loop("l1", "{{list}}", { name: "p", type: row }, [write("s1", "{{p.name}}", { requires_approval: true })], {
          requires_approval: true,
        }),
      ],
      { list: { type: rows } },
    );
    await runSkill(s, deps, { inputs: { list: people } });
    expect(asked).toEqual(["l1", "s1", "s1", "s1"]);
  });

  it("stops on a denial even when the loop skips failures", async () => {
    let n = 0;
    const deps = fake({}, { approve: async () => ++n !== 2 }).deps;
    const s = skill(
      [
        loop("l1", "{{list}}", { name: "p", type: row }, [write("s1", "{{p.name}}", { requires_approval: true })], {
          on_item_fail: "skip",
        }),
      ],
      { list: { type: rows } },
    );
    expect(await runSkill(s, deps, { inputs: { list: people } })).toMatchObject({
      status: "denied",
      failedStep: "l1[1] > s1",
    });
  });
});

describe("branches", () => {
  const big = { left: "{{p.amount}}", op: "greater_than", right: "{{threshold}}" };

  it("runs its steps when the condition holds, its else steps otherwise", async () => {
    const s = skill(
      [
        loop("l1", "{{list}}", { name: "p", type: row }, [
          branch("b1", big, [write("s1", "big {{p.name}}")], [write("s2", "small {{p.name}}")]),
        ]),
      ],
      { list: { type: rows }, threshold: { type: T.number, default: 1000 } },
    );
    const { deps, wrote, events } = fake();
    await runSkill(s, deps, { inputs: { list: people, threshold: 1000 } });
    expect(wrote).toEqual(["big Acme", "small Globex", "big Initech"]);
    expect(events.filter((e) => e.type === "branch").map((e) => (e as { took: string }).took)).toEqual([
      "steps",
      "else",
      "steps",
    ]);
  });

  it("keeps a variable after the branch only when both arms produce it", async () => {
    const s = skill(
      [
        branch("b1", { left: "{{n}}", op: "greater_than", right: 1 }, [read("s1", "label")], [read("s2", "label")]),
        write("s3", "label is {{label}}"),
      ],
      { n: { type: T.number } },
    );
    const { deps, wrote } = fake({ s2: [{ ok: true, value: "from else" }] });
    await runSkill(s, deps, { inputs: { n: 0 } });
    expect(wrote).toEqual(["label is from else"]);
  });

  it("fails clearly when the condition cannot be decided", async () => {
    const s = skill([branch("b1", { left: "{{n}}", op: "greater_than", right: 1 }, [write("s1", "x")])], {
      n: { type: T.text },
    });
    expect(await runSkill(s, fake().deps, { inputs: { n: "many" } })).toMatchObject({
      failedStep: "b1",
      error: 'cannot compare "many" with 1: use numbers or YYYY-MM-DD dates',
    });
  });
});

describe("asks", () => {
  it("saves a value answer, typed, for the step itself and later steps", async () => {
    const ask = { question: "How many hours this week?", output: { name: "hours", type: T.number } };
    const s = skill([write("s1", "hours: {{hours}}", { ask }), write("s2", "again {{hours}}")]);
    const { deps, wrote, events } = fake({}, { ask: async () => "38" });
    await runSkill(s, deps, { inputs: {} });
    expect(wrote).toEqual(["hours: 38", "again 38"]);
    expect(events.find((e) => e.type === "step.ask")).toMatchObject({
      question: "How many hours this week?",
      answer: "38",
    });
  });

  it("runs a confirmed step, skips one you say no to, and refuses an answer of the wrong type", async () => {
    const confirm = (id: string) => write(id, id, { ask: { question: "Send {{who}}?", kind: "confirm" } });
    const s = skill([confirm("s1"), confirm("s2")], { who: { type: T.text } });
    let n = 0;
    const { deps, wrote, events } = fake({}, { ask: async () => ++n === 1 });
    await runSkill(s, deps, { inputs: { who: "Acme" } });
    expect(wrote).toEqual(["s1"]);
    expect(events.find((e) => e.type === "step.ask")).toMatchObject({ question: "Send Acme?" });
    expect(events.find((e) => e.type === "step.skipped")).toMatchObject({ stepId: "s2", reason: "you said no" });

    const typed = skill([
      write("s1", "{{hours}}", { ask: { question: "Hours?", output: { name: "hours", type: T.number } } }),
    ]);
    expect(await runSkill(typed, fake({}, { ask: async () => "lots" }).deps, { inputs: {} })).toMatchObject({
      failedStep: "s1",
      error: 'the answer "lots" is not number',
    });
  });

  it("never guesses: without a way to ask, the run stops at the question", async () => {
    const s = skill([write("s1", "x", { ask: { question: "Which plan?", output: { name: "plan", type: T.text } } })]);
    expect(await runSkill(s, fake().deps, { inputs: {} })).toMatchObject({
      status: "failed",
      failedStep: "s1",
      error: 'needs an answer from you: "Which plan?"',
    });
  });
});

describe("pause and resume", () => {
  const inbox = skill(
    [
      write("s1", "start"),
      loop("l1", "{{people}}", { name: "p", type: row }, [
        write("s2", "{{p.name}}"),
        branch(
          "b1",
          { left: "{{p.amount}}", op: "greater_than", right: 1000 },
          [write("s3", "big {{p.name}}")],
          [write("s4", "small {{p.name}}")],
        ),
      ]),
      write("s5", "end"),
    ],
    { people: { type: rows } },
  );

  it("pauses at a failed step when asked to, keeping its position and variables", async () => {
    const failed: string[] = [];
    const { deps, wrote } = fake(
      { s3: [{ ok: false, error: "target not found" }] },
      {
        onFailure: (f) => {
          failed.push(`${f.path}: ${f.result.error} (${f.attempts} attempt)`);
          return "pause";
        },
      },
    );
    const outcome = await runSkill(inbox, deps, { inputs: { people } });
    expect(failed).toEqual(["l1[0] > s3: target not found (1 attempt)"]);
    expect(outcome).toMatchObject({
      status: "paused",
      pausedBy: "failure",
      failedStep: "l1[0] > s3",
      resume: { at: "l1[0] > s3", vars: { p: people[0] } },
      failure: { step: { args: { content: "big Acme" } } },
    });
    expect(wrote).toEqual(["start", "Acme"]);
  });

  it("resumes at the position, inside the loop item and branch arm, without asking again", async () => {
    const { deps, wrote, events } = fake();
    const outcome = await runSkill(inbox, deps, {
      inputs: { people },
      resume: { at: "l1[0] > s3", vars: { people, p: people[0] } },
    });
    expect(outcome.status).toBe("succeeded");
    // s3 for Acme, then the rest of the loop and the run.
    expect(wrote).toEqual(["big Acme", "Globex", "small Globex", "Initech", "big Initech", "end"]);
    expect(events[0]).toMatchObject({ type: "run.start", resumedAt: "l1[0] > s3" });
    expect(events.filter((e) => e.type === "loop.start")).toEqual([]); // not started again
  });

  it("resumes on a repaired version with an inserted step, at a loop item, or fails clearly", async () => {
    const repaired = skill(
      [
        write("s1", "start"),
        loop("l1", "{{people}}", { name: "p", type: row }, [
          write("s2", "{{p.name}}"),
          write("s6", "dismissed banner"),
          write("s3", "big {{p.name}}"),
        ]),
      ],
      { people: { type: rows } },
    );
    const a = fake();
    await runSkill(repaired, a.deps, { inputs: {}, resume: { at: "l1[1] > s6", vars: { people, p: people[1] } } });
    expect(a.wrote).toEqual(["dismissed banner", "big Globex", "Initech", "dismissed banner", "big Initech"]);

    const b = fake();
    await runSkill(repaired, b.deps, { inputs: {}, resume: { at: "l1[2]", vars: { people } } });
    expect(b.wrote).toEqual(["Initech", "dismissed banner", "big Initech"]);

    const c = fake();
    expect(await runSkill(repaired, c.deps, { inputs: {}, resume: { at: "l1[0] > s9", vars: {} } })).toMatchObject({
      status: "failed",
      error: "can't resume at l1[0] > s9: version 1 has no step s9",
    });
    expect(await runSkill(repaired, c.deps, { inputs: {}, resume: { at: "s3", vars: {} } })).toMatchObject({
      error: expect.stringMatching(/inside loop l1, and the position doesn't say which item/),
    });
  });

  it("handles a failure as before when onFailure says so, so a loop can skip it", async () => {
    const { deps, wrote } = fake({ s2: [{ ok: false, error: "bad file" }] }, { onFailure: () => "fail" });
    const skipping = skill(
      [loop("l1", "{{people}}", { name: "p", type: row }, [write("s2", "{{p.name}}")], { on_item_fail: "skip" })],
      { people: { type: rows } },
    );
    expect((await runSkill(skipping, deps, { inputs: { people } })).status).toBe("succeeded");
    expect(wrote).toEqual(["Globex", "Initech"]);
  });

  it("goes on after a step the user did by hand, unless later steps need its output", async () => {
    const { deps, wrote, events } = fake();
    await runSkill(inbox, deps, {
      inputs: {},
      resume: { at: "l1[2] > s3", vars: { people, p: people[2] }, skip: true },
    });
    expect(wrote).toEqual(["end"]);
    expect(events.find((e) => e.type === "step.skipped")).toMatchObject({ path: "l1[2] > s3", reason: "done by hand" });
    const reads = skill([read("s1", "note"), write("s2", "{{note}}")]);
    expect(
      await runSkill(reads, fake().deps, { inputs: {}, resume: { at: "s1", vars: {}, skip: true } }),
    ).toMatchObject({
      status: "failed",
      error: "s1 produces note, so it can't be done by hand and skipped",
    });
  });

  it("pauses after maxSteps and says where to go on", async () => {
    const { deps, wrote } = fake();
    const outcome = await runSkill(inbox, deps, {
      inputs: {},
      resume: { at: "l1[1] > s2", vars: { people, p: people[1] } },
      maxSteps: 2,
    });
    expect(wrote).toEqual(["Globex", "small Globex"]);
    expect(outcome).toMatchObject({
      status: "paused",
      pausedBy: "step_limit",
      resume: { at: "l1[2] > s2", vars: { p: people[2] } },
    });
  });
});

describe("conditions", () => {
  const vars = { n: "1,234", d: "2026-10-09", tags: ["urgent", "billing"], name: "Acme Corp", empty: "" };
  const cases: [unknown, boolean][] = [
    [{ left: "{{n}}", op: "greater_than", right: 1000 }, true],
    [{ left: "{{n}}", op: "equals", right: 1234 }, true],
    [{ left: "{{d}}", op: "less_than", right: "2026-12-01" }, true],
    [{ left: "{{tags}}", op: "contains", right: "urgent" }, true],
    [{ left: "{{name}}", op: "contains", right: "acme" }, true],
    [{ left: "{{empty}}", op: "exists" }, false],
    [{ left: "{{missing}}", op: "not_exists" }, true],
    [
      {
        all: [
          { left: "{{n}}", op: "greater_than", right: 1 },
          { not: { left: "{{tags}}", op: "contains", right: "spam" } },
        ],
      },
      true,
    ],
    [
      {
        any: [
          { left: "{{name}}", op: "equals", right: "Globex" },
          { left: "{{d}}", op: "equals", right: "2026-10-09" },
        ],
      },
      true,
    ],
  ];
  for (const [condition, expected] of cases) {
    it(`${JSON.stringify(condition)} is ${expected}`, () => {
      expect(evaluate(condition as never, vars)).toBe(expected);
    });
  }
});
