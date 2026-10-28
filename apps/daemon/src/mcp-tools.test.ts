import { Skill } from "@shadow/core";
import { runSkill } from "@shadow/player";
import { requireApprovals } from "@shadow/recorder";
import { describe, expect, it } from "vitest";
import {
  appsOfWorkflow,
  connectedToolsOf,
  coveringApp,
  describeAppTool,
  type McpTool,
  type McpTools,
  mcpChannel,
  prepareMcpSteps,
} from "./mcp-tools.ts";

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

  it("hands the run's Stop signal and the step's time limit to the call, so Stop can end it (C7)", async () => {
    let seen: { signal?: AbortSignal; timeoutMs?: number } | undefined;
    const tools: McpTools = {
      ...fakeTools(),
      call: async (_name, _args, signal, timeoutMs) => {
        seen = { signal, timeoutMs };
        return { ok: true, value: {} };
      },
    };
    const stop = new AbortController();
    const base = workflow("GOOGLESHEETS_GET_VALUES");
    const slow = Skill.parse({
      ...base,
      steps: [base.steps[0], { ...base.steps[1], timeout_ms: 90_000 }],
    });
    const deps = { ...baseDeps, mcp: mcpChannel(tools), approve: async () => true };
    await runSkill(slow, deps, { ...RUN, signal: stop.signal });
    expect(seen?.signal).toBe(stop.signal);
    expect(seen?.timeoutMs).toBe(90_000);
    // Without a limit on the step, an app call gets a generous one rather than the SDK's 60 s (a slow write that
    // finished would then show as failed, and a retry could write it twice).
    await runSkill(base, deps, RUN);
    expect(seen?.timeoutMs).toBe(120_000);
  });

  it("shows repair one tool's arguments, or the tool names when it guessed a wrong one (a real repair guessed them)", async () => {
    const tools: McpTool[] = [
      { ...(TOOLS[1] as McpTool), inputSchema: { properties: { spreadsheet_id: { type: "string" } } } },
    ];
    const text = describeAppTool(tools, "GOOGLESHEETS_APPEND_VALUES");
    expect(text).toContain("spreadsheet_id");
    expect(text).toContain("GOOGLESHEETS_APPEND_VALUES");
    expect(describeAppTool(tools, "NOPE")).toMatch(/no app tool NOPE.*GOOGLESHEETS_APPEND_VALUES/);
    expect(describeAppTool([], "NOPE")).toMatch(/none/);
  });

  it("gives the chat box the connected apps the workflow's pages are in, with the documents by the step that opens them", () => {
    const tools: McpTool[] = [{ ...(TOOLS[1] as McpTool), toolkit: "googlesheets" }];
    const skill = Skill.parse({
      id: "w",
      name: "w",
      version: 1,
      description: { goal: "g" },
      steps: [
        { id: "start", type: "trigger", intent: "by hand" },
        {
          id: "s1",
          type: "action",
          intent: "open the sheet",
          channel: "web",
          action: "navigate",
          args: { url: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUv/edit" },
        },
        {
          id: "s2",
          type: "action",
          intent: "open hn",
          channel: "web",
          action: "navigate",
          args: { url: "https://news.ycombinator.com" },
        },
      ],
    });
    expect(appsOfWorkflow(skill, tools)).toMatchObject([
      { toolkit: "googlesheets", name: "Google Sheets", steps: ["s1"], ids: { s1: "1AbCdEfGhIjKlMnOpQrStUv" } },
    ]);
    expect(appsOfWorkflow(skill, [])).toEqual([]);
  });

  it("gives app-first repair the connected app that covers a page, with only that app's tools", () => {
    const tools: McpTool[] = [
      { ...(TOOLS[1] as McpTool), toolkit: "googlesheets" },
      {
        name: "GMAIL_SEND_EMAIL",
        description: "",
        inputSchema: {},
        readOnly: false,
        destructive: false,
        toolkit: "gmail",
      },
    ];
    const sheet = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUv/edit";
    expect(coveringApp(tools, sheet)).toMatchObject({
      name: "Google Sheets",
      tools: [{ name: "GOOGLESHEETS_APPEND_VALUES", readOnly: false }],
    });
    // A page no app covers, or an app that isn't connected: none.
    expect(coveringApp(tools, "https://news.ycombinator.com")).toBeUndefined();
    expect(coveringApp(tools, "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit")).toBeUndefined();
  });

  it("tells repair which app tools exist, so it can use one (A3: the briefing said 'none')", async () => {
    const listed = await connectedToolsOf(fakeTools());
    expect(listed.map((t) => t.name)).toEqual(["GOOGLESHEETS_GET_VALUES", "GOOGLESHEETS_APPEND_VALUES"]);
    expect(listed[0]).toMatchObject({ readOnly: true });
    expect(listed[1]).toMatchObject({ readOnly: false });
    // Signed out, or the service unreachable: none, and repair is told so (it must not guess a tool).
    expect(await connectedToolsOf(undefined)).toEqual([]);
    const down: McpTools = {
      ...fakeTools(),
      list: async () => {
        throw new Error("service down");
      },
    };
    expect(await connectedToolsOf(down)).toEqual([]);
  });

  describe("a step that typed into a drawn area (A2)", () => {
    const SHEET = "https://docs.google.com/spreadsheets/d/abc/edit";
    const drawnIn = (url: string) =>
      Skill.parse({
        id: "kpi",
        name: "KPI",
        version: 1,
        description: { goal: "numbers in the sheet" },
        steps: [
          { id: "t", type: "trigger", intent: "start", when: [{ type: "manual" }] },
          { id: "s1", type: "action", intent: "open it", channel: "web", action: "navigate", args: { url } },
          {
            id: "s2",
            type: "action",
            intent: "type the number",
            channel: "web",
            action: "type",
            target: { role: "textbox", name: "Cell", fallbacks: [] },
            args: { text: "42" },
            drawn: true,
          },
        ],
      });
    const sheets = TOOLS.map((t) => ({ ...t, toolkit: "googlesheets" }));
    const gmail = [{ ...(TOOLS[0] as McpTool), name: "GMAIL_FETCH_EMAILS", toolkit: "gmail" }];
    const toolsOf = (list: McpTool[]): McpTools => ({ ...fakeTools(), list: async () => list });

    it("stops before step 1 and says to connect the app that covers the page, when it isn't connected", async () => {
      const r = await prepareMcpSteps(drawnIn(SHEET), toolsOf(gmail));
      expect(r.error).toMatch(/^needs an app: step s2 works in a drawn area of Google Sheets/);
      expect(r.error).toMatch(/connect Google Sheets in Apps/);
    });

    it("stops too when it is connected: the workflow should use the app's own tool, not the page", async () => {
      const r = await prepareMcpSteps(drawnIn(SHEET), toolsOf(sheets));
      expect(r.error).toMatch(/^needs an app: step s2 works in a drawn area of Google Sheets/);
      expect(r.error).toMatch(/use the app's own tool/);
    });

    it("says to sign in when nobody is, and plainly when no app covers the site", async () => {
      expect((await prepareMcpSteps(drawnIn(SHEET), undefined)).error).toMatch(/sign in to Shadow/);
      const other = await prepareMcpSteps(drawnIn("https://canvas.example.com/doc"), toolsOf(sheets));
      expect(other.error).toMatch(/no connected app covers canvas\.example\.com/);
    });

    it("leaves a workflow with no drawn step alone", async () => {
      const plain = drawnIn(SHEET);
      for (const { step } of [...plain.steps].map((step) => ({ step }))) delete (step as { drawn?: boolean }).drawn;
      expect((await prepareMcpSteps(plain, undefined)).error).toBeUndefined();
    });
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
