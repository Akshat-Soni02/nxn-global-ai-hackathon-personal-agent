import { ActionStep } from "@shadow/core";
import { describe, expect, it } from "vitest";
import type { Failure } from "../types.ts";
import { classify } from "./classify.ts";

const step = ActionStep.parse({
  id: "s7",
  type: "action",
  intent: "Close the email",
  channel: "web",
  action: "click",
  target: { role: "button", name: "Close", fallbacks: [] },
  args: {},
});
const failure = (error: string): Failure =>
  ({ stepId: "s7", path: "s7", step, result: { ok: false, error }, attempts: 1, vars: {} }) as Failure;

describe("a question the page asked (A5)", () => {
  it("is the user's to answer, not drift: no repair, no model, and the words say what to do", () => {
    const c = classify(
      failure(
        'the page asked "Delete 3 items?" (confirm) and nothing says what to answer: answer it by hand in the automation window, then go on',
      ),
    );
    expect(c.class).toBe("environment");
    expect(c.need).toMatch(/Delete 3 items\?.*by hand/);
  });
});

describe("a control that changed kind (C30)", () => {
  it("is drift a repair can fix, not bad data: a select that became a text box", () => {
    const pick = ActionStep.parse({
      id: "s3",
      type: "action",
      intent: "Choose a size",
      channel: "web",
      action: "select",
      target: { role: "combobox", name: "Size", fallbacks: [] },
      args: { value: "Large" },
    });
    const c = classify({
      stepId: "s3",
      path: "s3",
      step: pick,
      result: { ok: false, error: "target is not a <select>" },
      attempts: 1,
      vars: {},
    } as Failure);
    expect(c.class).toBe("drift");
  });
});

describe("a hung Chrome", () => {
  it("is the environment, with what to do, not an unknown failure", () => {
    for (const error of [
      "Chrome did not answer Accessibility.queryAXTree in 15 s",
      "extension did not answer run.step within 50000 ms",
    ]) {
      const c = classify(failure(error));
      expect(c.class).toBe("environment");
      expect(c.need).toMatch(/automation window/);
    }
  });
});
