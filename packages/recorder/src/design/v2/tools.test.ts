import { type AnyTool, runAgent } from "@shadow/agent";
import { findStep, Skill, type StepInput } from "@shadow/core";
import { fakeLlm } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import type { DoneReport, EvidenceView, Proposal } from "./contracts.ts";
import { withFields } from "./orchestrator.ts";
import { newSession, type SessionV2 } from "./session.ts";
import { designToolsV2, isFrequency, isTimeOfDay, unstring, vaguePick } from "./tools.ts";

const MAIL = "https://mail.google.com/mail/u/0/#inbox";
const recorded = Skill.parse({
  id: "kpi",
  name: "kpi",
  version: 1,
  description: { goal: "KPIs into the sheet" },
  steps: [
    {
      id: "start",
      type: "trigger",
      intent: "by hand",
      inputs: { emails: { type: { type: "list", items: { type: "text" } }, default: [] } },
    },
    { id: "s1", type: "action", intent: "open Gmail", channel: "web", action: "navigate", args: { url: MAIL } },
    {
      id: "s2",
      type: "action",
      intent: "click the header",
      channel: "web",
      action: "click",
      target: { text: "Print all", fallbacks: [] },
    },
    {
      id: "s3",
      type: "action",
      intent: "type the subject",
      channel: "web",
      action: "type",
      target: { role: "textbox", name: "Subject", fallbacks: [] },
      args: { text: "Daily KPIs - w/c 19 Oct" },
    },
  ],
});
const facts = { pages: [MAIL], folders: [] };
const session = (extra: Partial<SessionV2> = {}) => newSession(recorded, facts, extra);
const run = async (s: SessionV2, name: string, input: unknown) => {
  const t = designToolsV2(s).find((x) => x.name === name) as AnyTool<DoneReport>;
  const prepared = t.prepare ? t.prepare(input) : input;
  const parsed = t.input.safeParse(prepared);
  if (!parsed.success) throw new Error(parsed.error.message);
  return (await t.run(parsed.data, { turn: 1 })) as { output: Record<string, unknown>; finish?: DoneReport };
};

describe("forgiving input", () => {
  it("parses a whole input, or one field, sent as a JSON string", () => {
    expect(unstring('{"steps":["s2"]}')).toEqual({ steps: ["s2"] });
    expect(unstring({ steps: '["s2","s3"]', why: "noise" })).toEqual({ steps: ["s2", "s3"], why: "noise" });
    expect(unstring({ why: "[not json" })).toEqual({ why: "[not json" });
  });

  it("runs several changes in one turn, and keeps each change's reason for the review", async () => {
    const s = session();
    const llm = fakeLlm([
      {
        toolCalls: [
          { name: "remove", arguments: { steps: '["s2"]', why: "a click that only selected text" } },
          {
            name: "change",
            arguments: { step: "s3", args: { text: "{{today}}" }, why: "the date is the day it runs" },
          },
          { name: "done", arguments: { summary: "cleaned", rules: [] } },
        ],
      },
    ]);
    const episode = await runAgent({ llm, system: "s", task: "t", tools: designToolsV2(s), callsPerTurn: 8 });
    expect(episode.outcome.kind).toBe("finished");
    expect(findStep(s.draft, "s2")).toBeUndefined();
    expect(s.whys.get("s2")).toBe("a click that only selected text");
    expect(s.whys.get("s3")).toBe("the date is the day it runs");
  });
});

describe("the tools", () => {
  it("apply a proposal code prepared, all at once, and list the real ids for an unknown one", async () => {
    const p: Proposal = {
      id: "p1",
      kind: "date",
      summary: "the typed 19 Oct is the day it runs",
      steps: ["s3"],
      evidence: ["k17"],
      edits: [{ op: "set", step: "s3", field: "args", value: { text: "Daily KPIs - w/c {{today}}" } }],
      runnable: true,
    };
    const s = session({ proposals: new Map([["p1", p]]) });
    expect((await run(s, "accept", { proposal: "p9", why: "x" })).output.problems).toEqual([
      "no proposal p9. Proposals: p1",
    ]);
    expect((await run(s, "accept", { proposal: "p1", why: "they said the date is today" })).output.ok).toBe(true);
    const step = findStep(s.draft, "s3");
    expect(step && "args" in step ? step.args.text : "").toContain("{{today}}");
    expect(s.decisions.get("p1")?.decision).toBe("accept");
  });

  it("add a new click as unverified, with approval added by code when it sends; an unknown verb lists the right ones", async () => {
    const s = session();
    const added = await run(s, "add", {
      after: "s3",
      step: { do: "click", intent: "Send the reply", target: { role: "button", name: "Send" } },
      why: "they always send it",
    });
    expect(added.output.ok).toBe(true);
    expect(added.output.approval_added).toEqual(["s4"]);
    expect(s.unverified.has("s4")).toBe(true);
    const bad = await run(s, "add", { step: { do: "teleport", intent: "x" }, why: "x" });
    expect(String(bad.output.problems)).toMatch(/"teleport" is not something a step can do. Use one of: open, click/);
  });

  it("never gives a new step the id of a recorded one it removed: the review keeps them apart", async () => {
    const s = session();
    await run(s, "remove", { steps: ["s3"], why: "typed by mistake" });
    const added = await run(s, "add", {
      after: "s2",
      step: { do: "type", intent: "type it right", target: { like: "s3" }, text: "x" },
      why: "x",
    });
    expect(added.output.ok).toBe(true);
    expect(findStep(s.draft, "s3")).toBeUndefined();
    expect(findStep(s.draft, "s4")).toBeDefined();
    expect(s.whys.get("s3")).toBe("typed by mistake");
  });

  it("says a workflow keeps a step when asked to remove every one", async () => {
    const s = session();
    const all = await run(s, "remove", { steps: ["s1", "s2", "s3"], why: "x" });
    expect(String(all.output.problems)).toMatch(/keeps at least one step/);
    expect(String(all.output.problems)).not.toMatch(/loop or branch/);
  });

  it("asks before an Enter, Return or new line the agent adds in a field, whatever the field is called", async () => {
    const s = session();
    const enter = await run(s, "add", {
      after: "s3",
      step: { do: "press", intent: "send it", target: { like: "s3" }, key: "Enter" },
      why: "x",
    });
    expect(enter.output.approval_added).toEqual(["s4"]);
    const line = await run(s, "add", {
      after: "s4",
      step: { do: "type", intent: "type and send", target: { like: "s3" }, text: "hello\n" },
      why: "x",
    });
    expect(line.output.approval_added).toEqual(["s5"]);
    const shifted = await run(s, "add", {
      after: "s5",
      step: { do: "press", intent: "new line", target: { like: "s3" }, key: "Enter", modifiers: ["shift"] },
      why: "x",
    });
    expect(shifted.output.approval_added).toBeUndefined();
  });

  it("asks before a step that copies a recorded send, after the send itself was removed", async () => {
    const withSend = Skill.parse({
      ...recorded,
      steps: [
        ...recorded.steps,
        {
          id: "s4",
          type: "action",
          intent: "send",
          channel: "web",
          action: "click",
          target: { role: "button", name: "Go", fallbacks: [] },
          requires_approval: true,
        },
      ],
    });
    const s = newSession(withSend, facts);
    await run(s, "remove", { steps: ["s4"], why: "x" });
    const again = await run(s, "add", {
      after: "s3",
      step: { do: "click", intent: "go", target: { like: "s4" } },
      why: "x",
    });
    expect(again.output.approval_added).toEqual(["s5"]);
  });

  it("changes a step's tab together with its other fields, losing none", async () => {
    const s = session();
    // A tab is one a page was opened in (code leaves out any other: it would be blank).
    expect((await run(s, "change", { step: "s1", tab: "Gmail", why: "x" })).output.ok).toBe(true);
    const changed = await run(s, "change", {
      step: "s3",
      intent: "type the subject in the draft",
      target: { role: "textbox", name: "Subject line" },
      tab: "Gmail",
      why: "x",
    });
    expect(changed.output.ok).toBe(true);
    const step = findStep(s.draft, "s3");
    expect(step).toMatchObject({
      intent: "type the subject in the draft",
      tab: "Gmail",
      target: { name: "Subject line" },
    });
  });

  it("copy a recorded target with like, and say what to use when a loop is empty", async () => {
    const s = session();
    const copied = await run(s, "add", {
      after: "s3",
      step: { do: "type", intent: "type it again", target: { like: "s3" }, text: "x" },
      why: "x",
    });
    expect(copied.output.ok).toBe(true);
    expect(s.unverified.size).toBe(0);
    const empty = await run(s, "loop", {
      steps: [],
      over: "emails",
      item: { name: "email" },
      intent: "each",
      why: "x",
    });
    expect(String(empty.output.problems)).toMatch(/the steps to repeat/);
    const ok = await run(s, "loop", {
      steps: ["s3"],
      over: "emails",
      item: { name: "email" },
      intent: "each email",
      why: "every email",
    });
    expect(ok.output.ok).toBe(true);
  });

  it("queue a question with what the recording says about it, never twice, for one batch", async () => {
    const evidence: EvidenceView = {
      step: () => undefined,
      timeline: () => "",
      about: (q) => (/sheet/i.test(q) ? ["page at s1: https://docs.google.com/spreadsheets/d/S/edit"] : []),
      appeared: () => new Set(),
    };
    const s = session({ evidence });
    const shown = await run(s, "ask", { question: "Which sheet?", why: "where it writes", step: "s3" });
    // Asked, with what the recording says beside it: never held back by it (Oct 25, P3).
    expect(shown.output).toMatchObject({ queued: "q1", the_recording_says: [expect.stringContaining("spreadsheets")] });
    const queued = await run(s, "ask", {
      question: "Newest email, or all unread?",
      why: "which emails",
      step: "s1",
      options: ["newest", "all unread"],
    });
    expect(queued.output.queued).toBe("q2");
    const again = await run(s, "ask", { question: "newest email or all unread", why: "x", step: "s1" });
    expect(again.output.queued).toBeUndefined();
    expect(s.questions).toHaveLength(2);
  });

  it("finish only when the gate has nothing left", async () => {
    const s = session({ finish: () => ["s3 (type the subject) was work the user showed, and it is gone"] });
    const refused = await run(s, "done", { summary: "done", rules: [] });
    expect(refused.finish).toBeUndefined();
    expect(String(refused.output.problems)).toMatch(/s3/);
    const s2 = session({ finish: () => [] });
    expect((await run(s2, "done", { summary: "done" })).finish).toEqual({ summary: "done", rules: [] });
  });

  it("finishes with what is left listed for the review once the gate has refused twice", async () => {
    const s = session({ finish: () => ['s3: "Saved" never appeared on screen'] });
    expect((await run(s, "done", { summary: "done" })).finish).toBeUndefined();
    expect((await run(s, "done", { summary: "done" })).finish).toBeUndefined();
    expect((await run(s, "done", { summary: "done" })).finish).toEqual({ summary: "done", rules: [] });
    expect(s.gaps).toEqual(['s3: "Saved" never appeared on screen']);
  });

  it("opens a page by the step that opened it or its tab: code writes the real address", async () => {
    const sheet = "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit";
    const s = session({ pages: new Map([["KPI Sheet", sheet]]), facts: { pages: [MAIL, sheet], folders: [] } });
    const step = { do: "open", intent: "go to the sheet", page: "KPI Sheet" };
    expect((await run(s, "add", { after: "s3", step, why: "paste there" })).output.ok).toBe(true);
    const opened = findStep(s.draft, "s4");
    expect(opened && "args" in opened ? opened.args.url : "").toBe(sheet);
    const lost = await run(s, "add", { step: { do: "open", intent: "x", page: "Drive" }, why: "x" });
    expect(String(lost.output.problems)).toMatch(/no page Drive. Pages: KPI Sheet/);
  });

  it("runs the test run inside the episode, three times at most, and says when it can't run", async () => {
    let runs = 0;
    const report = { outcome: "succeeded", steps: [{ id: "s1", path: "s1", status: "done" as const }] };
    const s = session({
      runTest: async () => {
        runs++;
        return report;
      },
    });
    expect((await run(s, "test", {})).output).toMatchObject({ outcome: "succeeded", done: ["s1"] });
    await run(s, "test", {});
    await run(s, "test", {});
    expect(String((await run(s, "test", {})).output)).toMatch(/tested 3 times/);
    expect(runs).toBe(3);
    expect(String((await run(session(), "test", {})).output)).toMatch(/can't run here/);
  });

  it("tests a workflow changed after its last test once more at done, past the three (28 Oct YC → Sheet: saved untested)", async () => {
    let runs = 0;
    const report = { outcome: "succeeded", steps: [{ id: "s1", path: "s1", status: "done" as const }] };
    const s = session({
      runTest: async () => {
        runs++;
        return report;
      },
    });
    for (let i = 0; i < 3; i++) await run(s, "test", {});
    (s.draft.steps[1] as { intent: string }).intent = "changed after the last test";
    await run(s, "done", { summary: "x", rules: [] });
    expect(runs).toBe(4);
    expect(s.testedDraft).toBe(JSON.stringify(s.draft.steps));
  });

  it("tests once on its own before done when the workflow changed since the last test", async () => {
    let runs = 0;
    const s = session({
      finish: () => [],
      runTest: async () => {
        runs++;
        return { outcome: "succeeded", steps: [] };
      },
    });
    await run(s, "remove", { steps: ["s2"], why: "noise" });
    expect((await run(s, "done", { summary: "done" })).finish).toBeDefined();
    expect(runs).toBe(1);
  });

  it("puts back a step code left out, by its id", async () => {
    const left: StepInput = {
      id: "x1",
      type: "action",
      intent: "click Print all",
      channel: "web",
      action: "click",
      target: { text: "Print all", fallbacks: [] },
      args: {},
    };
    const s = session({ dropped: new Map([["x1", { step: left, why: "it changed nothing", after: "s2" }]]) });
    expect((await run(s, "restore", { step: "x1", why: "it opens the print view they need" })).output.ok).toBe(true);
    expect(findStep(s.draft, "x1")).toBeDefined();
  });

  it("mask what the model reads back: recorded values in the outline, a step, and a proposal's change", async () => {
    const p: Proposal = {
      id: "p1",
      kind: "date",
      summary: "the typed date is the day it runs",
      steps: ["s3"],
      evidence: [],
      edits: [{ op: "set", step: "s3", field: "args", value: { text: "Daily KPIs - w/c {{today}}" } }],
      runnable: true,
    };
    const s = session({ maskTerms: ["Daily KPIs"], proposals: new Map([["p1", p]]) });
    for (const input of [{}, { step: "s3" }, { proposal: "p1" }]) {
      const shown = JSON.stringify((await run(s, "look", input)).output);
      expect(shown).not.toContain("Daily KPIs");
      expect(shown).toContain("███");
    }
  });

  it("answer the old tool names the model reaches for", async () => {
    const s = session();
    const names = designToolsV2(s).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["wrap_in_loop", "wrap_in_branch", "add_llm_step", "ask_user", "finish", "edit"]),
    );
    expect(String((await run(s, "edit", { edits: [] })).output.use)).toMatch(/add, change, remove, move, loop, branch/);
  });
});

describe("steps the step-runner can run (Checkpoint 4)", () => {
  const proposal = (id: string, kind: Proposal["kind"]): Proposal => ({
    id,
    kind,
    summary: "s3 copied from item 1 of 20",
    steps: ["s3"],
    evidence: [],
    edits: [],
    runnable: true,
  });

  it("reads a whole page when a read has no control: the page's main part, else its body", async () => {
    const s = session();
    const out = await run(s, "add", {
      step: { do: "read_all", intent: "read the page", save_as: "page" },
      after: "s1",
    });
    expect(out.output.ok).toBe(true);
    const added = findStep(s.draft, "s4") as { target?: unknown; args: Record<string, unknown> };
    expect(added.target).toEqual({ fallbacks: ["main", "body"] });
    expect(added.args.all).toBeUndefined();
  });

  it("refuses a step the runner can't run, saying what it needs", async () => {
    const s = session();
    const find = await run(s, "add", {
      step: { do: "find_files", intent: "find it", folder: "~/Reading", pattern: "*.pdf" },
    });
    expect(JSON.stringify(find.output)).toMatch(/fs\.find needs dir and glob/);
    const near = await run(s, "add", { step: { do: "click", intent: "the rate", target: { near: "Indian Rupee" } } });
    expect(JSON.stringify(near.output)).toMatch(/can't find its control/);
    const input = await run(s, "input", { name: "today_date", type: "text", default: "{{today}}", about: "today" });
    expect(JSON.stringify(input.output)).toMatch(/use \{\{today\}\} in the step itself/);
    expect(triggerInputs(s)).not.toHaveProperty("today_date");
  });

  it("says a proposal with nothing prepared is a note to build, not a change made", async () => {
    const s = session({ proposals: new Map([["p1", proposal("p1", "list_item")]]) });
    const out = await run(s, "accept", { proposal: "p1", why: "the newest" });
    expect(JSON.stringify(out.output)).toMatch(/nothing prepared.*build it/i);
  });

  it("forgives what the real runs got wrong: ids in one string, how often through change, a step id as a variable", async () => {
    const s = session();
    expect((await run(s, "remove", { steps: "s2, s3", why: "noise" })).output.ok).toBe(true);
    const t = session();
    expect(
      (await run(t, "change", { step: "start", args: { schedule: "0 8 * * *" }, why: "every day" })).output.ok,
    ).toBe(true);
    expect(JSON.stringify(t.draft.steps[0])).toContain("0 8 * * *");
    const u = session();
    await run(u, "add", { step: { do: "read", intent: "read the page", save_as: "subject" }, after: "s1" });
    const ai = await run(u, "ai_step", {
      after: "s4",
      intent: "pick",
      instruction: "the newest",
      inputs: ["{{s4}}"],
      output: { name: "newest", type: "text" },
    });
    expect(ai.output.ok).toBe(true);
    expect(JSON.stringify(u.draft)).toContain('"inputs":["{{subject}}"]');
  });
});
const triggerInputs = (s: SessionV2) => (s.draft.steps[0] as { inputs: Record<string, unknown> }).inputs;

describe("what the re-designs after the fixes showed (round 2)", () => {
  it("says how to use a list's item: put the step in a loop first", async () => {
    const s = session();
    const out = await run(s, "add", {
      step: { do: "type", intent: "title", target: { like: "s3" }, text: "{{story.title}}" },
      after: "s3",
    });
    expect(JSON.stringify(out.output)).toMatch(/loop/);
  });

  it("takes step lists as one string, with or without brackets", async () => {
    expect((await run(session(), "remove", { steps: "[s2, s3]", why: "x" })).output.ok).toBe(true);
    const looped = await run(session(), "loop", {
      steps: "s2, s3",
      over: "{{emails}}",
      item: { name: "email" },
      intent: "each email",
      why: "each",
    });
    expect(looped.output.ok).toBe(true);
  });

  it("says plainly when a step to copy a control from has none; a read like an open reads that page (Oct 27)", async () => {
    const s = session();
    const read = await run(s, "add", { step: { do: "read_all", intent: "read", target: { like: "s1" } } });
    expect(JSON.stringify(read.output)).toMatch(/"ok":true/);
    const out = await run(session(), "add", { step: { do: "click", intent: "click", target: { like: "s1" } } });
    expect(JSON.stringify(out.output)).toMatch(
      /s1 has no control to copy \(it opens a page: to click what is in the place it was, target \{ place: \\"s1\\" \}\)/,
    );
  });

  it("clicks whatever is in a recorded control's place next time, or a selector it writes (checkpoint 6)", async () => {
    const evidence: EvidenceView = {
      step: (id) => (id === "s2" ? { place: "#mp-tfa > p > b > a" } : undefined),
      timeline: () => "",
      about: () => [],
      appeared: () => new Set(),
    };
    const s = session({ evidence });
    const placed = await run(s, "add", {
      step: { do: "click", intent: "open today's featured article", target: { place: "s2" } },
    });
    expect(placed.output.ok).toBe(true);
    expect(findStep(s.draft, "s4")).toMatchObject({ target: { fallbacks: ["#mp-tfa > p > b > a"] } });
    const heading = await run(s, "add", {
      step: { do: "read", intent: "read the article's title", target: { css: "h1" }, save_as: "title" },
    });
    expect(heading.output.ok).toBe(true);
    expect(findStep(s.draft, "s5")).toMatchObject({ target: { fallbacks: ["h1"] } });
    const none = await run(s, "add", { step: { do: "click", intent: "x", target: { place: "s3" } } });
    expect(JSON.stringify(none.output)).toMatch(/s3 has no recorded place/);
  });

  it("refuses a schedule that isn't a fixed time: a {{value}} can't be a cron", async () => {
    const out = await run(session(), "trigger", { when: { schedule: "{{cron_expr}}" }, why: "friday" });
    expect(JSON.stringify(out.output)).toMatch(/a schedule is a fixed cron/);
  });
});

describe("what round 3 showed: A and B stuck on loops, AI step types and the trigger", () => {
  const withPage = async () => {
    const s = session();
    await run(s, "add", { step: { do: "read", intent: "read the page", save_as: "page" }, after: "s1" });
    return s;
  };
  const typeOf = (s: SessionV2, id: string) => (findStep(s.draft, id) as { output: { type: unknown } }).output.type;

  it("takes an AI step and a loop sent to add with their fields beside the place (A, 24 Oct: all five refused)", async () => {
    const s = await withPage();
    // A3's own calls, but for the names of this fixture's steps.
    const ai = await run(s, "add", {
      after: "s4",
      intent: "Extract story titles and points",
      instruction: "From the page, the title and points of each story.",
      inputs: ["{{page}}"],
      output: { name: "stories", type: "list" },
      why: "Create a list of all stories",
    });
    expect(JSON.stringify(ai.output)).toContain('"ok":true');
    expect(ai.output.new_steps).toEqual(["ai1"]);
    const repeat = await run(s, "add", {
      steps: [{ do: "type", intent: "type the title", target: { like: "s3" }, args: { text: "{{story}}" } }],
      over: "{{stories}}",
      item: { name: "story", type: {} },
      intent: "Save each new story",
      after: "ai1",
      why: "each story",
    });
    expect(JSON.stringify(repeat.output)).toContain('"ok":true');
    expect(findStep(s.draft, "l1")).toMatchObject({ type: "control", over: "{{stories}}" });
  });

  it('asks an AI step that picks "the top 3" to say how (A, 24 Oct: models read it as the most points)', async () => {
    const s = await withPage();
    const pick = (instruction: string) =>
      run(s, "ai_step", {
        after: "s4",
        intent: "pick",
        instruction,
        inputs: ["{{page}}"],
        output: { name: "p", type: "list" },
      });
    expect(JSON.stringify((await pick("Extract the top 3 stories")).output)).toMatch(
      /say how to pick: the ones in the list's order, with the count as the loop's first: 3/,
    );
    expect(vaguePick("the first 3 stories in the list's order")).toBeUndefined();
    expect(vaguePick("the top 3 stories by points")).toBeUndefined();
    expect(vaguePick("the top three videos")).toMatch(/say how to pick/);
  });

  it('takes words sent as a place for what they are, and "None" as no target (C, 24 Oct)', async () => {
    const s = session();
    const added = await run(s, "add", { step: { do: "read", intent: "the rate", save_as: "rate" }, after: "s1" });
    const id = (added.output.new_steps as string[])[0] as string;
    const words = await run(s, "change", { step: id, target: { place: "Indian Rupee" }, why: "the row" });
    expect(JSON.stringify(words.output)).toMatch(/is neither a step nor a selector/);
    const none = await run(s, "change", { step: id, target: "None", why: "read the whole page" });
    expect(none.output.ok).toBe(true);
    expect(findStep(s.draft, id)).toMatchObject({ target: { fallbacks: ["main", "body"] } });
  });

  it("changes an AI step's instruction and what it reads (A, 24 Oct: it removed them for want of this)", async () => {
    const s = await withPage();
    await run(s, "ai_step", {
      after: "s4",
      intent: "p",
      instruction: "x",
      inputs: ["{{page}}"],
      output: { name: "picked", type: "text" },
    });
    const out = await run(s, "change", {
      step: "ai1",
      instruction: "the first 3 in the list's order",
      inputs: ["{{page}}"],
      why: "order",
    });
    expect(JSON.stringify(out.output)).toContain('"ok":true');
    expect(findStep(s.draft, "ai1")).toMatchObject({ instruction: "the first 3 in the list's order" });
    const target = await run(s, "change", { step: "ai1", target: { like: "s3" }, why: "x" });
    expect(JSON.stringify(target.output)).toMatch(/an AI step changes its instruction or inputs/);
  });

  it("makes a loop with new steps inside it: a step using {{story.title}} can't be added before its loop", async () => {
    const s = await withPage();
    await run(s, "ai_step", {
      after: "s4",
      intent: "pick",
      instruction: "the first 3 stories in the list's order",
      inputs: ["{{page}}"],
      output: { name: "stories", type: { title: "text", points: "text" } },
    });
    const out = await run(s, "loop", {
      over: "stories",
      item: { name: "story" },
      intent: "each story",
      after: "ai1",
      steps: [
        { do: "type", intent: "the title", target: { like: "s3" }, args: { text: "{{story.title}}" } },
        {
          do: "type",
          intent: "the points",
          target: { role: "textbox", name: "Value" },
          args: { text: "{{story.points}}" },
        },
      ],
      why: "each story, not these three",
    });
    expect(out.output.ok).toBe(true);
    expect((findStep(s.draft, "l1") as { steps: { id: string }[] }).steps.map((x) => x.id)).toEqual(["s5", "s6"]);
    expect(s.unverified.has("s6")).toBe(true);
  });

  it("takes the output types the model writes: list, { title: text }, list of text", async () => {
    const cases: [unknown, unknown][] = [
      ["list", { type: "list", items: { type: "object" } }],
      [{ title: "text" }, { type: "object", fields: { title: { type: "text" } } }],
      ["list of text", { type: "list", items: { type: "text" } }],
      [
        { type: "list", items: { title: "text" } },
        { type: "list", items: { type: "object", fields: { title: { type: "text" } } } },
      ],
    ];
    for (const [type, want] of cases) {
      const s = await withPage();
      const out = await run(s, "ai_step", {
        after: "s4",
        intent: "p",
        instruction: "x",
        inputs: ["{{page}}"],
        output: { name: "picked", type },
      });
      expect(out.output.ok).toBe(true);
      expect(typeOf(s, "ai1")).toEqual(want);
    }
  });

  it("loops over what an ai_step returns even when it was declared as one value: the prompt's own example did", async () => {
    const s = await withPage();
    await run(s, "ai_step", {
      after: "s4",
      intent: "p",
      instruction: "the new ones",
      inputs: ["{{page}}"],
      output: { name: "new_emails" },
    });
    const out = await run(s, "loop", {
      steps: ["s2", "s3"],
      over: "new_emails",
      item: { name: "email" },
      intent: "each",
      why: "each",
    });
    expect(out.output.ok).toBe(true);
    expect(typeOf(s, "ai1")).toEqual({ type: "list", items: { type: "object" } });
  });

  it("says which step saves a value when removing it leaves a step using it, not to loop it", async () => {
    const s = session();
    await run(s, "add", {
      step: { do: "read", intent: "copy", target: { like: "s3" }, save_as: "copied_1" },
      after: "s1",
    });
    await run(s, "change", { step: "s3", args: { text: "{{copied_1}}" } });
    const out = JSON.stringify((await run(s, "remove", { steps: ["s4"], why: "x" })).output);
    expect(out).toMatch(/s4 saves it/);
    expect(out).not.toMatch(/loop/);
  });

  it("says what to do about a value nothing saves: a step that saves nothing, or a value to save first (D2)", async () => {
    const s = session();
    const ai = await run(s, "ai_step", {
      after: "s1",
      intent: "p",
      instruction: "the title",
      inputs: ["s1"],
      output: { name: "title" },
    });
    expect(JSON.stringify(ai.output)).toMatch(/s1 saves nothing: read what you need/);
    const changed = await run(s, "change", { step: "s3", args: { text: "{{article_title}}" } });
    expect(JSON.stringify(changed.output)).toMatch(/nothing saves article_title yet/);
    expect(JSON.stringify(changed.output)).not.toMatch(/loop/);
  });

  it("makes an AI step when add is given one, and saves what a step's output names (A, B, D2, E all sent these)", async () => {
    const s = await withPage();
    const ai = await run(s, "add", {
      step: {
        do: "ai_step",
        intent: "pick",
        instruction: "the first 3 in the list's order",
        inputs: ["{{page}}"],
        output: { name: "top", type: "list" },
      },
      after: "s4",
      why: "the top 3 each day",
    });
    expect(ai.output.ok).toBe(true);
    expect(typeOf(s, "ai1")).toEqual({ type: "list", items: { type: "object" } });
    const read = await run(s, "add", {
      step: { do: "read", intent: "the heading", output: { name: "heading" } },
      after: "s1",
    });
    expect(read.output.ok).toBe(true);
    expect(JSON.stringify(findStep(s.draft, "s5"))).toContain('"output":{"name":"heading"');
    expect(JSON.stringify(findStep(s.draft, "s5"))).not.toContain('"args":{"output"');
  });

  it("takes the word trigger for the trigger, wherever a step is named", async () => {
    const out = await run(session(), "look", { step: "trigger" });
    expect(JSON.stringify(out.output)).toMatch(/"id":"start"/);
    const asked = await run(session(), "ask", {
      question: "Which sheet tab should it use?",
      why: "two tabs",
      step: "trigger",
      options: ["A", "B"],
    });
    expect(asked.output.queued).toBe("q1");
    const bare = await run(session(), "change", { step: "start", why: "every Friday" });
    expect(JSON.stringify(bare.output)).toMatch(/set with the trigger tool: call trigger with \{ when/);
  });

  it("takes how often it runs sent to change, by the trigger's id or the word trigger (the D eval, 24 Oct)", async () => {
    for (const step of ["start", "trigger"]) {
      const s = session();
      const out = await run(s, "change", { step, when: { schedule: "0 9 * * *" }, why: "every day" });
      expect(out.output.ok).toBe(true);
      expect(s.draft.steps[0]).toMatchObject({ when: [{ type: "schedule", cron: "0 9 * * *" }] });
    }
  });

  it("takes a place sent as the selector itself, unverified like a css target (the D eval, 24 Oct)", async () => {
    const s = session();
    const out = await run(s, "add", {
      step: { do: "click", intent: "the featured article", target: { place: "#mp-tfa > p > b > a" } },
      after: "s1",
      why: "what is there today",
    });
    expect(out.output.ok).toBe(true);
    expect(JSON.stringify(s.draft.steps)).toContain('"fallbacks":["#mp-tfa > p > b > a"]');
    expect(s.unverified.size).toBe(1);
    // "h1" looks like an id, but no step has it: the heading.
    const heading = await run(s, "add", {
      step: { do: "read", intent: "the title", target: { place: "h1" }, save_as: "title" },
      after: "s1",
    });
    expect(heading.output.ok).toBe(true);
    expect(JSON.stringify(s.draft.steps)).toContain('"fallbacks":["h1"]');
  });

  it("says which fields a tool left out, never drops them unseen", async () => {
    const out = await run(session(), "remove", { steps: ["s2"], why: "x", when: "now" });
    expect(String(out.output.ignored)).toMatch(/^when: not remove's \(it takes steps, why\); left out/);
  });
});

describe("before round 3 spends: what the model resends, and what the run's model is asked for", () => {
  const withPage = async () => {
    const s = session();
    await run(s, "add", { step: { do: "read", intent: "read the page", save_as: "page" }, after: "s1" });
    return s;
  };
  const fields = { type: "object", fields: { title: { type: "text" }, points: { type: "text" } } };

  it("asks the run's model for the fields the loop reads ({{story.title}}), not any object", async () => {
    const s = await withPage();
    await run(s, "ai_step", {
      after: "s4",
      intent: "p",
      instruction: "the first 3 in the list's order",
      inputs: ["{{page}}"],
      output: { name: "stories", type: "list" },
    });
    const looped = await run(s, "loop", {
      over: "stories",
      item: { name: "story" },
      intent: "each",
      after: "ai1",
      steps: [
        { do: "type", intent: "title", target: { like: "s3" }, args: { text: "{{story.title}}" } },
        { do: "type", intent: "points", target: { like: "s3" }, args: { text: "{{story.points}}" } },
      ],
    });
    expect(looped.output.ok).toBe(true);
    const saved = withFields(s.draft);
    expect((findStep(saved, "ai1") as { output: { type: unknown } }).output.type).toEqual({
      type: "list",
      items: fields,
    });
    expect((findStep(saved, "l1") as { item: { type: unknown } }).item.type).toEqual(fields);
  });

  it("also when the loop's steps read the fields after it was made", async () => {
    const s = await withPage();
    await run(s, "ai_step", {
      after: "s4",
      intent: "p",
      instruction: "new ones",
      inputs: ["{{page}}"],
      output: { name: "new_emails", type: "list" },
    });
    await run(s, "loop", { steps: ["s2", "s3"], over: "new_emails", item: { name: "email" }, intent: "each" });
    expect((await run(s, "change", { step: "s3", args: { text: "{{email.subject}}" } })).output.ok).toBe(true);
    const saved = findStep(withFields(s.draft), "ai1") as { output: { type: unknown } };
    expect(saved.output.type).toEqual({
      type: "list",
      items: { type: "object", fields: { subject: { type: "text" } } },
    });
  });

  it("says a call sent again exactly as before fails the same way (A sent one add 20 times)", async () => {
    const s = session();
    const tools = designToolsV2(s);
    const add = tools.find((t) => t.name === "add") as AnyTool<DoneReport>;
    const input = add.input.parse({
      step: { do: "type", intent: "t", target: { like: "s3" }, args: { text: "{{story.title}}" } },
    });
    const first = JSON.stringify((await add.run(input, { turn: 1 })).output);
    const again = JSON.stringify((await add.run(input, { turn: 2 })).output);
    expect(first).not.toMatch(/sent this exact call before/);
    expect(again).toMatch(/sent this exact call before.*uses story/);
  });
});

describe("what round 3's re-design of A showed", () => {
  it("never asks the time of day: a time they didn't say is 9:00 (A, B and D2 asked it)", async () => {
    const s = session();
    for (const question of ["What time each morning should it run?", "At what time on Monday?", "What time of day?"]) {
      const out = await run(s, "ask", { question, why: "w", step: "start", confirm: true });
      expect(JSON.stringify(out.output)).toMatch(/9:00/);
    }
    expect(s.questions).toEqual([]);
    expect(isTimeOfDay("Which row should the numbers go in?")).toBe(false);
  });
});

describe("what the YC design of 28 Oct asked twice", () => {
  it("never asks how often it runs: that is its Frequency in the review, and the form already holds the user's answer", async () => {
    const s = session();
    for (const question of [
      "How often should the collection run?",
      "What frequency should it run at?",
      "How frequently should this run?",
    ]) {
      const out = await run(s, "ask", { question, why: "w", step: "start" });
      expect(JSON.stringify(out.output)).toMatch(/Frequency/);
    }
    expect(s.questions).toEqual([]);
    expect(isFrequency("How often should it run?")).toBe(true);
    expect(isFrequency("How many jobs should it collect each day?")).toBe(false);
  });
});

describe("a question asked while building (N9)", () => {
  it("is answered at once when the design can ask now, and the agent builds with the answer", async () => {
    const s = session();
    const asked: string[] = [];
    s.askNow = async (q) => {
      asked.push(q.text);
      return "the next empty row";
    };
    const out = await run(s, "ask", {
      question: "Which row should the numbers go in?",
      why: "the recording wrote A4",
      step: "start",
      options: ["A4", "the next empty row"],
    });
    expect(asked).toEqual(["Which row should the numbers go in?"]);
    expect(out.output).toMatchObject({ answered: "the next empty row" });
    // Answered: not asked again in the batch at the end.
    expect(s.questions).toEqual([]);
    expect(s.answeredNow).toMatchObject([
      { question: { text: "Which row should the numbers go in?" }, answer: "the next empty row" },
    ]);
    // Asked again (models repeat a call; the YC design sent one six times): the user isn't asked twice.
    const again = await run(s, "ask", { question: "which row should the numbers go in", why: "w", step: "start" });
    expect(asked).toHaveLength(1);
    expect(again.output).toMatchObject({ answered: "the next empty row" });
  });

  it("takes the default when the answer is empty, and queues it as before when it can't ask now", async () => {
    const now = session();
    now.askNow = async () => "";
    const out = await run(now, "ask", {
      question: "How many?",
      why: "w",
      step: "start",
      options: ["3", "5"],
      default: "5",
    });
    expect(out.output).toMatchObject({ answered: "5" });
    const later = session();
    expect((await run(later, "ask", { question: "How many?", why: "w", step: "start" })).output).toMatchObject({
      queued: "q1",
    });
  });
});

describe("what live C showed", () => {
  it("lets a read drop its control to read the whole page (change target: null); nothing else can", async () => {
    const s = session();
    await run(s, "add", {
      step: { do: "read", intent: "the rate", target: { like: "s3" }, save_as: "rate" },
      after: "s1",
    });
    const out = await run(s, "change", { step: "s4", target: null, why: "the whole page" });
    expect(out.output.ok).toBe(true);
    expect((findStep(s.draft, "s4") as { target: unknown }).target).toEqual({ fallbacks: ["main", "body"] });
    const cell = await run(s, "change", { step: "s4", target: { role: "cell" }, why: "near the rate" });
    expect(JSON.stringify(cell.output)).toMatch(/a role alone matches every cell/);
    const click = await run(s, "change", { step: "s3", target: null, why: "x" });
    expect(JSON.stringify(click.output)).toMatch(/only a read can do without a control/);
  });

  it("says when a change changed nothing, so the model sees its change didn't take (C: 8 such changes)", async () => {
    const s = session();
    const out = await run(s, "change", { step: "s3", intent: "type the subject", why: "read the whole page" });
    expect(JSON.stringify(out.output)).toMatch(/nothing changed/);
  });
});

describe("what live D showed", () => {
  it("says a page opened by its address has no control: add a click and remove it (D: 15 changes that did nothing)", async () => {
    const out = await run(session(), "change", {
      step: "s1",
      target: { near: "From today's featured article" },
      why: "x",
    });
    expect(JSON.stringify(out.output)).toMatch(/s1 opens a page by its address.*add .*click.*remove s1/);
  });

  it("takes do with its channel in front (web.read, web.read_all) as the plain verb", async () => {
    const s = session();
    const out = await run(s, "add", { step: { do: "web.read_all", intent: "the page", save_as: "page" }, after: "s1" });
    expect(out.output.ok).toBe(true);
    expect(JSON.stringify(findStep(s.draft, "s4"))).toContain('"action":"extract"');
  });

  it("says what an AI step with no inputs needs: the text it reads", async () => {
    const out = await run(session(), "add", {
      step: { do: "ai_step", intent: "pick", instruction: "the featured article", inputs: [], output: { name: "x" } },
      after: "s1",
    });
    expect(JSON.stringify(out.output)).toMatch(/read the page first/);
  });
});

describe("what live D showed about repeats", () => {
  it("counts a change that changed nothing, sent again as it was, as a repeat", async () => {
    const s = session();
    const change = designToolsV2(s).find((t) => t.name === "change") as AnyTool<DoneReport>;
    const input = change.input.parse({ step: "s3", intent: "type the subject", why: "again" });
    await change.run(input, { turn: 1 });
    expect(JSON.stringify((await change.run(input, { turn: 2 })).output)).toMatch(/sent this exact call before/);
  });
});

describe("what live D's last try showed", () => {
  it("shows what each step read or worked out, as page data, so a wrong AI pick can be seen in the test", async () => {
    const report = {
      outcome: "failed: check did not hold",
      steps: [
        { id: "s9", path: "s9", status: "done" as const, value: `Main Page ${"x".repeat(400)}` },
        { id: "ai1", path: "ai1", status: "done" as const, value: "Thugs about to strangle a traveller" },
        { id: "s2", path: "s2", status: "failed" as const, error: "check did not hold" },
      ],
    };
    const s = session({ runTest: async () => report });
    const t = designToolsV2(s).find((x) => x.name === "test") as AnyTool<DoneReport>;
    const out = (await t.run({}, { turn: 1 })) as { output: { values: Record<string, string> }; untrusted?: boolean };
    expect(out.output.values.ai1).toBe("Thugs about to strangle a traveller");
    expect(out.output.values.s9?.length).toBeLessThanOrEqual(161);
    expect(out.untrusted).toBe(true);
  });
});

describe("what live D's last try showed", () => {
  it("shows a whole-page read as one, not as a control it can't name (D re-added the same read 10 times)", async () => {
    const out = await run(session(), "add", { step: { do: "read", intent: "the page", save_as: "page" }, after: "s1" });
    expect(String(out.output.workflow)).toMatch(/s4 {2}web\.extract {2}"the page" {2}reads the whole page/);
    expect(String(out.output.workflow)).not.toMatch(/element "\?"/);
  });
});

describe("save the page as a PDF (checkpoint 6)", () => {
  const reading = `${process.env.HOME}/Desktop/Reading`;
  const s = () => newSession(recorded, { pages: [MAIL], folders: [reading] });
  const pdf = (dir: string) => ({
    step: {
      do: "save_pdf",
      intent: "Save the page as a PDF",
      args: { dir, name: "{{today|D MMM}} - KPIs.pdf" },
    },
    after: "s1",
    why: "they printed the page to a PDF in Reading",
  });

  it("adds a step that prints the page to a PDF, named with today's date, in a folder the recording used", async () => {
    const r = await run(s(), "add", pdf("~/Desktop/Reading"));
    expect(r.output.ok).toBe(true);
  });

  it("keeps it out of folders the recording never used", async () => {
    const r = await run(s(), "add", pdf("~/.ssh"));
    expect(JSON.stringify(r.output)).toContain("may only reach");
  });
});
