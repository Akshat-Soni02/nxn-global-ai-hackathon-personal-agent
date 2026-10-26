import type { AnyTool } from "@shadow/agent";
import { findStep, Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import type { DoneReport } from "./contracts.ts";
import { lostWork } from "./gate.ts";
import { newSession, type SessionV2 } from "./session.ts";
import { designToolsV2, workflowFile } from "./tools.ts";

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
            instruction: "the subjects of KPI emails, the first 3 in the list's order",
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

  it("names the step a problem is in, with what it does", async () => {
    const s = session();
    const [trigger, s1] = steps(s) as Record<string, unknown>[];
    const bad = await run(s, "write_workflow", {
      workflow: {
        steps: [trigger, s1, { id: "s7", type: "action", intent: "x", channel: "web", action: "read", args: {} }],
      },
      why: "x",
    });
    expect(bad.problems?.join(" ")).toContain("s7 (web.read)");
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
