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

describe("a step in a drawn area (A2)", () => {
  it("is the user's to settle (connect the app), not drift: no ladder, no model", () => {
    const c = classify(
      failure(
        "this step types into a drawn area replay can't reach (a sheet's cells): use the connected app that covers this page (connect it in Apps), then run it again",
      ),
    );
    expect(c.class).toBe("environment");
    expect(c.need).toMatch(/connect it in Apps/);
  });
});

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

describe("a download held by Chrome's Save-as dialog (A5)", () => {
  it("is the user's to settle (choose a place, or turn the setting off), not drift a repair could spend on", () => {
    const c = classify(
      failure(
        'Chrome is asking where to save the download (your setting "Ask where to save each file before downloading"): choose a place in the automation window and go on, or turn that setting off so runs can download on their own',
      ),
    );
    expect(c.class).toBe("environment");
    expect(c.need).toMatch(/choose a place/);
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
