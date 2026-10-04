import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Step } from "@taskplayer/core";
import { describe, expect, it } from "vitest";
import { parseCsv, rowsOf, sheetExportUrl } from "../web/csv.ts";
import { dataChannel, pick } from "./data-channel.ts";

const rows = [
  { Date: "10/2/2026", Client: "Acme", Amount: "1,180" },
  { Date: "10/3/2026", Client: "Globex", Amount: "1,234" },
  { Date: "10/3/2026", Client: "Initech", Amount: "990" },
];
const step = (action: string, args: Record<string, unknown>): Step => ({
  id: "s1",
  intent: "x",
  channel: "data",
  action,
  args,
  requires_approval: false,
});
const ctx = (runId: string) => ({ runId, startedAt: 0, inputs: {}, vars: {} });

describe("data.pick: a rule, no model", () => {
  it("matches a date written as YYYY-MM-DD against the sheet's 10/3/2026, first or last match", () => {
    expect(pick({ from: rows, where: { Date: "2026-10-03" }, column: "Amount" })).toEqual({ ok: true, value: "1,234" });
    expect(pick({ from: rows, where: { date: "2026-10-03" }, column: "amount", pick: "last" }).value).toBe("990");
    expect(pick({ from: rows, where: { Client: "acme" }, column: "Date" }).value).toBe("10/2/2026");
  });

  it("says which rule found nothing", () => {
    expect(pick({ from: rows, where: { Date: "2026-12-25" }, column: "Amount" })).toEqual({
      ok: false,
      error: "no row where Date = 2026-12-25",
    });
  });
});

describe("data.ai: one model call per run, capped and cached", () => {
  const ai = (args: Record<string, unknown> = {}) =>
    step("ai", { instruction: "Amount of today's row", from: rows, output: "number", ...args });

  it("caps calls per run, caps input size, caches answers, and checks the answer's type", async () => {
    let calls = 0;
    const ask = async () => {
      calls++;
      return "<think>today is 10/3</think> 1,234";
    };
    const run = dataChannel({
      ask,
      cacheDir: mkdtempSync(join(tmpdir(), "tp-ai-")),
      limits: { maxCallsPerRun: 1, maxInputChars: 500 },
    });
    expect(await run(ai(), ctx("r1"))).toEqual({ ok: true, value: 1234 });
    expect(await run(ai(), ctx("r2"))).toEqual({ ok: true, value: 1234 }); // same question and data: from the cache
    expect(calls).toBe(1);
    expect((await run(ai({ instruction: "something else" }), ctx("r1"))).error).toMatch(/already made 1 model calls/);
    expect((await run(ai({ from: "x".repeat(600) }), ctx("r3"))).error).toMatch(/over the 500 limit/);
    // The same data on another day is a new question: "today's row" must not come from yesterday's answer.
    const tomorrow = { ...ctx("r6"), startedAt: Date.now() + 86_400_000 };
    let asked = "";
    const dated = dataChannel({
      ask: async (_s, user) => {
        asked = user;
        return "990";
      },
      cacheDir: mkdtempSync(join(tmpdir(), "tp-ai-")),
    });
    await dated(ai(), ctx("r7"));
    expect(await dated(ai(), tomorrow)).toEqual({ ok: true, value: 990 });
    expect(asked).toMatch(/^Today is \d{4}-\d{2}-\d{2}\./);
    const wrong = dataChannel({ ask: async () => "about twelve hundred" });
    expect((await wrong(ai({ output: "date" }), ctx("r4"))).error).toMatch(/not a date as YYYY-MM-DD/);
    expect((await dataChannel({})(ai(), ctx("r5"))).error).toMatch(/needs a model/);
  });
});

describe("csv", () => {
  it("reads quoted fields, commas, doubled quotes and CRLF", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
    expect(rowsOf('Date,Amount\n10/3/2026,"1,234"\n')).toEqual([{ Date: "10/3/2026", Amount: "1,234" }]);
  });

  it("finds a sheet tab's CSV export from its URL", () => {
    expect(sheetExportUrl("https://docs.google.com/spreadsheets/d/abc123/edit#gid=42&range=C3")).toBe(
      "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=42",
    );
    expect(sheetExportUrl("https://example.com/sheet")).toBeUndefined();
  });
});
