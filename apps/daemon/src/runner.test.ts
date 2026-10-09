import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDecoder, encode } from "@taskplayer/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { type Daemon, startDaemon } from "./daemon.ts";
import { runSkillFile } from "./runner.ts";

let daemon: Daemon | undefined;
afterEach(() => daemon?.close());

// Stands in for the extension: answers run.step / run.check over the real socket.
function fakeExtension(socketPath: string, answer: (m: { type: string; step?: { id: string } }) => object | undefined) {
  const socket = connect(socketPath);
  const seen: string[] = [];
  socket.on(
    "data",
    createDecoder((raw) => {
      const m = raw as { id: string; type: string; runId: string; step?: { id: string } };
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
          {
            id: "s1",
            type: "action",
            intent: "read title",
            channel: "web",
            action: "extract",
            target: { fallbacks: ["h1"] },
            save_as: "title",
          },
          {
            id: "s2",
            type: "action",
            intent: "save it",
            channel: "fs",
            action: "write",
            args: { path: join(dir, "out.txt"), content: "{{vars.title}}" },
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
