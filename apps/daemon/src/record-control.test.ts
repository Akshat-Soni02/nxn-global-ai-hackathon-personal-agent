import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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
import { readConsent, readForm } from "./recording-store.ts";
import type { Service } from "./service.ts";

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
