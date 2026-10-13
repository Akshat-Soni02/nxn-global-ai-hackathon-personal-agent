import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAction, Skill, triggerOf } from "@shadow/core";
import { createDecoder, encode } from "@shadow/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "./api.ts";
import { type Daemon, startDaemon } from "./daemon.ts";
import { finishRecording } from "./record.ts";
import { createRecordControl, type RecordControlOptions } from "./record-control.ts";
import {
  type RecordingMeta,
  readConsent,
  readForm,
  readMeta,
  sweepRecordings,
  writeForm,
  writeMeta,
} from "./recording-store.ts";
import type { Service } from "./service.ts";
import { appendTrace, listTraces, tracePath } from "./trace-store.ts";

const temp = () => mkdtempSync(join(tmpdir(), "rc-"));
const PAGE = "http://localhost:5173/upload.html";
const button = (name: string, id: string) => ({
  tag: "button",
  url: PAGE,
  role: "button",
  name,
  text: name,
  fallbacks: [],
  selectors: { css: `#${id}` },
});

// A stand-in for the daemon: what was broadcast, and whether Shadow.app is connected.
function fakeDaemon(mac: boolean) {
  const sent: { type: string; phase?: string }[] = [];
  let recording: string | undefined;
  const daemon: RecordControlOptions["daemon"] = {
    startRecording: () => {
      recording ??= "s1";
      sent.push({ type: "record.start" });
      return recording;
    },
    stopRecording: async () => {
      const stopped = recording;
      recording = undefined;
      return stopped;
    },
    broadcast: (m) => sent.push(m as { type: string; phase?: string }),
    mac: () => ({ connected: mac, trusted: mac }),
  };
  return { daemon, sent };
}

let real: Daemon | undefined;
afterEach(() => real?.close());

describe("the Record buttons", () => {
  it("open the form in Shadow's window when the app runs, and start nothing until it is sent", () => {
    const { daemon, sent } = fakeDaemon(true);
    const control = createRecordControl({
      dataDir: temp(),
      daemon,
      ask: async () => "",
      finish: async () => undefined,
      log: () => {},
    });
    control.press();
    expect(sent).toEqual([expect.objectContaining({ type: "record.status", phase: "form" })]);
    expect(control.view().phase).toBe("idle");
  });

  it("ask the form's questions in the inbox when the app isn't running, then record with the answers", async () => {
    const home = temp();
    const { daemon, sent } = fakeDaemon(false);
    const answers = ["Invoices are filed", "3", "the invoice", "", "delete, send"];
    const asked: string[] = [];
    const control = createRecordControl({
      dataDir: home,
      daemon,
      ask: async (q) => {
        asked.push(q.title);
        return answers.shift() ?? "";
      },
      finish: async () => undefined,
      log: () => {},
    });
    control.press();
    await new Promise((r) => setTimeout(r, 10));
    expect(asked).toHaveLength(5);
    expect(sent.some((m) => m.type === "record.start")).toBe(true);
    expect(control.view().phase).toBe("recording");
    expect(readForm(home, "s1")).toMatchObject({
      goal: "Invoices are filed",
      when: [{ type: "schedule", cron: "0 9 * * *" }], // the third choice: every day at 9:00
      changes: ["the invoice"],
      constants: [],
      never: ["delete", "send"],
    });
  });

  it("don't record without a goal", async () => {
    const { daemon, sent } = fakeDaemon(false);
    const control = createRecordControl({
      dataDir: temp(),
      daemon,
      ask: async () => "",
      finish: async () => undefined,
      log: () => {},
    });
    await control.describeInInbox();
    expect(sent.some((m) => m.type === "record.start")).toBe(false);
    expect(() => control.start({ goal: "  " })).toThrow(/goal is required/);
  });
});

describe("recording from the window's API", () => {
  it("form → events over the socket → stop → a workflow with the form's description, Frequency and approvals", async () => {
    const home = temp();
    const socketPath = join(temp(), "d.sock");
    real = await startDaemon({ socketPath, dataDir: home, watchDirs: [], drainMs: 50 });
    const daemon = real;
    const asked: string[] = [];
    let saved: Awaited<ReturnType<typeof finishRecording>>;
    const control = createRecordControl({
      dataDir: home,
      daemon,
      ask: async () => "",
      finish: async (sessionId) => {
        saved = await finishRecording(sessionId, {
          dataDir: home,
          log: () => {},
          prompter: {
            ask: async (q) => {
              asked.push(q.id);
              return "";
            },
          },
        });
        return saved;
      },
      log: () => {},
    });
    const api = createApi({} as Service, control);

    const received: { type: string }[] = [];
    const ext = connect(socketPath);
    ext.on(
      "data",
      createDecoder((m) => received.push(m as { type: string })),
    );
    ext.write(encode({ id: "1", type: "hello", from: "extension", version: "test" }));
    await expect(api.call("recordStart", { goal: "" })).rejects.toThrow(/goal is required/);
    const { sessionId } = (await api.call("recordStart", {
      goal: "Old invoices are archived and the report is sent",
      when: [{ type: "schedule", cron: "0 9 * * 1", missed: "skip" }],
      changes: ["the invoice"],
      never: ["archive anything without asking"],
      consent: { screen: true, microphone: false },
    })) as { sessionId: string };
    for (let i = 0; i < 50 && !received.some((m) => m.type === "record.start"); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await api.call("recording", {})) as { phase: string }).toMatchObject({ phase: "recording" });
    expect(readConsent(home)).toEqual({ screen: true, microphone: false }); // the form's next defaults

    const event = (id: string, at: number, body: object) =>
      ext.write(encode({ id, type: "record.event", sessionId, at, tabId: 1, frameId: 0, url: PAGE, ...body }));
    event("e1", 1000, { event: "click", target: button("Archive", "archive") });
    event("e2", 3000, { event: "click", target: button("Send report", "send") });
    await new Promise((r) => setTimeout(r, 50));

    await control.stop();
    ext.end();
    expect(existsSync(join(home, "recordings", sessionId, "description.json"))).toBe(true);
    expect(asked).not.toContain("intent"); // the goal came from the form
    const skill = Skill.parse(JSON.parse(readFileSync(saved?.path ?? "", "utf8")));
    expect(skill.description).toEqual({
      goal: "Old invoices are archived and the report is sent",
      changes: ["the invoice"],
      constants: [],
      never: ["archive anything without asking"],
    });
    expect(triggerOf(skill).when).toEqual([{ type: "schedule", cron: "0 9 * * 1", missed: "skip" }]);
    // "Archive" matches Never, "Send report" sends: both wait for approval when it runs.
    const actions = skill.steps.filter(isAction);
    expect(actions.map((s) => [s.target?.name, s.requires_approval])).toEqual([
      [undefined, false],
      ["Archive", true],
      ["Send report", true],
    ]);
    expect(skill.history).toEqual([expect.objectContaining({ version: 1, by: "record" })]);
    expect(control.view()).toMatchObject({ phase: "idle", last: { outcome: "saved", skillId: skill.id } });
  });
});

describe("keeping a recording for a day", () => {
  const H = 60 * 60_000;
  const form = { goal: "x", changes: [], constants: [], never: [], when: [{ type: "manual" as const }] };
  const consent = { screen: false, microphone: false };

  it("deletes a folder a day after its workflow is saved, or a day after Stop, and never the older traces", () => {
    const home = temp();
    const now = Date.UTC(2026, 9, 13, 12);
    const make = (id: string, meta: RecordingMeta) => {
      writeForm(home, id, { ...form, consent });
      appendTrace(home, { id: "e", sessionId: id, at: 1, event: "click" });
      writeMeta(home, id, meta);
    };
    make("saved-old", { stoppedAt: now - 30 * H, savedAt: now - 25 * H, outcome: "saved" });
    make("saved-new", { stoppedAt: now - 30 * H, savedAt: now - 2 * H, outcome: "saved" }); // saved late: 24 h from saving
    make("failed-old", { stoppedAt: now - 25 * H, outcome: "failed" });
    make("failed-new", { stoppedAt: now - 3 * H, outcome: "failed" });
    make("going-on", {});
    mkdirSync(join(home, "traces"), { recursive: true });
    writeFileSync(join(home, "traces", "before-oct-13.jsonl"), "");

    const gone = sweepRecordings(home, { now, active: "going-on" });
    expect(gone.sort()).toEqual(["failed-old", "saved-old"]);
    expect(
      listTraces(home)
        .map((t) => t.sessionId)
        .sort(),
    ).toEqual(["before-oct-13", "failed-new", "going-on", "saved-new"]);
    expect(tracePath(home, "saved-new")).toBe(join(home, "recordings", "saved-new", "trace.jsonl"));
    expect(tracePath(home, "before-oct-13")).toBe(join(home, "traces", "before-oct-13.jsonl"));
  });

  it("deletes a recording with nothing in it at once, and says why a deleted one can't be compiled", async () => {
    const home = temp();
    const { daemon } = fakeDaemon(false);
    const said: string[] = [];
    const control = createRecordControl({
      dataDir: home,
      daemon,
      ask: async () => "",
      finish: async () => undefined, // nothing recorded
      log: (...args) => said.push(args.join(" ")),
    });
    control.start({ goal: "x" });
    expect(existsSync(join(home, "recordings", "s1"))).toBe(true);
    await control.stop();
    expect(existsSync(join(home, "recordings", "s1"))).toBe(false);
    await control.compile("s1");
    expect(said.at(-1)).toMatch(/no recording s1: a recording is deleted a day after Stop/);
  });

  it("marks when a recording stopped and when its workflow was saved", async () => {
    const home = temp();
    const { daemon } = fakeDaemon(false);
    const control = createRecordControl({
      dataDir: home,
      daemon,
      ask: async () => "",
      finish: async () => ({ skill: { id: "x-abc123" } }),
      log: () => {},
    });
    control.start({ goal: "x" });
    await control.stop();
    expect(readMeta(home, "s1")).toMatchObject({ outcome: "saved", skillId: "x-abc123" });
    expect(readMeta(home, "s1").savedAt).toBeGreaterThanOrEqual(readMeta(home, "s1").stoppedAt ?? Infinity);
  });
});
