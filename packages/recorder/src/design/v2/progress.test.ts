import { describe, expect, it } from "vitest";
import { progressLine } from "./progress.ts";

describe("the design agent's work, in plain words", () => {
  it("says what it changes and asks, never its bookkeeping", () => {
    const call = (tool: string, input: unknown) => progressLine({ type: "call", turn: 1, tool, input });
    expect(call("remove", { steps: ["s2", "s5"], why: "clicks that changed nothing" })).toBe(
      "Removing s2, s5: clicks that changed nothing",
    );
    expect(call("loop", { steps: ["s4"], item: { name: "email" } })).toBe("Repeating s4 for each email");
    const whole = [
      { do: "type", intent: "Type the title" },
      { do: "click", intent: "Save" },
    ];
    expect(call("loop", { steps: whole, item: { name: "story" } })).toBe(
      "Repeating Type the title, Save for each story",
    );
    expect(call("accept", { proposal: "p1", why: "the date is today" })).toBe(
      "Using a pattern from the recording: the date is today",
    );
    expect(call("ask", { question: "Newest email, or all unread?" })).toBe(
      "A question for you: Newest email, or all unread?",
    );
    expect(call("look", { step: "s3" })).toBeUndefined();
    expect(progressLine({ type: "invalid", turn: 1, error: "bad input" })).toBeUndefined();
    expect(progressLine({ type: "end", turn: 3, outcome: { kind: "finished", tool: "done", value: {} } })).toBe("Done");
  });
});
