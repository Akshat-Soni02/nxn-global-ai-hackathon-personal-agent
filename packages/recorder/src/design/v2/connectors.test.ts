import type { AnyTool } from "@shadow/agent";
import { findStep, Skill } from "@shadow/core";
import type { NormalisedStep } from "../../normalise.ts";
import { describe, expect, it } from "vitest";
import {
  type AppTool,
  appOf,
  appsSection,
  type ConnectorChance,
  type Connectors,
  connectorChances,
  documentIdOf,
  type UsableApp,
  withIds,
} from "./connectors.ts";
import type { DoneReport } from "./contracts.ts";
import { lostWork } from "./gate.ts";
import { usableApps } from "./orchestrator.ts";
import { newSession, type SessionV2 } from "./session.ts";
import { designToolsV2 } from "./tools.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUv/edit#gid=0";

const recorded = Skill.parse({
  id: "kpi",
  name: "kpi",
  version: 1,
  description: { goal: "today's numbers into the KPI sheet" },
  steps: [
    { id: "start", type: "trigger", intent: "by hand", inputs: {} },
    { id: "s1", type: "action", intent: "open the sheet", channel: "web", action: "navigate", args: { url: SHEET } },
    {
      id: "s2",
      type: "action",
      intent: "click cell A4",
      channel: "web",
      action: "click",
      target: { role: "gridcell", name: "A4", fallbacks: [] },
    },
    {
      id: "s3",
      type: "action",
      intent: "type today's number",
      channel: "web",
      action: "type",
      target: { role: "textbox", name: "Cell", fallbacks: [] },
      args: { text: "42" },
    },
  ],
});

const APPEND: AppTool = {
  name: "GOOGLESHEETS_BATCH_UPDATE",
  description: "Write values to a range",
  inputSchema: {
    type: "object",
    properties: { spreadsheet_id: { type: "string" }, sheet_name: { type: "string" }, values: { type: "array" } },
    required: ["spreadsheet_id", "values"],
  },
  toolkit: "googlesheets",
  readOnly: false,
  destructive: false,
};
const READ: AppTool = { ...APPEND, name: "GOOGLESHEETS_GET_VALUES", readOnly: true, inputSchema: { required: [] } };
const chance: ConnectorChance = {
  toolkit: "googlesheets",
  name: "Google Sheets",
  why: "it writes cells directly",
  steps: ["s2", "s3"],
  ids: { s3: "1AbCdEfGhIjKlMnOpQrStUv" },
};
const app: UsableApp = { ...chance, tools: [APPEND, READ] };

const session = (apps: UsableApp[] = [app]) => newSession(recorded, { pages: [SHEET], folders: [] }, { apps });
const run = async (s: SessionV2, name: string, input: unknown) => {
  const t = designToolsV2(s).find((x) => x.name === name) as AnyTool<DoneReport>;
  const parsed = t.input.safeParse(t.prepare ? t.prepare(input) : input);
  if (!parsed.success) throw new Error(parsed.error.message);
  return (await t.run(parsed.data, { turn: 1 })) as { output: unknown };
};

describe("where an app could do the work", () => {
  it("finds the app by the pages the steps worked in, not by opening it", () => {
    expect(appOf(SHEET)?.toolkit).toBe("googlesheets");
    expect(appOf("https://mail.google.com/mail/u/0/#inbox")?.toolkit).toBe("gmail");
    expect(appOf("https://docs.google.com/document/d/abcdefghijkl/edit")?.toolkit).toBe("googledocs");
    expect(appOf("https://news.ycombinator.com")).toBeUndefined();
    const DRIVE = "https://drive.google.com/drive/my-drive";
    const step = (kind: string, url: string, extra: Record<string, unknown> = {}) =>
      ({ index: 0, kind, at: 0, events: [], url, ...extra }) as NormalisedStep;
    const chances = connectorChances(
      [
        step("navigate", DRIVE),
        // Getting to the sheet through Drive: navigation, not work in Drive (Oct 25).
        step("click", DRIVE, { navigatesTo: "https://drive.google.com/drive/recent" }),
        step("click", DRIVE, { opensTab: 2 }),
        step("navigate", SHEET),
        step("type", SHEET),
        step("copy", SHEET),
        step("click", "https://news.ycombinator.com", { navigatesTo: "https://news.ycombinator.com/item" }),
      ],
      [["s1"], ["s2"], ["s3"], ["s4"], ["s5"], ["s6"], ["s7"]],
    );
    expect(chances).toEqual([
      {
        toolkit: "googlesheets",
        name: "Google Sheets",
        why: expect.any(String),
        steps: ["s5", "s6"],
        ids: { s5: "1AbCdEfGhIjKlMnOpQrStUv", s6: "1AbCdEfGhIjKlMnOpQrStUv" },
      },
    ]);
    expect(connectorChances([step("navigate", SHEET)], [["s1"]])).toEqual([]);
  });

  it("reads a document's id from its address, and puts it where the agent wrote <id:…>", () => {
    expect(documentIdOf(SHEET)).toBe("1AbCdEfGhIjKlMnOpQrStUv");
    expect(withIds({ spreadsheet_id: "<id:s3>", values: [["<id:s3>"]] }, [app])).toEqual({
      ok: true,
      value: { spreadsheet_id: "1AbCdEfGhIjKlMnOpQrStUv", values: [["1AbCdEfGhIjKlMnOpQrStUv"]] },
    });
    expect(withIds({ spreadsheet_id: "<id:s9>" }, [app])).toMatchObject({ ok: false });
  });

  it("lists the app's tools and the ids for the agent", () => {
    const text = appsSection([app]).join("\n");
    expect(text).toContain("GOOGLESHEETS_GET_VALUES (reads only)");
    expect(text).toContain("<id:s3>");
    expect(appsSection([])).toEqual([]);
  });
});

describe("asking before planning", () => {
  const connectors = (over: Partial<Connectors> & { declined?: string[]; connected?: string[] } = {}) => {
    const calls = { offered: [] as string[], declined: [] as string[] };
    const c: Connectors = {
      status: async () => ({ connected: over.connected ?? [], declined: over.declined ?? [] }),
      offer:
        over.offer ??
        (async (ch) => {
          calls.offered.push(ch.toolkit);
          return "connected" as const;
        }),
      decline: (t) => {
        calls.declined.push(t);
      },
      tools: async () => [APPEND, READ],
    };
    return { c, calls };
  };

  it("connected in the browser: the app's tools are used", async () => {
    const { c, calls } = connectors();
    const got = await usableApps([chance], c, () => {});
    expect(calls.offered).toEqual(["googlesheets"]);
    expect(got.apps[0]?.tools.map((t) => t.name)).toEqual([APPEND.name, READ.name]);
    expect(got.asked).toEqual([{ question: "Use Google Sheets directly?", answer: "connected" }]);
  });

  it("already connected: not asked; said no before: not asked and not used", async () => {
    const on = connectors({ connected: ["googlesheets"] });
    expect((await usableApps([chance], on.c, () => {})).apps).toHaveLength(1);
    expect(on.calls.offered).toEqual([]);
    const off = connectors({ declined: ["googlesheets"] });
    expect((await usableApps([chance], off.c, () => {})).apps).toEqual([]);
    expect(off.calls.offered).toEqual([]);
  });

  it("keep clicking: designed the classic way, and remembered", async () => {
    const { c, calls } = connectors({ offer: async () => "classic" });
    expect((await usableApps([chance], c, () => {})).apps).toEqual([]);
    expect(calls.declined).toEqual(["googlesheets"]);
  });
});

describe("app steps in the design", () => {
  it("adds one with the real id, replacing the clicks, and it asks first unless it only reads", async () => {
    const s = session();
    const added = (await run(s, "add", {
      step: {
        do: "app",
        intent: "write today's number to the sheet",
        tool: "GOOGLESHEETS_BATCH_UPDATE",
        arguments: { spreadsheet_id: "<id:s3>", values: [["{{today}}", 42]] },
      },
      after: "s1",
      why: "written to the sheet directly",
    })) as { output: { ok: boolean; new_steps?: string[] } };
    expect(added.output.ok).toBe(true);
    const id = added.output.new_steps?.[0] ?? "";
    expect(findStep(s.draft, id)).toMatchObject({
      channel: "mcp",
      action: "call",
      requires_approval: true,
      args: { tool: "GOOGLESHEETS_BATCH_UPDATE", arguments: { spreadsheet_id: "1AbCdEfGhIjKlMnOpQrStUv" } },
    });
    const read = (await run(s, "add", {
      step: { do: "app", intent: "read the sheet", tool: "GOOGLESHEETS_GET_VALUES", arguments: {}, save_as: "rows" },
      why: "read it directly",
    })) as { output: { new_steps?: string[] } };
    expect(findStep(s.draft, read.output.new_steps?.[0] ?? "")).toMatchObject({ requires_approval: false });

    // The clicks it replaced, removed with a why: that work is kept, not lost.
    await run(s, "remove", { steps: ["s2", "s3"], why: "written to the sheet directly" });
    expect(lostWork(recorded, s.draft, s.whys)).toEqual([]);
  });

  it("refuses a tool that isn't offered, a missing argument, and any app step with no app connected", async () => {
    const refused = async (s: SessionV2, step: Record<string, unknown>) =>
      JSON.stringify((await run(s, "add", { step: { do: "app", intent: "x", ...step }, why: "y" })).output);
    expect(await refused(session(), { tool: "GMAIL_SEND_EMAIL", arguments: {} })).toContain("no app tool");
    expect(await refused(session(), { tool: APPEND.name, arguments: { spreadsheet_id: "<id:s3>" } })).toContain(
      "needs values",
    );
    expect(await refused(session([]), { tool: APPEND.name, arguments: {} })).toContain("no app is connected");
  });

  it("shows a tool's arguments on look", async () => {
    const out = (await run(session(), "look", { app_tool: APPEND.name })).output as { arguments: unknown };
    expect(out.arguments).toEqual(APPEND.inputSchema);
  });
});
