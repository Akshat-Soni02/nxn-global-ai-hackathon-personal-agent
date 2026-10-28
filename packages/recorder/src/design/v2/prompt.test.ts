import { describe, expect, it } from "vitest";
import { BUILD, BUILD_FILE, PLAN_FILE, withAiLimit } from "./prompt.ts";

describe("the file-mode prompt (B5)", () => {
  it("shows a page read in one block and written in another, the read after its own page's open", () => {
    // Oct 27, the YC jobs → sheet design: the jobs were read in the block that opened Drive, then never written to the
    // sheet. The example is what tells the agent which block a read belongs in.
    expect(BUILD_FILE).toMatch(/read in one block and written in another/);
    expect(BUILD_FILE).toMatch(
      /"Open the jobs page".*"Copy the top 5 jobs".*"Open the sheet".*"Add a row for each job"/s,
    );
    expect(BUILD_FILE).toMatch(/a read right after "Open the sheet" would read the sheet/);
  });

  it("says what a step marked drawn is, and that a connected app does it (A1)", () => {
    expect(BUILD_FILE).toMatch(/"drawn": true/);
    expect(BUILD_FILE).toMatch(/replay can't reach/);
    expect(BUILD_FILE).toMatch(/leave it: the review says it can't run yet/);
  });
});

describe("what an AI step is for (28 Oct YC → Sheet: five AI steps, four reshaping data, the run stopped at its limit)", () => {
  it("says how values are reached without AI, and what an AI step costs", () => {
    for (const prompt of [BUILD_FILE, PLAN_FILE]) {
      expect(prompt).toMatch(/\{\{name\.0\}\} a list's first item/);
      expect(prompt).toMatch(/\{\{row\.1\}\} a row's second cell/);
      expect(prompt).toMatch(/never an AI step to reshape, flatten, pair or take the first/);
      expect(prompt).toMatch(/one AI step per judgement, given everything it needs at once/);
    }
    // The worked example gives its one AI step both lists.
    expect(BUILD_FILE).toMatch(/"inputs": \["\{\{subjects\}\}", "\{\{done_rows\}\}"\]/);
  });

  it("puts the run's real AI limit in the prompt", () => {
    expect(withAiLimit(BUILD_FILE, 3)).toMatch(/a run may ask the AI 3 times/);
    expect(withAiLimit(BUILD_FILE, 7)).toMatch(/a run may ask the AI 7 times/);
    expect(withAiLimit(BUILD_FILE, undefined)).toMatch(/a run may ask the AI 3 times/);
  });
});

describe('how often it runs (the third YC re-design built "Every day" as weekdays, as the worked example did)', () => {
  it("never shows 'every day' turned into weekdays, and says which cron is which", () => {
    expect(BUILD).not.toMatch(/"0 9 \* \* 1-5" \}, why "every day/);
    expect(BUILD_FILE).not.toMatch(/every new KPI email[^\n]*1-5/);
    expect(BUILD_FILE).toMatch(/"0 9 \* \* \*" every day, "0 9 \* \* 1-5" weekdays only/);
  });

  it("says the cells the recording typed into are the columns an app writes", () => {
    expect(BUILD_FILE).toMatch(/the cells the recording typed into give each value's column/i);
  });
});
