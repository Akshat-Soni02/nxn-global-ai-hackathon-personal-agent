// The "+" forms (AddNode.tsx, R4): each makes a step the workflow takes, through the same insert edit the daemon
// applies, or says what is missing.
import { applyEdits, type EditInput, findStep, Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { editsFor, type Kind, stepOf } from "./AddNode.tsx";

const base = Skill.parse({
  id: "w",
  name: "w",
  version: 1,
  description: { goal: "g" },
  steps: [
    { id: "start", type: "trigger", intent: "t" },
    {
      id: "s1",
      type: "action",
      intent: "open",
      channel: "web",
      action: "navigate",
      args: { url: "https://example.com" },
    },
  ],
});

describe('"Ask me" and "Wait for my OK" (B4)', () => {
  // Both are fields on the step that follows the spot: it asks first, or waits for the user's OK before it runs.
  const two = Skill.parse({
    ...base,
    steps: [
      ...base.steps,
      { id: "s2", type: "action", intent: "send", channel: "web", action: "click", target: { name: "Send" } },
    ],
  });
  const apply = (edits: EditInput[] | string) => {
    if (typeof edits === "string") throw new Error(edits);
    const done = applyEdits(two, edits);
    if (!done.ok) throw new Error(done.problems.join("; "));
    return done.skill;
  };

  it("Wait for my OK sets the approval on the step after the spot", () => {
    const done = apply(editsFor("approve", {}, { after: "s1" }, two));
    expect(findStep(done, "s2")).toMatchObject({ requires_approval: true });
    expect(findStep(done, "s1")).toMatchObject({ requires_approval: false });
    // Picking the spot from the other side is the same step.
    expect(editsFor("approve", {}, { before: "s2" }, two)).toEqual(editsFor("approve", {}, { after: "s1" }, two));
  });

  it("Ask me puts a question on the step after the spot: a value it saves, or a yes/no", () => {
    const value = apply(editsFor("ask", { question: "Which month?", name: "Month" }, { before: "s2" }, two));
    expect(findStep(value, "s2")).toMatchObject({
      ask: { question: "Which month?", kind: "value", output: { name: "month", type: { type: "text" } } },
    });
    const yesNo = apply(editsFor("ask", { question: "Send it now?", answer: "yes/no" }, { before: "s2" }, two));
    expect(findStep(yesNo, "s2")).toMatchObject({ ask: { question: "Send it now?", kind: "confirm" } });
  });

  it("says why when there is no step after the spot, or no question", () => {
    expect(editsFor("approve", {}, { after: "s2" }, two)).toMatch(/no step after/);
    expect(editsFor("ask", { question: "" }, { before: "s2" }, two)).toMatch(/say what to ask/);
  });

  it("the older kinds still insert a step", () => {
    const edits = editsFor("open", { url: "https://example.com/x" }, { after: "s1" }, two);
    expect(edits).toEqual([expect.objectContaining({ op: "insert", at: { after: "s1" } })]);
  });
});

const add = (skill: Skill, kind: Kind, form: Record<string, string>, after = "s1") => {
  const step = stepOf(kind, form);
  if (typeof step === "string") throw new Error(step);
  const done = applyEdits(skill, [{ op: "insert", at: { after }, step }]);
  if (!done.ok) throw new Error(done.problems.join("; "));
  return done.skill;
};

describe("adding a step by hand", () => {
  it("makes each kind a step the workflow takes", () => {
    let w = add(base, "open", { url: "https://example.com/jobs" });
    w = add(w, "click", { name: "Next", role: "button" });
    w = add(w, "type", { label: "Search", text: "{{today|D MMM}}" });
    w = add(w, "read", { css: "h1", save_as: "Page title" });
    // Reads what the read step saved: the variable check passes because it comes after it.
    const read = w.steps.find((s) => "output" in s && s.output?.name === "page_title");
    w = add(
      w,
      "ai",
      { instruction: "the title's first word", reads: "page_title", output: "text", save_as: "word" },
      read?.id,
    );
    w = add(w, "files", { dir: "~/Downloads", glob: "*.pdf", pick: "newest", save_as: "invoice" });
    expect(w.steps.length).toBe(base.steps.length + 6);
    expect(w.steps.find((s) => s.type === "action" && s.channel === "fs")).toMatchObject({ action: "find" });
  });

  it("says what is missing instead of making a step that can't run", () => {
    expect(stepOf("open", { url: "example.com" })).toMatch(/https/);
    expect(stepOf("read", {})).toMatch(/name what it reads/);
    expect(stepOf("app", { tool: "X", arguments: "{" })).toMatch(/JSON/);
  });

  it("is refused by the workflow when the AI reads something nothing saves", () => {
    expect(() => add(base, "ai", { instruction: "x", reads: "nothing_here", save_as: "y" })).toThrow(/nothing_here/);
  });
});
