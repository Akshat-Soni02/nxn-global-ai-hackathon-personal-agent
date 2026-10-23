import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { DoneReport, TaskModel } from "./contracts.ts";
import { gate } from "./gate.ts";

const CHAT = "https://chat.google.com/room/X";
const SHEET = "https://docs.google.com/spreadsheets/d/S/edit";
const skill = (steps: unknown[], when: unknown[] = [{ type: "manual" }], success: unknown[] = []) =>
  Skill.parse({
    id: "w",
    name: "w",
    version: 1,
    description: { goal: "stats to chat" },
    success,
    steps: [{ id: "start", type: "trigger", intent: "by hand", when }, ...steps],
  });
const act = (
  id: string,
  channel: string,
  action: string,
  args: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({
  id,
  type: "action",
  intent: `${action} ${id}`,
  channel,
  action,
  args,
  ...(channel === "web" && action !== "navigate" ? { target: { role: "textbox", name: id, fallbacks: [] } } : {}),
  ...extra,
});
const recorded = skill([
  act("s1", "web", "navigate", { url: CHAT }),
  act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
  act("s3", "web", "type", { text: "Date - 19 Oct" }),
  act("s4", "web", "press", { key: "Enter" }),
]);
const task = TaskModel.parse({
  outcome: "every report of every month is posted in the Chat space with today's date",
  cadence: { kind: "schedule", cron: "0 9 1 * *", quote: "monthly" },
  rules: [
    { quote: "every report", where: "said" },
    { quote: "today's date", where: "said" },
  ],
});
const done = (rules: unknown[] = []) => DoneReport.parse({ summary: "done", rules });
const input = (workflow: Skill, extra: Partial<Parameters<typeof gate>[0]> = {}) => ({
  recorded,
  workflow,
  task,
  done: done([
    { rule: 0, steps: ["s2"] },
    { rule: 1, steps: ["s3"] },
  ]),
  appeared: new Set(["Message sent", "Arilo Stats"]),
  explained: new Map<string, string>(),
  ...extra,
});

describe("the finish gate", () => {
  it("refuses a workflow that lost the work the user showed (the Play Store run: one fs.find left)", () => {
    const lost = skill(
      [act("s9", "fs", "find", { dir: "~/Downloads", glob: "*.csv", pick: "all" })],
      [{ type: "schedule", cron: "0 9 1 * *" }],
    );
    const problems = gate(input(lost)).join("\n");
    expect(problems).toMatch(/s2 .*gone/);
    expect(problems).toMatch(/s3 .*gone/);
  });

  it("refuses a workflow that keeps none of the shown work, whatever reason each removal was given", () => {
    const one = skill([act("s1", "web", "navigate", { url: CHAT })], [{ type: "schedule", cron: "0 9 1 * *" }]);
    const whys = new Map([
      ["s2", "x"],
      ["s3", "x"],
      ["s4", "x"],
    ]);
    const report = done([
      { rule: 0, not_built: "x" },
      { rule: 1, not_built: "x" },
    ]);
    const problems = gate(input(one, { explained: whys, done: report })).join("\n");
    expect(problems).toMatch(/s2 .*gone/);
    expect(problems).toMatch(/s3 .*gone/);
  });

  it("counts a recorded step that needed approval (an Enter that sent) as work the user showed", () => {
    const sent = skill([
      act("s1", "web", "navigate", { url: CHAT }),
      act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
      act("s3", "web", "type", { text: "Date - 19 Oct" }),
      act("s4", "web", "press", { key: "Enter" }, { requires_approval: true }),
    ]);
    const without = skill(
      [
        act("s1", "web", "navigate", { url: CHAT }),
        act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
        act("s3", "web", "type", { text: "Date - {{today}}" }),
      ],
      [{ type: "schedule", cron: "0 9 1 * *" }],
    );
    expect(gate(input(without, { recorded: sent })).join("\n")).toMatch(/s4 .*gone/);
  });

  it("refuses invented checks, empty ones, and text checks on a sheet's drawn cells", () => {
    const wf = skill(
      [
        act("s1", "web", "navigate", { url: CHAT }),
        act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
        act("s3", "web", "type", { text: "Date - {{today}}" }, { check: { text_visible: "Job entry added to sheet" } }),
        act("s4", "web", "press", { key: "Enter" }, { check: { text_visible: "" } }),
        act("s5", "web", "navigate", { url: SHEET }, { check: { text_visible: "Arilo Stats" } }),
      ],
      [{ type: "schedule", cron: "0 9 1 * *" }],
    );
    const problems = gate(input(wf)).join("\n");
    expect(problems).toMatch(/s3: .*"Job entry added to sheet" never appeared/);
    expect(problems).toMatch(/s4: .*empty/);
    expect(problems).toMatch(/s5: .*drawn/);
  });

  it("refuses a check for a hidden value: the masked line appeared, the real text never matches it", () => {
    const wf = skill(
      [
        act("s1", "web", "navigate", { url: CHAT }),
        act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
        act("s3", "web", "type", { text: "Date - {{today}}" }, { check: { text_visible: "Message sent to ███" } }),
        act("s4", "web", "press", { key: "Enter" }),
      ],
      [{ type: "schedule", cron: "0 9 1 * *" }],
    );
    const problems = gate(input(wf, { appeared: new Set(["Message sent to ███"]) })).join("\n");
    expect(problems).toMatch(/s3: .*hidden value/);
  });

  it("wants every stated rule built or explained, the frequency they said, and test failures explained", () => {
    const wf = skill([
      act("s1", "web", "navigate", { url: CHAT }),
      act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
      act("s3", "web", "type", { text: "Date - {{today}}" }),
      act("s4", "web", "press", { key: "Enter" }),
    ]);
    const problems = gate(
      input(wf, {
        done: done([{ rule: 0, steps: ["l9"] }]),
        test: { outcome: "succeeded", steps: [{ id: "s2", path: "s2", status: "not_found" }] },
      }),
    ).join("\n");
    expect(problems).toMatch(/rule 0 .*l9/);
    expect(problems).toMatch(/rule 1 "today's date" is neither built nor explained/);
    expect(problems).toMatch(/monthly/);
    expect(problems).toMatch(/s2: the test run didn't find it/);
  });

  it("accepts a removal or a failure the agent explained, a rule it says isn't built, and a right workflow", () => {
    const wf = skill(
      [
        act("s1", "web", "navigate", { url: CHAT }),
        act("s2", "web", "upload", { file: "~/Downloads/y.csv" }),
        act("s3", "web", "type", { text: "Date - {{today}}" }),
      ],
      [{ type: "schedule", cron: "0 9 1 * *" }],
    );
    expect(
      gate(
        input(wf, {
          done: done([
            { rule: 0, steps: ["s2"] },
            { rule: 1, not_built: "the date format isn't known" },
          ]),
          explained: new Map([["s4", "Enter is sent by the upload's own Send button now"]]),
        }),
      ),
    ).toEqual([]);
  });

  it("treats a test run that couldn't start (Chrome not connected) as not tested, never as failures to fix", () => {
    const wf = skill(
      [
        act("s1", "web", "navigate", { url: CHAT }),
        act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
        act("s3", "web", "type", { text: "Date - {{today}}" }),
        act("s4", "web", "press", { key: "Enter" }),
      ],
      [{ type: "schedule", cron: "0 9 1 * *" }],
    );
    const test = {
      outcome: "not run: Chrome is not connected",
      steps: [{ id: "s2", path: "s2", status: "not_reached" as const }],
    };
    expect(gate(input(wf, { test }))).toEqual([]);
  });

  it("wants a web workflow to open a page first: runs start on a blank window", () => {
    const wf = skill([act("s3", "web", "type", { text: "x" })]);
    expect(gate(input(wf)).join("\n")).toMatch(/open a page first/);
  });
});

describe("what Checkpoint 4 let through", () => {
  const ok = skill(
    [
      act("s1", "web", "navigate", { url: CHAT }),
      act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
      act("s3", "web", "type", { text: "Date - {{today|D MMM}}" }),
      act("s4", "web", "press", { key: "Enter" }),
    ],
    [{ type: "schedule", cron: "0 9 1 * *" }],
  );

  it("a failed test step is explained only by a reason given after that test, not the one it was added with", () => {
    const test = {
      outcome: "failed: s3",
      steps: [{ id: "s3", path: "s3", status: "failed" as const, error: "target not found" }],
    };
    const added = gate(input(ok, { test, explained: new Map([["s3", "type the date"]]), sinceTest: new Map() }));
    expect(added.join("\n")).toMatch(/s3: it failed in the test run/);
    const after = gate(
      input(ok, { test, explained: new Map([["s3", "x"]]), sinceTest: new Map([["s3", "it needs the sign-in"]]) }),
    );
    expect(after.join("\n")).not.toMatch(/s3: it failed/);
  });

  it("a test run that couldn't start is a problem, unless Chrome isn't there", () => {
    expect(gate(input(ok, { test: { outcome: "not run: input day has no value", steps: [] } })).join("\n")).toMatch(
      /test run couldn't start.*input day has no value/,
    );
    expect(gate(input(ok, { test: { outcome: "not run: Chrome is not connected to Shadow", steps: [] } }))).toEqual([]);
  });

  it("a check that still holds the recorded page on a step that now opens a {{…}} page is a problem", () => {
    const stale = skill(
      [
        act(
          "s1",
          "web",
          "navigate",
          { url: "https://en.wikipedia.org/wiki/{{today|D MMM}}" },
          { check: { url_matches: "/wiki/Thuggee" } },
        ),
        act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
        act("s3", "web", "type", { text: "Date - {{today|D MMM}}" }),
      ],
      [{ type: "schedule", cron: "0 9 1 * *" }],
    );
    expect(gate(input(stale)).join("\n")).toMatch(/s1: its check still looks for "\/wiki\/Thuggee"/);
  });

  it("a step the runner can't run is a problem", () => {
    const read = skill(
      [...ok.steps.slice(1), act("s5", "web", "extract", {}, { target: { near: "Indian Rupee", fallbacks: [] } })],
      [{ type: "schedule", cron: "0 9 1 * *" }],
    );
    expect(gate(input(read)).join("\n")).toMatch(/s5: replay can't find its control/);
  });

  it("how often it runs comes from what was said, whatever the task model wrote (F1)", () => {
    const manual = skill(ok.steps.slice(1));
    const problems = gate(
      input(manual, { task: { ...task, cadence: { kind: "manual" } }, said: ["Every day I get these KPI emails"] }),
    );
    expect(problems.join("\n")).toMatch(/"Every day".*only runs when started by hand/);
  });
});

describe("what the re-designs after the fixes showed (round 2)", () => {
  const ok = skill(
    [
      act("s1", "web", "navigate", { url: CHAT }),
      act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
      act("s3", "web", "type", { text: "Date - {{today|D MMM}}" }),
      act("s4", "web", "press", { key: "Enter" }),
    ],
    [{ type: "schedule", cron: "0 9 1 * *" }],
  );
  const pick = TaskModel.parse({ ...task, rules: [{ quote: "note the newest video", where: "goal" }] });

  it("turns back a rule about picking what changes, said not to be built, with how to build it", () => {
    const problems = gate(input(ok, { task: pick, done: done([{ rule: 0, not_built: "not enough selectors" }]) }));
    expect(problems.join("\n")).toMatch(/rule 0 "note the newest video" isn't built: .*reading the page.*ai_step/);
  });

  it("counts a new step doing what a recorded write did, on the same control, as that work kept", () => {
    const same = skill(
      [
        act("s1", "web", "navigate", { url: CHAT }),
        act("s9", "web", "upload", { file: "~/Downloads/y.csv" }),
        act("s10", "web", "type", { text: "Date - {{today|D MMM}}" }),
        act("s4", "web", "press", { key: "Enter" }),
      ].map((s) =>
        s.id === "s9"
          ? { ...s, target: { role: "textbox", name: "s2", fallbacks: [] } }
          : s.id === "s10"
            ? { ...s, target: { role: "textbox", name: "s3", fallbacks: [] } }
            : s,
      ),
      [{ type: "schedule", cron: "0 9 1 * *" }],
    );
    expect(
      gate(
        input(same, {
          explained: new Map([
            ["s2", "a"],
            ["s3", "b"],
          ]),
        }),
      ).join("\n"),
    ).not.toMatch(/gone/);
  });
});
