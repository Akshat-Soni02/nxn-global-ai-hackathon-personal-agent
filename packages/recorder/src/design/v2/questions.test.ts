import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import type { Question } from "../../compile.ts";
import { askBatch, batchOf, openCodeQuestions } from "./questions.ts";
import type { QueuedQuestion } from "./session.ts";

const skill = (pick: string) =>
  Skill.parse({
    id: "w",
    name: "w",
    version: 1,
    description: { goal: "g" },
    steps: [
      {
        id: "start",
        type: "trigger",
        intent: "by hand",
        inputs: { invoice: { type: { type: "file" }, resolve: { dir: "~/Downloads", glob: "*.pdf", pick } } },
      },
      {
        id: "s2",
        type: "action",
        intent: "read it",
        channel: "fs",
        action: "read",
        args: { path: "{{invoice.path}}" },
      },
    ],
  });
const file: Question = {
  id: "file-s2",
  text: "Which file next time?",
  appliesTo: "steps.start.inputs.invoice.resolve.pick",
  options: [{ label: "the newest one", value: "newest" }],
};
const row: Question = { id: "row-s5", text: "Which row?", appliesTo: "steps.s5.args.where" };
const theirs = (id: string, step: string): QueuedQuestion => ({ id, text: `${id}?`, why: "x", step, options: [] });

describe("the questions left after a design", () => {
  it("asks code's question only when the design left its answer's place as it was", () => {
    expect(openCodeQuestions([file], skill("ask"), skill("ask"))).toEqual([file]);
    expect(openCodeQuestions([file], skill("ask"), skill("all"))).toEqual([]); // the agent decided: all of them
  });

  it("asks once about a step code and the agent both ask about, five at most", () => {
    const many = ["a", "b", "c", "d"].map((x) => theirs(x, x));
    const batch = batchOf([row], [theirs("q1", "s5"), theirs("q2", "s2"), ...many]);
    expect(batch.code).toEqual([row]);
    expect(batch.agent.map((q) => q.id)).toEqual(["q2", "a", "b", "c"]);
  });

  it("asks about the start of a workflow from both: code's input question doesn't silence the agent's on cadence", () => {
    const batch = batchOf([file], [theirs("q1", "start")]);
    expect(batch.code).toEqual([file]);
    expect(batch.agent.map((q) => q.id)).toEqual(["q1"]);
  });

  it("keeps what it didn't ask, so the defaults are taken and the review lists them", () => {
    const many = ["a", "b", "c", "d"].map((x) => theirs(x, x));
    const batch = batchOf([row], [theirs("q1", "s5"), theirs("q2", "s2"), ...many]);
    expect(batch.skipped.agent.map((q) => q.id)).toEqual(["q1", "d"]);
    expect(batch.skipped.code).toEqual([]);
  });

  it("puts every question to the user at once: one batch, not one after another", async () => {
    let open = 0;
    let most = 0;
    const prompter = {
      ask: async (q: Question) => {
        open++;
        most = Math.max(most, open);
        await new Promise((r) => setTimeout(r, 5));
        open--;
        return q.id === "file-s2" ? "the newest one" : "A4";
      },
    };
    const answers = await askBatch(prompter, skill("ask"), [file], [theirs("q1", "s5")]);
    expect(most).toBe(2);
    expect(answers.code).toEqual([{ question: file, answer: "the newest one" }]);
    expect(answers.agent[0]?.answer).toBe("A4");
  });
});
