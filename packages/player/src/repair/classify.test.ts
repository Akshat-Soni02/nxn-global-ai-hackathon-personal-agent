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
