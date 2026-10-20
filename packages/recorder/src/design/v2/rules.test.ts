import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { changeNotes, refusals } from "./rules.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/S/edit";
const MAIL = "https://mail.google.com/mail/u/0/#inbox";
type Extra = { never?: string[]; inputs?: Record<string, unknown>; when?: unknown[] };
const base = (steps: unknown[], extra: Extra = {}) =>
  Skill.parse({
    id: "kpi",
    name: "kpi",
    version: 1,
    description: { goal: "KPIs into the sheet", never: extra.never ?? [] },
    steps: [
      {
        id: "start",
        type: "trigger",
        intent: "by hand",
        inputs: extra.inputs ?? {},
        when: extra.when ?? [{ type: "manual" }],
      },
      ...steps,
    ],
  });
const open = (id: string, url: string) => ({
  id,
  type: "action",
  intent: "open",
  channel: "web",
  action: "navigate",
  args: { url },
});
const click = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "action",
  intent: `click ${name}`,
  channel: "web",
  action: "click",
  target: { role: "button", name, fallbacks: [] },
  ...extra,
});
const fs = (id: string, action: string, args: Record<string, unknown>, output?: unknown) => ({
  id,
  type: "action",
  intent: `${action} ${id}`,
  channel: "fs",
  action,
  args,
  ...(output ? { output } : {}),
});
const text = (name: string) => ({ name, type: { type: "text" } });
const facts = { pages: [SHEET, MAIL], folders: ["/tmp/exports"] };

describe("refusals: what the design agent may never do", () => {
  const original = base([open("s1", SHEET), click("s2", "Send", { requires_approval: true })], { never: ["Archive"] });

  it("allows new clicks, new targets, removals and reordering: those are changes for the review, not refusals", () => {
    const draft = base([open("s1", SHEET), click("s9", "Next page")], { never: ["Archive"] });
    expect(refusals(original, draft, facts)).toEqual([]);
  });

  it("refuses turning approval off, scripts, a changed goal, an unvisited site, files elsewhere and Never matches", () => {
    const draft = Skill.parse({
      ...original,
      description: { goal: "something else", never: ["Archive"] },
      steps: [
        { id: "start", type: "trigger", intent: "by hand", inputs: { link: { type: { type: "text" } } } },
        open("s1", "https://evil.example/"),
        click("s2", "Send", { requires_approval: false }),
        { id: "s3", type: "action", intent: "run it", channel: "script", action: "shell", args: { command: "ls" } },
        fs("s4", "find", { dir: "~/.ssh", glob: "*", pick: "all" }),
        click("s5", "Archive"),
        open("s6", "{{link}}"),
      ],
    });
    const why = refusals(original, draft, facts).join("\n");
    expect(why).toMatch(/goal/);
    expect(why).toMatch(/s1: https:\/\/evil\.example is a site the recording didn't visit/);
    expect(why).toMatch(/s2: approval can't be turned off/);
    expect(why).toMatch(/s3: script/);
    expect(why).toMatch(/s4: .*folders the recording touched/);
    expect(why).toMatch(/s5: .*Never rule "Archive"/);
    expect(why).toMatch(/s6: an address built from a value/);
  });

  it("keeps file steps and inputs inside the folders the recording touched, however the path is written", () => {
    const original = base([open("s1", SHEET)]);
    const problems = (...steps: unknown[]) => refusals(original, base([open("s1", SHEET), ...steps]), facts).join("\n");
    expect(problems(fs("r1", "read", { path: "/tmp/exports/kpis.csv" }, text("r1")))).toBe("");
    expect(problems(fs("r2", "read", { path: "~/Desktop/notes.txt" }, text("r2")))).toMatch(
      /r2: it may only reach folders .* not ~\/Desktop\/notes.txt/,
    );
    expect(problems(fs("f1", "find", { dir: "/tmp/exports", glob: "../../Users/*", pick: "all" }))).toMatch(
      /f1: its glob .* must stay inside its folder/,
    );
    const input = base([open("s1", SHEET)], { inputs: { key: { type: { type: "text" }, default: "~/.ssh/id_rsa" } } });
    expect(refusals(original, input, facts).join()).toMatch(
      /key: an input may only point at folders .* not ~\/\.ssh\/id_rsa/,
    );
  });

  it("reads a date in a path as the date it will be, so a date can't lead out of a recorded folder", () => {
    const original = base([open("s1", SHEET)]);
    const find = (id: string, dir: string, glob = "*") => fs(id, "find", { dir, glob, pick: "all" });
    const problems = (step: unknown) => refusals(original, base([open("s1", SHEET), step]), facts).join("\n");
    expect(problems(find("f1", "/tmp/exports/{{today|YYYY-MM}}"))).toBe("");
    // Written, it looks inside /tmp/exports; run, "20/." and "./20" make "20/../20", and it climbs out.
    expect(problems(find("f2", "/tmp/exports/{{today|D/.}}{{today|./D}}/../../../.ssh"))).toMatch(
      /f2: it may only reach/,
    );
    expect(problems(find("f3", "/tmp/exports", "{{today|D/.}}{{today|./D}}/../../*"))).toMatch(
      /f3: its glob .* must stay inside its folder/,
    );
    // A whole-string date is not a value an earlier step produced: it is checked like any place.
    expect(problems(find("f4", "{{today}}"))).toMatch(/f4: it may only reach/);
  });

  it("refuses a file path made from an AI step's answer or page text; allows a found file and an input", () => {
    const inputs = { report: { type: { type: "file" } } };
    const original = base([open("s1", SHEET)], { inputs });
    const ai = {
      id: "ai1",
      type: "llm",
      intent: "pick a path",
      instruction: "x",
      inputs: ["{{report}}"],
      output: text("where"),
    };
    const found = fs(
      "f1",
      "find",
      { dir: "/tmp/exports", glob: "*.csv", pick: "all" },
      { name: "csvs", type: { type: "list", items: { type: "file" } } },
    );
    const loop = {
      id: "l1",
      type: "control",
      kind: "loop",
      intent: "each",
      over: "{{csvs}}",
      item: { name: "csv", type: { type: "file" } },
      steps: [fs("r3", "read", { path: "{{csv.path}}" }, text("r3"))],
    };
    const draft = base(
      [
        open("s1", SHEET),
        ai,
        fs("r1", "read", { path: "{{where}}" }, text("r1")),
        fs("r2", "read", { path: "/tmp/exports/{{where}}.csv" }, text("r2")),
        found,
        loop,
        fs("r4", "read", { path: "{{report.path}}" }, text("r4")),
      ],
      { inputs },
    );
    const why = refusals(original, draft, facts).join("\n");
    expect(why).toMatch(/r1: a path made from \{\{where\}\}/);
    expect(why).toMatch(/r2: a path made from \{\{where\}\}/);
    expect(why).not.toMatch(/r3|r4|f1/);
  });

  it("keeps uploads and watched folders inside the folders the recording touched too", () => {
    const original = base([open("s1", SHEET)]);
    const upload = (id: string, file: string) => ({
      id,
      type: "action",
      intent: `upload ${id}`,
      channel: "web",
      action: "upload",
      target: { role: "button", name: "Upload", fallbacks: [] },
      args: { file },
    });
    const ai = { id: "ai1", type: "llm", intent: "pick", instruction: "x", inputs: ["{{x}}"], output: text("answer") };
    const why = (...steps: unknown[]) => refusals(original, base([open("s1", SHEET), ...steps]), facts).join("\n");
    expect(why(upload("u1", "/tmp/exports/kpis.csv"))).toBe("");
    expect(why(upload("u2", "~/.ssh/id_rsa"))).toMatch(/u2: it may only reach .* not ~\/\.ssh\/id_rsa/);
    const fromAnswer = refusals(
      original,
      base([open("s1", SHEET), ai, upload("u3", "{{answer}}")], { inputs: { x: { type: { type: "text" } } } }),
      facts,
    ).join("\n");
    expect(fromAnswer).toMatch(/u3: a path made from \{\{answer\}\}/);
    const watched = base([open("s1", SHEET)], { when: [{ type: "folder_watch", dir: "~/.ssh", glob: "*" }] });
    expect(refusals(original, watched, facts).join()).toMatch(/start: it may only watch .* not ~\/\.ssh/);
  });

  it("refuses a hidden value (███) copied back from the masked text the agent reads", () => {
    const original = base([open("s1", SHEET)]);
    const typing = {
      id: "t1",
      type: "action",
      intent: "type the date",
      channel: "web",
      action: "type",
      target: { role: "textbox", name: "Message", fallbacks: [] },
      args: { text: "Date - ███" },
    };
    expect(refusals(original, base([open("s1", SHEET), typing]), facts).join()).toMatch(/t1: .*hidden value/);
  });

  it("keeps how often it runs when the form set it", () => {
    const original = base([open("s1", SHEET)], { when: [{ type: "schedule", cron: "0 9 * * *" }] });
    const changed = base([open("s1", SHEET)], { when: [{ type: "manual" }] });
    expect(refusals(original, changed, { ...facts, whenFixed: true }).join()).toMatch(/how often it runs was set/);
    expect(refusals(original, changed, facts)).toEqual([]);
  });
});

describe("change notes: everything else, with the agent's reason", () => {
  it("lists added, removed, changed and moved steps, and which new targets the test run hasn't found yet", () => {
    const original = base([open("s1", SHEET), click("s2", "Print all"), click("s3", "Next")]);
    const draft = base([open("s1", MAIL), click("s9", "Newest email"), click("s3", "Next")]);
    const whys = new Map([
      ["s2", "a click that changed nothing"],
      ["s9", "open the newest email, not this one"],
    ]);
    const notes = changeNotes(original, draft, whys, new Set(["s9"]));
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: "s2", change: "removed", why: "a click that changed nothing" }),
        expect.objectContaining({ step: "s9", change: "added", unverified: true }),
        expect.objectContaining({ step: "s1", change: "changed" }),
      ]),
    );
    expect(notes.some((n) => n.step === "s3")).toBe(false);
  });
});
