import { type ElementDescriptor, isAction, type Skill, type TraceEvent, triggerOf, walkSteps } from "@shadow/core";
import { type FakeReply, fakeLlm } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import { compile, type Form, type Question } from "../compile.ts";
import type { Prompter } from "../drill.ts";
import { normalise } from "../normalise.ts";
import { designWorkflow } from "./design.ts";
import { designViolations, notesByStep } from "./tools.ts";

const PAGE = "http://localhost:5173/upload.html";
const control = (name: string, extra: Partial<ElementDescriptor> = {}): ElementDescriptor => ({
  tag: "button",
  url: PAGE,
  role: "button",
  name,
  text: name,
  fallbacks: [],
  selectors: { css: `#${name.toLowerCase()}` },
  ...extra,
});
const upload = control("Upload invoice", { tag: "input", attrs: { type: "file", name: "invoice" } });
let n = 0;
const ev = (event: TraceEvent["event"], at: number, extra: Partial<TraceEvent> = {}): TraceEvent => ({
  id: `e${++n}`,
  sessionId: "s",
  at,
  event,
  tabId: 1,
  frameId: 0,
  url: PAGE,
  ...extra,
});
const trace = () => [
  ev("click", 0, { target: upload }),
  ev("file", 5_000, { target: upload, file: { name: "invoice-0923.pdf", size: 48_213, type: "application/pdf" } }),
  ev("click", 8_000, { target: control("Submit") }),
];
const form: Form = {
  description: { goal: "This month's invoice is in the portal", changes: ["the invoice"], constants: [], never: [] },
  when: [{ type: "manual" }],
};
const call = (name: string, args: unknown): FakeReply => ({ toolCalls: [{ name, arguments: args }] });

// The compiled first draft (code only): start, s1 open the page, s2 upload, s3 Submit (needs approval).
async function draft() {
  const steps = normalise(trace());
  const compiled = await compile(steps, { form });
  return { steps, skill: compiled.skill, questions: compiled.questions };
}

function prompter(answers: Record<string, string> = {}) {
  const asked: { question: Question; step?: string; draft?: Skill }[] = [];
  const p: Prompter = {
    ask: async (question, about) => {
      asked.push({ question, ...about });
      return answers[question.id] ?? "";
    },
  };
  return { p, asked };
}

const results = (episode: { transcript: { type: string; tool?: string; output?: string }[] } | undefined) =>
  (episode?.transcript ?? []).filter((e) => e.type === "result").map((e) => e.output ?? "");

describe("the design agent", () => {
  it("reads, edits, asks on the step, and finishes with what it changed", async () => {
    const { steps, skill, questions } = await draft();
    const { p, asked } = prompter({ "design-1": "yes" });
    const llm = fakeLlm([
      call("read_description", {}),
      call("workflow", {}),
      call("edit", { edits: [{ op: "set", step: "s2", field: "intent", value: "Attach this month's invoice" }] }),
      call("ask_user", { question: "Always the newest invoice?", options: ["yes", "no"], default: "yes", step: "s2" }),
      call("validate", {}),
      call("finish", { summary: "Named the upload after the month's invoice" }),
    ]);
    const outcome = await designWorkflow({ llm, skill, questions, steps, form, prompter: p, protocol: "tools" });
    expect(outcome.kind).toBe("designed");
    expect(outcome.kind === "designed" && outcome.summary).toBe("Named the upload after the month's invoice");
    const s2 = [...walkSteps(outcome.skill.steps)].find(({ step }) => step.id === "s2")?.step;
    expect(s2?.intent).toBe("Attach this month's invoice");
    // The question is shown on the draft, next to its step.
    expect(asked[0]).toMatchObject({ question: { text: "Always the newest invoice?" }, step: "s2" });
    expect(asked[0]?.draft?.id).toBe(skill.id);
    expect(outcome.answered).toEqual([expect.objectContaining({ answer: "yes" })]);
    // What the model was told first: the user's goal, the recording and the draft.
    const messages = (llm.requests[0]?.messages ?? []) as { content: string }[];
    const task = messages[1]?.content ?? "";
    expect(task).toContain("This month's invoice is in the portal");
    expect(task).toContain('"did":"upload"');
    expect(task).toContain("s3  web.click");
  });

  it("is refused anything outside the rules, and the draft is left as it was", async () => {
    const { steps, skill, questions } = await draft();
    const llm = fakeLlm([
      call("edit", {
        edits: [{ op: "retarget", step: "s3", target: { role: "button", name: "Delete", fallbacks: [] } }],
      }),
      call("edit", { edits: [{ op: "set", step: "s3", field: "requires_approval", value: false }] }),
      call("edit", { edits: [{ op: "remove", step: "s3" }] }),
      call("edit", {
        edits: [{ op: "set", step: "start", field: "when", value: [{ type: "schedule", cron: "0 9 * * *" }] }],
      }),
      call("edit", {
        edits: [
          {
            op: "insert",
            at: { after: "s1" },
            step: {
              type: "action",
              intent: "Go elsewhere",
              channel: "web",
              action: "navigate",
              args: { url: "https://elsewhere.example" },
            },
          },
        ],
      }),
      call("finish", { summary: "nothing" }),
    ]);
    const outcome = await designWorkflow({
      llm,
      skill,
      questions,
      steps,
      form,
      prompter: prompter().p,
      protocol: "tools",
    });
    expect(outcome.skill).toEqual(skill);
    const said = results(outcome.episode);
    expect(said[0]).toMatch(/its target is not one you recorded/);
    expect(said[1]).toMatch(/approval can't be turned off/);
    expect(said[2]).toMatch(/needs approval can't be removed/);
    expect(said[3]).toMatch(/the Frequency is the user's/);
    expect(said[4]).toMatch(/only open a site the recording visited/);
  });

  it("builds a loop over files and an llm step from the recorded steps", async () => {
    const { steps, skill, questions } = await draft();
    const llm = fakeLlm([
      call("edit", {
        edits: [
          {
            op: "insert",
            at: { after: "s1" },
            step: {
              id: "find",
              type: "action",
              intent: "Find this month's invoices",
              channel: "fs",
              action: "find",
              args: { dir: "~/Downloads", glob: "invoice-*.pdf", pick: "all" },
              output: { name: "invoices", type: { type: "list", items: { type: "file" } } },
            },
          },
        ],
      }),
      call("wrap_in_loop", {
        steps: ["s2", "s3"],
        over: "{{invoices}}",
        item: { name: "invoice_file", type: { type: "file" } },
        intent: "Upload each invoice",
        on_item_fail: "skip",
      }),
      call("edit", { edits: [{ op: "set", step: "s2", field: "args", value: { file: "{{invoice_file}}" } }] }),
      call("add_llm_step", {
        after: "find",
        intent: "Count the invoices",
        instruction: "How many invoices are in this list?",
        inputs: ["{{invoices}}"],
        output: { name: "count", type: { type: "number" } },
      }),
      call("finish", { summary: "Uploads every invoice of the month" }),
    ]);
    const outcome = await designWorkflow({
      llm,
      skill,
      questions,
      steps,
      form,
      prompter: prompter().p,
      protocol: "tools",
    });
    expect(results(outcome.episode).every((r) => !r.includes('"ok":false'))).toBe(true);
    expect(outcome.kind).toBe("designed");
    const top = outcome.skill.steps.map((s) => (s.type === "control" ? `${s.kind}:${s.id}` : s.id));
    expect(top).toEqual(["start", "s1", "find", "ai1", "loop:l1"]);
    const loop = outcome.skill.steps.at(-1);
    expect(loop?.type === "control" && loop.kind === "loop" && loop.steps.map((s) => s.id)).toEqual(["s2", "s3"]);
    // Moved, not removed: the Submit inside the loop still waits for approval.
    const submit = loop?.type === "control" ? loop.steps[1] : undefined;
    expect(submit && isAction(submit) && submit.requires_approval).toBe(true);
  });

  it("may finish only once the checks pass", async () => {
    const { steps, skill, questions } = await draft();
    const llm = fakeLlm([
      call("finish", { summary: "done" }),
      call("edit", { edits: [{ op: "set_skill", field: "success", value: [{ text_visible: "Upload complete" }] }] }),
      call("finish", { summary: "Added how to tell it worked" }),
    ]);
    const outcome = await designWorkflow({
      llm,
      skill,
      questions,
      steps,
      form,
      prompter: prompter().p,
      protocol: "tools",
      checks: (s) => (s.success.length > 0 ? [] : ["say how to tell it worked"]),
    });
    expect(results(outcome.episode)[0]).toMatch(/not finished yet.*say how to tell it worked/);
    expect(outcome).toMatchObject({ kind: "designed", summary: "Added how to tell it worked" });
  });

  it("keeps the first draft, with the answers already given, when it runs out of turns", async () => {
    const { steps, skill, questions } = await draft();
    const open = questions[0];
    expect(open).toBeDefined();
    const llm = fakeLlm([call("ask_user", { id: open?.id }), call("workflow", {})]);
    const outcome = await designWorkflow({
      llm,
      skill,
      questions,
      steps,
      form,
      prompter: prompter().p,
      protocol: "tools",
      budget: { turns: 2 },
    });
    expect(outcome).toMatchObject({ kind: "kept", reason: "it ran out of turns" });
    expect(outcome.answered.map((a) => a.question.id)).toEqual([open?.id]);
    expect(outcome.pending.map((q) => q.id)).not.toContain(open?.id); // not asked twice
    expect(triggerOf(outcome.skill).when).toEqual(form.when);
  });
});

describe("the rules and the recording view", () => {
  it("lets the user's own fields and approvals through unchanged, and nothing else", async () => {
    const { skill } = await draft();
    expect(designViolations(skill, skill, form)).toEqual([]);
    const renamed = { ...skill, description: { ...skill.description, goal: "something else" } };
    expect(designViolations(skill, renamed, form)).toEqual([expect.stringMatching(/description is the user's/)]);
    // Without a form (a recording from before Oct 13), the agent may write the goal.
    expect(designViolations(skill, renamed)).toEqual([]);
  });

  it("puts what was said next to the step it was said over", () => {
    const steps = normalise(trace());
    const notes = notesByStep(steps, [
      { at: 5_500, kind: "said", text: "always the newest one" },
      { at: -2_000, kind: "screen", text: "Invoices · ███@███" },
    ]);
    const said = notes.findIndex((n) => n.some((t) => t.includes("newest")));
    expect(steps[said]?.kind).toBe("upload");
    expect(notes[0]).toEqual(["on screen: Invoices · ███@███"]);
  });
});

describe("questions left after the agent", () => {
  it("drops a first-draft question about an input the agent removed", async () => {
    const { steps, skill, questions } = await draft();
    const aboutInput = questions.filter((q) => q.appliesTo?.startsWith("steps.start.inputs."));
    expect(aboutInput.length).toBeGreaterThan(0);
    const llm = fakeLlm([
      call("edit", {
        edits: [
          { op: "set", step: "s2", field: "args", value: { file: "~/Downloads/invoice.pdf" } },
          { op: "set", step: "start", field: "inputs", value: {} },
        ],
      }),
      call("finish", { summary: "Always uploads the same file" }),
    ]);
    const outcome = await designWorkflow({
      llm,
      skill,
      questions,
      steps,
      form,
      prompter: prompter().p,
      protocol: "tools",
    });
    expect(outcome.kind).toBe("designed");
    expect(outcome.pending.filter((q) => q.appliesTo?.startsWith("steps.start.inputs."))).toEqual([]);
  });
});
