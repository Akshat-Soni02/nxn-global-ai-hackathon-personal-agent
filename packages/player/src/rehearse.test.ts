import { ActionStep, Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { rehearsal, rehearsalChoice, rehearsalPlan } from "./rehearse.ts";
import { runSkill } from "./run.ts";
import type { RunDeps } from "./types.ts";

const act = (id: string, action: string, target?: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ActionStep.parse({
    id,
    type: "action",
    intent: `${action} ${id}`,
    channel: "web",
    action,
    ...(target ? { target: { fallbacks: [], ...target } } : {}),
    args: action === "navigate" ? { url: "https://mail.google.com/" } : {},
    ...extra,
  });

describe("what the test run does for real", () => {
  it("opens and reads; follows links, tabs and menus that only went somewhere; never presses Archive", () => {
    expect(rehearsalChoice(act("s1", "navigate"), undefined, 0).choice).toBe("do");
    expect(rehearsalChoice(act("s2", "extract", { role: "list" }), undefined, 0).choice).toBe("do");
    expect(
      rehearsalChoice(
        act("s3", "click", { role: "link", name: "Daily KPIs" }),
        { changed: "large", navigated: true },
        0,
      ).choice,
    ).toBe("do");
    expect(
      rehearsalChoice(act("s4", "click", { role: "button", name: "More" }), { changed: "small", expanded: true }, 0)
        .choice,
    ).toBe("do");
    // Gmail's Archive returns to the inbox ("went somewhere") but archives the email.
    expect(
      rehearsalChoice(
        act("s5", "click", { role: "button", name: "Archive" }),
        { changed: "large", navigated: true },
        0,
      ),
    ).toMatchObject({ choice: "skip", why: expect.stringMatching(/Archive/) });
    expect(rehearsalChoice(act("s6", "type", { role: "textbox", name: "Subject" }), undefined, 0).choice).toBe("skip");
    expect(
      rehearsalChoice(
        act("s7", "click", { role: "button", name: "Next" }, { requires_approval: true }),
        { changed: "large" },
        0,
      ).choice,
    ).toBe("skip");
    expect(rehearsalChoice(act("s8", "click", { role: "button", name: "Apply" }), { changed: "large" }, 0).choice).toBe(
      "skip",
    );
  });
});

describe("what the test run never does", () => {
  it("never follows a link the agent invented, nor one whose recorded control was changed; never Decline or Join", () => {
    const link = act("s9", "click", { role: "link", name: "Daily KPIs" });
    expect(rehearsalChoice(link, undefined, 0, false).choice).toBe("skip");
    expect(rehearsalChoice(link, { changed: "large", navigated: true }, 0, false).choice).toBe("skip");
    expect(rehearsalChoice(link, undefined, 0, true).choice).toBe("do");
    for (const name of ["Decline", "Join meeting", "Accept invite", "Unfollow", "Resolve"]) {
      expect(
        rehearsalChoice(act("s3", "click", { role: "link", name }), { changed: "large", navigated: true }, 0).choice,
      ).toBe("skip");
    }
  });
});

describe("what it says before it starts", () => {
  it("lists what it will do, what it will only outline, and that opening an email marks it read", () => {
    const skill = Skill.parse({
      id: "w",
      name: "w",
      version: 1,
      description: { goal: "g" },
      steps: [
        { id: "start", type: "trigger", intent: "by hand" },
        act("s1", "navigate"),
        { ...act("s2", "click", { role: "link", name: "Daily KPIs" }), intent: "open the newest email" },
        act("s3", "type", { role: "textbox", name: "Subject" }),
      ],
    });
    const plan = rehearsalPlan(skill, new Map([["s2", { changed: "large", navigated: true }]]));
    expect(plan.does).toEqual(["s1 navigate s1", "s2 open the newest email"]);
    expect(plan.outlines).toEqual(["s3 type s3 (it would change something)"]);
    expect(plan.warnings).toEqual(["Opening 1 email will mark it as read"]);
  });
});

describe("the test run", () => {
  it("reports what it did, what it only found, and what it couldn't find", async () => {
    const skill = Skill.parse({
      id: "w",
      name: "w",
      version: 1,
      description: { goal: "g" },
      steps: [
        { id: "start", type: "trigger", intent: "by hand" },
        act("s1", "navigate"),
        act("s5", "click", { role: "button", name: "Archive" }),
        act("s6", "type", { role: "textbox", name: "Gone" }),
      ],
    });
    const r = rehearsal(skill, new Map([["s5", { changed: "large", navigated: true }]]));
    const deps: RunDeps = {
      web: async () => ({ ok: true }),
      fs: async () => ({ ok: true }),
      script: async () => ({ ok: true }),
      fileExists: async () => true,
      webCheck: async () => true,
      approve: async () => false,
      walk: r.walk,
      highlight: async (step) => {
        if (step.target?.name === "Gone") {
          r.onHighlight(step, "target not found");
          throw new Error("target not found");
        }
        r.onHighlight(step);
      },
      log: r.log,
    };
    const outcome = await runSkill(skill, deps, { inputs: {} });
    const report = r.report(outcome.status);
    expect(report.steps.map((s) => [s.id, s.status])).toEqual([
      ["s1", "done"],
      ["s5", "found"],
      ["s6", "not_found"],
    ]);
    expect(report.steps[2]?.error).toBe("target not found");
  });
});

describe("what live D showed", () => {
  it("only outlines finding a file this run makes: a test run never downloads it", () => {
    const find = (args: Record<string, unknown>) =>
      ActionStep.parse({ id: "s6", type: "action", intent: "find", channel: "fs", action: "find", args });
    const made = rehearsalChoice(find({ dir: "~/Downloads", glob: "*.pdf", since_run_start: true }), undefined, 0);
    expect(made.choice).toBe("skip");
    expect(made.why).toMatch(/a file this run makes/);
    expect(rehearsalChoice(find({ dir: "~/Downloads", glob: "*.pdf" }), undefined, 0).choice).toBe("do");
  });
});
