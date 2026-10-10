import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_DOCS, briefing } from "./briefing.ts";
import { applyEdit, applyEdits, describeEdit, type EditInput as Edit } from "./edit.ts";
import { isOutward, repairViolations } from "./guard.ts";
import { ACTIONS, findStep, Skill, walkSteps } from "./skill.ts";

// An invoice upload: a trigger input, a web form, an llm step, and a submit that needs approval.
const skill = Skill.parse({
  id: "upload-invoice",
  name: "Upload the invoice",
  version: 1,
  description: { goal: "Upload this month's invoice to the portal", never: ["Never click Delete draft"] },
  steps: [
    {
      id: "start",
      type: "trigger",
      intent: "By hand",
      inputs: { invoice: { type: { type: "file" } } },
    },
    {
      id: "s1",
      type: "action",
      intent: "Open the portal",
      channel: "web",
      action: "navigate",
      args: { url: "https://portal.example.com/upload" },
    },
    {
      id: "s2",
      type: "action",
      intent: "Attach the invoice",
      channel: "web",
      action: "upload",
      target: { role: "button", name: "Choose file" },
      args: { file: "{{invoice}}" },
    },
    {
      id: "s3",
      type: "llm",
      intent: "Write a short note",
      instruction: "A one-line note naming the invoice file",
      inputs: ["{{invoice.name}}"],
      output: { name: "note", type: { type: "text" } },
    },
    {
      id: "s4",
      type: "action",
      intent: "Type the note",
      channel: "web",
      action: "type",
      target: { role: "textbox", name: "Note" },
      args: { text: "{{note}}" },
    },
    {
      id: "s5",
      type: "action",
      intent: "Submit",
      channel: "web",
      action: "click",
      target: { role: "button", name: "Submit" },
      requires_approval: true,
    },
  ],
});

const ids = (s: Skill) => [...walkSteps(s.steps)].map(({ step }) => step.id);
const ok = (result: ReturnType<typeof applyEdits>) => {
  if (!result.ok) throw new Error(result.problems.join("\n"));
  return result.skill;
};

describe("edits", () => {
  it("retargets, inserts, moves, removes and sets, keeping ids and the original untouched", () => {
    const edited = ok(
      applyEdits(skill, [
        { op: "retarget", step: "s5", target: { role: "button", name: "Submit invoice" } },
        {
          op: "insert",
          at: { after: "s1" },
          step: {
            type: "action",
            intent: "Dismiss the cookie banner",
            channel: "web",
            action: "click",
            target: { role: "button", name: "Accept all" },
          },
        },
        { op: "set", step: "s2", field: "timeout_ms", value: 20_000 },
        { op: "set", step: "s4", field: "wait", value: { text_visible: "Note" } },
      ]),
    );
    expect(ids(edited)).toEqual(["start", "s1", "s6", "s2", "s3", "s4", "s5"]); // the new step got a free id
    expect(findStep(edited, "s5")).toMatchObject({ target: { name: "Submit invoice" }, requires_approval: true });
    expect(findStep(edited, "s2")).toMatchObject({ timeout_ms: 20_000 });
    expect(findStep(skill, "s5")).toMatchObject({ target: { name: "Submit" } });

    const moved = ok(applyEdit(edited, { op: "move", step: "s6", to: { before: "s5" } }));
    expect(ids(moved)).toEqual(["start", "s1", "s2", "s3", "s4", "s6", "s5"]);
    const removed = ok(applyEdit(moved, { op: "set", step: "s4", field: "wait", value: null }));
    expect(findStep(removed, "s4")).not.toHaveProperty("wait");
  });

  it("wraps steps into loops and branches, and replaces a step keeping its id", () => {
    const edited = ok(
      applyEdits(skill, [
        {
          op: "insert",
          at: { after: "s4" },
          step: {
            id: "b1",
            type: "control",
            kind: "branch",
            intent: "Close the tip if it shows",
            if: { left: "{{note}}", op: "exists" },
            steps: [{ type: "action", intent: "Close", channel: "web", action: "press", args: { key: "Escape" } }],
          },
        },
        {
          op: "replace",
          step: "s1",
          with: {
            type: "action",
            intent: "Open it",
            channel: "web",
            action: "navigate",
            args: { url: "https://portal.example.com/upload" },
          },
        },
      ]),
    );
    expect(ids(edited)).toEqual(["start", "s1", "s2", "s3", "s4", "b1", "s6", "s5"]);
    expect(findStep(edited, "s1")).toMatchObject({ intent: "Open it" });
    const intoElse = ok(
      applyEdit(edited, {
        op: "insert",
        at: { into: "b1", arm: "else" },
        step: {
          id: "w1",
          type: "action",
          intent: "Wait",
          channel: "web",
          action: "wait_for",
          check: { text_visible: "Done" },
        },
      }),
    );
    expect(findStep(intoElse, "b1")).toMatchObject({ else: [{ id: "w1" }] });
  });

  it("refuses an edit that breaks the workflow, saying which step and why", () => {
    const missing = applyEdit(skill, { op: "remove", step: "s3" });
    expect(missing).toEqual({
      ok: false,
      problems: [expect.stringMatching(/^s4 \(args\.text\): \{\{note\}\} uses note, which is not declared/)],
    });

    const typo = applyEdit(skill, { op: "set", step: "s3", field: "inputs", value: ["{{invoice.nmae}}"] });
    expect(typo.ok || typo.problems[0]).toMatch(
      /s3 \(inputs\.0\): \{\{invoice\.nmae\}\} has no such field: invoice is a file/,
    );

    const cases: [Edit, RegExp][] = [
      [{ op: "remove", step: "start" }, /trigger can't be removed/],
      [
        {
          op: "insert",
          at: { before: "start" },
          step: { type: "action", intent: "x", channel: "web", action: "click" },
        },
        /before the trigger/,
      ],
      [{ op: "retarget", step: "s3", target: { name: "x" } }, /llm step: only actions have a target/],
      [{ op: "set", step: "s1", field: "instruction", value: "x" }, /action step has no field instruction/],
      [{ op: "move", step: "s9", to: { after: "s1" } }, /no step s9/],
      [
        { op: "insert", at: { into: "s1" }, step: { type: "action", intent: "x", channel: "web", action: "click" } },
        /not a loop or branch/,
      ],
      [{ op: "set", step: "s2", field: "timeout_ms", value: -1 }, /^s2 \(timeout_ms\): /],
      [
        { op: "insert", at: { after: "s1" }, step: { type: "action", intent: "x", channel: "web", action: "fly" } },
        /action is not supported/,
      ],
    ];
    for (const [edit, problem] of cases) {
      const result = applyEdit(skill, edit);
      expect(result.ok ? "accepted" : result.problems.join("; ")).toMatch(problem);
    }
  });

  it("describes edits in words", () => {
    expect(describeEdit({ op: "retarget", step: "s5", target: { role: "button", name: "Submit invoice" } })).toBe(
      's5: target is now button "Submit invoice"',
    );
    expect(describeEdit({ op: "move", step: "s6", to: { into: "b1", arm: "else", at: "start" } })).toBe(
      "moved s6 first in b1 (else)",
    );
  });
});

describe("what a repair may never change", () => {
  const violations = (edits: Edit[]) => repairViolations(skill, ok(applyEdits(skill, edits)));

  it("allows retargeting, a new harmless step, and waits", () => {
    expect(
      violations([
        { op: "retarget", step: "s5", target: { role: "button", name: "Submit invoice" } },
        {
          op: "insert",
          at: { after: "s1" },
          step: {
            type: "action",
            intent: "Banner",
            channel: "web",
            action: "click",
            target: { role: "button", name: "Accept cookies" },
          },
        },
        { op: "set", step: "s2", field: "wait", value: { text_visible: "Upload" } },
      ]),
    ).toEqual([]);
  });

  it("refuses outward steps, the user's decisions, safety switches and new reach", () => {
    const cases: [Edit[], RegExp][] = [
      [
        [
          {
            op: "insert",
            at: { after: "s4" },
            step: { type: "action", intent: "x", channel: "web", action: "click", target: { name: "Send now" } },
          },
        ],
        /new step can't act outward/,
      ],
      [
        [{ op: "retarget", step: "s4", target: { role: "textbox", name: "Delete draft" } }],
        /s4: it matches the user's Never rule/,
      ],
      [
        [
          {
            op: "replace",
            step: "s4",
            with: { type: "action", intent: "x", channel: "web", action: "click", target: { name: "Pay now" } },
          },
        ],
        /s4: it would now act outward/,
      ],
      [
        [
          {
            op: "insert",
            at: { after: "s1" },
            step: { type: "action", intent: "x", channel: "web", action: "click", target: { name: "Delete draft" } },
          },
        ],
        /Never rule "Never click Delete draft"/,
      ],
      [[{ op: "set", step: "s5", field: "requires_approval", value: false }], /approval can't be turned off/],
      [[{ op: "set", step: "s4", field: "args", value: { text: "hello" } }], /args are the user's values/],
      [[{ op: "set", step: "s3", field: "instruction", value: "Anything" }], /instruction is the user's/],
      [[{ op: "set", step: "start", field: "intent", value: "Daily" }], /trigger .* can't change/],
      [[{ op: "set_skill", field: "description", value: { goal: "Something else" } }], /description is the user's/],
      [
        [
          {
            op: "insert",
            at: { after: "s1" },
            step: { type: "action", intent: "x", channel: "script", action: "shell", args: { command: "ls" } },
          },
        ],
        /can't add scripts/,
      ],
      [
        [
          {
            op: "insert",
            at: { after: "s1" },
            step: {
              type: "action",
              intent: "x",
              channel: "web",
              action: "navigate",
              args: { url: "https://evil.example.net/" },
            },
          },
        ],
        /evil\.example\.net is a site this workflow doesn't use/,
      ],
      [[{ op: "remove", step: "s5" }], /needs approval can't be removed/],
      [
        [
          {
            op: "replace",
            step: "s2",
            with: { type: "action", intent: "x", channel: "web", action: "click", target: { name: "Upload now" } },
          },
        ],
        /s2: it would now act outward/,
      ],
    ];
    for (const [edits, problem] of cases) expect(violations(edits).join("; ")).toMatch(problem);
  });

  it("lets a confirmation follow an outward step, only right after it and only with approval", () => {
    const confirm = (extra: Record<string, unknown>) => ({
      type: "action",
      intent: "Confirm sending",
      channel: "web",
      action: "click",
      target: { role: "button", name: "Confirm" },
      ...extra,
    });
    expect(violations([{ op: "insert", at: { after: "s5" }, step: confirm({ requires_approval: true }) }])).toEqual([]);
    expect(violations([{ op: "insert", at: { after: "s5" }, step: confirm({}) }]).join()).toMatch(/can't act outward/);
    expect(
      violations([{ op: "insert", at: { after: "s4" }, step: confirm({ requires_approval: true }) }]).join(),
    ).toMatch(/can't act outward/);
  });

  it("knows outward steps by their control's words", () => {
    expect(isOutward(findStep(skill, "s5") as never)).toBe(true);
    expect(isOutward(findStep(skill, "s4") as never)).toBe(false);
  });
});

describe("the briefing", () => {
  it("documents every action a workflow can use, generated from the code", () => {
    for (const [channel, actions] of Object.entries(ACTIONS)) {
      if (channel === "vision") continue;
      for (const action of actions)
        expect(ACTION_DOCS, `${channel}.${action}`).toHaveProperty([`${channel}.${action}`]);
    }
    const text = briefing({ edits: true, available: { extension: true, macApp: false } });
    expect(text).toContain("- fs.find { dir, glob");
    expect(text).toContain("{ op: retarget, step, target: Locator }");
    expect(text).toContain("- action: intent, requires_approval");
    expect(text).toContain("Task Player.app running: no (ax steps can't run or be tried)");
    expect(briefing()).not.toContain("Edit operations");
  });

  it("edits the real skills without breaking them", () => {
    const dir = join(import.meta.dirname, "../../../skills/real");
    const inbox = Skill.parse(JSON.parse(readFileSync(join(dir, "sort-inbox.json"), "utf8")));
    const nested = ok(applyEdit(inbox, { op: "set", step: "s2", field: "timeout_ms", value: 5000 }));
    expect(findStep(nested, "s2")).toMatchObject({ timeout_ms: 5000 });
    expect(repairViolations(inbox, nested)).toEqual([]);
  });
});
