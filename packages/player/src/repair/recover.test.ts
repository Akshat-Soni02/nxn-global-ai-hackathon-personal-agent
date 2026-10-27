// Recovery that waits for the user instead of holding the run: the run ends as `waiting` and goes on later from its
// resume. The repairer is scripted, so these tests are about runWithRecovery itself, not classification or repair.
import { type ActionStep, type Skill, Skill as SkillSchema, type Step } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { type RunDeps, type StepResult, WAIT } from "../types.ts";
import { runWithRecovery } from "./recover.ts";
import type { Repairer, RepairOutcome } from "./repair.ts";

const write = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "action",
  intent: `write ${id}`,
  channel: "fs",
  action: "write",
  args: { path: "~/out.txt", content: id },
  ...extra,
});

const skill = (steps: unknown[], version = 1): Skill =>
  SkillSchema.parse({
    id: "t",
    name: "test",
    version,
    description: { goal: "test" },
    steps: [{ id: "start", type: "trigger", intent: "by hand", inputs: {} }, ...steps],
  });

// Channels that fail the steps in `failing` once, and record what ran and what was approved.
function fake(failing: string[], approve: (step: Step) => Promise<boolean | typeof WAIT> = async () => true) {
  const ran: string[] = [];
  const approved: string[] = [];
  const left = new Set(failing);
  const channel = async (step: ActionStep): Promise<StepResult> => {
    if (left.delete(step.id)) return { ok: false, error: "target not found" };
    ran.push(step.id);
    return { ok: true };
  };
  const deps: RunDeps = {
    web: channel,
    fs: channel,
    script: channel,
    fileExists: async () => true,
    webCheck: async () => true,
    approve: async (step) => {
      approved.push(step.id);
      return approve(step);
    },
  };
  return { deps, ran, approved };
}

const repairer = (outcome: (s: Skill) => RepairOutcome): Repairer => ({
  repair: async (s) => outcome(s),
  spent: { episodes: 0, costUsd: 0 },
});
const classification = { class: "drift" as const, reason: "changed page" };

describe("recovery that waits", () => {
  it("ends as waiting when nobody can answer now, and goes on later after the step the user did by hand", async () => {
    const s = skill([write("s1"), write("s2")]);
    const escalate = repairer(() => ({ kind: "escalate", reason: "no safe fix", classification }));
    const first = fake(["s1"]);
    const waiting = await runWithRecovery(s, first.deps, {
      inputs: {},
      recovery: { repairer: escalate, saveVersion: (x) => x, waitForUser: async () => WAIT },
    });
    expect(waiting).toMatchObject({
      status: "waiting",
      waiting: { kind: "recovery", path: "s1", stepId: "s1", error: "target not found" },
      resume: { at: "s1" },
    });
    expect(waiting.waiting?.kind === "recovery" && waiting.waiting.message).toContain(
      "couldn't repair “write s1” (s1)",
    );

    // Later (perhaps after a restart): the user did s1 by hand and chose skip.
    const later = fake([]);
    const resume = { ...JSON.parse(JSON.stringify(waiting.resume)), skip: true };
    const done = await runWithRecovery(s, later.deps, {
      inputs: {},
      resume,
      recovery: { repairer: escalate, saveVersion: (x) => x, waitForUser: async () => WAIT },
    });
    expect(done.status).toBe("succeeded");
    expect(later.ran).toEqual(["s2"]);
  });

  it("puts a fix that needs the user's OK to them as a proposal, and saves it and goes on when they say use it (A3)", async () => {
    // In the daemon nobody can answer while a run is going: a repair that needs a yes (an app step that writes for
    // real) could never commit there. It waits as a proposal instead, with what it would do.
    const s = skill([write("s1"), write("s2")]);
    const fixed = skill([write("s1", { intent: "write s1 in the app" }), write("s2")], 2);
    const propose = repairer(() => ({
      kind: "propose",
      skill: fixed,
      summary: "do s1 in the app",
      what: 'APP_WRITE {"cell":"A1"}',
      edits: [],
      resume: { at: "s1", vars: {} },
      classification,
    }));
    const waiting = await runWithRecovery(s, fake(["s1"]).deps, {
      inputs: {},
      recovery: { repairer: propose, saveVersion: (x) => x, waitForUser: async () => WAIT },
    });
    expect(waiting).toMatchObject({
      status: "waiting",
      waiting: {
        kind: "recovery",
        path: "s1",
        proposal: { summary: "do s1 in the app", what: 'APP_WRITE {"cell":"A1"}' },
      },
    });
    const proposal = waiting.waiting?.kind === "recovery" ? waiting.waiting.proposal : undefined;
    expect(proposal?.skill.version).toBe(2);
    expect(waiting.waiting?.kind === "recovery" && waiting.waiting.message).toMatch(
      /Shadow can fix it: do s1 in the app/,
    );

    // Answered at once (the terminal): "use" saves the proposal and the run goes on with it.
    const saved: number[] = [];
    const now = fake(["s1"]);
    const done = await runWithRecovery(s, now.deps, {
      inputs: {},
      recovery: {
        repairer: propose,
        saveVersion: (x) => {
          saved.push(x.version);
          return x;
        },
        waitForUser: async () => "use",
      },
    });
    expect(saved).toEqual([2]);
    expect(done.status).toBe("succeeded");
    expect(now.ran).toEqual(["s1", "s2"]);
  });

  it("keeps a retargeted outward step's first-time approval across a wait", async () => {
    // s1 fails and is repaired; the fix retargeted s3 (outward) without running it. The run then waits for s2's
    // approval. When it goes on, s3 must still ask for approval although it doesn't require it in the workflow.
    const s = skill([write("s1"), write("s2", { requires_approval: true }), write("s3")]);
    const commit = repairer((current) => ({
      kind: "commit",
      skill: { ...current, version: 2 },
      summary: "s1 retargeted",
      edits: [],
      by: "ladder",
      resume: { at: "s1", vars: {} },
      approveOnce: ["s3"],
      classification,
    }));
    const recovery = { repairer: commit, saveVersion: (x: Skill) => x, waitForUser: async () => "stop" as const };
    const first = fake(["s1"], async () => WAIT);
    const waiting = await runWithRecovery(s, first.deps, { inputs: {}, recovery });
    expect(waiting).toMatchObject({
      status: "waiting",
      waiting: { kind: "approval", path: "s2" },
      resume: { at: "s2", approveOnce: ["s3"] },
    });

    const later = fake([]);
    const resume = { ...JSON.parse(JSON.stringify(waiting.resume)), answers: [{ kind: "approval", approved: true }] };
    expect(
      (
        await runWithRecovery(
          skill([write("s1"), write("s2", { requires_approval: true }), write("s3")], 2),
          later.deps,
          { inputs: {}, resume, recovery },
        )
      ).status,
    ).toBe("succeeded");
    expect(later.ran).toEqual(["s2", "s3"]);
    expect(later.approved).toEqual(["s3"]); // s2 used the saved answer; s3 asked
  });
});
