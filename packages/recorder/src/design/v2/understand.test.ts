import { fakeLlm } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import { BUILD, PLAN, UNDERSTAND } from "./prompt.ts";
import { understand } from "./understand.ts";

const task = {
  outcome: "the newest KPI email's numbers are in the KPI Sheet",
  cadence: { kind: "schedule", cron: "0 9 * * 1-5", quote: "every day" },
  rules: [{ quote: "always the newest one", where: "said" }],
};

describe("stage 1: understand", () => {
  it("writes the task model from the evidence in one call, before anything changes", async () => {
    const llm = fakeLlm([JSON.stringify(task)]);
    const result = await understand({
      llm,
      evidence: "Goal: KPIs into my sheet\nTimeline: …",
      memory: ["The KPI sheet is called KPI Sheet"],
    });
    expect(result).toMatchObject({
      ok: true,
      task: { cadence: { kind: "schedule" }, rules: [{ quote: "always the newest one" }] },
    });
    expect(llm.requests).toHaveLength(1);
    expect(JSON.stringify(llm.requests[0])).toContain("The KPI sheet is called KPI Sheet");
  });

  it("tries again when the reply isn't a task model, then gives up and says why", async () => {
    const llm = fakeLlm(() => "no json here");
    const result = await understand({ llm, evidence: "Goal: x" });
    expect(result.ok).toBe(false);
    expect(llm.requests.length).toBeGreaterThanOrEqual(2);
    expect(llm.requests.length).toBeLessThanOrEqual(4);
  });

  it("tells the model page text is data, and shows the tools with one worked example, in 80 lines at most", () => {
    expect(UNDERSTAND).toContain("<untrusted_data>");
    expect(BUILD).toContain("<untrusted_data>");
    expect(BUILD).toMatch(/accept p1/);
    expect(BUILD).toMatch(/page: "KPI Sheet"/);
    // Steps without a tab share one tab; a tab name goes with an open that put a page in it (checkpoint 6: a read named
    // the recorded tab, got a blank one, and read nothing).
    expect(BUILD).toMatch(/steps without a tab all work in one tab/);
    expect(BUILD).toMatch(/A tab name no open put a page in is a blank tab/);
    // What steps can't do, and the order to get what changes each time: the same place before an AI pick.
    expect(BUILD).toMatch(/can't\s+use the browser's own menus, print dialog/);
    expect(BUILD).toMatch(/target: \{ place:\s+"s2" \}/);
    expect(BUILD).toMatch(/change s5 \{ tab: "KPI Sheet" \} and s6 \{ tab: "KPI Sheet" \}/);
    expect(BUILD.split("\n").length).toBeLessThanOrEqual(80);
  });

  it("plans with the build's principles and example, without testing and finishing (the episode's)", () => {
    expect(PLAN).toMatch(/^You are Shadow's design agent, planning\. Principles/);
    expect(PLAN).toMatch(/A worked example: the KPI task/);
    expect(PLAN).toMatch(/- Ask only what the user must decide/);
    expect(PLAN).toMatch(/target: \{ place:\s+"s2" \}/);
    for (const gone of ["- Test it (test)", "- Finish with done", "Tools: accept", "- test, then done"])
      expect(PLAN).not.toContain(gone);
    expect(PLAN).toMatch(/\{"calls": \[\{"tool": "<tool>", "input": \{…\}\}, …\]\}/);
  });
});
