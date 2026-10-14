import { type ElementDescriptor, isAction, type Skill, type TraceEvent, triggerOf, walkSteps } from "@shadow/core";
import { type FakeReply, fakeLlm } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import { compile, type Form, type Question } from "../compile.ts";
import type { Prompter } from "../drill.ts";
import { narrationOf } from "../narration.ts";
import { type NormalisedStep, normalise } from "../normalise.ts";
import { designWorkflow } from "./design.ts";
import { designViolations, notesByStep, recordedFolders, recordedOpens } from "./tools.ts";

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
      // Steps with no control to click can still act: they may only be added if they only read.
      call("edit", {
        edits: [
          {
            op: "insert",
            at: { after: "s3" },
            step: { type: "action", intent: "Press Enter", channel: "web", action: "press", args: { key: "Enter" } },
          },
        ],
      }),
      call("edit", {
        edits: [
          {
            op: "replace",
            step: "s1",
            with: {
              type: "action",
              intent: "Move it",
              channel: "fs",
              action: "move",
              args: { from: "~/a", to: "~/b/" },
            },
          },
        ],
      }),
      // A reading step, but of a private file the recording never touched: an llm step could send it to the model.
      call("edit", {
        edits: [
          {
            op: "insert",
            at: { after: "s1" },
            step: {
              type: "action",
              intent: "Read a key",
              channel: "fs",
              action: "read",
              args: { path: "~/.ssh/id_rsa" },
              output: { name: "key", type: { type: "text" } },
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
    expect(said[5]).toMatch(/a new web.press step would do something the user didn't show/);
    expect(said[6]).toMatch(/a recorded step keeps its kind of action \(it was web.navigate\)/);
    expect(said[7]).toMatch(/may only look in folders the recording touched .* not ~\/\.ssh\/id_rsa/);
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

  it("tells the agent after every edit what still stops the workflow", async () => {
    const { steps, skill, questions } = await draft();
    const llm = fakeLlm([
      call("edit", { edits: [{ op: "set", step: "s2", field: "intent", value: "Attach the invoice" }] }),
      call("edit", { edits: [{ op: "set_skill", field: "success", value: [{ text_visible: "Upload complete" }] }] }),
      call("finish", { summary: "done" }),
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
    const [first, second] = results(outcome.episode);
    expect(first).toContain('"still_to_fix":["say how to tell it worked"]');
    expect(second).toContain('"still_to_fix":[]');
    expect(outcome.kind).toBe("designed");
  });

  it("describes a recorded step's masked picture when asked, as data", async () => {
    const { steps, skill, questions } = await draft();
    const described: number[] = [];
    const llm = fakeLlm([
      call("describe_step_screenshot", { step: 2 }),
      call("describe_step_screenshot", { step: 9 }),
      call("finish", { summary: "done" }),
    ]);
    const outcome = await designWorkflow({
      llm,
      skill,
      questions,
      steps,
      form,
      prompter: prompter().p,
      protocol: "tools",
      describeScreen: async (step) => {
        described.push(step.index);
        return "An upload form with one file field and a Submit button.";
      },
    });
    expect(described).toEqual([steps[1]?.index]);
    const [first, second] = results(outcome.episode);
    expect(first).toBe("<untrusted_data>\nAn upload form with one file field and a Submit button.\n</untrusted_data>");
    expect(second).toMatch(/No step 9/);
  });

  it("says there are no pictures when the user did not allow them", async () => {
    const { steps, skill, questions } = await draft();
    const llm = fakeLlm([call("describe_step_screenshot", { step: 1 }), call("finish", { summary: "done" })]);
    const outcome = await designWorkflow({
      llm,
      skill,
      questions,
      steps,
      form,
      prompter: prompter().p,
      protocol: "tools",
    });
    expect(results(outcome.episode)[0]).toMatch(/did not allow pictures/);
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

describe("one AI reads the recording: it labels the plain list first", () => {
  // The plain step list as the daemon now hands it over: code only, no model call before the agent.
  async function plain() {
    const steps = normalise(trace());
    const compiled = await compile(steps, { form });
    return { steps, skill: compiled.skill, questions: compiled.questions, base: compiled.base };
  }

  it("labels every step in one move, before any other change or question", async () => {
    const { steps, skill, questions, base } = await plain();
    const llm = fakeLlm([
      call("edit", { edits: [{ op: "set", step: "s2", field: "intent", value: "too soon" }] }),
      call("ask_user", { question: "Always the newest invoice?" }),
      call("label_steps", {
        intent: "Upload this month's invoice",
        steps: [
          { id: "s2", intent: "Attach this month's invoice" },
          { id: "s3", intent: "Send it", requires_approval: true },
        ],
      }),
      call("label_steps", { steps: [{ id: "s2", intent: "again" }] }),
      call("finish", { summary: "Labelled the steps" }),
    ]);
    const outcome = await designWorkflow({
      llm,
      skill,
      questions,
      steps,
      form,
      base,
      prompter: prompter().p,
      protocol: "tools",
    });
    const [edit, ask, labelled, again] = results(outcome.episode);
    expect(edit).toMatch(/label the steps first/);
    expect(ask).toMatch(/label the steps first/);
    expect(labelled).toContain('"ok":true');
    expect(again).toMatch(/labelled already/);
    const s2 = [...walkSteps(outcome.skill.steps)].find(({ step }) => step.id === "s2")?.step;
    expect(s2?.intent).toBe("Attach this month's invoice");
    // The labelling rules travel with the agent: they are in its instructions.
    const system = ((llm.requests[0]?.messages ?? []) as { content: string }[])[0]?.content ?? "";
    expect(system).toMatch(/# Your first move: label_steps/);
    expect(system).toMatch(/Never output targets, selectors, channels or actions/);
  });

  it("when it stops early, keeps what it reached; when it changed nothing, the plain list", async () => {
    const { steps, skill, questions, base } = await plain();
    const reached = await designWorkflow({
      llm: fakeLlm([
        call("label_steps", { steps: [{ id: "s2", intent: "Attach this month's invoice" }] }),
        call("edit", { edits: [{ op: "set", step: "s1", field: "intent", value: "Open the portal" }] }),
      ]),
      skill,
      questions,
      steps,
      form,
      base,
      prompter: prompter().p,
      protocol: "tools",
      budget: { turns: 2 },
    });
    expect(reached.kind).toBe("kept");
    const intents = reached.skill.steps.filter(isAction).map((s) => s.intent);
    expect(intents.slice(0, 2)).toEqual(["Open the portal", "Attach this month's invoice"]);
    const nothing = await designWorkflow({
      llm: fakeLlm([call("workflow", {})]),
      skill,
      questions,
      steps,
      form,
      base,
      prompter: prompter().p,
      protocol: "tools",
      budget: { turns: 1 },
    });
    expect(nothing).toMatchObject({ kind: "kept", skill });
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

  it("keeps what the user showed: no recorded write removed, at most half the steps; a click may open its page", async () => {
    const { skill } = await draft();
    const clone = (s: Skill = skill) => JSON.parse(JSON.stringify(s)) as Skill;
    const without = (s: Skill, ...ids: string[]) => ({ ...s, steps: s.steps.filter((x) => !ids.includes(x.id)) });
    // The upload is the work itself (Oct 14: the agent removed s1-s30, typing and pasting included).
    expect(designViolations(skill, without(clone(), "s2"), form)).toEqual([
      expect.stringMatching(/s2: it does what the user showed \(web.upload\).*never remove it/),
    ]);
    // Ten recorded actions: four clicks may go as noise, five may not.
    const long = clone();
    const submit = long.steps[3] as Record<string, unknown>;
    for (let i = 1; i <= 6; i++) {
      long.steps.push({
        ...submit,
        id: `c${i}`,
        requires_approval: false,
        target: { role: "button", name: `Next ${i}`, fallbacks: [] },
      } as never);
    }
    expect(designViolations(long, without(clone(long), "c1", "c2", "c3", "c4"), form)).toEqual([]);
    expect(designViolations(long, without(clone(long), "c1", "c2", "c3", "c4", "c5"), form)).toEqual([
      expect.stringMatching(/5 of the 9 recorded steps would be gone \(at most 4\)/),
    ]);
    // A click that took them to a sheet may become "open the sheet", if the recording reached that page.
    const sheet = "https://docs.google.com/spreadsheets/d/abc/edit";
    const opened = clone(long);
    opened.steps[4] = {
      id: "c1",
      type: "action",
      intent: "Open the sheet",
      channel: "web",
      action: "navigate",
      args: { url: sheet },
    } as never;
    expect(designViolations(long, opened, form, [], { pages: [sheet], opens: { c1: sheet } })).toEqual([]);
    // Only the page that click opened, never another visited page; and never a click that needs approval (Submit).
    const elsewhere = "https://docs.google.com/spreadsheets/d/other/edit";
    expect(designViolations(long, opened, form, [], { pages: [sheet, elsewhere], opens: { c1: elsewhere } })).toEqual([
      expect.stringMatching(/c1: a step may become "open this page" only for the page it opened/),
    ]);
    const submitted = clone(long);
    submitted.steps[3] = { ...(opened.steps[4] as object), id: "s3", requires_approval: true } as never;
    expect(designViolations(long, submitted, form, [], { pages: [sheet], opens: { s3: sheet } })).toEqual(
      expect.arrayContaining([expect.stringMatching(/s3: a step may become "open this page" only/)]),
    );
    // Not only clicks: Enter in a search box that took them to the results may become "open the results".
    const pressed = clone(long);
    (pressed.steps[4] as Record<string, unknown>).action = "press";
    (pressed.steps[4] as Record<string, unknown>).args = { key: "Enter" };
    expect(designViolations(pressed, opened, form, [], { pages: [sheet], opens: { c1: sheet } })).toEqual([]);
    // A step that submitted a form never gets a page to open: its page is a result.
    const steps = [{ navigatesTo: sheet, submits: true }, { navigatesTo: sheet }] as NormalisedStep[];
    expect(recordedOpens(steps, [["s4"], ["s5"]])).toEqual({ s5: sheet });
  });

  it("lets a second item's repeat go once the loop does it, but no removal in disguise, and runs still open a page", async () => {
    const { skill } = await draft();
    const clone = (s: Skill = skill) => JSON.parse(JSON.stringify(s)) as Skill;
    // Shown for two invoices: the upload twice, on the same control.
    const twice = clone();
    twice.steps.splice(3, 0, { ...(twice.steps[2] as object), id: "s2b" } as never);
    const looped = clone(twice);
    const loop = {
      id: "l1",
      type: "control",
      kind: "loop",
      intent: "Each invoice",
      over: "{{invoices}}",
      item: { name: "invoice", type: { type: "file" } },
      steps: [looped.steps[2]],
    };
    looped.steps = [looped.steps[0], looped.steps[1], loop, looped.steps[4]] as never;
    expect(designViolations(twice, looped, form)).toEqual([]);
    // Without the loop keeping it, removing the repeat is removing the work.
    const dropped = { ...clone(twice), steps: clone(twice).steps.filter((s) => s.id !== "s2b" && s.id !== "s2") };
    expect(designViolations(twice, dropped, form)).toEqual(
      expect.arrayContaining([expect.stringMatching(/s2: it does what the user showed \(web.upload\)/)]),
    );
    // Replacing the upload under its own id with an llm step is a removal too.
    const replaced = clone();
    replaced.steps[2] = {
      id: "s2",
      type: "llm",
      intent: "Think about it",
      instruction: "x",
      inputs: [],
      output: { name: "x", type: { type: "text" } },
    } as never;
    expect(designViolations(skill, replaced, form)).toEqual([
      expect.stringMatching(/s2: a recorded step keeps its kind of action \(it was web.upload\)/),
    ]);
    // s1 opened the page; without it a run starts on a blank window (Oct 14's first failure).
    const blank = { ...clone(), steps: clone().steps.filter((s) => s.id !== "s1") };
    expect(designViolations(skill, blank, form)).toEqual([
      expect.stringMatching(/s2: runs start on a blank window, so the workflow must still open a page first/),
    ]);
  });

  it("keeps file steps, inputs and local pages inside what the recording touched, however the path is written", async () => {
    const { steps, skill } = await draft();
    // A download's folder counts as touched.
    const downloaded = { ...steps[1], produces: ["/tmp/exports/kpis.csv"] } as NormalisedStep;
    const folders = recordedFolders([...steps, downloaded], skill);
    const clone = (s: Skill = skill) => JSON.parse(JSON.stringify(s)) as Skill;
    const withStep = (s: Skill, step: object) => ({ ...s, steps: [...s.steps, step] }) as Skill;
    const step = (id: string, channel: string, action: string, args: object) => ({
      id,
      type: "action",
      intent: id,
      channel,
      action,
      args,
      output: { name: id, type: { type: "text" } },
    });
    const problems = (d: Skill, o: Skill = skill) => designViolations(o, d, undefined, folders);

    // A new read in a touched folder is fine; elsewhere it is refused, as is a glob that climbs out.
    expect(problems(withStep(clone(), step("r1", "fs", "read", { path: "/tmp/exports/kpis.csv" })))).toEqual([]);
    expect(problems(withStep(clone(), step("r2", "fs", "read", { path: "~/Desktop/notes.txt" })))).toEqual([
      expect.stringMatching(/r2: it may only look in folders .* not ~\/Desktop\/notes.txt/),
    ]);
    expect(
      problems(
        withStep(clone(), step("f1", "fs", "find", { dir: "/tmp/exports", glob: "../../Users/*", pick: "all" })),
      ),
    ).toEqual([expect.stringMatching(/f1: its glob .* must stay inside its folder/)]);
    // A recorded file step re-pointed elsewhere counts as new.
    const original = withStep(clone(), step("f2", "fs", "find", { dir: "/tmp/exports", glob: "*.csv", pick: "all" }));
    const repointed = withStep(clone(), step("f2", "fs", "find", { dir: "~/.ssh", glob: "*", pick: "all" }));
    expect(problems(repointed, original)).toEqual([expect.stringMatching(/f2: it may only look .* not ~\/\.ssh/)]);
    expect(problems(clone(original), original)).toEqual([]);
    // An input the agent declares may not point outside either.
    const input = clone();
    (input.steps[0] as { inputs: Record<string, unknown> }).inputs.key = {
      type: { type: "text" },
      default: "~/.ssh/id_rsa",
    };
    expect(problems(input)).toEqual([
      expect.stringMatching(/key: an input may only point at folders .* not ~\/\.ssh\/id_rsa/),
    ]);
    // A local page is a site only by its exact address.
    const local = clone();
    (local.steps[1] as { args: Record<string, unknown> }).args.url = "file:///Users/me/Documents/report.html";
    const nav = (id: string, url: string) => ({
      id,
      type: "action",
      intent: id,
      channel: "web",
      action: "navigate",
      args: { url },
    });
    expect(problems(withStep(clone(local), nav("n1", "file:///Users/me/Documents/report.html")), local)).toEqual([]);
    expect(problems(withStep(clone(local), nav("n2", "file:///Users/me/.ssh/id_rsa")), local)).toEqual([
      expect.stringMatching(/n2: it may only open a site the recording visited/),
    ]);
  });

  it("gives the narration whole, before the recording, with the steps each piece spans", async () => {
    const { steps, skill, questions } = await draft();
    const upload = steps.findIndex((s) => s.kind === "upload") + 1;
    const said = [
      { at: -3_000, kind: "said" as const, text: "every day I take the top 5 new ones" },
      { at: 5_200, until: 9_000, kind: "said" as const, text: "skip the ones already in my sheet" },
    ];
    // The same page read twice, and a long one: said once, and cut short, in the first message.
    const screen = [
      { at: 5_100, kind: "screen" as const, text: `Invoices ${"x".repeat(400)}` },
      { at: 8_100, kind: "screen" as const, text: `Invoices ${"x".repeat(400)}` },
    ];
    const llm = fakeLlm([call("finish", { summary: "done" })]);
    await designWorkflow({
      llm,
      skill,
      questions,
      steps,
      form,
      notes: [...said, ...screen],
      prompter: prompter().p,
      protocol: "tools",
    });
    const task = ((llm.requests[0]?.messages ?? []) as { content: string }[])[1]?.content ?? "";
    expect(task).toContain("- [before step 1] every day I take the top 5 new ones");
    expect(task).toContain(`- [steps ${upload}-${steps.length}] skip the ones already in my sheet`);
    expect(task.indexOf("# What they said")).toBeLessThan(task.indexOf("# The recording"));
    expect(task).toContain("on screen: (as before)");
    expect(task).not.toContain("x".repeat(301));
    // Said once, in the list: never again as a note on a step.
    expect(task).not.toContain("said: ");
  });

  it("sends the screen lines around what a step clicked, not the top of the page", async () => {
    const steps = normalise([
      ev("click", 0, { target: control("Jobs") }),
      ev("click", 3_000, { target: control("Numeral", { role: "link", tag: "a" }) }),
    ]);
    const { skill, questions } = await compile(steps, { form });
    // A long page: menus first, the clicked company far down.
    const page = [
      ...Array.from({ length: 30 }, (_, i) => `Menu item ${i + 1}`),
      "Numeral (W23) · Data Analyst · Remote (US) · $55K - $65K",
      ...Array.from({ length: 10 }, (_, i) => `Footer ${i + 1}`),
    ].join("\n");
    const llm = fakeLlm([call("finish", { summary: "done" })]);
    await designWorkflow({
      llm,
      skill,
      questions,
      steps,
      form,
      notes: [{ at: 3_400, kind: "screen", text: page }],
      prompter: prompter().p,
      protocol: "tools",
    });
    const task = ((llm.requests[0]?.messages ?? []) as { content: string }[])[1]?.content ?? "";
    expect(task).toContain('on screen, around \\"Numeral\\"');
    expect(task).toContain("$55K - $65K");
    expect(task).toContain("Menu item 27");
    expect(task).not.toContain("Menu item 1 ");
    expect(task).not.toContain("Footer 6");
  });

  it("lets the first draft hear the narration too", async () => {
    const steps = normalise(trace());
    const seen: string[] = [];
    await compile(steps, {
      form,
      notes: [{ at: 5_200, kind: "said", text: "always the newest invoice" }],
      chat: async (messages) => {
        seen.push(String(messages[1]?.content));
        return "{}";
      },
    });
    expect(JSON.parse(seen[0] ?? "{}").narration).toEqual([
      { during: `step ${steps.findIndex((s) => s.kind === "upload") + 1}`, said: "always the newest invoice" },
    ]);
  });

  it("puts what was seen next to its step, and what was said only in its own list", () => {
    const steps = normalise(trace());
    const notes = notesByStep(steps, [
      { at: 5_500, kind: "said", text: "always the newest one" },
      { at: -2_000, kind: "screen", text: "Invoices · ███@███" },
    ]);
    expect(notes[0]).toEqual(["on screen: Invoices · ███@███"]);
    expect(notes.flat().some((t) => t.includes("newest"))).toBe(false);
    const upload = steps.findIndex((s) => s.kind === "upload") + 1;
    expect(narrationOf(steps, [{ at: 5_500, kind: "said", text: "always the newest one" }])).toEqual([
      { during: `step ${upload}`, said: "always the newest one" },
    ]);
  });

  it("marks a sentence against what the person did, never a page they switched back to", () => {
    const jobs = "https://www.ycombinator.com/jobs";
    const sheet = "https://docs.google.com/spreadsheets/d/abc/edit";
    // 1 open the jobs, 2 click Numeral, 3 open the sheet, 4 back to the jobs tab (it reloads), 5 click the next job.
    const steps = [
      { kind: "navigate", at: 0, url: jobs },
      { kind: "click", at: 2_000, url: jobs },
      { kind: "navigate", at: 5_000, url: sheet },
      { kind: "navigate", at: 9_000, url: `${jobs}?ref=tab` },
      { kind: "click", at: 15_000, url: jobs },
    ] as NormalisedStep[];
    const said = (at: number) => narrationOf(steps, [{ at, kind: "said", text: "I take the top 5" }])[0]?.during;
    // Said just after switching back to the jobs tab: not "step 4" (the reload), but the sheet step before it.
    expect(said(10_000)).toBe("step 3");
    expect(said(16_000)).toBe("step 5");
    // The first time a page is opened counts.
    expect(said(5_500)).toBe("step 3");
  });
});

describe("questions left after the agent", () => {
  it("asks after it only what it left untouched: an answer it put in from what was said isn't asked again", async () => {
    const { steps, skill } = await draft();
    // Two questions code might have: where the answer goes is a step's timeout.
    const questions: Question[] = [
      { id: "slow-upload", text: "How long can the upload take?", appliesTo: "steps.s2.timeout_ms" },
      { id: "slow-page", text: "How long can the page take to open?", appliesTo: "steps.s1.timeout_ms" },
    ];
    const { p, asked } = prompter();
    const llm = fakeLlm([
      // They said "the upload takes about a minute": the agent writes that in.
      call("edit", { edits: [{ op: "set", step: "s2", field: "timeout_ms", value: 60_000 }] }),
      call("finish", { summary: "Gave the upload a minute" }),
    ]);
    const outcome = await designWorkflow({ llm, skill, questions, steps, form, prompter: p, protocol: "tools" });
    expect(outcome.pending.map((q) => q.id)).toEqual(["slow-page"]);
    expect(asked).toEqual([]);
  });

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
