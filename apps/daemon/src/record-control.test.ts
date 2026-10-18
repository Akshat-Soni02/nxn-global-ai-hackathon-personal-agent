import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAction, Skill, triggerOf } from "@shadow/core";
import { createDecoder, encode } from "@shadow/ipc";
import { fakeLlm } from "@shadow/llm";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "./api.ts";
import { type Daemon, startDaemon } from "./daemon.ts";
import { finishRecording, unattendedGaps } from "./record.ts";
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

  it("ask only the goal in the inbox when the app isn't running, then record", async () => {
    const home = temp();
    const { daemon, sent } = fakeDaemon(false);
    const answers = ["Invoices are filed"];
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
    // How often, what changes, what stays and Never are worked out after Stop, not asked before.
    expect(asked).toHaveLength(1);
    expect(sent.some((m) => m.type === "record.start")).toBe(true);
    expect(control.view().phase).toBe("recording");
    expect(readForm(home, "s1")).toMatchObject({
      goal: "Invoices are filed",
      when: [{ type: "manual" }],
      changes: [],
      constants: [],
      never: [],
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
      consent: { screen: true, microphone: false, pictures: false },
    })) as { sessionId: string };
    for (let i = 0; i < 50 && !received.some((m) => m.type === "record.start"); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await api.call("recording", {})) as { phase: string }).toMatchObject({ phase: "recording" });
    expect(readConsent(home)).toEqual({ screen: true, microphone: false, pictures: false }); // the form's next defaults

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
  const consent = { screen: false, microphone: false, pictures: false };

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

describe("after Stop, with a model", () => {
  // A recording of typing the week into a timesheet, on a weekly Frequency. The design agent's first move labels the
  // steps and declares the week as an input without a default (a value typed into a step would have been kept as its
  // default); a run started by the schedule would have nobody to ask.
  async function recorded(home: string) {
    const sessionId = "w1";
    writeForm(home, sessionId, {
      goal: "This week's hours are logged",
      changes: ["the week"],
      constants: [],
      never: [],
      when: [{ type: "schedule", cron: "0 17 * * 5", missed: "run_once" }],
      consent: { screen: false, microphone: false, pictures: false },
    });
    const field = { ...button("Week", "week"), tag: "input", role: "textbox", name: "Week" };
    appendTrace(home, { id: "e1", sessionId, at: 1000, event: "type", url: PAGE, target: field, value: "2026-W41" });
    appendTrace(home, { id: "e2", sessionId, at: 3000, event: "click", url: PAGE, target: button("Save", "save") });
    const labels = call("label_steps", {
      id: "log-hours",
      intent: "Log the week's hours",
      inputs: { week: { type: { type: "text" }, description: "the ISO week" } },
    });
    return { sessionId, labels };
  }
  const call = (name: string, args: unknown) => ({ toolCalls: [{ name, arguments: args }] });

  it("the design agent fills what a scheduled run needs, asks on the step, and its work is kept with the recording", async () => {
    const home = temp();
    const { sessionId, labels } = await recorded(home);
    const llm = fakeLlm([
      labels,
      call("finish", { summary: "too early" }),
      // The recording is looked at first (the goal shares "week" and "log"); seen, the agent asks anyway.
      call("ask_user", { question: "Which week should a scheduled run log?", default: "the current week", step: "s2" }),
      call("ask_user", {
        question: "Which week should a scheduled run log?",
        default: "the current week",
        step: "s2",
        confirm: true,
      }),
      call("edit", {
        edits: [
          {
            op: "set",
            step: "start",
            field: "inputs",
            value: { week: { type: { type: "text" }, description: "the ISO week", default: "{{today}}" } },
          },
        ],
      }),
      call("finish", { summary: "A scheduled run logs the current week" }),
    ]);
    const asked: { id: string; step?: string }[] = [];
    const saved = await finishRecording(sessionId, {
      dataDir: home,
      llm,
      log: () => {},
      design: { protocol: "tools" },
      prompter: {
        ask: async (q, about) => {
          asked.push({ id: q.id, step: about?.step });
          return "";
        },
      },
    });
    expect(asked).toEqual([{ id: "design-1", step: "s2" }]);
    const skill = saved?.skill as Skill;
    expect(triggerOf(skill).inputs.week?.default).toBe("{{today}}");
    // The history says what really changed, from the workflow, not the agent's own sentence.
    expect(skill.history[0]?.summary).toMatch(/^Recorded; .*input week added/);
    const kept = JSON.parse(readFileSync(join(home, "recordings", sessionId, "design.json"), "utf8"));
    // What the agent said it did, next to what it really changed.
    expect(kept).toMatchObject({ claimed: "A scheduled run logs the current week", turns: 6 });
    expect(kept.changes).toContain("input week added");
    // One AI read the recording: every model call was the agent's (no separate first-draft call).
    expect(llm.requests.every((r) => Array.isArray((r as { tools?: unknown }).tools))).toBe(true);
    // What the agent was told is kept, so a poor result can be explained (Oct 14: it couldn't be).
    expect(kept.prompt.system).toMatch(/^You are Shadow's design agent/);
    expect(kept.prompt.task).toMatch(/# What they said while doing it/);
  });

  it("when the agent can't finish, what it reached is kept and the missing default is asked for", async () => {
    const home = temp();
    const { sessionId, labels } = await recorded(home);
    // It labels the steps (declaring the week), then runs out of turns: the labelled draft is kept, not thrown away.
    const llm = fakeLlm([labels]);
    const asked: string[] = [];
    const saved = await finishRecording(sessionId, {
      dataDir: home,
      llm,
      log: () => {},
      design: { protocol: "tools", budget: { turns: 1 } },
      prompter: {
        ask: async (q) => {
          asked.push(q.id);
          return q.id === "default-week" ? "2026-W42" : "";
        },
      },
    });
    expect(asked).toContain("default-week");
    expect(triggerOf(saved?.skill as Skill).inputs.week?.default).toBe("2026-W42");
    // What it reached is described by what changed (its labels added the week input).
    expect(saved?.skill.history[0]?.summary).toBe("Recorded; input week added");
  });

  it("never asks for a password, and never gives one a default", () => {
    const skill = Skill.parse({
      id: "login",
      name: "Log in",
      version: 1,
      description: { goal: "Logged in" },
      steps: [
        {
          id: "start",
          type: "trigger",
          intent: "On its trigger",
          when: [{ type: "schedule", cron: "0 9 * * *", missed: "run_once" }],
          inputs: { password: { type: { type: "secret" } }, user: { type: { type: "text" } } },
        },
        { id: "s1", type: "action", intent: "Open", channel: "web", action: "navigate", args: { url: PAGE } },
      ],
    });
    expect(unattendedGaps(skill)).toEqual([expect.stringMatching(/^input "user"/)]);
  });
});
