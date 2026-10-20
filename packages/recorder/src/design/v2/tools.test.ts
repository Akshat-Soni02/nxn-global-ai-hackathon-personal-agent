import { type AnyTool, runAgent } from "@shadow/agent";
import { findStep, Skill, type StepInput } from "@shadow/core";
import { fakeLlm } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import type { DoneReport, EvidenceView, Proposal } from "./contracts.ts";
import { newSession, type SessionV2 } from "./session.ts";
import { designToolsV2, unstring } from "./tools.ts";

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

  it("show the evidence before queuing a question, never queue it twice, and queue it for one batch", async () => {
    const evidence: EvidenceView = {
      step: () => undefined,
      timeline: () => "",
      about: (q) => (/sheet/i.test(q) ? ["page at s1: https://docs.google.com/spreadsheets/d/S/edit"] : []),
      appeared: () => new Set(),
    };
    const s = session({ evidence });
    const shown = await run(s, "ask", { question: "Which sheet?", why: "where it writes", step: "s3" });
    expect(shown.output.not_asked).toBeDefined();
    const queued = await run(s, "ask", {
      question: "Newest email, or all unread?",
      why: "which emails",
      step: "s1",
      options: ["newest", "all unread"],
    });
    expect(queued.output.queued).toBe("q1");
    const again = await run(s, "ask", { question: "newest email or all unread", why: "x", step: "s1" });
    expect(again.output.queued).toBeUndefined();
    expect(s.questions).toHaveLength(1);
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
