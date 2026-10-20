import { describe, expect, it } from "vitest";
import { resolveTemplates, today } from "./template.ts";

const file = { path: "/Users/a/ShadowTest/upload/x.txt", name: "x.txt", size: 4, modified: "" };
const ctx = {
  vars: {
    file,
    city: "Seattle",
    pdfs: [{ path: "/a.pdf" }, { path: "/b.pdf" }],
    invoice: { vendor: "Acme", amount: 1234 },
  },
};
const now = new Date(2026, 9, 2);

describe("templates", () => {
  it("fills variables, fields, list items and today", () => {
    expect(
      resolveTemplates({ to: "~/done/{{file.name}}", day: "{{today}}-{{city}}", first: "{{pdfs.0.path}}" }, ctx, now),
    ).toEqual({ to: "~/done/x.txt", day: "2026-10-02-Seattle", first: "/a.pdf" });
  });

  it("keeps the value's type when the whole string is one reference", () => {
    expect(resolveTemplates({ from: "{{pdfs}}", amount: "{{invoice.amount}}" }, ctx, now)).toEqual({
      from: [{ path: "/a.pdf" }, { path: "/b.pdf" }],
      amount: 1234,
    });
  });

  it("writes objects and lists inside text as JSON", () => {
    expect(resolveTemplates("Invoice: {{invoice}}", ctx, now)).toBe('Invoice: {"vendor":"Acme","amount":1234}');
  });

  it("leaves extract's per-element template alone", () => {
    expect(resolveTemplates({ each: "- [{{text}}]({{href}})" }, ctx, now)).toEqual({ each: "- [{{text}}]({{href}})" });
  });

  it("fails loudly on a missing variable, field or item", () => {
    expect(() => resolveTemplates("{{nope}}", ctx, now)).toThrow("nope has no value yet");
    expect(() => resolveTemplates("{{invoice.amonut}}", ctx, now)).toThrow("invoice has no field amonut");
    expect(() => resolveTemplates("{{pdfs.5.path}}", ctx, now)).toThrow("pdfs has no item 5 (it has 2)");
  });

  it("formats today as local YYYY-MM-DD", () => {
    expect(today(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("dates in templates (spec 2.11)", () => {
  const tuesday = new Date(2026, 9, 20, 9, 30); // Tuesday 20 Oct 2026
  const at = (t: string, now = tuesday) => resolveTemplates(t, { vars: {} }, now);

  it("gives today, a day before or after, and the week's Monday, in the format typed", () => {
    expect(at("{{today}}")).toBe("2026-10-20");
    expect(at("{{today-1}}")).toBe("2026-10-19");
    expect(at("{{today+3|ddd D MMMM YYYY}}")).toBe("Fri 23 October 2026");
    expect(at("{{today|D MMM}}")).toBe("20 Oct");
    expect(at("{{ today | DD/MM/YYYY }}")).toBe("20/10/2026");
    expect(at("{{today|D.M.YYYY}}")).toBe("20.10.2026");
    expect(at("{{week_start}}")).toBe("2026-10-19");
    expect(at("Daily KPIs - {{week_start|[w/c] D MMM}}")).toBe("Daily KPIs - w/c 19 Oct");
  });

  it("starts the week on Monday, also on a Sunday", () => {
    expect(at("{{week_start}}", new Date(2026, 9, 25))).toBe("2026-10-19");
  });
});
