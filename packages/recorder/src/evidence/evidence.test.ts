import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TraceEvent } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { compile } from "../compile.ts";
import { normaliseAll } from "../normalise.ts";
import { buildEvidence, type Evidence, evidenceText, evidenceView } from "./evidence.ts";

const MAIL = "https://mail.google.com/mail/u/0/#inbox";
let n = 0;
const ev = (event: TraceEvent["event"], at: number, extra: Partial<TraceEvent> = {}): TraceEvent => ({
  id: `e${++n}`,
  sessionId: "s",
  at,
  event,
  tabId: 1,
  frameId: 0,
  url: MAIL,
  ...extra,
});
const row = {
  tag: "div",
  url: MAIL,
  role: "link",
  name: "Daily KPIs - w/c 19 Oct",
  fallbacks: [],
  selectors: { css: "#r1" },
};
const header = { tag: "div", url: MAIL, text: "Print all In new window", fallbacks: [], selectors: { css: "#h" } };
const subject = {
  tag: "h2",
  url: MAIL,
  role: "heading",
  name: "Daily KPIs - w/c 19 Oct",
  fallbacks: [],
  selectors: { css: "h2" },
};
const list = {
  container: { tag: "table", url: MAIL, role: "grid", fallbacks: [], selectors: { css: "table.F" } },
  index: 0,
  count: 50,
  itemText: "Ana · Daily KPIs - w/c 19 Oct · Hi All, numbers attached",
};

async function evidenceOf(
  trace: TraceEvent[],
  pictures: Parameters<typeof buildEvidence>[0]["pictures"] = [],
  said: Evidence["said"] = [],
) {
  const { steps, noise } = normaliseAll(trace);
  const { skill, base } = await compile(steps);
  return buildEvidence({
    trace,
    steps,
    noise,
    skill,
    idsByStep: base.idsByStep,
    goal: "Note the newest KPI email's subject",
    switches: { screen: pictures.length > 0, voice: said.length > 0, pictures: false },
    said,
    pictures,
  });
}

const gmail = () => [
  ev("tab_open", 0, { title: "Inbox (3) - Searce Mail", preexisting: true }),
  ev("navigate", 1, { transition: "typed" }),
  ev("click", 2_000, { target: row, cid: "c1", list }),
  ev("effect", 2_700, { of: "c1", effect: { changed: "large" } }),
  ev("click", 5_000, { target: header, cid: "c2" }),
  ev("effect", 5_700, { of: "c2", effect: { changed: "none" } }),
  ev("select_text", 7_000, { target: subject, value: "Daily KPIs - w/c 19 Oct" }),
  ev("copy", 8_000, { target: subject, value: "Daily KPIs - w/c 19 Oct", via: "keyboard" }),
];

describe("the evidence package", () => {
  it("holds the steps by draft id and class, the tab, what was left out, and the proposals", async () => {
    const pictures = [
      { eventId: "e3", at: 2_000, tabId: 1, lines: [{ text: "Hi All,", box: { x: 0, y: 0, w: 10, h: 10 } }] },
    ];
    const evidence = await evidenceOf(gmail(), pictures, [{ at: 3_000, text: "always take the newest one" }]);
    expect(evidence.steps.map((s) => [s.id, s.class, s.tab])).toEqual([
      ["s1", "go", "Searce Mail"],
      ["s2", "reveal", "Searce Mail"],
      ["s3", "read", "Searce Mail"],
    ]);
    expect(evidence.steps[1]?.appeared).toEqual(["Hi All,"]);
    expect(evidence.noise.map((x) => x.why)).toEqual(["changed nothing on the page, and nothing was copied from it"]);
    expect(evidence.proposals.map((p) => p.kind)).toContain("list_item");
    expect(evidence.timeline.map((l) => l.text).join("\n")).toContain('said: "always take the newest one"');
  });

  it("hides emails, keys and the recording's private words in everything it shows a model", async () => {
    const search = { tag: "input", url: MAIL, role: "textbox", name: "Search mail", fallbacks: [], selectors: {} };
    const trace = [
      ev("tab_open", 0, { title: "Inbox - Searce Mail", preexisting: true }),
      ev("navigate", 1, { transition: "typed" }),
      ev("click", 2_000, { target: row, cid: "c1", list: { ...list, itemText: "jane@client.com · Project Falcon" } }),
      ev("effect", 2_700, { of: "c1", effect: { changed: "large" } }),
      ev("copy", 8_000, { target: subject, value: "sk-live-abcdefghijklmnop1234", via: "keyboard" }),
      ev("select_text", 10_000, { target: subject, value: "jane@client.com" }),
      ev("click", 12_000, { target: search, cid: "c2" }),
      ev("type", 13_000, { target: search, value: "Project Falcon for jane@client.com" }),
    ];
    const { steps, noise } = normaliseAll(trace);
    const { skill, base } = await compile(steps);
    const evidence = buildEvidence({
      trace,
      steps,
      noise,
      skill,
      idsByStep: base.idsByStep,
      goal: "Note the key",
      switches: { screen: false, voice: false, pictures: false },
      said: [],
      pictures: [],
      maskTerms: ["Project Falcon"],
    });
    const shown = [
      evidenceText(evidence).text,
      JSON.stringify({ steps: evidence.steps, timeline: evidence.timeline, flow: evidence.flow }),
      JSON.stringify({ noise: evidence.noise.map((n) => n.what), proposals: evidence.proposals.map((p) => p.summary) }),
    ].join("\n");
    expect(shown).toContain("███");
    for (const secret of ["jane@client.com", "sk-live-abcdefghijklmnop1234", "Project Falcon"]) {
      expect(shown).not.toContain(secret);
    }
  });

  it("builds from an older recording with no effects, lists or cells (the KPI fixture)", async () => {
    const dir = join(import.meta.dirname, "../../../../fixtures/recordings/kpi-email-to-sheet");
    const trace = readFileSync(join(dir, "trace.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => TraceEvent.parse(JSON.parse(l)));
    const evidence = await evidenceOf(trace);
    expect(evidence.steps.length).toBeGreaterThan(3);
    expect(evidence.noise.filter((x) => x.why.startsWith("changed nothing"))).toEqual([]);
  });

  it("builds with Screen and Voice off: no pictures, no speech, no captions", async () => {
    const evidence = await evidenceOf(gmail());
    expect(evidence.steps.every((s) => s.appeared.length === 0 && s.near.length === 0 && !s.caption)).toBe(true);
    expect(evidence.said).toEqual([]);
    expect(evidence.switches).toEqual({ screen: false, voice: false, pictures: false });
  });

  it("keeps its text under the cap by cutting screen words first, never speech or proposals", async () => {
    const evidence = await evidenceOf(gmail(), [], [{ at: 3_000, text: "always take the newest one" }]);
    const big: Evidence = {
      ...evidence,
      steps: evidence.steps.map((s) => ({
        ...s,
        near: Array(6).fill("x".repeat(120)),
        appeared: Array(12).fill("y".repeat(120)),
        caption: "z".repeat(200),
      })),
    };
    const full = evidenceText(big, 1_000_000);
    const cut = evidenceText(big, Math.floor(full.tokens / 2));
    expect(full.level).toBe(0);
    expect(cut.level).toBeGreaterThan(0);
    expect(cut.text).toContain("always take the newest one");
    for (const p of big.proposals) expect(cut.text).toContain(p.summary);
  });

  it("lets the agent look up a step, a stretch of the timeline, the words about a question, and what appeared", async () => {
    const pictures = [
      { eventId: "e3", at: 2_000, tabId: 1, lines: [{ text: "Hi All,", box: { x: 0, y: 0, w: 10, h: 10 } }] },
    ];
    const view = evidenceView(await evidenceOf(gmail(), pictures, [{ at: 3_000, text: "always take the newest one" }]));
    expect(view.step("s2")).toMatchObject({ class: "reveal" });
    expect(view.timeline("s2", "s2")).toContain("s2 [Searce Mail]");
    expect(view.about("Which email is the newest one?")).toContain("always take the newest one");
    expect(view.appeared().has("Hi All,")).toBe(true);
  });
});
