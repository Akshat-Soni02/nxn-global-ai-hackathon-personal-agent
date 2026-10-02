import { describe, expect, it } from "vitest";
import { resolveTemplates, today } from "./template.ts";

const ctx = {
  inputs: { file: "/Users/a/TaskPlayerTest/upload/x.txt", city: "Seattle" },
  vars: { pdfs: ["/a.pdf", "/b.pdf"] },
};
const now = new Date(2026, 9, 2);

describe("templates", () => {
  it("fills inputs, file names, vars and today", () => {
    expect(resolveTemplates({ to: "~/done/{{inputs.file.name}}", day: "{{today}}-{{inputs.city}}" }, ctx, now)).toEqual(
      { to: "~/done/x.txt", day: "2026-10-02-Seattle" },
    );
  });

  it("keeps lists when the whole string is one placeholder", () => {
    expect(resolveTemplates({ from: "{{vars.pdfs}}" }, ctx, now)).toEqual({ from: ["/a.pdf", "/b.pdf"] });
  });

  it("leaves extract's per-element template alone", () => {
    expect(resolveTemplates({ each: "- [{{text}}]({{href}})" }, ctx, now)).toEqual({ each: "- [{{text}}]({{href}})" });
  });

  it("fails loudly on unknown or missing values", () => {
    expect(() => resolveTemplates("{{vars.nope}}", ctx, now)).toThrow(/no value/);
    expect(() => resolveTemplates("{{home}}", ctx, now)).toThrow(/unknown/);
  });

  it("formats today as local YYYY-MM-DD", () => {
    expect(today(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
