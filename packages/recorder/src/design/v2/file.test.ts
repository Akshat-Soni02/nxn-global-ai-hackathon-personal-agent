import type { AnyTool } from "@shadow/agent";
import { applyEdits, findStep, Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { HIDE_IDENTIFIERS } from "../../mask.ts";
import type { DoneReport } from "./contracts.ts";
import { lostWork } from "./gate.ts";
import { newSession, type SessionV2 } from "./session.ts";
import { designToolsV2, pagesOfSteps, workflowFile } from "./tools.ts";

const INBOX = "https://mail.example.com/inbox";
const recorded = Skill.parse({
  id: "kpi",
  name: "kpi",
  version: 1,
  description: { goal: "today's numbers into the KPI sheet" },
  steps: [
    { id: "start", type: "trigger", intent: "by hand", inputs: {} },
    { id: "s1", type: "action", intent: "open the inbox", channel: "web", action: "navigate", args: { url: INBOX } },
    {
      id: "s2",
      type: "action",
      intent: "open the Acme report",
      channel: "web",
      action: "click",
      target: { role: "link", name: "Acme report", fallbacks: [] },
    },
    {
      id: "s3",
      type: "action",
      intent: "type the date",
      channel: "web",
      action: "type",
      target: { role: "textbox", name: "Date", fallbacks: [] },
      args: { text: "19 Oct" },
    },
  ],
});

const session = (maskTerms: string[] = []) =>
  newSession(recorded, { pages: [INBOX], folders: [] }, { pages: new Map([["s1", INBOX]]), maskTerms });
const run = async (s: SessionV2, name: string, input: unknown) => {
  const t = designToolsV2(s, { mode: "file" }).find((x) => x.name === name) as AnyTool<DoneReport>;
  const parsed = t.input.safeParse(t.prepare ? t.prepare(input) : input);
  if (!parsed.success) throw new Error(parsed.error.message);
  return (await t.run(parsed.data, { turn: 1 })).output as { ok?: boolean; problems?: string[] } & Record<
    string,
    unknown
  >;
};
const steps = (s: SessionV2) => (JSON.parse(workflowFile(s.draft)) as { steps: unknown[] }).steps;

describe("the workflow as a file", () => {
  it("has the file tools, and the verbs only for looking, testing, asking and finishing", () => {
    const names = designToolsV2(session(), { mode: "file" }).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["read_workflow", "write_workflow", "edit_workflow", "test", "done"]));
    expect(names).not.toContain("add");
    expect(names).not.toContain("loop");
    expect(designToolsV2(session()).map((t) => t.name)).not.toContain("write_workflow");
  });

  it("reads it whole, or one step", async () => {
    const s = session();
    expect(await run(s, "read_workflow", {})).toBe(workflowFile(s.draft));
    expect(JSON.parse(String(await run(s, "read_workflow", { step: "s3" })))).toMatchObject({ id: "s3" });
  });

  it("edits by exact text, and says where it missed", async () => {
    const s = session();
    const done = await run(s, "edit_workflow", {
      edits: [{ old: '"text": "19 Oct"', new: '"text": "{{today|D MMM}}"' }],
      why: "the date typed is the day it runs",
    });
    expect(done.ok).toBe(true);
    expect(findStep(s.draft, "s3")).toMatchObject({ args: { text: "{{today|D MMM}}" } });
    expect(s.whys.get("s3")).toBe("the date typed is the day it runs");

    const missed = await run(s, "edit_workflow", { edits: [{ old: '"text":"{{today}}"', new: "x" }], why: "y" });
    expect(missed.problems?.[0]).toContain("The nearest line");
    const twice = await run(s, "edit_workflow", { edits: [{ old: '"fallbacks": []', new: "x" }], why: "y" });
    expect(twice.problems?.[0]).toContain("appears 2 times");
    // Broken JSON changes nothing.
    const broken = await run(s, "edit_workflow", { edits: [{ old: '"id": "s3",', new: '"id": "s3"' }], why: "y" });
    expect(broken.ok).toBe(false);
    expect(findStep(s.draft, "s3")).toBeDefined();
  });

  it("writes it whole with the short forms: pages by name, controls by step, an AI step and a loop over its list", async () => {
    const s = session();
    const [trigger, s1, s2, s3] = steps(s) as Record<string, unknown>[];
    const written = await run(s, "write_workflow", {
      workflow: {
        steps: [
          { ...trigger, when: "0 9 * * 1-5" },
          { do: "open", intent: "open the inbox", page: "s1" },
          {
            do: "read_all",
            intent: "read the subjects",
            target: { like: "s2" },
            save_as: "subjects",
            why: "the subjects to pick from",
          },
          {
            instruction: "the subjects of KPI emails, in the list's order",
            inputs: ["{{subjects}}"],
            output: { name: "reports", type: "list" },
          },
          { over: "{{reports}}", item: "report", steps: [{ ...s2, intent: "open {{report}}" }, s3], why: "each one" },
        ],
      },
      why: "every report, each weekday morning",
    });
    expect(written.problems).toBeUndefined();
    expect(written.ok).toBe(true);
    expect(s.draft.steps[0]).toMatchObject({ when: [{ type: "schedule", cron: "0 9 * * 1-5" }] });
    expect(s.draft.steps[1]).toMatchObject({ action: "navigate", args: { url: INBOX } });
    expect(s.draft.steps[2]).toMatchObject({ action: "extract", output: { name: "subjects" } });
    // Only the action's values in its args, never the step's own fields (the fifth YC design).
    expect(Object.keys((s.draft.steps[2] as { args: object }).args)).not.toContain("id");
    expect(s.draft.steps[3]).toMatchObject({ type: "llm", output: { type: { type: "list" } } });
    const loop = s.draft.steps[4] as { kind: string; item: unknown; steps: { id: string }[] };
    // The item has the type of the AI step's list, made in the same write.
    const listed = (s.draft.steps[3] as { output: { type: { items: unknown } } }).output.type.items;
    expect(loop).toMatchObject({ kind: "loop", item: { name: "report", type: listed } });
    expect(loop.steps.map((x) => x.id)).toEqual(["s2", "s3"]);
    expect(s.whys.get(s.draft.steps[2]?.id ?? "")).toBe("the subjects to pick from");
    // s1 was rewritten as a new step: the recorded one is gone with the change's why, so no work is lost.
    expect(lostWork(recorded, s.draft, s.whys)).toEqual([]);
    void s1;
  });

  it('makes an AI step\'s bare input names references (the second YC design wrote inputs: ["yc_page"])', async () => {
    const s = session();
    const [trigger, s1] = steps(s) as Record<string, unknown>[];
    const written = await run(s, "write_workflow", {
      workflow: {
        steps: [
          trigger,
          s1,
          { do: "read", intent: "read the inbox", save_as: "inbox" },
          {
            instruction: "the Acme reports in the inbox",
            inputs: ["inbox", "only Acme's"],
            output: { name: "acme", type: "list" },
          },
        ],
      },
      why: "x",
    });
    expect(written.problems).toBeUndefined();
    const step = s.draft.steps.find((x) => x.type === "llm") as { inputs: string[] };
    // A name becomes a reference; words stay words.
    expect(step.inputs).toEqual(["{{inbox}}", "only Acme's"]);
  });

  it("settles how the second YC re-design wrote things: success as a step, JSON-Schema types (28 Oct)", async () => {
    const s = session();
    const [trigger, s1] = steps(s) as Record<string, unknown>[];
    const written = await run(s, "write_workflow", {
      workflow: {
        steps: [
          trigger,
          s1,
          { do: "read", intent: "read the inbox", save_as: "inbox" },
          {
            instruction: "the Acme reports in the inbox",
            inputs: ["{{inbox}}"],
            output: {
              name: "acme",
              type: { type: "array", items: { type: "object", properties: { title: { type: "string" } } } },
            },
          },
          { id: "success", type: "control", intent: "Success", requires_approval: false, steps: [] },
          "success",
        ],
      },
      why: "x",
    });
    expect(written.problems).toBeUndefined();
    expect(s.draft.steps.some((x) => x.id === "success")).toBe(false);
    const ai = s.draft.steps.find((x) => x.type === "llm") as { output: { type: unknown } };
    expect(ai.output.type).toEqual({ type: "list", items: { type: "object", fields: { title: { type: "text" } } } });
  });

  it("settles how the fourth YC re-design wrote names and ends (28 Oct): camelCase names, an end marker", async () => {
    const s = session();
    const [trigger, s1] = steps(s) as Record<string, unknown>[];
    const written = await run(s, "write_workflow", {
      workflow: {
        steps: [
          trigger,
          s1,
          { do: "read", intent: "read the inbox", save_as: "inboxText" },
          {
            instruction: "the Acme reports in the inbox",
            inputs: ["{{inboxText}}"],
            output: { name: "newReports", type: "list" },
          },
          { over: "{{newReports}}", item: "report", steps: ["s2"] },
          { id: "end", type: "control", intent: "Done", steps: [] },
        ],
      },
      why: "x",
    });
    expect(written.problems).toBeUndefined();
    const text = JSON.stringify(s.draft.steps);
    expect(text).toContain('"inputs":["{{inbox_text}}"]');
    expect(text).toContain('"over":"{{new_reports}}"');
    expect(text).not.toMatch(/inboxText|newReports|"id":"end"/);
  });

  it("takes what the YC design wrote (Oct 25): steps named by id in a loop, a cron as expr, a bad JSON string said so", async () => {
    const s = session();
    const [trigger, s1] = steps(s) as Record<string, unknown>[];
    const written = await run(s, "write_workflow", {
      workflow: {
        steps: [
          { ...trigger, when: [{ type: "schedule", expr: "0 9 * * *" }] },
          s1,
          { do: "read_all", intent: "read the reports", target: { like: "s2" }, save_as: "reports" },
          { over: "{{reports}}", item: "report", steps: ["s2", "s3"] },
        ],
      },
      why: "each report, each morning",
    });
    expect(written.problems).toBeUndefined();
    expect(s.draft.steps[0]).toMatchObject({ when: [{ type: "schedule", cron: "0 9 * * *" }] });
    expect((s.draft.steps[3] as { steps: { id: string }[] }).steps.map((x) => x.id)).toEqual(["s2", "s3"]);

    const unknownId = await run(session(), "write_workflow", {
      workflow: { steps: [s1, { over: "{{x}}", item: "y", steps: ["s9"] }] },
      why: "x",
    });
    expect(unknownId.problems?.[0]).toContain("no step s9");
    const text = await run(session(), "write_workflow", { workflow: '{"steps": [{"id": "s1",}]}', why: "x" });
    expect(text.problems?.[0]).toMatch(/isn't valid JSON .*near/);
  });

  it("takes the full form written with short names (the second YC design): cron triggers, ai_step, read_all", async () => {
    const s = session();
    const [trigger, s1] = steps(s) as Record<string, unknown>[];
    const written = await run(s, "write_workflow", {
      workflow: {
        steps: [
          { ...trigger, when: [{ type: "cron", expr: "0 9 * * *" }] },
          s1,
          {
            id: "read_jobs",
            type: "action",
            channel: "web",
            action: "read_all",
            intent: "read the list",
            target: { like: "s2" },
            save_as: "jobs",
          },
          {
            id: "pick",
            type: "ai_step",
            intent: "pick",
            instruction: "the new ones, in the list's order",
            inputs: ["{{jobs}}"],
            output: { name: "top", type: "list" },
          },
        ],
      },
      why: "x",
    });
    expect(written.problems).toBeUndefined();
    expect(s.draft.steps[0]).toMatchObject({ when: [{ type: "schedule", cron: "0 9 * * *" }] });
    expect(s.draft.steps[2]).toMatchObject({ channel: "web", action: "extract" });
    expect(s.draft.steps[3]).toMatchObject({ type: "llm" });
  });

  it("asks a question about a step written as words about the start, and cuts a long done summary", async () => {
    const s = session();
    const asked = await run(s, "ask", { question: "How many jobs?", why: "x", step: "after opening the jobs page" });
    expect(asked).toMatchObject({ queued: "q1" });
    expect(String(asked.note)).toContain("asked about the start");
    expect(s.questions[0]?.step).toBe("start");
    const t = designToolsV2(s, { mode: "file" }).find((x) => x.name === "done") as AnyTool<DoneReport>;
    const long = t.prepare?.({ summary: "x".repeat(700), rules: [] }) as { summary: string };
    expect(t.input.safeParse(long).success).toBe(true);
  });

  it("always says why, and explains a step left out earlier by id (the third YC design)", async () => {
    const s = session();
    const t = designToolsV2(s, { mode: "file" }).find((x) => x.name === "write_workflow") as AnyTool<DoneReport>;
    expect(t.input.safeParse({ workflow: { steps: [] } }).success).toBe(false);
    const [trigger, s1, s2] = steps(s) as Record<string, unknown>[];
    // s3 replaced by typing into the row's cell, named from a value: its work is kept, and its removal is said.
    const typing = {
      id: "type_date",
      do: "type",
      intent: "type the date in the row",
      target: { role: "textbox", name: "Date {{row}}" },
      text: "{{today|D MMM}}",
    };
    const row = {
      instruction: "the row number to type in: 4",
      inputs: [],
      output: { name: "row", type: "number" },
    };
    const left = await run(s, "write_workflow", {
      workflow: { steps: [trigger, s1, s2, row, typing] },
      why: "the row",
    });
    expect(left.problems).toBeUndefined();
    expect(left.recorded_steps_left_out).toEqual(["s3"]);
    const again = steps(s);
    await run(s, "write_workflow", {
      workflow: { steps: again },
      why: "no change",
      whys: { s3: "the date is typed by the new step" },
    });
    expect(s.whys.get("s3")).toBe("the date is typed by the new step");
    expect(lostWork(recorded, s.draft, s.whys)).toEqual([]);
  });

  it("shows blocks folded to their steps' ids, and takes them back whole (R5)", async () => {
    const s = session();
    const [trigger, s1, s2, s3] = steps(s) as Record<string, unknown>[];
    // A block made with the short form, its steps by id.
    const made = await run(s, "write_workflow", {
      workflow: { steps: [trigger, { block: "Open the reports", steps: ["s1", "s2"] }, s3] },
      why: "one thing on the page",
    });
    expect(made.problems).toBeUndefined();
    const shown = JSON.parse(String(await run(s, "read_workflow", {}))) as { steps: { steps?: unknown[] }[] };
    expect(shown.steps[1]).toMatchObject({ kind: "group", intent: "Open the reports", steps: ["s1", "s2"] });
    // Written back as read: nothing changes, nothing is lost.
    const same = await run(s, "write_workflow", { workflow: shown, why: "as it is" });
    expect(String(same.note ?? "")).toMatch(/nothing changed/);
    expect(findStep(s.draft, "s2")).toMatchObject({ target: { name: "Acme report" } });
    // An edit quoting a step inside the block (read with read_workflow { step }) is found in the full text.
    const edited = await run(s, "edit_workflow", {
      edits: [{ old: '"intent": "open the Acme report"', new: '"intent": "open the newest report"' }],
      why: "the newest",
    });
    expect(edited.ok).toBe(true);
    expect(findStep(s.draft, "s2")).toMatchObject({ intent: "open the newest report" });
    void s1;
    void s2;
  });

  it("drops a block whose steps were all taken out", async () => {
    const s = session();
    const [trigger, , , s3] = steps(s) as Record<string, unknown>[];
    await run(s, "write_workflow", {
      workflow: { steps: [trigger, { block: "Open", steps: ["s1", "s2"] }, s3] },
      why: "x",
    });
    const removed = applyEdits(s.draft, [
      { op: "remove", step: "s1" },
      { op: "remove", step: "s2" },
    ]);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.skill.steps.map((x) => x.id)).toEqual(["start", "s3"]);
  });

  it("says which page each step it wrote works on, and fills an empty intent (the Oct 27 YC design)", async () => {
    const s = session();
    const [trigger, s1] = steps(s) as Record<string, unknown>[];
    const written = await run(s, "write_workflow", {
      workflow: {
        steps: [
          trigger,
          s1,
          { do: "open", intent: "", page: "s1" },
          { do: "read_all", intent: "", target: { css: ".job" }, save_as: "jobs" },
        ],
      },
      why: "x",
    });
    expect(written.problems).toBeUndefined();
    expect(String(written.works_on)).toMatch(/reads mail\.example\.com \(the page \w+ opened\)/);
    const read = s.draft.steps.at(-1) as { intent: string };
    expect(read.intent).toBe("read all .job");
    expect(pagesOfSteps(session().draft, new Set(["s3"]))).toEqual([
      "s3 types on mail.example.com (the page s1 opened)",
    ]);
  });

  it("names the step a problem is in, with what it does", async () => {
    const s = session();
    const [trigger, s1] = steps(s) as Record<string, unknown>[];
    const bad = await run(s, "write_workflow", {
      workflow: {
        steps: [trigger, s1, { id: "s7", type: "action", intent: "x", channel: "web", action: "hover", args: {} }],
      },
      why: "x",
    });
    expect(bad.problems?.join(" ")).toContain("s7 (web.hover)");
  });

  it("says what's wrong, by path, and changes nothing", async () => {
    const s = session();
    const before = workflowFile(s.draft);
    const bad = await run(s, "write_workflow", {
      workflow: { steps: [{ id: "s9", type: "action", channel: "web", action: "click" }] },
      why: "x",
    });
    expect(bad.ok).toBe(false);
    expect(bad.problems?.join(" ")).toMatch(/s9 \(web\.click\), intent/);
    expect(workflowFile(s.draft)).toBe(before);
    expect((await run(s, "write_workflow", { workflow: "nonsense", why: "x" })).ok).toBe(false);
    // A default the runner wouldn't fill, as the input tool refuses it.
    const templated = await run(s, "edit_workflow", {
      edits: [
        { old: '"inputs": {}', new: '"inputs": { "day": { "type": { "type": "text" }, "default": "{{today}}" } }' },
      ],
      why: "x",
    });
    expect(templated.problems?.[0]).toContain("a default can't be a {{…}} value");
  });

  it("keeps a private value it was shown masked, and refuses one it can't place", async () => {
    const s = session(["Acme"]);
    const shown = String(await run(s, "read_workflow", {}));
    expect(shown).toContain("███ report");
    expect(shown).not.toContain("Acme");
    // An edit elsewhere, in a stretch of text that holds the masked value: the real one is kept.
    const edited = await run(s, "edit_workflow", {
      edits: [
        { old: '"intent": "open the ███ report",', new: '"intent": "open the ███ report", "timeout_ms": 20000,' },
      ],
      why: "the page is slow",
    });
    expect(edited.ok).toBe(true);
    expect(findStep(s.draft, "s2")).toMatchObject({ target: { name: "Acme report" }, timeout_ms: 20000 });
    // ███ in a new value would be typed into the page as it is.
    const typed = await run(s, "edit_workflow", {
      edits: [{ old: '"text": "19 Oct"', new: '"text": "███ 19 Oct"' }],
      why: "x",
    });
    expect(typed.ok).toBe(false);
    expect(typed.problems?.[0]).toContain("private value");
  });
});

describe('the trigger as a model writes it (28 Oct, the YC design: refused four times for "a step, type: Invalid input")', () => {
  const withTrigger = (trigger: Record<string, unknown>, s = session()) => {
    const [, ...rest] = steps(s);
    return run(s, "write_workflow", {
      workflow: { steps: [{ id: "start", type: "trigger", intent: "daily", ...trigger }, ...rest] },
      why: "daily",
    });
  };

  it("takes an input's type as a word, and a bare word for the whole input", async () => {
    const s = session();
    const out = await withTrigger(
      {
        when: [{ type: "cron", expression: "0 9 * * *" }],
        inputs: { count: { type: "number", default: 5 }, label: "text" },
      },
      s,
    );
    expect(out.problems).toBeUndefined();
    expect((steps(s)[0] as { inputs: unknown }).inputs).toEqual({
      count: { type: { type: "number" }, default: 5 },
      label: { type: { type: "text" } },
    });
  });

  it('says where a bad value is by its path, not as "a step"', async () => {
    const out = await withTrigger({ when: [{ type: "sometimes" }] });
    expect(out.problems?.join(" ")).toMatch(/start, when\.0\.type/);
    expect(out.problems?.join(" ")).not.toMatch(/a step/);
  });
});

describe("with emails and ids hidden from the AI (N7)", () => {
  it("shows the agent no email, and puts the real one back when it writes the step as it read it", async () => {
    const withEmail = Skill.parse({
      ...recorded,
      steps: [
        ...recorded.steps,
        {
          id: "s4",
          type: "action",
          intent: "type the address",
          channel: "web",
          action: "type",
          target: { role: "textbox", name: "To", fallbacks: [] },
          args: { text: "ana@example.com" },
        },
      ],
    });
    const s = newSession(
      withEmail,
      { pages: [INBOX], folders: [] },
      { pages: new Map([["s1", INBOX]]), maskTerms: [HIDE_IDENTIFIERS] },
    );
    const shown = String(await run(s, "read_workflow", {}));
    expect(shown).not.toContain("ana@example.com");
    const written = await run(s, "write_workflow", { workflow: JSON.parse(shown), why: "as it is" });
    expect(written.problems).toBeUndefined();
    expect(JSON.stringify(s.draft)).toContain("ana@example.com");
  });
});
