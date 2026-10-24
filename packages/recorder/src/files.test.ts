// What made a file (checkpoint 6: Rushil printed the featured article to PDF with Chrome's print dialog, saved it
// straight into ~/Desktop/Reading, and the PDF was blamed on the click 39 s before it, then dropped from the evidence).
import { type ElementDescriptor, Skill, type TraceEvent } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { proposalsOf } from "./evidence/proposals.ts";
import { describeStep, timelineOf } from "./evidence/timeline.ts";
import { normaliseAll } from "./normalise.ts";
import { skeletonOf, skillInput } from "./skeleton.ts";

const T0 = 1_792_779_148_000;
const MAIN = "https://en.wikipedia.org/wiki/Main_Page";
const ARTICLE = "https://en.wikipedia.org/wiki/Thuggee";
const PDF = "/Users/me/Desktop/Reading/23 Oct - Thuggee.pdf";
const el = (d: { tag: string; role?: string; name?: string; href?: string }): ElementDescriptor => ({
  url: MAIN,
  selectors: {},
  fallbacks: [],
  ...d,
});
const link = el({ tag: "a", role: "link", name: "Thuggee", href: ARTICLE });
const exportButton = el({ tag: "button", role: "button", name: "Export" });
let n = 0;
const ev = (event: TraceEvent["event"], at: number, extra: Partial<TraceEvent> = {}): TraceEvent => ({
  id: `e${++n}`,
  sessionId: "s-1",
  at: T0 + at,
  event,
  tabId: 7,
  frameId: 0,
  url: MAIN,
  ...extra,
});
// The folder watcher's events have no tab or page.
const file = (event: TraceEvent["event"], at: number, extra: Partial<TraceEvent>) =>
  ev(event, at, { tabId: undefined, frameId: undefined, url: undefined, ...extra });

const opened = () => [
  ev("tab_open", 0, { title: "Wikipedia", preexisting: true }),
  ev("click", 4_000, { target: link }),
  ev("navigate", 4_300, { url: ARTICLE, transition: "link" }),
];
const printed = () => [
  ...opened(),
  ev("print", 10_000, { url: ARTICLE, title: "Thuggee - Wikipedia", target: el({ tag: "html" }) }),
  file("fs_create", 43_400, { path: PDF }),
];

// Every print and file event ends up in a step or in the noise list: none is silently lost.
const accounted = (trace: TraceEvent[]) => {
  const { steps, noise } = normaliseAll(trace);
  const seen = new Set([...steps.flatMap((s) => s.events), ...noise.flatMap((x) => x.events)]);
  return trace
    .filter((e) => ["print", "fs_create", "download"].includes(e.event))
    .filter((e) => !seen.has(e.id))
    .map((e) => e.event);
};

describe("what made a file", () => {
  it("a page printed to PDF is a step that saves the page as PDF, not a download of the click before it", () => {
    const { steps } = normaliseAll(printed());
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "click", "save_pdf"]);
    expect(steps[1]?.produces).toBeUndefined();
    expect(steps[2]).toMatchObject({ path: PDF, url: ARTICLE, title: "Thuggee - Wikipedia" });
  });

  it("the first draft saves the page as PDF where you did, and a later move uses that file", () => {
    const trace = [
      ...printed(),
      file("fs_move", 50_000, { path: PDF, toPath: "/Users/me/Documents/23 Oct - Thuggee.pdf" }),
    ];
    const { draft } = skeletonOf(normaliseAll(trace).steps);
    const [save, move] = draft.steps.slice(-2);
    expect(save).toMatchObject({
      channel: "web",
      action: "save_pdf",
      args: { dir: "~/Desktop/Reading", name: "23 Oct - Thuggee.pdf" },
      output: { name: "saved_1", type: { type: "file" } },
    });
    expect(move).toMatchObject({ channel: "fs", action: "move", args: { from: "{{saved_1}}", to: "~/Documents/" } });
  });

  it("a file nothing recorded made is said so: no step is blamed and no find is made up", () => {
    const trace = [...opened(), file("fs_create", 43_400, { path: PDF })];
    const { steps } = normaliseAll(trace);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "click", "file_appeared"]);
    expect(steps[1]?.produces).toBeUndefined();
    const sk = skeletonOf(steps);
    expect(sk.draft.steps.map((s) => `${s.channel}.${s.action}`)).toEqual(["web.navigate", "web.navigate"]);
    expect(sk.gaps).toEqual([
      "~/Desktop/Reading/23 Oct - Thuggee.pdf appeared 39 s after the step before it, and the recording doesn't show what made it",
    ]);
  });

  it("a file that appears right after a control that acts is that step's (an Export button, a Mac app's Save)", () => {
    const trace = [
      ev("click", 0, { target: exportButton }),
      file("fs_create", 2_000, { path: "/Users/me/Downloads/report.csv" }),
    ];
    const { steps } = normaliseAll(trace);
    expect(steps.at(-1)).toMatchObject({ kind: "click", produces: ["/Users/me/Downloads/report.csv"] });
  });

  it("a download is the step's that made it, however the watcher and the download event arrive", () => {
    const trace = [
      ev("click", 0, { target: exportButton }),
      file("fs_create", 400, { path: "/Users/me/Downloads/invoice.pdf" }),
      ev("download", 500, { path: "/Users/me/Downloads/invoice.pdf" }),
    ];
    const { steps } = normaliseAll(trace);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "click"]);
    expect(steps[1]?.produces).toEqual(["/Users/me/Downloads/invoice.pdf"]);
    expect(accounted(trace)).toEqual([]);
  });

  it("a form whose only effect was a download needs no OK; one that sent something does (D, 24 Oct)", () => {
    const download = el({ tag: "button", role: "button", name: "Download" });
    const fetched = [
      ev("click", 0, { target: download }),
      ev("submit", 100, { target: download }),
      ev("download", 2_000, { path: "/Users/me/Downloads/Thuggee.pdf" }),
    ];
    const click = (trace: TraceEvent[]) =>
      (skeletonOf(normaliseAll(trace).steps).draft.steps as { action?: string; requires_approval?: boolean }[]).find(
        (s) => s.action === "click",
      );
    expect(click(fetched)?.requires_approval).toBe(false);
    expect(click(fetched.slice(0, 2))?.requires_approval).toBe(true); // a form that left nothing here: it sent something
  });

  it("a print with no PDF after it is listed as left out, never lost", () => {
    const trace = [...opened(), ev("print", 10_000, { url: ARTICLE, title: "Thuggee - Wikipedia" })];
    const { noise } = normaliseAll(trace);
    expect(noise.map((x) => x.what)).toContain('printed "Thuggee - Wikipedia"');
    expect(accounted(trace)).toEqual([]);
  });

  it("every print and file event is in a step or the noise list", () => {
    expect(accounted(printed())).toEqual([]);
    expect(accounted([...opened(), file("fs_create", 43_400, { path: PDF })])).toEqual([]);
  });

  it("the evidence says what each file step did, with an id the agent can name", () => {
    const steps = normaliseAll([
      ...printed(),
      file("fs_create", 60_000, { path: "/Users/me/Desktop/Reading/notes.txt" }),
    ]).steps;
    expect(describeStep(steps[2]!)).toBe(
      'save the page "Thuggee - Wikipedia" as PDF → ~/Desktop/Reading/23 Oct - Thuggee.pdf',
    );
    expect(describeStep(steps[3]!)).toBe("a file appeared: ~/Desktop/Reading/notes.txt (what made it wasn't recorded)");
    const { idsByStep } = skeletonOf(steps);
    const lines = timelineOf({
      start: T0,
      steps,
      ids: idsByStep,
      classes: steps.map(() => "act"),
      tabs: [],
      screens: [],
      said: [],
      noise: [],
    }).map((l) => l.text);
    expect(lines.at(-2)).toContain("s3 act: save the page");
    expect(lines.at(-1)).toContain("n4 act: a file appeared");
  });

  it("a file named with the day it was recorded is named with the day it runs", () => {
    const steps = normaliseAll(printed()).steps;
    const { draft, idsByStep } = skeletonOf(steps);
    const proposals = proposalsOf({
      steps,
      skill: Skill.parse(skillInput(draft)),
      idsByStep,
      goal: "Every day, save today's featured article as a PDF named with today's date",
      said: [],
      recordedOn: new Date(2026, 9, 23, 12),
    });
    const date = proposals.find((p) => p.kind === "date");
    expect(date?.summary).toBe(
      's3 names the file "23 Oct - Thuggee.pdf", the day it was recorded: {{today|D MMM}} - Thuggee.pdf next time',
    );
    expect(date?.edits).toEqual([
      {
        op: "set",
        step: "s3",
        field: "args",
        value: { dir: "~/Desktop/Reading", name: "{{today|D MMM}} - Thuggee.pdf" },
      },
    ]);
  });
});
