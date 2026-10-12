// The service with the real interpreter and fake channels: runs that wait in the inbox, go on after an answer, and
// survive a daemon restart (a new service on the same database file).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionStep, Skill } from "@shadow/core";
import { type RunDeps, type RunOutcome, runSkill } from "@shadow/player";
import { describe, expect, it } from "vitest";
import { createService, type Execute, type ServiceEvent } from "./service.ts";
import { saveSkill } from "./skill-store.ts";
import { openStore } from "./store.ts";

const write = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "action",
  intent: `write ${id}`,
  channel: "fs",
  action: "write",
  args: { path: "~/out.txt", content: id },
  ...extra,
});

function setup(steps: unknown[]) {
  const dataDir = mkdtempSync(join(tmpdir(), "shadow-service-"));
  saveSkill(
    dataDir,
    Skill.parse({
      id: "report",
      name: "Weekly report",
      version: 1,
      description: { goal: "send the report" },
      steps: [{ id: "start", type: "trigger", intent: "by hand", inputs: {} }, ...steps],
    }),
  );
  const ran: string[] = [];
  // The real interpreter, with channels that only record which steps ran.
  const execute: Execute = (skill, leg) => {
    const channel = async (step: ActionStep) => {
      ran.push(step.id);
      return { ok: true };
    };
    const deps: RunDeps = {
      web: channel,
      fs: channel,
      script: channel,
      fileExists: async () => true,
      webCheck: async () => true,
      approve: leg.hooks.approve,
      ask: leg.hooks.ask,
      log: leg.log,
    };
    return runSkill(skill, deps, { runId: leg.runId, inputs: leg.provided, resume: leg.resume });
  };
  const db = join(dataDir, "shadow.db");
  const open = (exec: Execute = execute) => {
    const events: ServiceEvent[] = [];
    const service = createService({ dataDir, store: openStore(db), execute: exec });
    service.subscribe((e) => events.push(e));
    return { service, events };
  };
  return { open, ran, dataDir };
}

describe("the daemon as a service", () => {
  it("keeps a run that needs approval in the inbox, and finishes it after a restart once it is approved", async () => {
    const { open, ran } = setup([write("s1"), write("s2", { requires_approval: true }), write("s3")]);
    const first = open();
    const started = first.service.start("report");
    await first.service.idle();
    expect(first.service.runs()[0]).toMatchObject({ id: started.id, status: "waiting", failedStep: "s2" });
    const [item] = first.service.inbox({ open: true });
    expect(item).toMatchObject({ kind: "approval", runId: started.id, path: "s2", title: "Approve: write s2" });
    expect(ran).toEqual(["s1"]);

    // The daemon restarts: nothing was held in memory.
    const second = open();
    expect(second.service.recover()).toEqual({ interrupted: [], expired: [] });
    second.service.answer(item?.id as string, "approve");
    await second.service.idle();
    expect(second.service.runs()[0]).toMatchObject({
      status: "succeeded",
      checkpoint: undefined,
      failedStep: undefined,
    });
    expect(ran).toEqual(["s1", "s2", "s3"]);
    expect(second.service.inbox({ open: true })).toEqual([]);
    expect(second.events.map((e) => (e.type === "run" ? e.run.status : e.type))).toContain("succeeded");
  });

  it("ends the run as denied when the answer is no, and refuses a second answer", async () => {
    const { open, ran } = setup([write("s1", { requires_approval: true })]);
    const { service } = open();
    service.start("report");
    await service.idle();
    const [item] = service.inbox({ open: true });
    service.answer(item?.id as string, "deny");
    await service.idle();
    expect(service.runs()[0]?.status).toBe("denied");
    expect(ran).toEqual([]);
    expect(() => service.answer(item?.id as string, "approve")).toThrow("already answered");
  });

  it("goes on after a question with the typed answer", async () => {
    const ask = { question: "How many rows?", kind: "value", output: { name: "n", type: { type: "number" } } };
    const { open, ran } = setup([write("s1", { ask }), write("s2")]);
    const { service } = open();
    service.start("report");
    await service.idle();
    const [item] = service.inbox({ open: true });
    expect(item).toMatchObject({ kind: "ask", title: "How many rows?" });
    service.answer(item?.id as string, "12");
    await service.idle();
    expect(service.runs()[0]?.status).toBe("succeeded");
    expect(ran).toEqual(["s1", "s2"]);
  });

  it("stops a run waiting for recovery when told to, and cancels a waiting run with its open items", async () => {
    const waitingForRecovery: RunOutcome = {
      status: "waiting",
      vars: {},
      failedStep: "s1",
      resume: { at: "s1", vars: {} },
      waiting: { kind: "recovery", path: "s1", stepId: "s1", message: "s1 needs you: log in to Xero." },
    };
    const { open } = setup([write("s1"), write("s2", { requires_approval: true })]);
    const recovery = open(async () => waitingForRecovery);
    recovery.service.start("report");
    await recovery.service.idle();
    const [item] = recovery.service.inbox({ open: true });
    expect(item).toMatchObject({ kind: "recovery", detail: { options: ["retry", "skip", "stop"] } });
    expect(() => recovery.service.answer(item?.id as string, "maybe")).toThrow("retry, skip or stop");
    recovery.service.answer(item?.id as string, "stop");
    expect(recovery.service.runs()[0]?.status).toBe("cancelled");

    const { service } = open();
    const run = service.start("report");
    await service.idle();
    expect(service.cancel(run.id).status).toBe("cancelled");
    expect(service.inbox({ open: true })).toEqual([]);
    expect(() => service.cancel(run.id)).toThrow("already ended");
  });

  it("marks runs left going by a stopped daemon as interrupted, and expires questions nobody can receive", async () => {
    const { open, dataDir } = setup([write("s1")]);
    const store = openStore(join(dataDir, "shadow.db"));
    store.startRun({ id: "crashed", skillId: "report", version: 1, trigger: "manual", startedAt: 1 });
    store.close();
    const first = open();
    void first.service.ask({ title: "Which file?", default: "~/Downloads/a.pdf" });
    const { service } = open();
    expect(service.recover()).toMatchObject({ interrupted: ["crashed"], expired: [expect.any(String)] });
    expect(service.runs()[0]?.status).toBe("interrupted");
    expect(service.inbox({ open: true })).toEqual([]);
  });

  it("answers a question in the inbox", async () => {
    const { open } = setup([write("s1")]);
    const { service } = open();
    const answer = service.ask({ title: "Is this always the newest email?", options: ["yes", "no"] });
    const [item] = service.inbox({ open: true });
    service.answer(item?.id as string, "yes");
    await expect(answer).resolves.toBe("yes");
  });

  it("records a repair that lands during a run: the run's version, a repaired flag and an item to review", async () => {
    const { open } = setup([write("s1")]);
    const { service } = open(async (_skill, leg) => {
      leg.log({
        type: "repair",
        path: "s1",
        outcome: "commit",
        class: "drift",
        by: "ladder",
        summary: "s1 retargeted",
        version: 2,
        costUsd: 0.01,
      });
      return { status: "succeeded", vars: {} };
    });
    service.start("report");
    await service.idle();
    expect(service.runs()[0]).toMatchObject({ status: "succeeded", version: 2, repaired: true });
    expect(service.inbox({ open: true })[0]).toMatchObject({ kind: "repaired", detail: { version: 2 } });
  });
});

describe("the workflow lifecycle", () => {
  const failing = async (): Promise<RunOutcome> => ({
    status: "failed",
    vars: {},
    failedStep: "s1",
    error: "target not found",
  });

  it("goes live only with a trigger; setting the Frequency saves a version by you", () => {
    const { open } = setup([write("s1")]);
    const { service } = open();
    expect(service.state("report")).toMatchObject({ state: "draft" });
    expect(() => service.goLive("report")).toThrow("it has no trigger");
    expect(service.setTrigger("report", [{ type: "schedule", cron: "0 9 * * 1-5" }])).toEqual({ version: 2 });
    expect(service.workflow("report")?.latest.history.at(-1)).toMatchObject({
      by: "user",
      summary: "Frequency: schedule 0 9 * * 1-5",
    });
    expect(service.goLive("report")).toMatchObject({ state: "live" });
    expect(service.workflows()[0]).toMatchObject({ state: { state: "live" }, nextRunAt: expect.any(Number) });
    expect(service.pause("report")).toMatchObject({ state: "paused", reason: "paused by you" });
    expect(service.workflows()[0]?.nextRunAt).toBeUndefined();
  });

  it("pauses itself after 3 failed runs started by its trigger, and says so; resume makes it live again", async () => {
    const { open } = setup([write("s1")]);
    const { service } = open(failing);
    service.setTrigger("report", [{ type: "schedule", cron: "0 9 * * *" }]);
    service.goLive("report");
    // Failures started by hand don't count.
    service.start("report");
    service.start("report");
    await service.idle();
    expect(service.state("report").state).toBe("live");
    for (let i = 0; i < 3; i++) {
      service.fire("report", "schedule");
      await service.idle();
    }
    expect(service.state("report")).toMatchObject({
      state: "paused",
      auto: true,
      reason: expect.stringContaining("last 3 runs failed"),
    });
    const [item] = service.inbox({ open: true });
    expect(item).toMatchObject({ kind: "paused", skillId: "report" });
    service.answer(item?.id as string, "resume");
    expect(service.state("report").state).toBe("live");
  });

  it("skips a triggered run while the previous one waits for you, and says why", async () => {
    const { open } = setup([write("s1", { requires_approval: true })]);
    const { service } = open();
    service.start("report");
    await service.idle();
    expect(service.fire("report", "schedule")).toMatchObject({
      status: "skipped",
      trigger: "schedule",
      error: "skipped: the last run still waits for you",
    });
  });
});
