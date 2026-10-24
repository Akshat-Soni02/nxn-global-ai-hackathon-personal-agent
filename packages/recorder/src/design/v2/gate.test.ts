import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { DoneReport, TaskModel } from "./contracts.ts";
import { emptyIn, gate, joined, roleAlone, runProblems, tabsFixed, unfoundIn, unmadeProblems } from "./gate.ts";

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
      { ...act("s4", "web", "extract"), tab: "HN" },
    ]);
    expect(runProblems(w).join()).toMatch(/s3 runs in the window's first tab/);
    const { skill: tidy, fixed } = tabsFixed(w);
    expect(runProblems(tidy)).toEqual([]);
    expect(tidy.steps.find((s) => s.id === "s3")).toMatchObject({ tab: "Notes" });
    // "HN" was never opened: it acts where the steps before it are, in "Notes".
    expect(tidy.steps.find((s) => s.id === "s4")).toMatchObject({ tab: "Notes" });
    expect(fixed.get("s3")).toMatch(/code gave it tab "Notes": it acts on the page s2 opened there/);
    expect(fixed.get("s4")).toMatch(/code gave it tab "Notes": no step opens a page in tab "HN"/);
    const first = tabsFixed(skill([nav("s1", "https://x.test/"), { ...act("s2", "web", "extract"), tab: "HN" }]));
    expect(first.skill.steps.find((s) => s.id === "s2")).not.toHaveProperty("tab");
    expect(tabsFixed(tidy).fixed.size).toBe(0);
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
