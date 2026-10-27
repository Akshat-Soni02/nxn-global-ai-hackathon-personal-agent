// App-first repair (A3): a page step that fails on a page a connected app covers is moved to the app's tool by code,
// from one narrow question to the model, and the user is asked before it is kept. Scripted model, no browser.
import { type ActionStep, findStep, Skill } from "@shadow/core";
import { fakeLlm } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import { type RunDeps, WAIT } from "../types.ts";
import { appFirst, type CoveringApp } from "./app-first.ts";
import type { RepairEnv } from "./env.ts";
import { createRepairer } from "./repair.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef/edit";
const skill = Skill.parse({
  id: "jobs",
  name: "Jobs to the sheet",
  version: 3,
  description: { goal: "each new job into the sheet" },
  steps: [
    { id: "start", type: "trigger", intent: "by hand", inputs: { company: { type: { type: "text" } } } },
    { id: "s1", type: "action", intent: "open the sheet", channel: "web", action: "navigate", args: { url: SHEET } },
    {
      id: "s2",
      type: "action",
      intent: "type the company into the next row",
      channel: "web",
      action: "type",
      target: { role: "textbox", name: "Cell", fallbacks: [] },
      args: { text: "{{company}}" },
    },
  ],
});
const failure = {
  stepId: "s2",
  path: "s2",
  step: findStep(skill, "s2") as ActionStep,
  result: { ok: false, error: "target not found" },
  attempts: 3,
  vars: { company: "Acme" },
};
const sheets: CoveringApp = {
  name: "Google Sheets",
  tools: [
    {
      name: "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND",
      description: "Append values to a spreadsheet",
      inputSchema: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string" },
          range: { type: "string" },
          valueInputOption: { type: "string", enum: ["RAW", "USER_ENTERED"] },
          values: { type: "array", items: { type: "array" } },
        },
        required: ["spreadsheetId", "range", "valueInputOption", "values"],
      },
      readOnly: false,
    },
    {
      name: "GOOGLESHEETS_VALUES_GET",
      description: "Read a range",
      inputSchema: { type: "object", properties: { spreadsheet_id: { type: "string" } }, required: ["spreadsheet_id"] },
      readOnly: true,
    },
  ],
};
const covering = (url: string) => (url.includes("docs.google.com/spreadsheets") ? sheets : undefined);
const choose = (reply: unknown) => fakeLlm([JSON.stringify(reply)]);
const append = {
  tool: "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND",
  // The model's spelling, settled by code (as in the design).
  arguments: {
    spreadsheet_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef",
    range: "Sheet1!A:A",
    valueInputOption: "USER_ENTERED",
    values: ["{{company}}"],
  },
};

describe("app-first repair (A3)", () => {
  it("moves the failing page step to the app's tool, built by code from one narrow answer", async () => {
    const llm = choose(append);
    const fix = await appFirst(skill, failure, covering, llm);
    expect(llm.requests).toHaveLength(1);
    expect(fix?.summary).toMatch(/Google Sheets directly.*GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND/);
    expect(findStep(fix?.draft as Skill, "s2")).toMatchObject({
      channel: "mcp",
      action: "call",
      requires_approval: true,
      args: {
        tool: "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND",
        arguments: {
          spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef",
          values: [["{{company}}"]],
        },
      },
    });
    // The question names the step, its page, the values it can use, and only this app's tools.
    const asked = JSON.stringify(llm.requests[0]);
    expect(asked).toContain("type the company into the next row");
    expect(asked).toContain("company");
    expect(asked).toContain("GOOGLESHEETS_VALUES_GET");
  });

  it("does nothing when no connected app covers the page, the model says none fits, or its answer can't run", async () => {
    expect(await appFirst(skill, failure, () => undefined, choose(append))).toBeUndefined();
    expect(await appFirst(skill, failure, covering, choose({ tool: null }))).toBeUndefined();
    expect(await appFirst(skill, failure, covering, choose({ tool: "GMAIL_SEND", arguments: {} }))).toBeUndefined();
    const missing = { ...append, arguments: { range: "A:A", values: [["x"]] } };
    expect(await appFirst(skill, failure, covering, choose(missing))).toBeUndefined();
  });

  it("asks the user: yes saves it and goes on without asking twice; nobody there makes it a proposal", async () => {
    const env = (answer: boolean | typeof WAIT): RepairEnv => ({
      runId: "r",
      deps: { ask: async () => answer } as unknown as RunDeps,
      appFor: covering,
    });
    const yes = await createRepairer({ llm: choose(append) }).repair(skill, failure, env(true));
    expect(yes).toMatchObject({
      kind: "commit",
      resume: { at: "s2", vars: { company: "Acme" }, answers: [{ kind: "approval", approved: true }] },
    });
    expect(yes.kind === "commit" && yes.skill.version).toBe(4);
    const later = await createRepairer({ llm: choose(append) }).repair(skill, failure, env(WAIT));
    expect(later).toMatchObject({ kind: "propose", resume: { at: "s2" } });
    expect(later.kind === "propose" && later.what).toMatch(/s2: GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND/);
  });
});
