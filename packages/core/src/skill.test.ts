import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findStep, isBranch, isLoop, Skill, triggerOf, walkSteps } from "./skill.ts";
import { fitValue, parseRef, typeAt, valueAt } from "./vars.ts";

const skillsDir = join(import.meta.dirname, "../../../skills/real");

const trigger = (inputs: Record<string, unknown> = {}) => ({ id: "start", type: "trigger", intent: "by hand", inputs });
const base = { id: "demo", name: "Demo", version: 1, description: { goal: "Open the page" } };
const nav = (id: string) => ({ id, type: "action", intent: "open", channel: "web", action: "navigate" });
const issues = (data: unknown) => {
  const r = Skill.safeParse(data);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}${i.path.length ? ": " : ""}${i.message}`);
};
const withSteps = (...steps: unknown[]) => ({ ...base, steps: [trigger(), ...steps] });

const email = { type: "object", fields: { subject: { type: "text" }, body: { type: "text" } } };
const invoice = { type: "object", fields: { vendor: { type: "text" }, amount: { type: "number" } } };
// Workflow 2 in docs/examples.md, cut down: for each email, read the invoice, ask before large ones, file the PDF.
const invoices = () => ({
  ...base,
  steps: [
    trigger({ threshold: { type: { type: "number" }, default: 5000 } }),
    {
      id: "s1",
      type: "action",
      intent: "Collect the emails",
      channel: "web",
      action: "extract",
      args: { source: "table" },
      output: { name: "emails", type: { type: "list", items: email } },
    },
    {
      id: "l1",
      type: "control",
      kind: "loop",
      intent: "For each email",
      over: "{{emails}}",
      item: { name: "email", type: email },
      steps: [
        {
          id: "s2",
          type: "llm",
          intent: "Read the invoice",
          instruction: "Extract vendor and amount.",
          inputs: ["{{email.body}}"],
          output: { name: "invoice", type: invoice },
        },
        {
          id: "b1",
          type: "control",
          kind: "branch",
          intent: "Large invoices",
          if: { left: "{{invoice.amount}}", op: "greater_than", right: "{{threshold}}" },
          steps: [{ ...nav("s3"), ask: { question: "Large invoice from {{invoice.vendor}}?", kind: "confirm" } }],
        },
      ],
    },
  ],
});

describe("skill schema", () => {
  for (const file of readdirSync(skillsDir).filter((f) => f.endsWith(".json"))) {
    it(`accepts ${file}`, () => {
      expect(issues(JSON.parse(readFileSync(join(skillsDir, file), "utf8")))).toEqual([]);
    });
  }

  it("starts with a trigger step that holds when it runs and its inputs", () => {
    const skill = Skill.parse(withSteps(nav("s1")));
    expect(triggerOf(skill)).toMatchObject({ type: "trigger", when: [{ type: "manual" }], inputs: {} });
    expect(skill.description).toEqual({ goal: "Open the page", changes: [], constants: [], never: [] });
    expect(issues({ ...base, steps: [nav("s1"), nav("s2")] })).toContain("steps.0: the first step must be the trigger");
    expect(issues({ ...base, steps: [trigger(), nav("s1"), { ...trigger(), id: "t2" }] })).toContain(
      "steps: t2: only the first step can be a trigger",
    );
  });

  it("reports a bad action step by its own path, even nested", () => {
    expect(issues(withSteps({ ...nav("s1"), channel: "fs", action: "click" }))).toEqual([
      "steps.1.action: action is not supported by this channel",
    ]);
  });

  it("accepts a tree of loop, branch, llm and action steps and walks it in order", () => {
    const skill = Skill.parse(invoices());
    expect([...walkSteps(skill.steps)].map(({ step, parents }) => [step.id, parents.join("/")])).toEqual([
      ["start", ""],
      ["s1", ""],
      ["l1", ""],
      ["s2", "l1"],
      ["b1", "l1"],
      ["s3", "l1/b1"],
    ]);
    const loop = findStep(skill, "l1");
    expect(loop && isLoop(loop) && [loop.max_items, loop.on_item_fail]).toEqual([100, "stop"]);
    const branch = findStep(skill, "b1");
    expect(branch && isBranch(branch) && branch.else).toEqual([]);
  });

  it("needs ids unique across the whole tree", () => {
    const loop = { ...invoices().steps[2], id: "s1" };
    expect(issues({ ...invoices(), steps: [...invoices().steps.slice(0, 2), loop] })).toContain(
      "steps: duplicate step id s1",
    );
  });
});

describe("variables", () => {
  const broken = (edit: (s: ReturnType<typeof invoices>) => void) => {
    const s = invoices();
    edit(s);
    return issues(s);
  };
  const loop = (s: ReturnType<typeof invoices>) => s.steps[2] as { steps: Record<string, unknown>[]; item: unknown };

  it("checks that every reference points to a declared variable and an existing field", () => {
    expect(broken((s) => ((loop(s).steps[0] as { inputs: string[] }).inputs = ["{{email.bdy}}"]))).toEqual([
      "steps.2.steps.0.inputs.0: {{email.bdy}} has no such field: email is a { subject: text, body: text }",
    ]);
    expect(broken((s) => s.steps.push({ ...nav("s9"), args: { url: "{{email.subject}}" } } as never))).toEqual([
      "steps.3.args.url: {{email.subject}} uses email, which is not declared by an earlier step", // only inside the loop
    ]);
    expect(issues(withSteps({ ...nav("s1"), args: { url: "https://x.test/{{today}}/{{page}}" } }))).toEqual([
      "steps.1.args.url: {{page}} uses page, which is not declared by an earlier step",
    ]);
  });

  it("checks loops, names and outputs", () => {
    expect(broken((s) => (loop(s).item = { name: "email", type: { type: "text" } }))).toContain(
      "steps.2.item: email is declared as text but the list holds { subject: text, body: text }",
    );
    expect(broken((s) => (loop(s).item = { name: "threshold", type: email }))).toContain(
      "steps.2.item: variable threshold is already declared",
    );
    expect(issues(withSteps({ ...nav("s1"), output: { name: "x", type: { type: "text" } } }))).toEqual([
      "steps.1.output: web.navigate produces no value",
    ]);
    const find = {
      id: "s1",
      type: "action",
      intent: "x",
      channel: "fs",
      action: "find",
      args: { dir: "~", glob: "*" },
    };
    expect(issues(withSteps({ ...find, output: { name: "f", type: { type: "file" } } }))).toEqual([]);
    expect(
      issues(withSteps({ ...find, output: { name: "f", type: { type: "list", items: { type: "file" } } } })),
    ).toEqual(["steps.1.output: fs.find produces file, not list of file"]);
  });

  it("keeps a variable after a branch only when both arms produce it", () => {
    const read = (id: string) => ({
      id,
      type: "action",
      intent: "read",
      channel: "fs",
      action: "read",
      args: { path: "~/a.txt" },
      output: { name: `note_${id}`, type: { type: "text" } },
    });
    const branch = { id: "b1", type: "control", kind: "branch", intent: "x", if: { left: 1, op: "exists" } };
    expect(
      issues(withSteps({ ...branch, steps: [read("s1")] }, { ...nav("s3"), args: { url: "{{note_s1}}" } })),
    ).toEqual(["steps.2.args.url: {{note_s1}} uses note_s1, which is not declared by an earlier step"]);
  });

  it("asks: a value question declares its answer", () => {
    expect(issues(withSteps({ ...nav("s1"), ask: { question: "Which plan?" } }))).toEqual([
      "steps.1.ask.output: a value question needs an output",
    ]);
    const ask = { question: "Which plan?", output: { name: "plan", type: { type: "text" } } };
    expect(issues(withSteps({ ...nav("s1"), ask, args: { url: "https://x.test/{{plan}}" } }))).toEqual([]);
  });

  it("llm steps produce one typed output, never a file or secret", () => {
    const llm = {
      id: "s1",
      type: "llm",
      intent: "x",
      instruction: "Summarise",
      output: { name: "s", type: { type: "file" } },
    };
    expect(issues(withSteps(llm))).toEqual(["steps.1.output.type: an llm step cannot produce files or secrets"]);
  });

  it("reads references and values the same way", () => {
    expect(parseRef("emails.0.subject")).toEqual({ expr: "emails.0.subject", name: "emails", path: ["0", "subject"] });
    expect(parseRef("Emails")).toBeUndefined();
    expect(typeAt({ type: "file" }, ["name"])).toEqual({ type: "text" });
    expect(typeAt({ type: "object" }, ["anything", "deeper"])).toBe("unknown"); // rows of unknown shape
    expect(valueAt("e", [{ subject: "Hi" }], ["0", "subject"])).toBe("Hi");
    expect(() => valueAt("invoice", { vendor: "Acme" }, ["amount"])).toThrow("invoice has no field amount");
  });

  it("fits values to types, converting text that means a number, yes/no or a date", () => {
    expect(fitValue({ type: "number" }, "1,234")).toBe(1234);
    expect(fitValue({ type: "boolean" }, "Yes")).toBe(true);
    expect(fitValue({ type: "date" }, "2026-10-09T10:00:00Z")).toBe("2026-10-09");
    expect(fitValue({ type: "file" }, "/tmp/a.pdf")).toEqual({
      path: "/tmp/a.pdf",
      name: "a.pdf",
      size: 0,
      modified: "",
    });
    expect(fitValue(invoice as never, { vendor: "Acme", amount: "12" })).toEqual({ vendor: "Acme", amount: 12 });
    expect(fitValue(invoice as never, { vendor: "Acme" })).toBeUndefined();
    expect(fitValue({ type: "list", items: { type: "number" } }, ["1", "x"])).toBeUndefined();
  });
});
