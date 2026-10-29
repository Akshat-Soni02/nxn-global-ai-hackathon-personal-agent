import { Skill } from "@shadow/core";
import type { Review } from "@shadow/daemon/src/types.ts";
import { describe, expect, it } from "vitest";
import { badgesOf, cantRunNow, nodeProblems, plainProblem, savedSince, summaryOf } from "./review.ts";

const review: Review = {
  skillId: "w",
  version: 1,
  summary: "x",
  notes: [
    { step: "s4", change: "removed", what: "click the header", why: "it changed nothing" },
    { step: "s13", change: "added", what: "read the inbox", unverified: true },
    { step: "s7", change: "changed", what: "paste" },
  ],
  said: [],
  notTested: ["s7: target not found"],
  gaps: [],
  reviewed: false,
};

describe("problems on the nodes they're about (the YC review, Oct 26: nine 's5: target not found')", () => {
  const nav = (id: string) => ({
    id,
    type: "action",
    intent: "open",
    channel: "web",
    action: "navigate",
    args: { url: "https://example.com" },
  });
  const skill = Skill.parse({
    id: "w",
    name: "w",
    version: 1,
    description: { goal: "g" },
    steps: [
      { id: "start", type: "trigger", intent: "t" },
      { id: "b1", type: "control", kind: "group", intent: "Fill in the sheet", steps: [nav("s5"), nav("s6")] },
      nav("s7"),
    ],
  });

  it("puts each on the block that holds its step, in plain words, once", () => {
    const { byNode, other } = nodeProblems(
      {
        ...review,
        notTested: ["s5: target not found", "s6: target not found"],
        gaps: [
          "s5: the test run didn't find it: fix it, or explain why it will work in a real run",
          "s7: it failed in the test run (no such cell)",
          'rule 0 "I pick top 5 jobs.": no step open_yc_jobs in the workflow',
        ],
      },
      skill,
    );
    expect(byNode.get("b1")).toEqual(["When testing, it couldn't find what it clicks or reads on the page"]);
    expect(byNode.get("s7")).toEqual(["It failed when testing: no such cell"]);
    expect(other).toEqual(["What you said, “I pick top 5 jobs.”, isn't built by any step yet"]);
  });

  it("says the agent's other phrasings for a person", () => {
    // More of the gate's own wording, in plain words (R3.6, B2): none of these should reach the window as written.
    const plain = (text: string) => plainProblem(text);
    expect(plain(`replay can't find its control: give it a role and name ({ role: "button", name: "Save" })`)).toBe(
      "A step has no way to find its control on the page yet",
    );
    expect(
      plain('"Order placed" never appeared on screen: check for text that did, or for the page (url_matches)'),
    ).toBe("A check looks for text that never showed up on screen");
    expect(plain(`a text check can't be empty (it would always hold)`)).toBe(
      "A check has no text to look for, so it would always pass",
    );
    expect(plain(`a text check can't see a sheet's or document's drawn content: use url_matches or none`)).toBe(
      "A text check can't read a sheet's cells or a document's drawing",
    );
    expect(plain(`they said "every day", but it only runs when started by hand: set it with trigger`)).toBe(
      "You said how often it should run, but it only runs when you start it: set its Frequency",
    );
    expect(plain("the test run couldn't start (input day has no value): fix that, so it can run")).toBe(
      "The test run couldn't start (input day has no value)",
    );
    expect(plain("s1: runs start on a blank window, so the workflow must open a page first")).toBe(
      "It has to open a page before it clicks or reads",
    );
    expect(
      plain("p1 (s2 clicked item 3 of 9: next time the newest?) was accepted, but s3 is still as recorded: build it"),
    ).toBe("A change the design accepted isn't made yet");
    expect(plainProblem("not reached")).toBe("The test stopped before it got here");
    expect(plainProblem("s29 read exactly what s28 read in the test run")).toMatch(/same page/);
  });
});

describe("the review on the workflow page", () => {
  it("can't run yet only on the version the design saved: a version saved on top may have fixed it", () => {
    const cant = { ...review, cantRun: ["no step makes a file in ~/Desktop/Reading"] };
    expect(cantRunNow(cant, 1)).toEqual(["no step makes a file in ~/Desktop/Reading"]);
    expect(cantRunNow(cant, 2)).toEqual([]);
    expect(cantRunNow(review, 1)).toEqual([]);
    // Its first line follows: the design's words until a version is saved on top, then what to check.
    expect(summaryOf({ ...cant, summary: "Can't run yet: x" }, cantRunNow(cant, 1))).toBe("Can't run yet: x");
    expect(summaryOf(cant, cantRunNow(cant, 2))).toMatch(/^You changed it after the design said it can't run yet/);
    expect(summaryOf(review, [])).toBe("x");
  });

  it("badges every change, with its why, and marks what no test run found", () => {
    expect(badgesOf(review)).toEqual([
      { step: "s4", label: "Removed", why: "it changed nothing", untested: false },
      { step: "s13", label: "Added", untested: true },
      { step: "s7", label: "Changed", untested: true },
    ]);
  });

  it("opens the workflow a recording just saved, never one saved before the screen opened", () => {
    const last = { sessionId: "rec-2", outcome: "saved" as const, skillId: "kpi-a1b2c3", text: "Saved KPIs" };
    expect(savedSince("rec-1", last)).toBe("kpi-a1b2c3");
    expect(savedSince("rec-2", last)).toBeUndefined();
    expect(savedSince("rec-1", { ...last, outcome: "failed" })).toBeUndefined();
  });
});
