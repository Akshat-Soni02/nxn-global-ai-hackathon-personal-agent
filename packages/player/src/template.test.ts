import { describe, expect, it } from "vitest";
import { resolveTemplates, today } from "./template.ts";

const file = { path: "/Users/a/TaskPlayerTest/upload/x.txt", name: "x.txt", size: 4, modified: "" };
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
