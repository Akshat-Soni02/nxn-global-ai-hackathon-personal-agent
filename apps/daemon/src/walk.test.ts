// A walk-through through the service: a run with trigger "walk" waits in the inbox before every step, with the
// choices the window shows (do it / next, skip, stop), and goes on with the answer, also after a restart.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionStep, Skill } from "@shadow/core";
import { type RunDeps, runSkill } from "@shadow/player";
import { describe, expect, it } from "vitest";
import { createService, type Execute } from "./service.ts";
import { saveSkill } from "./skill-store.ts";
import { openStore } from "./store.ts";

const click = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "action",
  intent: `click ${name}`,
  channel: "web",
  action: "click",
  target: { role: "button", name, fallbacks: [`#${id}`] },
  ...extra,
});
const navigate = (id: string) => ({
  id,
  type: "action",
  intent: "open the page",
  channel: "web",
  action: "navigate",
  args: { url: "http://localhost:5173/page.html" },
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "shadow-walk-"));
  saveSkill(
    dataDir,
    Skill.parse({
      id: "report",
      name: "Weekly report",
      version: 1,
      description: { goal: "send the report" },
      steps: [
        { id: "start", type: "trigger", intent: "by hand", inputs: {} },
        navigate("s1"),
        click("s2", "Send", { requires_approval: true }),
        navigate("s3"),
      ],
    }),
  );
  const ran: string[] = [];
  const highlighted: string[] = [];
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
      walk: leg.walk ? leg.hooks.walk : undefined,
      highlight: async (step) => {
        highlighted.push(step.id);
      },
      log: leg.log,
    };
    return runSkill(skill, deps, { runId: leg.runId, inputs: leg.provided, resume: leg.resume });
  };
  const db = join(dataDir, "shadow.db");
  const open = () => createService({ dataDir, store: openStore(db), execute });
  return { open, ran, highlighted };
}

describe("walking through a workflow", () => {
  it("stops before each step with the right choices, runs reads on next and acting steps on do it", async () => {
    const { open, ran, highlighted } = setup();
    const service = open();
    const run = service.walk("report");
    expect(run.trigger).toBe("walk");
    await service.idle();

    // s1 opens a page: a read, so the choices are next / skip / stop.
    let [item] = service.inbox({ open: true });
    expect(item).toMatchObject({ kind: "walk", runId: run.id, path: "s1", title: "Next: open the page" });
    expect(item?.detail.options).toEqual(["next", "skip", "stop"]);
    service.answer(item?.id as string, "next");
    await service.idle();
    expect(ran).toEqual(["s1"]);

    // s2 sends: acting, so do it / skip / stop, with its target outlined first.
    [item] = service.inbox({ open: true });
    expect(item).toMatchObject({ kind: "walk", path: "s2", title: "Do it: click Send" });
    expect(item?.detail.options).toEqual(["do it", "skip", "stop"]);
    expect(highlighted).toEqual(["s2"]);
    // "do it" is the approval: no separate approval item follows.
    service.answer(item?.id as string, "do it");
    await service.idle();
    expect(ran).toEqual(["s1", "s2"]);
    [item] = service.inbox({ open: true });
    expect(item).toMatchObject({ kind: "walk", path: "s3" });

    // A restart in the middle: the walk goes on from its checkpoint.
    const second = open();
    second.answer(item?.id as string, "skip");
    await second.idle();
    expect(ran).toEqual(["s1", "s2"]);
    expect(second.runs()[0]).toMatchObject({ id: run.id, status: "succeeded" });
  });

  it("ends the walk when the user stops, and never counts it towards auto-pause", async () => {
    const { open } = setup();
    const service = open();
    const run = service.walk("report");
    await service.idle();
    const [item] = service.inbox({ open: true });
    service.answer(item?.id as string, "stop");
    await service.idle();
    expect(service.runs()[0]).toMatchObject({ id: run.id, status: "cancelled" });
    expect(service.state("report").state).toBe("draft");
  });
});
