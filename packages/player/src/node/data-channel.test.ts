import { describe, expect, it } from "vitest";
import { parseCsv, rowsOf, sheetExportUrl } from "../web/csv.ts";
import { pick } from "./data-channel.ts";

const rows = [
  { Date: "10/2/2026", Client: "Acme", Amount: "1,180" },
  { Date: "10/3/2026", Client: "Globex", Amount: "1,234" },
  { Date: "10/3/2026", Client: "Initech", Amount: "990" },
];
describe("data.pick: a rule, no model", () => {
  it("matches a date written as YYYY-MM-DD against the sheet's 10/3/2026, first or last match", () => {
    expect(pick({ from: rows, where: { Date: "2026-10-03" }, column: "Amount" })).toEqual({ ok: true, value: "1,234" });
    expect(pick({ from: rows, where: { date: "2026-10-03" }, column: "amount", pick: "last" }).value).toBe("990");
    expect(pick({ from: rows, where: { Client: "acme" }, column: "Date" }).value).toBe("10/2/2026");
  });

  it("fails rather than pick the wrong day when a sheet's dates can be read two ways (C33)", () => {
    // 3/10/2026 is 3 October or 10 March; 10/3/2026 the other way round. Nothing says which the sheet means.
    const unclear = [
      { Date: "3/10/2026", Client: "A" },
      { Date: "10/3/2026", Client: "B" },
    ];
    const r = pick({ from: unclear, where: { Date: "2026-10-03" }, column: "Client" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/day first or month first/);
  });

  it("reads the sheet's own order from a date that can only be one way (C33)", () => {
    const dayFirst = [
      { Date: "3/10/2026", Client: "A" },
      { Date: "10/3/2026", Client: "B" },
      { Date: "25/10/2026", Client: "C" }, // 25 is a day: the sheet writes day/month
    ];
    expect(pick({ from: dayFirst, where: { Date: "2026-10-03" }, column: "Client" }).value).toBe("A");
    const monthFirst = [
      { Date: "3/10/2026", Client: "A" },
      { Date: "10/3/2026", Client: "B" },
      { Date: "10/25/2026", Client: "C" }, // 25 is a day: the sheet writes month/day
    ];
    expect(pick({ from: monthFirst, where: { Date: "2026-10-03" }, column: "Client" }).value).toBe("B");
  });

  it("says which rule found nothing", () => {
    expect(pick({ from: rows, where: { Date: "2026-12-25" }, column: "Amount" })).toEqual({
      ok: false,
      error: "no row where Date = 2026-12-25",
    });
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
