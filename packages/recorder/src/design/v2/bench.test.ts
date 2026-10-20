import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TraceEvent } from "@shadow/core";
import { type FakeReply, fakeLlm } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import { compile, type Form } from "../../compile.ts";
import { checkExpectations, Expectations } from "../../eval/expect.ts";
import { buildEvidence } from "../../evidence/evidence.ts";
import { normaliseAll } from "../../normalise.ts";
import { scriptedDesigner } from "./fake.ts";
import { designV2 } from "./orchestrator.ts";
import { recordedFolders, recordedPages } from "./places.ts";

const DIR = join(import.meta.dirname, "../../../../../fixtures/recordings");
const read = (name: string, file: string) => readFileSync(join(DIR, name, file), "utf8");
const lines = (name: string, file: string) => read(name, file).split("\n").filter(Boolean);

async function design(name: string, script: { task: object; build: FakeReply[] }) {
  const trace = lines(name, "trace.jsonl").map((l) => TraceEvent.parse(JSON.parse(l)));
  const said = lines(name, "transcript.jsonl").map((l) => JSON.parse(l) as { at: number; text: string });
  const d = JSON.parse(read(name, "description.json")) as { goal: string; when: Form["when"] };
  const form: Form = {
    description: { goal: d.goal, changes: [], constants: [], never: [] },
    when: d.when,
    whenFixed: false,
  };
  const { steps, noise } = normaliseAll(trace);
  const { skill, base, questions } = await compile(steps, { form });
  const evidence = buildEvidence({
    trace,
    steps,
    noise,
    skill,
    idsByStep: base.idsByStep,
    goal: d.goal,
    switches: { screen: false, voice: true, pictures: false },
    said,
    pictures: [],
  });
  const asked: string[] = [];
  const out = await designV2({
    llm: fakeLlm(scriptedDesigner(script.build, script.task)),
    skill,
    questions,
    evidence,
    facts: { pages: recordedPages(steps), folders: recordedFolders(steps, skill) },
    pages: new Map(),
    prompter: {
      ask: async (q) => {
        asked.push(q.text);
        return q.default ?? "";
      },
    },
    protocol: "tools",
  });
  return { out, asked };
}

describe("the bench: a scripted correct agent on each recording", () => {
  it.each(["kpi-email-to-sheet", "timesheet", "yc-top-job", "playstore-to-chat"])(
    "%s meets its expectations",
    async (name) => {
      const { out, asked } = await design(name, JSON.parse(read(name, "agent.json")));
      expect(out.kind).toBe("designed");
      const expected = Expectations.parse(JSON.parse(read(name, "expect.json")));
      for (const v of checkExpectations(out.skill, asked, expected)) {
        // A known gap is expected to fail: if it passes, the gap closed and expect.json should say so.
        expect({ why: v.expectation.why, ok: v.ok, detail: v.detail }).toMatchObject({
          ok: !v.expectation.expectedToFail,
        });
      }
    },
  );
});

describe("the bench: the bad moves the reports saw are caught", () => {
  const kpi = JSON.parse(read("kpi-email-to-sheet", "agent.json")) as { task: object };
  const call = (name: string, args: unknown) => ({ toolCalls: [{ name, arguments: args }] });

  it("everything removed (the Play Store run): saved only with each lost write listed for you", async () => {
    // All but the first: a workflow can't be emptied (it keeps a step), and the Oct 19 run left one step too.
    const all = ["s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12"];
    const done = call("done", { summary: "done", rules: [] });
    const removeAll = call("remove", { steps: all, why: "x" });
    const { out } = await design("kpi-email-to-sheet", { task: kpi.task, build: [removeAll, done, done, done] });
    expect(out.gaps.join("\n")).toMatch(/s7 .*gone/);
    expect(out.gaps.join("\n")).toMatch(/s12 .*gone/);
  });

  it("an invented check, and an empty loop: refused, then listed", async () => {
    // On the email (s3), where a text check could see the page: it never appeared there. (On the sheet, s7, it is
    // refused as a drawn page first.)
    const invented = call("change", { step: "s3", check: { text_visible: "Job entry added to sheet" }, why: "x" });
    const empty = call("loop", { steps: [], over: "emails", item: { name: "e" }, intent: "each", why: "x" });
    const done = call("done", { summary: "done", rules: [{ rule: 0, steps: ["s3"] }] });
    const { out } = await design("kpi-email-to-sheet", { task: kpi.task, build: [invented, empty, done, done, done] });
    expect(out.gaps.join("\n")).toMatch(/"Job entry added to sheet" never appeared/);
    expect(out.transcript.some((e) => e.type === "result" && /the steps to repeat/.test(e.output))).toBe(true);
  });
});
