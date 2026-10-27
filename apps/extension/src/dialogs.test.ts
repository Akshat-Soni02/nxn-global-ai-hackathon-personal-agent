import { describe, expect, it } from "vitest";
import { answerDialog, DialogLog, dialogProblem } from "./dialogs.ts";

describe("a page's own dialogs during a step (A5)", () => {
  it("accepts one that only tells you something, so the page never hangs behind it", () => {
    expect(answerDialog({ type: "alert", message: "Saved" }, { approved: false })).toEqual({ accept: true });
    expect(answerDialog({ type: "beforeunload", message: "" }, { approved: false })).toEqual({ accept: true });
  });

  it("answers a question only in a step you approved: that act is what the question is about", () => {
    const confirm = { type: "confirm", message: "Delete 3 items?" } as const;
    expect(answerDialog(confirm, { approved: true })).toEqual({ accept: true });
    expect(answerDialog({ type: "prompt", message: "Name?", defaultPrompt: "Draft" }, { approved: true })).toEqual({
      accept: true,
      promptText: "Draft",
    });
    // Not approved: nothing says what to answer, so it is dismissed (the page goes on) and the step will say so.
    expect(answerDialog(confirm, { approved: false })).toEqual({ accept: false, unanswered: true });
  });

  it("keeps what a step's dialogs were, and turns an unanswered question into a failure with the page's words", () => {
    const log = new DialogLog();
    log.add(7, { type: "alert", message: "Saved" }, { accept: true });
    expect(dialogProblem(log.take(7))).toBeUndefined();
    log.add(7, { type: "confirm", message: "Delete 3 items?" }, { accept: false, unanswered: true });
    const problem = dialogProblem(log.take(7));
    expect(problem).toMatch(/^the page asked/);
    expect(problem).toMatch(/Delete 3 items\?/);
    expect(log.take(7)).toEqual([]); // taken once
    expect(log.take(8)).toEqual([]); // another tab's
  });
});
