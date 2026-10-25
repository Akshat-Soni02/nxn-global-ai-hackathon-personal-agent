import { Skill } from "@shadow/core";
import { runSkill } from "@shadow/player";
import { requireApprovals } from "@shadow/recorder";
import { describe, expect, it } from "vitest";
import { type McpTool, type McpTools, mcpChannel, prepareMcpSteps } from "./mcp-tools.ts";

const TOOLS: McpTool[] = [
  { name: "GOOGLESHEETS_GET_VALUES", description: "", inputSchema: {}, readOnly: true, destructive: false },
  { name: "GOOGLESHEETS_APPEND_VALUES", description: "", inputSchema: {}, readOnly: false, destructive: false },
];

function fakeTools(): McpTools & { calls: { name: string; args: unknown }[] } {
  const calls: { name: string; args: unknown }[] = [];
  return {
    calls,
    list: async () => TOOLS,
    find: async (name) => TOOLS.find((t) => t.name === name),
    call: async (name, args) => {
      calls.push({ name, args });
      return { ok: true, value: { updates: { updatedRows: 1 } } };
    },
    invalidate() {},
  };
}

const workflow = (tool: string, approval = false) =>
  Skill.parse({
    id: "kpi",
    name: "KPI",
    version: 1,
    description: { goal: "numbers in the sheet", changes: [], constants: [], never: [] },
    steps: [
      {
        id: "t",
        type: "trigger",
        intent: "start",
        when: [{ type: "manual" }],
        inputs: { week: { type: { type: "text" }, default: "W43" } },
      },
      {
        id: "s1",
        type: "action",
        intent: "add the row",
        channel: "mcp",
        action: "call",
        requires_approval: approval,
        args: { tool, arguments: { spreadsheet_id: "kpi", values: [["{{week}}", 7]] } },
        output: { name: "result", type: { type: "object" } },
      },
    ],
    success: [],
    history: [],
  });

const RUN = { runId: "r1", inputs: { week: "W43" } };
const noop = async () => ({ ok: true });
const baseDeps = {
  web: noop,
  fs: noop,
  script: noop,
  fileExists: async () => true,
  webCheck: async () => true,
};

describe("mcp steps in a run", () => {
  it("run the tool with resolved arguments, after approval for a tool that writes", async () => {
    const tools = fakeTools();
    const prepared = await prepareMcpSteps(workflow("GOOGLESHEETS_APPEND_VALUES"), tools);
    expect(prepared.error).toBeUndefined();
    const approvals: string[] = [];
    const outcome = await runSkill(
      prepared.skill,
      {
        ...baseDeps,
        mcp: mcpChannel(tools),
        approve: async (step) => {
          approvals.push(step.id);
          return true;
        },
      },
      RUN,
    );
    expect(outcome.status).toBe("succeeded");
    expect(approvals).toEqual(["s1"]);
    expect(tools.calls).toEqual([
      { name: "GOOGLESHEETS_APPEND_VALUES", args: { spreadsheet_id: "kpi", values: [["W43", 7]] } },
    ]);
    expect(outcome.vars.result).toEqual({ updates: { updatedRows: 1 } });
  });

  it("a read-only tool runs without asking; a missing app or no sign-in stops before the run", async () => {
    const tools = fakeTools();
    const read = await prepareMcpSteps(workflow("GOOGLESHEETS_GET_VALUES"), tools);
    expect(read.skill.steps[1]).toMatchObject({ requires_approval: false });
    expect((await prepareMcpSteps(workflow("GMAIL_SEND_EMAIL"), tools)).error).toMatch(/connect gmail/);
    expect((await prepareMcpSteps(workflow("GOOGLESHEETS_GET_VALUES"), undefined)).error).toMatch(/sign in/);
  });

  it("approval is only added: a saved approval on a read-only tool stays", async () => {
    const prepared = await prepareMcpSteps(workflow("GOOGLESHEETS_GET_VALUES", true), fakeTools());
    expect(prepared.skill.steps[1]).toMatchObject({ requires_approval: true });
  });

  it("the recorder asks first for every mcp step except tools it knows are read-only", () => {
    expect(requireApprovals(workflow("GOOGLESHEETS_APPEND_VALUES")).added).toEqual(["s1"]);
    const readOnly = new Set(["GOOGLESHEETS_GET_VALUES"]);
    expect(requireApprovals(workflow("GOOGLESHEETS_GET_VALUES"), { readOnlyTools: readOnly }).added).toEqual([]);
  });

  it("without a connected-apps channel the step fails", async () => {
    const outcome = await runSkill(
      workflow("GOOGLESHEETS_GET_VALUES"),
      { ...baseDeps, approve: async () => true },
      RUN,
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toMatch(/channel mcp/);
  });
});
