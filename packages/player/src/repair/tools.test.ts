// Repair v2's tools on their own (Oct 25): the user's OK for what repair may not change alone, the repeat guard, and
// what the recording showed in the failure report.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnyTool } from "@shadow/agent";
import { type ActionStep, findStep, Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { type RunDeps, WAIT, type Wait } from "../types.ts";
import type { RepairEnv } from "./env.ts";
import { failureReport } from "./report.ts";
import { type RepairFinish, type RepairSession, repairGuard, repairTools } from "./tools.ts";

const DRIFT = join(import.meta.dirname, "../../../../fixtures/pages/drift");
const skill = Skill.parse(JSON.parse(readFileSync(join(DRIFT, "drift-skill.json"), "utf8")));
const step = findStep(skill, "s5") as ActionStep;
const failure = {
  stepId: "s5",
  path: "s5",
  step,
  result: { ok: false, error: "target not found" },
  attempts: 3,
  vars: {},
};

function session(answer?: boolean | Wait, extra: Partial<RepairEnv> = {}) {
  const asked: string[] = [];
  const deps = {
    ...(answer === undefined
      ? {}
      : {
          ask: async (a: { question: string }) => {
            asked.push(a.question);
            return answer;
          },
        }),
  } as unknown as RunDeps;
  const s: RepairSession = {
    original: skill,
    draft: skill,
    failure,
    env: { runId: "r", deps, ...extra },
    report: "",
    edits: [],
  };
  const tools = repairTools(s);
  const run = async (
    name: string,
    input: unknown,
  ): Promise<{ output?: unknown; finish?: RepairFinish; refused?: string }> => {
    const t = tools.find((x) => x.name === name) as AnyTool<RepairFinish>;
    const refused = await repairGuard(s)({ tool: t as AnyTool, input });
    if (refused) return { refused };
    return t.run(t.input.parse(input), { turn: 1 }) as Promise<{ output: unknown; finish?: RepairFinish }>;
  };
  return { s, run, asked };
}

// A fix that opens a site the workflow never used: not repair's to decide alone.
const elsewhere = {
  edits: [
    {
      op: "insert",
      at: { before: "s5" },
      step: {
        type: "action",
        intent: "open the export page",
        channel: "web",
        action: "navigate",
        args: { url: "https://exports.example.com/csv" },
      },
    },
  ],
};
const tried = (s: RepairSession) => {
  s.tried = {
    draft: JSON.stringify(s.draft.steps),
    result: { ok: true, ran: [], vars: {}, evidence: "the export appeared", approved: [] },
    from: "s5",
  };
};

describe("repair asks instead of refusing", () => {
  it("makes a change only the user may allow, and says commit will ask", async () => {
    const { run } = session(true);
    const applied = (await run("edit", elsewhere)) as { output: string };
    expect(applied.output).toContain("Commit will ask the user's OK for");
    expect(applied.output).toContain("exports.example.com is a site this workflow doesn't use");
  });

  it("commits on yes, asking once", async () => {
    const { s, run, asked } = session(true);
    await run("edit", elsewhere);
    tried(s);
    const done = await run("commit", { summary: "the export moved to its own site" });
    expect(done.finish).toEqual({ kind: "commit", summary: "the export moved to its own site" });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Go ahead?");
    await run("commit", { summary: "again" });
    expect(asked).toHaveLength(1);
  });

  it("replaces a page step with a connected app's step: no try (it would write for real), the user's OK is the check (A3)", async () => {
    const appStep = {
      op: "replace",
      step: "s5",
      with: {
        type: "action",
        intent: "add the row to the sheet directly",
        channel: "mcp",
        action: "call",
        requires_approval: true,
        args: { tool: "GOOGLESHEETS_BATCH_UPDATE", arguments: { spreadsheet_id: "made-up", values: [["x"]] } },
      },
    };
    const { run, asked } = session(true);
    const applied = (await run("edit", { edits: [appStep] })) as { output: string };
    expect(applied.output).toContain("Commit will ask the user's OK for");
    // Not tried, and committed on the user's yes: before, "the current draft hasn't been tried" ended it.
    const done = await run("commit", { summary: "the page can't be done by clicks: use Google Sheets directly" });
    expect(done.finish).toEqual({
      kind: "commit",
      summary: "the page can't be done by clicks: use Google Sheets directly",
    });
    expect(asked).toHaveLength(1);
    // A no commits nothing; nobody to ask now (the daemon) puts it to the user as a proposal, never a commit.
    const no = session(false);
    await no.run("edit", { edits: [appStep] });
    expect((await no.run("commit", { summary: "x" })).finish).toBeUndefined();
    const later = session(WAIT);
    await later.run("edit", { edits: [appStep] });
    expect((await later.run("commit", { summary: "x" })).finish).toEqual({ kind: "propose", summary: "x" });
  });

  it("answers a try of an app-only fix with 'commit it', and the commit tool says so (a real run escalated instead)", async () => {
    const appStep = {
      edits: [
        {
          op: "replace",
          step: "s5",
          with: {
            id: "s5",
            type: "action",
            intent: "add the line to the doc directly",
            channel: "mcp",
            action: "call",
            requires_approval: true,
            args: { tool: "GOOGLEDOCS_INSERT_TEXT_ACTION", arguments: { document_id: "made-up", text_to_insert: "x" } },
          },
        },
      ],
    };
    const { s, run } = session(true);
    await run("edit", appStep);
    const tried = (await run("try_steps", {})) as { output: { ok: boolean; ran: unknown[]; error: string } };
    expect(tried.output).toMatchObject({ ok: false, ran: [] });
    expect(tried.output.error).toMatch(/not tried.*commit it.*yes/i);
    const commit = repairTools(s).find((t) => t.name === "commit");
    expect(commit?.description).toMatch(/only connected-app steps.*not tried/);
  });

  it("lets the agent read a connected tool's arguments instead of guessing them, only when an app is connected", async () => {
    const { s, run } = session(undefined, {
      appTool: (name) =>
        name === "DOCS_ADD" ? '{"arguments":{"document_id":"text","append_to_end":"boolean"}}' : "no app tool",
    });
    expect(await run("app_tool", { name: "DOCS_ADD" })).toMatchObject({
      output: expect.stringContaining("append_to_end"),
    });
    expect(repairTools({ ...s, env: { runId: "r", deps: {} as RunDeps } }).some((t) => t.name === "app_tool")).toBe(
      false,
    );
  });

  it("still needs a try for a fix that is not an app step", async () => {
    const { run } = session(true);
    await run("edit", elsewhere);
    const out = (await run("commit", { summary: "x" })) as { output: string; finish?: unknown };
    expect(out.finish).toBeUndefined();
    expect(out.output).toMatch(/hasn't been tried/);
  });

  it("doesn't commit on no; when nobody can answer now, it ends as a proposal that waits for them (A3)", async () => {
    const no = session(false);
    await no.run("edit", elsewhere);
    tried(no.s);
    const refused = (await no.run("commit", { summary: "x" })) as { output: string; finish?: unknown };
    expect(refused.finish).toBeUndefined();
    expect(refused.output).toMatch(/the user said no/);
    // In the daemon a run's question always waits: before, such a fix could never be committed there.
    for (const answer of [WAIT, undefined] as const) {
      const { s, run } = session(answer);
      await run("edit", elsewhere);
      tried(s);
      const out = (await run("commit", { summary: "open the export page first" })) as {
        output: string;
        finish?: unknown;
      };
      expect(out.finish).toEqual({ kind: "propose", summary: "open the export page first" });
      expect(out.output).toMatch(/put to the user/);
    }
  });

  it("still refuses what is never allowed", async () => {
    const { run } = session(true);
    const out = await run("edit", { edits: [{ op: "set", step: "s4", field: "requires_approval", value: false }] });
    expect(out).toEqual({ refused: "s4: approval can't be turned off" });
  });
});

describe("the repeat guard", () => {
  it("answers the same look, with nothing done in between, without running it again", async () => {
    let looked = 0;
    const { run } = session(undefined, {
      page: async () => {
        looked++;
        return { ok: true, value: [] };
      },
    });
    await run("find", { text: "Export" });
    const again = (await run("find", { text: "Export" })) as { output: string };
    expect(again.output).toMatch(/^You made this exact call already/);
    expect(looked).toBe(1);
    // A probe changes the page: the same look runs again after it.
    await run("press", { key: "Escape" });
    await run("find", { text: "Export" });
    expect(looked).toBe(3);
  });
});

describe("the failure report", () => {
  it("says what the recording showed at the failing step", async () => {
    const report = await failureReport(
      skill,
      failure,
      { class: "drift", reason: "renamed" },
      { runId: "r", deps: {} as RunDeps, recorded: (id) => (id === "s5" ? "recorded: clicked Export CSV" : undefined) },
    );
    expect(report).toContain("# When it was recorded");
    expect(report).toContain("recorded: clicked Export CSV");
  });

  it("never holds a secret input's value, though the step as run typed it (N2)", async () => {
    const withSecret = Skill.parse({
      ...skill,
      steps: [
        {
          ...(skill.steps[0] as object),
          inputs: {
            ...(skill.steps[0]?.type === "trigger" ? skill.steps[0].inputs : {}),
            password: { type: { type: "secret" } },
          },
        },
        ...skill.steps.slice(1),
      ],
    });
    const typed = { ...step, action: "type", args: { text: "hunter2-secret" } } as ActionStep;
    const report = await failureReport(
      withSecret,
      { ...failure, step: typed, vars: { password: "hunter2-secret" } },
      { class: "drift", reason: "renamed" },
      { runId: "r", deps: {} as RunDeps },
    );
    expect(report).not.toContain("hunter2-secret");
    expect(report).toContain("███");
  });
});
