// The service with the real interpreter and fake channels: runs that wait in the inbox, go on after an answer, and
// survive a daemon restart (a new service on the same database file).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionStep, Skill } from "@shadow/core";
import { type RunDeps, type RunOutcome, runSkill } from "@shadow/player";
import { describe, expect, it } from "vitest";
import { NEEDS_APP } from "./mcp-tools.ts";
import { writeReview } from "./review-store.ts";
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
  const released: string[] = [];
  const open = (exec: Execute = execute, more: Partial<Parameters<typeof createService>[0]> = {}) => {
    const events: ServiceEvent[] = [];
    const service = createService({
      dataDir,
      store: openStore(db),
      execute: exec,
      release: (runId) => released.push(runId),
      ...more,
    });
    service.subscribe((e) => events.push(e));
    return { service, events };
  };
  return { open, ran, dataDir, released };
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

  it("stops a run in the middle: the step in progress is let go, and nothing after it runs", async () => {
    const { open, ran } = setup([write("s1"), write("s2"), write("s3")]);
    // s2 hangs until the run is stopped, as a page that never answers would.
    const exec: Execute = (skill, leg) => {
      const channel = async (step: ActionStep) => {
        ran.push(step.id);
        if (step.id === "s2") {
          await new Promise<void>((resolve) => leg.signal?.addEventListener("abort", () => resolve(), { once: true }));
          return { ok: false, error: "the page went away" };
        }
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
      return runSkill(skill, deps, { runId: leg.runId, inputs: leg.provided, signal: leg.signal });
    };
    const { service } = open(exec);
    const started = service.start("report");
    while (!ran.includes("s2")) await new Promise((r) => setTimeout(r, 5));
    expect(service.cancel(started.id).status).toBe("running");
    await service.idle();
    expect(service.runs()[0]).toMatchObject({ id: started.id, status: "cancelled", error: "you stopped it" });
    expect(ran).toEqual(["s1", "s2"]);
    expect(() => service.cancel(started.id)).toThrow(/already ended: cancelled/);
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
    const { open, released } = setup([write("s1"), write("s2", { requires_approval: true })]);
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
    // Both waiting runs kept their tabs while they waited; ended from the inbox, the tabs are let go.
    expect(released).toEqual([recovery.service.runs().at(-1)?.id, run.id]);
  });

  it("offers a proposed fix as Use it, saves it as the next version and goes on with it (A3)", async () => {
    const { open, ran } = setup([write("s1"), write("s2")]);
    const fixed = Skill.parse({
      id: "report",
      name: "Weekly report",
      version: 2,
      description: { goal: "send the report" },
      steps: [
        { id: "start", type: "trigger", intent: "by hand", inputs: {} },
        write("s1", { intent: "write s1 in the app" }),
        write("s2"),
      ],
      history: [{ version: 2, by: "debug", summary: "s1 done in the app", at: "2026-10-28T00:00:00.000Z" }],
    });
    let legs = 0;
    const proposing: Execute = async (skill, leg) => {
      legs++;
      if (legs === 1)
        return {
          status: "waiting",
          vars: {},
          failedStep: "s1",
          resume: { at: "s1", vars: {} },
          waiting: {
            kind: "recovery",
            path: "s1",
            stepId: "s1",
            message: "s1 failed: target not found. Shadow can fix it: s1 done in the app",
            proposal: { summary: "s1 done in the app", what: 's1: APP_WRITE {"a":1}', skill: fixed, edits: [] },
          },
        };
      // The leg after "Use it" runs the saved version, from the stuck step.
      ran.push(`v${skill.version}@${leg.resume?.at}`);
      return { status: "succeeded", vars: {} };
    };
    const { service } = open(proposing);
    service.start("report");
    await service.idle();
    const [item] = service.inbox({ open: true });
    expect(item).toMatchObject({ kind: "recovery", detail: { options: ["use", "retry", "skip", "stop"] } });
    service.answer(item?.id as string, "use");
    await service.idle();
    expect(service.runs()[0]?.status).toBe("succeeded");
    expect(ran).toContain("v2@s1");
    expect(service.workflow("report")?.versions).toEqual([1, 2]);
  });

  it("puts a run stopped for want of an app to the user as Connect and Run it again, once (A2)", async () => {
    const { open } = setup([write("s1")]);
    let runs = 0;
    const needsSheets: Execute = async () => {
      runs++;
      return {
        status: "failed",
        vars: {},
        error: `${NEEDS_APP}step s2 works in a drawn area of Google Sheets, which replay can't reach: connect Google Sheets in Apps, then run it again`,
      };
    };
    const { service } = open(needsSheets);
    service.start("report");
    await service.idle();
    const cards = () => service.inbox({ open: true }).filter((i) => i.kind === "question");
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toMatchObject({
      skillId: "report",
      title: "Weekly report needs Google Sheets connected",
      detail: { connect: { toolkit: "googlesheets", name: "Google Sheets" }, options: ["Run it again", "Not now"] },
    });
    // A second stop (a schedule's next tick) doesn't add a second card while one waits.
    service.start("report");
    await service.idle();
    expect(cards()).toHaveLength(1);
    service.answer(cards()[0]?.id as string, "Run it again");
    await service.idle();
    expect(runs).toBe(3);
  });

  it("tests the workflow, or one block of it, in safe mode from its page (R4.6, N1)", async () => {
    const { open } = setup([write("s1"), write("s2")]);
    const asked: { version: number; block?: string }[] = [];
    const { service } = open(undefined, {
      test: async (skill, block) => {
        asked.push({ version: skill.version, ...(block ? { block } : {}) });
        return { outcome: "succeeded", steps: [{ id: "s1", path: "s1", status: "done" }] };
      },
    });
    expect(await service.test("report")).toMatchObject({ outcome: "succeeded", steps: [{ id: "s1", status: "done" }] });
    await service.test("report", "b1");
    expect(asked).toEqual([{ version: 1 }, { version: 1, block: "b1" }]);
    await expect(service.test("nope")).rejects.toThrow(/no workflow nope/);
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
    // Options don't fence the person in: they may write their own answer, unless the question says it can't take one.
    expect(item?.detail).toMatchObject({ options: ["yes", "no"], freeText: true });
    service.answer(item?.id as string, "only on Mondays");
    await expect(answer).resolves.toBe("only on Mondays");
    void service.ask({ title: "Keep the AI step?", options: ["keep", "use the rule"], freeText: false });
    expect(service.inbox({ open: true })[0]?.detail).toMatchObject({ freeText: false });
  });

  it("dismisses the waiting questions of one recording and no other's, resolving them with the default (W1: Stop)", async () => {
    const { open } = setup([write("s1")]);
    const { service } = open();
    const mine = service.ask({ title: "Where to save?", sessionId: "rec-1" });
    void service.ask({ title: "Another recording's", sessionId: "rec-2" });
    void service.ask({ title: "From the terminal" });
    expect(service.dismissQuestions("rec-1")).toBe(1);
    await expect(mine).resolves.toBe("");
    const waiting = service.inbox({ open: true }).map((i) => i.title);
    expect(waiting).toEqual(expect.arrayContaining(["Another recording's", "From the terminal"]));
    expect(waiting).not.toContain("Where to save?");
  });

  it("keeps a drill question's step and draft with it, so the window can show it on the draft", () => {
    const { open } = setup([write("s1")]);
    const { service } = open();
    const draft = { id: "report", steps: [{ id: "start" }, { id: "s1" }] };
    void service.ask({ title: "Always the newest email?", step: "s1", draft });
    const [item] = service.inbox({ open: true });
    expect(item?.detail).toMatchObject({ step: "s1", draft });
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

describe("one automation window", () => {
  it("queues work that needs the window to itself (the design's test run) with the runs, never alongside", async () => {
    const { open } = setup([write("s1")]);
    const { service } = open();
    const order: string[] = [];
    const first = service.exclusive(async () => {
      order.push("test run starts");
      await new Promise((r) => setTimeout(r, 10));
      order.push("test run ends");
      return 1;
    });
    const second = service.exclusive(async () => {
      order.push("next starts");
      return 2;
    });
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(order).toEqual(["test run starts", "test run ends", "next starts"]);
  });
});

describe("the workflow lifecycle", () => {
  it("keeps waiting for Looks right when a later version (a new Frequency) is saved on top of the design", () => {
    const { open, dataDir } = setup([write("s1")]);
    const { service } = open();
    writeReview(dataDir, {
      skillId: "report",
      version: 1,
      summary: "x",
      notes: [],
      said: [],
      notTested: [],
      gaps: [],
      reviewed: false,
    });
    service.setTrigger("report", [{ type: "manual" }]);
    expect(() => service.goLive("report")).toThrow(/Looks right/);
  });

  it("waits for Looks right before a designed workflow goes live", () => {
    const { open, dataDir } = setup([write("s1")]);
    const { service } = open();
    const review = {
      skillId: "report",
      version: 1,
      summary: "x",
      notes: [],
      said: [],
      notTested: [],
      gaps: [],
      reviewed: false,
    };
    writeReview(dataDir, review);
    expect(() => service.goLive("report")).toThrow(/Looks right/);
    service.looksRight("report");
    expect(service.goLive("report")).toMatchObject({ state: "live" });
  });

  it("never goes live while its design says it can't do the task yet (checkpoint 6)", () => {
    const { open, dataDir } = setup([write("s1")]);
    const { service } = open();
    const cantRun = [
      "~/Desktop/Reading/23 Oct - Thuggee.pdf appeared in the recording, but no step makes a file there",
    ];
    writeReview(dataDir, {
      skillId: "report",
      version: 1,
      summary: "x",
      notes: [],
      said: [],
      notTested: [],
      gaps: [],
      cantRun,
      reviewed: true,
    });
    expect(() => service.goLive("report")).toThrow(/it can't do the task yet: .*no step makes a file there/);
  });

  const failing = async (): Promise<RunOutcome> => ({
    status: "failed",
    vars: {},
    failedStep: "s1",
    error: "target not found",
  });

  it("goes live run by hand too; on a schedule only once it can run without you; the Frequency saves a version", () => {
    const { open } = setup([write("s1")]);
    const { service } = open();
    expect(service.state("report")).toMatchObject({ state: "draft" });
    // Only by hand: live at once, nothing to check (you are there when it starts).
    expect(service.goLive("report")).toMatchObject({ state: "live" });
    expect(service.workflows()[0]?.nextRunAt).toBeUndefined();
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

  it("doesn't count runs that stopped for want of a connected app: nothing ran, and the user can fix it by connecting (A2)", async () => {
    const { open } = setup([write("s1")]);
    const needsApp = async (): Promise<RunOutcome> => ({
      status: "failed",
      vars: {},
      error: `${NEEDS_APP}step s1 uses GOOGLESHEETS_BATCH_UPDATE: connect googlesheets in Apps first`,
    });
    const { service } = open(needsApp);
    service.setTrigger("report", [{ type: "schedule", cron: "0 9 * * *" }]);
    service.goLive("report");
    for (let i = 0; i < 4; i++) {
      service.fire("report", "schedule");
      await service.idle();
    }
    expect(service.state("report").state).toBe("live"); // it would be paused after 3 real failures
  });

  describe("Run now asks which file to use, as the terminal does (C22)", () => {
    const succeed: Execute = async () => ({ status: "succeeded", vars: {} });

    it("settles the inputs first, then starts with the answer", async () => {
      const { open } = setup([write("s1")]);
      let given: Record<string, unknown> | undefined;
      const { service } = open(
        async (_skill, leg) => {
          given = leg.provided;
          return { status: "succeeded", vars: {} };
        },
        {
          chooseInputs: async (skill, provided) => {
            expect(skill.id).toBe("report");
            provided.invoice = "/tmp/invoice-1.pdf";
          },
        },
      );
      const run = await service.startAsking("report");
      await service.idle();
      expect(run.trigger).toBe("manual");
      expect(given).toEqual({ invoice: "/tmp/invoice-1.pdf" });
    });

    it("starts no run when the answer is wrong: it stops before anything runs", async () => {
      const { open } = setup([write("s1")]);
      const { service } = open(succeed, {
        chooseInputs: async () => {
          throw new Error("invoice: no file at /tmp/missing.pdf");
        },
      });
      await expect(service.startAsking("report")).rejects.toThrow(/no file at/);
      expect(service.runs()).toEqual([]);
    });

    it("is just a start when nothing is to be asked", async () => {
      const { open } = setup([write("s1")]);
      const { service } = open(succeed);
      expect((await service.startAsking("report")).skillId).toBe("report");
    });
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
