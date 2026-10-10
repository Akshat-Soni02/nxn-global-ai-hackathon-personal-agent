import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Skill } from "@taskplayer/core";
import { createDecoder, encode } from "@taskplayer/ipc";
import { createRepairer } from "@taskplayer/player/repair";
import { afterEach, describe, expect, it } from "vitest";
import { type Daemon, startDaemon } from "./daemon.ts";
import { type Recovery, runSkillFile } from "./runner.ts";

let daemon: Daemon | undefined;
afterEach(() => daemon?.close());

// Stands in for the extension: answers run.step / run.check over the real socket.
type Seen = { type: string; step?: { id: string; target?: { name?: string } }; op?: { op: string } };
function fakeExtension(socketPath: string, answer: (m: Seen) => object | undefined) {
  const socket = connect(socketPath);
  const seen: string[] = [];
  socket.on(
    "data",
    createDecoder((raw) => {
      const m = raw as Seen & { id: string; runId: string };
      seen.push(m.type);
      const reply = answer(m);
      if (reply) socket.write(encode({ id: m.id, runId: m.runId, ...reply }));
    }),
  );
  socket.write(encode({ id: "h", type: "hello", from: "extension", version: "test" }));
  return { seen, end: () => socket.end() };
}

describe("runSkillFile through the extension", () => {
  it("sends web steps and page checks to the extension, runs fs steps locally, and logs the run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tp-run-"));
    const socketPath = join(dir, "d.sock");
    daemon = await startDaemon({ socketPath });
    const ext = fakeExtension(socketPath, (m) =>
      m.type === "run.step"
        ? { type: "run.step_result", stepId: m.step?.id, ok: true, value: "Hello", matchScore: 1 }
        : m.type === "run.check"
          ? { type: "run.check_result", ok: true }
          : undefined,
    );
    const skillPath = join(dir, "skill.json");
    writeFileSync(
      skillPath,
      JSON.stringify({
        id: "mixed",
        version: 1,
        name: "web then fs",
        description: { goal: "web then fs" },
        steps: [
          { id: "start", type: "trigger", intent: "by hand" },
          {
            id: "s1",
            type: "action",
            intent: "read title",
            channel: "web",
            action: "extract",
            target: { fallbacks: ["h1"] },
            output: { name: "title", type: { type: "text" } },
          },
          {
            id: "s2",
            type: "action",
            intent: "save it",
            channel: "fs",
            action: "write",
            args: { path: join(dir, "out.txt"), content: "{{title}}" },
            requires_approval: true,
          },
        ],
        success: [{ text_visible: "Hello" }, { file_exists: join(dir, "out.txt") }],
      }),
    );

    const logDir = join(dir, "runs");
    const outcome = await runSkillFile(daemon, skillPath, {}, { approve: async () => true, log: () => {} }, logDir);

    expect(outcome.status).toBe("succeeded");
    expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe("Hello");
    await new Promise((r) => setTimeout(r, 50));
    expect(ext.seen).toEqual(["hello", "run.step", "run.check", "run.end"]);
    const [logFile] = readdirSync(logDir);
    const events = readFileSync(join(logDir, logFile as string), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).type);
    expect(events).toEqual([
      "run.start",
      "step.start",
      "step.result",
      "step.approval",
      "step.start",
      "step.result",
      "run.end",
    ]);
    ext.end();
  });

  it("fails the step, not the daemon, when the extension reports a miss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tp-run-"));
    const socketPath = join(dir, "d.sock");
    daemon = await startDaemon({ socketPath });
    const ext = fakeExtension(socketPath, (m) =>
      m.type === "run.step"
        ? { type: "run.step_result", stepId: m.step?.id, ok: false, error: "target not found" }
        : undefined,
    );
    const skillPath = join(dir, "skill.json");
    writeFileSync(
      skillPath,
      JSON.stringify({
        id: "miss",
        version: 1,
        name: "x",
        description: { goal: "x" },
        steps: [
          { id: "start", type: "trigger", intent: "by hand" },
          {
            id: "s1",
            type: "action",
            intent: "click",
            channel: "web",
            action: "click",
            target: { role: "button", name: "Go" },
          },
        ],
      }),
    );
    const outcome = await runSkillFile(
      daemon,
      skillPath,
      {},
      { approve: async () => true, log: () => {} },
      join(dir, "runs"),
    );
    expect(outcome).toMatchObject({ status: "failed", failedStep: "s1", error: "target not found" });
    ext.end();
  });
});

describe("recovery during a run", () => {
  // Click "Send" (stored as "Send now"), then write a file. The page renamed the button to "Send".
  async function setup(answer: (m: Seen, attempt: number) => object | undefined) {
    const dir = mkdtempSync(join(tmpdir(), "tp-run-"));
    const socketPath = join(dir, "d.sock");
    daemon = await startDaemon({ socketPath });
    let attempt = 0;
    const ext = fakeExtension(socketPath, (m) =>
      answer(m, m.type === "run.step" && m.step?.id === "s1" ? ++attempt : attempt),
    );
    const skillPath = join(dir, "skill.json");
    writeFileSync(
      skillPath,
      JSON.stringify({
        id: "send-report",
        version: 1,
        name: "Send the report",
        description: { goal: "Send the weekly report" },
        steps: [
          { id: "start", type: "trigger", intent: "by hand" },
          {
            id: "s1",
            type: "action",
            intent: "Open the report",
            channel: "web",
            action: "click",
            target: { role: "button", name: "Open report", fallbacks: ["#open"] },
            check: { text_visible: "Weekly report" },
          },
          {
            id: "s2",
            type: "action",
            intent: "Save a copy",
            channel: "fs",
            action: "write",
            args: { path: join(dir, "out.txt"), content: "done" },
          },
        ],
      }),
    );
    const saved: Skill[] = [];
    const asked: string[] = [];
    const recovery = (choice: "retry" | "skip" | "stop" = "retry"): Recovery => ({
      repairer: createRepairer(),
      saveVersion: (skill) => {
        saved.push(skill);
        return skill;
      },
      waitForUser: async (message) => {
        asked.push(message);
        return choice;
      },
      sleep: async () => {},
    });
    const events: { type: string; [k: string]: unknown }[] = [];
    const run = (r: Recovery) =>
      runSkillFile(
        daemon as Daemon,
        skillPath,
        {},
        { approve: async () => true, log: (e) => events.push(e), recovery: r },
        join(dir, "runs"),
      );
    return { dir, ext, run, recovery, saved, asked, events };
  }

  const page = (op: string, extra: object = {}) =>
    op === "signals"
      ? {
          type: "page.op_result",
          ok: true,
          value: {
            url: "https://reports.example.com/",
            title: "Reports",
            loginLike: false,
            dialogs: [],
            readyState: "complete",
            ...extra,
          },
        }
      : op === "find"
        ? {
            type: "page.op_result",
            ok: true,
            value: [{ ref: "e4", role: "button", name: "Open the report", score: 0.8, visible: true }],
          }
        : op === "inspect"
          ? {
              type: "page.op_result",
              ok: true,
              value: { locator: { role: "button", name: "Open the report", fallbacks: ["#open-report"] } },
            }
          : { type: "page.op_result", ok: true, value: "" };

  it("repairs a renamed button with the cheap ladder, saves v2, and resumes the run after it", async () => {
    const { ext, run, recovery, saved, events, dir } = await setup((m, attempt) =>
      m.type === "page.op"
        ? page(m.op?.op ?? "")
        : m.type === "run.step"
          ? attempt === 1
            ? {
                type: "run.step_result",
                stepId: m.step?.id,
                ok: false,
                error: "target not found: best 0.36 [role+name(0.8)]",
                matchScore: 0.36,
              }
            : {
                type: "run.step_result",
                stepId: m.step?.id,
                ok: m.step?.target?.name === "Open the report",
                matchScore: 1,
              }
          : undefined,
    );
    const outcome = await run(recovery());
    expect(outcome.status).toBe("succeeded");
    expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe("done"); // s2 ran after the repair
    expect(saved[0]).toMatchObject({ version: 2, history: [{ by: "debug" }] });
    expect(events.find((e) => e.type === "repair")).toMatchObject({ outcome: "commit", by: "ladder", version: 2 });
    expect(events.filter((e) => e.type === "run.start").map((e) => e.resumedAt)).toEqual([undefined, "s2"]);
    ext.end();
  });

  it("retries a site that is down, and asks the user about a login page", async () => {
    const down = await setup((m, attempt) =>
      m.type === "page.op"
        ? page(m.op?.op ?? "")
        : m.type === "run.step"
          ? attempt === 1
            ? {
                type: "run.step_result",
                stepId: m.step?.id,
                ok: false,
                error: "navigation failed: net::ERR_CONNECTION_RESET",
              }
            : { type: "run.step_result", stepId: m.step?.id, ok: true }
          : undefined,
    );
    expect((await down.run(down.recovery())).status).toBe("succeeded");
    expect(down.saved).toEqual([]);
    expect(down.events.find((e) => e.type === "repair")).toMatchObject({ outcome: "resolve", class: "transient" });
    down.ext.end();
    daemon?.close();

    const login = await setup((m) =>
      m.type === "page.op"
        ? page(m.op?.op ?? "", { loginLike: true })
        : m.type === "run.step"
          ? { type: "run.step_result", stepId: m.step?.id, ok: false, error: "target not found", matchScore: 0 }
          : undefined,
    );
    const outcome = await login.run(login.recovery("skip"));
    expect(login.asked).toEqual(["s1 needs you: log in to reports.example.com in the automation window."]);
    expect(outcome.status).toBe("succeeded"); // the user did s1 by hand; s2 ran
    login.ext.end();
  });
});
