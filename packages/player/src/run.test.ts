import type { ActionStep, Skill, Step } from "@taskplayer/core";
import { Skill as SkillSchema } from "@taskplayer/core";
import { describe, expect, it } from "vitest";
import { runSkill } from "./run.ts";
import type { RunDeps, StepResult } from "./types.ts";

const skill = (steps: unknown[], extra: Record<string, unknown> = {}, inputs: Record<string, unknown> = {}): Skill =>
  SkillSchema.parse({
    id: "t",
    name: "test",
    version: 1,
    description: { goal: "test" },
    steps: [{ id: "start", type: "trigger", intent: "by hand", inputs }, ...steps],
    ...extra,
  });

function deps(results: Record<string, StepResult[]>, overrides: Partial<RunDeps> = {}) {
  const calls: Step[] = [];
  const next = async (step: Step) => {
    calls.push(step);
    return results[step.id]?.shift() ?? { ok: true };
  };
  const d: RunDeps = {
    web: next,
    fs: next,
    script: next,
    fileExists: async () => true,
    webCheck: async () => true,
    approve: async () => true,
    ...overrides,
  };
  return { d, calls };
}

describe("runSkill", () => {
  it("passes inputs and typed outputs to later steps through references", async () => {
    const s = skill(
      [
        {
          id: "a",
          type: "action",
          intent: "find",
          channel: "fs",
          action: "find",
          args: { dir: "~", glob: "*", pick: "all" },
          output: { name: "found", type: { type: "list", items: { type: "file" } } },
        },
        {
          id: "b",
          type: "action",
          intent: "move",
          channel: "fs",
          action: "move",
          args: { from: "{{found}}", to: "~/x/{{n}}/{{found.0.name}}" },
        },
      ],
      {},
      { n: { type: { type: "text" } } },
    );
    const { d, calls } = deps({ a: [{ ok: true, value: ["/p/1.pdf", "/p/2.pdf"] }] });
    const out = await runSkill(s, d, { inputs: { n: "out" } });
    expect(out.status).toBe("succeeded");
    expect((calls[1] as ActionStep | undefined)?.args).toEqual({
      from: [
        { path: "/p/1.pdf", name: "1.pdf", size: 0, modified: "" },
        { path: "/p/2.pdf", name: "2.pdf", size: 0, modified: "" },
      ],
      to: "~/x/out/1.pdf",
    });
  });

  it("fails the step when its result does not fit the declared output type", async () => {
    const s = skill([
      {
        id: "a",
        type: "action",
        intent: "read the total",
        channel: "fs",
        action: "read",
        args: { path: "~/total.txt" },
        output: { name: "total", type: { type: "number" } },
      },
    ]);
    const { d } = deps({ a: [{ ok: true, value: "about twelve hundred" }] });
    expect(await runSkill(s, d, { inputs: {} })).toMatchObject({
      status: "failed",
      failedStep: "a",
      error: 'total should be number, got "about twelve hundred"',
    });
  });

  it("retries up to on_fail.retries, then fails the run at that step", async () => {
    const s = skill([
      { id: "a", type: "action", intent: "click", channel: "web", action: "navigate", on_fail: { retries: 2 } },
    ]);
    const { d, calls } = deps({
      a: [
        { ok: false, error: "x" },
        { ok: false, error: "y" },
        { ok: false, error: "z" },
      ],
    });
    const out = await runSkill(s, d, { inputs: {} });
    expect(calls).toHaveLength(3);
    expect(out).toMatchObject({ status: "failed", failedStep: "a", error: "z" });
  });

  it("succeeds on a retry", async () => {
    const s = skill([
      { id: "a", type: "action", intent: "nav", channel: "web", action: "navigate", on_fail: { retries: 1 } },
    ]);
    const { d } = deps({ a: [{ ok: false, error: "slow" }, { ok: true }] });
    expect((await runSkill(s, d, { inputs: {} })).status).toBe("succeeded");
  });

  it("stops before a step the user does not approve", async () => {
    const s = skill([
      { id: "a", type: "action", intent: "submit", channel: "web", action: "navigate", requires_approval: true },
    ]);
    const { d, calls } = deps({}, { approve: async () => false });
    expect(await runSkill(s, d, { inputs: {} })).toMatchObject({ status: "denied", failedStep: "a" });
    expect(calls).toHaveLength(0);
  });

  it("verifies file_exists checks after any channel", async () => {
    const s = skill([
      { id: "a", type: "action", intent: "w", channel: "fs", action: "write", check: { file_exists: "~/x" } },
    ]);
    const { d } = deps({}, { fileExists: async () => false });
    expect(await runSkill(s, d, { inputs: {} })).toMatchObject({ status: "failed", failedStep: "a" });
  });

  it("checks the skill's success list at the end", async () => {
    const s = skill([{ id: "a", type: "action", intent: "n", channel: "web", action: "navigate" }], {
      success: [{ text_visible: "Done" }],
    });
    const { d } = deps({}, { webCheck: async () => false });
    expect(await runSkill(s, d, { inputs: {} })).toMatchObject({ status: "failed", failedStep: "success" });
  });

  it("refuses an undeclared reference when the skill is parsed, and an unset input when it runs", async () => {
    const step = {
      id: "a",
      type: "action",
      intent: "n",
      channel: "web",
      action: "navigate",
      args: { url: "{{page}}" },
    };
    expect(() => skill([step])).toThrow("page, which is not declared by an earlier step");
    const s = skill([step], {}, { page: { type: { type: "text" } } });
    const { d, calls } = deps({});
    expect(await runSkill(s, d, { inputs: {} })).toMatchObject({
      status: "failed",
      failedStep: "a",
      error: "{{page}}: page has no value yet",
    });
    expect(calls).toHaveLength(0);
  });
});
