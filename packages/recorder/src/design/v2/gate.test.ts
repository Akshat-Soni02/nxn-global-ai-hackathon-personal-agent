import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { DoneReport, TaskModel } from "./contracts.ts";
import {
  drawnProblems,
  emptyIn,
  gate,
  guessed,
  joined,
  madeUpAddresses,
  roleAlone,
  runProblems,
  sameReads,
  stepProblems,
  tabsFixed,
  unbuiltProposals,
  unfoundIn,
  unmadeProblems,
  withoutUnusedInputs,
} from "./gate.ts";

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

describe("an AI step that is told to read something it isn't given (28 Oct)", () => {
  const ai = (inputs: string[], instruction: string) => ({
    id: "ai5",
    type: "llm",
    intent: "pick",
    instruction,
    inputs,
    output: { name: "jobs", type: { type: "list", items: { type: "object" } } },
  });
  const problemsOf = (step: unknown) => stepProblems(step as Parameters<typeof stepProblems>[0]);

  it("says it sees only its inputs when it has none and its instruction names the page, a sheet or a list", () => {
    const problems = problemsOf(ai([], "Extract all job listings visible on the page. Return as a list."));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/ai5.*sees only its inputs.*read the page.*as an input/);
  });

  it("sends a count of a list to the loop's first: an AI step counts wrong (it picked items 1, 2, 3, 2, 5)", () => {
    for (const instruction of [
      "Take the first {{num_jobs}} jobs from the new_jobs list.",
      "Return the top 5 listings from the list.",
      "Keep the first 3 items.",
    ]) {
      const problems = problemsOf(ai(["{{jobs}}"], instruction));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/ai5.*counting is code's.*first: N/);
    }
    // Choosing by a rule is the model's: it isn't a count.
    expect(problemsOf(ai(["{{jobs}}"], "Return the jobs whose title is not in {{existing}}."))).toEqual([]);
  });

  it("leaves one with an input, or one that asks for nothing outside it, alone", () => {
    expect(problemsOf(ai(["{{page_text}}"], "Extract the job listings on the page."))).toEqual([]);
    expect(problemsOf(ai([], "Write a one-line greeting."))).toEqual([]);
  });
});

describe("inputs nothing uses (28 Oct)", () => {
  it("drops a trigger input once the step that used it is gone, and keeps one a step still reads", () => {
    const withInputs = Skill.parse({
      id: "w",
      name: "w",
      version: 1,
      description: { goal: "x" },
      success: [],
      steps: [
        {
          id: "start",
          type: "trigger",
          intent: "by hand",
          when: [{ type: "manual" }],
          inputs: {
            pasted_text: { type: { type: "text" }, description: "what you pasted" },
            company: { type: { type: "text" }, description: "which company" },
          },
        },
        act("s1", "web", "navigate", { url: CHAT }),
        act("s2", "web", "type", { text: "{{company}}" }),
      ],
    });
    const out = withoutUnusedInputs(withInputs, withInputs);
    // An input the recording didn't have is the agent's: kept even when nothing reads it yet.
    const added = withoutUnusedInputs(withInputs, skill([act("s1", "web", "navigate", { url: CHAT })]));
    expect(Object.keys((added.steps[0] as { inputs: object }).inputs)).toEqual(["pasted_text", "company"]);
    expect(Object.keys((out.steps[0] as { inputs: object }).inputs)).toEqual(["company"]);
    // Nothing else is touched.
    expect(out.steps.slice(1)).toEqual(withInputs.steps.slice(1));
  });
});

describe("steps that type into a drawn area (A1)", () => {
  // s3 typed into a sheet's cells after clicks that were dropped: replay would type into whichever cell is selected.
  const drawnType = act("s3", "web", "type", { text: "42" }, { drawn: true });
  const withDrawn = skill([act("s1", "web", "navigate", { url: SHEET }), drawnType]);
  // As the recorder makes it (pagesOf): the pages that were opened, by the step that opened them, never the typing step
  // (the first test of this keyed the map by the drawn step's own id, so it passed while the real map missed it).
  const pages = new Map([["s1", SHEET]]);

  it("asks for an app step when a connected app covers the page: the step can't be replayed on it", () => {
    const { fix, cantRun } = drawnProblems(withDrawn, pages, new Set(["googlesheets"]));
    // The agent is sent back for it (fix); if the design ends with it still there, the review says it can't run (28 Oct:
    // a design that gave up kept the drawn steps and showed no warning, with Sheets connected).
    expect(cantRun).toHaveLength(1);
    expect(cantRun[0]).toMatch(/s3.*drawn area of Google Sheets.*didn't turn.*into Google Sheets steps/);
    expect(fix).toHaveLength(1);
    expect(fix[0]).toMatch(/s3.*drawn area of Google Sheets.*replay can't reach.*the app's tool/);
  });

  it("says it can't run yet, and what to connect, when the app isn't connected", () => {
    const { fix, cantRun } = drawnProblems(withDrawn, pages, new Set());
    expect(fix).toEqual([]);
    expect(cantRun).toHaveLength(1);
    expect(cantRun[0]).toMatch(/s3.*Google Sheets.*connect Google Sheets in Apps/);
  });

  it("says so plainly when no app covers the site", () => {
    const canvas = "https://canvas-editor.example.com/doc/1";
    const onCanvas = skill([act("s1", "web", "navigate", { url: canvas }), drawnType]);
    const { cantRun } = drawnProblems(onCanvas, new Map([["s1", canvas]]), new Set(["googlesheets"]));
    expect(cantRun[0]).toMatch(/s3.*no connected app covers canvas-editor\.example\.com/);
  });

  it("leaves a workflow with no drawn step alone", () => {
    const plain = skill([act("s1", "web", "navigate", { url: SHEET }), act("s3", "web", "type", { text: "42" })]);
    expect(drawnProblems(plain, pages, new Set())).toEqual({ fix: [], cantRun: [] });
  });

  it("the finish gate sends the agent back for it", () => {
    const problems = gate(input(withDrawn, { pages, connectedToolkits: new Set(["googlesheets"]) }));
    expect(problems.join("\n")).toMatch(/s3.*drawn area of Google Sheets/);
  });
});

describe("a proposal accepted with nothing prepared must really be built (C15)", () => {
  const proposal = {
    id: "p1",
    kind: "list_item" as const,
    summary: "s2 clicked item 3 of 9 in the jobs list: next time the newest, or the one with this text?",
    steps: ["s3"],
    evidence: [],
    edits: [], // nothing prepared: the agent builds it
    runnable: true,
  };
  const proposals = new Map([["p1", proposal]]);
  const accepted = new Map([["p1", { decision: "accept" as const, why: "the newest" }]]);

  it("says so while the steps are still as recorded", () => {
    const problems = unbuiltProposals(recorded, recorded, proposals, accepted);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/p1.*accepted.*s3.*still as recorded/);
  });

  it("is satisfied once a step it is about changed, or is gone", () => {
    const changed = skill([
      act("s1", "web", "navigate", { url: CHAT }),
      act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
      act("s3", "web", "type", { text: "the newest" }),
      act("s4", "web", "press", { key: "Enter" }),
    ]);
    expect(unbuiltProposals(recorded, changed, proposals, accepted)).toEqual([]);
    const gone = skill([act("s1", "web", "navigate", { url: CHAT }), act("s4", "web", "press", { key: "Enter" })]);
    expect(unbuiltProposals(recorded, gone, proposals, accepted)).toEqual([]);
  });

  it("leaves alone what was rejected, what has edits applied, and what replay can't run", () => {
    const rejected = new Map([["p1", { decision: "reject" as const, why: "no" }]]);
    expect(unbuiltProposals(recorded, recorded, proposals, rejected)).toEqual([]);
    const prepared = new Map([["p1", { ...proposal, edits: [{ op: "remove", step: "s3" } as never] }]]);
    expect(unbuiltProposals(recorded, recorded, prepared, accepted)).toEqual([]);
    const notRunnable = new Map([["p1", { ...proposal, runnable: false }]]);
    expect(unbuiltProposals(recorded, recorded, notRunnable, accepted)).toEqual([]);
  });
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
    // Nobody signed in: the agent can't fix that, so it isn't sent round the fix loop (C8).
    expect(
      gate(
        input(ok, {
          test: { outcome: "not run: sign in to Shadow in Settings to test its connected-app steps", steps: [] },
        }),
      ),
    ).toEqual([]);
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

describe("what round 3 showed", () => {
  it("takes the trigger by the name the outline shows it under (B: fifteen calls looking for a step trigger)", () => {
    const ok = skill(
      [
        act("s1", "web", "navigate", { url: CHAT }),
        act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
        act("s3", "web", "type", { text: "Date - {{today|D MMM}}" }),
        act("s4", "web", "press", { key: "Enter" }),
      ],
      [{ type: "schedule", cron: "0 9 1 * *" }],
    );
    const problems = gate(
      input(ok, {
        done: done([
          { rule: 0, steps: ["trigger", "s2"] },
          { rule: 1, steps: ["s3"] },
        ]),
      }),
    );
    expect(problems.join("\n")).not.toMatch(/no step trigger/);
  });
});

describe("what live C showed", () => {
  it("refuses a control the agent gives by role alone, except to read them all or the main part", () => {
    const read = (target: unknown, args: Record<string, unknown> = {}) =>
      roleAlone({
        id: "s2",
        type: "action",
        intent: "read",
        channel: "web",
        action: "extract",
        args,
        target,
      } as never);
    expect(read({ role: "cell", fallbacks: [] }).join()).toMatch(/a role alone matches every cell/);
    expect(read({ role: "cell", fallbacks: [] }, { all: true })).toEqual([]);
    expect(read({ role: "main", fallbacks: [] })).toEqual([]);
    expect(read({ role: "cell", name: "94.89", fallbacks: [] })).toEqual([]);
  });
});

describe("what live D showed", () => {
  const nav = (id: string, url: string, tab?: string) => ({
    ...act(id, "web", "navigate", { url }),
    ...(tab ? { tab } : {}),
  });
  it("says a step with no tab, after a page opened in a named tab, acts in another tab", () => {
    const w = skill([nav("s1", "https://en.wikipedia.org/wiki/Main_Page", "API"), act("s9", "web", "extract")]);
    expect(runProblems(w).join()).toMatch(/s9 runs in the window's first tab, but s1 opened its page in tab "API"/);
    const same = skill([
      nav("s1", "https://en.wikipedia.org/wiki/Main_Page", "API"),
      { ...act("s9", "web", "extract"), tab: "API" },
    ]);
    expect(runProblems(same)).toEqual([]);
  });

  it("says a step that names a tab no step opened a page in acts on a blank tab (checkpoint 6: D's read got nothing)", () => {
    const w = skill([
      nav("s1", "https://en.wikipedia.org/wiki/Main_Page"),
      { ...act("s4", "web", "extract"), tab: "Wikipedia, the free encyclopedia" },
    ]);
    expect(runProblems(w).join()).toMatch(
      /s4: no earlier step opens a page in tab "Wikipedia, the free encyclopedia", so it would act on a blank tab/,
    );
    const main = skill([
      nav("s1", "https://en.wikipedia.org/wiki/Main_Page"),
      { ...act("s4", "web", "extract"), tab: "main" },
    ]);
    expect(runProblems(main)).toEqual([]);
  });

  it("fixes the tabs the way the rule asks, so the agent never spends turns on them (A, 24 Oct)", () => {
    const w = skill([
      nav("s1", "https://news.ycombinator.com/"),
      { ...nav("s2", "http://localhost:5173/notes.html"), tab: "Notes" },
      act("s3", "web", "extract"),
    ]);
    expect(runProblems(w).join()).toMatch(/s3 runs in the window's first tab/);
    const { skill: tidy, fixed, owned } = tabsFixed(w);
    expect(runProblems(tidy)).toEqual([]);
    expect(tidy.steps.find((s) => s.id === "s3")).toMatchObject({ tab: "Notes" });
    expect(fixed.get("s3")).toMatch(/code gave it tab "Notes": it acts on the page s2 opened there/);
    expect(owned).toEqual(new Map([["s3", "Notes"]]));
    expect(tabsFixed(tidy, owned).fixed.size).toBe(0);
  });

  it("never changes a tab the agent named, and works its own out again as steps move (A's 4th design)", () => {
    // The agent puts the notes read in "Notes" before the open that makes that tab: it stays (the gate says so).
    const early = skill([
      { ...nav("s26", "https://news.ycombinator.com/"), tab: "HN" },
      act("s24", "web", "extract"),
      { ...act("s25", "web", "extract"), tab: "Notes" },
    ]);
    const first = tabsFixed(early);
    expect(first.skill.steps.find((s) => s.id === "s25")).toMatchObject({ tab: "Notes" });
    expect(first.skill.steps.find((s) => s.id === "s24")).toMatchObject({ tab: "HN" }); // code's
    // Then the Notes open goes in before both: the read code placed moves with it; the agent's stays.
    const later = skill([
      { ...nav("s26", "https://news.ycombinator.com/"), tab: "HN" },
      { ...nav("s27", "http://localhost:5173/notes.html"), tab: "Notes" },
      { ...act("s24", "web", "extract"), tab: "HN" },
      { ...act("s25", "web", "extract"), tab: "Notes" },
    ]);
    const again = tabsFixed(later, first.owned);
    expect(again.skill.steps.find((s) => s.id === "s24")).toMatchObject({ tab: "Notes" });
    expect(again.skill.steps.find((s) => s.id === "s25")).toMatchObject({ tab: "Notes" });
    expect(runProblems(again.skill)).toEqual([]);
  });

  it("says what to do instead of guessing another selector the test run didn't find (B, 24 Oct)", () => {
    const w = skill([
      nav("s1", "https://www.youtube.com/@GoogleDevelopers/videos"),
      { ...act("s9", "web", "click"), target: { fallbacks: ["ytd-video-renderer:first-child #video-title"] } },
      act("s3", "web", "extract"),
    ]);
    const report = { outcome: "failed", steps: [{ id: "s9", path: "s9", status: "not_found" as const }] };
    expect(gate(input(w, { test: report, sinceTest: new Map() })).join()).toMatch(
      /s9: the test run didn't find it; a selector not found isn't fixed by guessing another: read the page/,
    );
    expect(guessed(w, "s3")).toBe(""); // a control by its role and name: no such advice
  });

  it("refuses an address an AI step made up from what it read (D, 24 Oct: /wiki/<title> built from the title)", () => {
    const w = skill([
      nav("s1", "https://en.wikipedia.org/wiki/Main_Page"),
      act("s4", "web", "extract", {}, { output: { name: "page", type: { type: "text" } } }),
      {
        id: "ai1",
        type: "llm",
        intent: "the featured article's link",
        instruction: "the href of today's featured article",
        inputs: ["{{page}}"],
        output: { name: "featured_url", type: { type: "text" } },
      },
      nav("s5", "https://en.wikipedia.org{{featured_url}}"),
    ]);
    const ran = (page: string) => ({
      outcome: "succeeded",
      steps: [
        { id: "s4", path: "s4", status: "done" as const, value: page },
        { id: "ai1", path: "ai1", status: "done" as const, value: "/wiki/Battle_of_Schliengen" },
      ],
    });
    expect(
      madeUpAddresses(w, ran("From today's featured article: The Battle of Schliengen was fought…")).join(),
    ).toMatch(/ai1's answer goes into s5's address but isn't in what it read/);
    expect(madeUpAddresses(w, ran('<a href="/wiki/Battle_of_Schliengen">Battle of Schliengen</a>'))).toEqual([]);
  });

  it("says when two reads got the same page in the test run (A's 4th design: the notes read read Hacker News)", () => {
    const w = skill([
      nav("s1", "https://news.ycombinator.com/"),
      act("s24", "web", "extract"),
      act("s25", "web", "extract"),
    ]);
    const ran = (a: string, b: string) => ({
      outcome: "succeeded",
      steps: [
        { id: "s24", path: "s24", status: "done" as const, value: a },
        { id: "s25", path: "s25", status: "done" as const, value: b },
      ],
    });
    expect(sameReads(w, ran("Hacker News 1. OBS", "Hacker News 1. OBS")).join()).toMatch(
      /s25 read exactly what s24 read/,
    );
    expect(sameReads(w, ran("Hacker News 1. OBS", "My notes"))).toEqual([]);
  });

  it("counts a check still holding the recorded page as a run problem, so a kept draft is judged by it too", () => {
    const w = skill([
      act(
        "s2",
        "web",
        "navigate",
        { url: "https://en.wikipedia.org/wiki/{{today}}" },
        { check: { url_matches: "/wiki/Thuggee" } },
      ),
    ]);
    expect(runProblems(w).join()).toMatch(/s2: its check still looks for "\/wiki\/Thuggee"/);
  });
});

describe("what the test run's values show (step 5: code checks them)", () => {
  const w = skill([
    act("s1", "web", "navigate", { url: "https://en.wikipedia.org/wiki/Main_Page" }),
    act("s2", "web", "extract", {}, { output: { name: "title", type: { type: "text" } } }),
    {
      id: "ai1",
      type: "llm",
      intent: "pick",
      instruction: "the article's title",
      inputs: ["{{title}}"],
      output: { name: "article", type: { type: "text" } },
    },
  ]);
  const ran = (s2: unknown, ai1: unknown) => ({
    outcome: "succeeded",
    steps: [
      { id: "s1", path: "s1", status: "done" as const },
      { id: "s2", path: "s2", status: "done" as const, value: s2 },
      { id: "ai1", path: "ai1", status: "done" as const, value: ai1 },
    ],
  });
  it('finds a read or AI step that ran but got nothing (checkpoint 6: D\'s read got "" three times)', () => {
    expect(emptyIn(w, ran("", "Thuggee"))).toEqual(["s2"]);
    expect(emptyIn(w, ran("Thuggee", "  "))).toEqual(["ai1"]);
    expect(emptyIn(w, ran(["a"], []))).toEqual(["ai1"]); // a text answer
    expect(emptyIn(w, ran("Thuggee", "Thuggee"))).toEqual([]);
  });
  it("takes an AI step's empty list as an answer: nothing new today (A: skip the ones already saved)", () => {
    const list = skill([
      act("s1", "web", "navigate", { url: "https://news.ycombinator.com" }),
      {
        id: "ai1",
        type: "llm",
        intent: "pick",
        instruction: "the top 3 stories not already saved",
        inputs: [],
        output: { name: "stories", type: { type: "list", items: { type: "text" } } },
      },
    ]);
    const report = { outcome: "succeeded", steps: [{ id: "ai1", path: "ai1", status: "done" as const, value: [] }] };
    expect(emptyIn(list, report)).toEqual([]);
  });
  it("shows an AI answer that isn't in what it read (D: a made-up article), never one that is", () => {
    expect(unfoundIn(w, ran("Thuggee were bands of robbers in India", "Thuggee"))).toEqual([]);
    expect(unfoundIn(w, ran("Thuggee were bands of robbers", "2026 in railway transportation")).join()).toMatch(
      /ai1 answered "2026 in railway transportation", which isn't in what it read/,
    );
    expect(unfoundIn(w, ran("", "anything"))).toEqual([]); // nothing read: emptyIn's to say
  });
  it("says how to fix an address made of two (D: en.wikipedia.orghttps://…)", () => {
    const error =
      "navigation failed: net::ERR_NAME_NOT_RESOLVED (it tried to open https://en.wikipedia.orghttps://en.wikipedia.org/wiki/Thuggee)";
    expect(joined(error)).toMatch(/its address is two joined/);
    expect(joined("navigation failed (it tried to open https://en.wikipedia.org/wiki/Thuggee)")).toBe("");
    const failed = { outcome: "failed", steps: [{ id: "s1", path: "s1", status: "failed" as const, error }] };
    expect(gate(input(w, { test: failed, sinceTest: new Map() })).join()).toMatch(/s1: it failed .*two joined/);
  });
  it("sends it back to the agent unless a reason was given after the test", () => {
    const problems = gate(input(w, { test: ran("", "x"), sinceTest: new Map() }));
    expect(problems.join("\n")).toMatch(/s2: it got nothing in the test run/);
    const explained = gate(input(w, { test: ran("", "x"), sinceTest: new Map([["s2", "logged in it isn't empty"]]) }));
    expect(explained.join("\n")).not.toMatch(/got nothing/);
  });
});

describe("what live D showed, again", () => {
  it("judges a check by the value it checks: the plain list's rename to a fixed name isn't stale", () => {
    const rename = (to: string) =>
      skill([
        act(
          "s6",
          "fs",
          "find",
          { dir: "~/Downloads", glob: "*.pdf", pick: "newest" },
          { output: { name: "downloaded_1", type: { type: "file" } } },
        ),
        act(
          "s7",
          "fs",
          "rename",
          { from: "{{downloaded_1}}", to },
          { check: { file_exists: "~/Downloads/23 Oct - Thuggee.pdf" } },
        ),
      ]);
    expect(runProblems(rename("~/Downloads/23 Oct - Thuggee.pdf"))).toEqual([]);
    expect(runProblems(rename("~/Downloads/{{today|D MMM}}.pdf")).join()).toMatch(/s7: its check still looks for/);
  });
});

describe("a file the recording shows appearing with nothing recorded making it (checkpoint 6)", () => {
  const pdf = "~/Desktop/Reading/23 Oct - Thuggee.pdf";
  const open = act("s1", "web", "navigate", { url: "https://en.wikipedia.org/wiki/Main_Page" });
  it("is a problem until some step makes a file in that folder", () => {
    expect(unmadeProblems(skill([open]), [pdf]).join()).toMatch(
      /~\/Desktop\/Reading\/23 Oct - Thuggee.pdf appeared in the recording, but no step makes a file in ~\/Desktop\/Reading/,
    );
    const saved = {
      ...act("s3", "web", "save_pdf", { dir: "~/Desktop/Reading", name: "{{today|D MMM}} - x.pdf" }),
      target: undefined,
    };
    expect(unmadeProblems(skill([open, saved]), [pdf])).toEqual([]);
    const moved = act("s4", "fs", "move", { from: "~/Downloads/x.pdf", to: "~/Desktop/Reading/" });
    expect(unmadeProblems(skill([open, moved]), [pdf])).toEqual([]);
    const elsewhere = { ...saved, args: { dir: "~/Documents", name: "x.pdf" } };
    expect(unmadeProblems(skill([open, elsewhere]), [pdf])).toHaveLength(1);
  });
});
