import { describe, expect, it } from "vitest";
import { stepTitle } from "./names.ts";
import type { Step } from "./skill.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/1XyZexampleDocId/edit#gid=0";
const action = (extra: Record<string, unknown>) =>
  ({ id: "s1", type: "action", intent: "x", channel: "web", requires_approval: false, args: {}, ...extra }) as Step;

describe("titles people read (the YC workflow's cards, Oct 26)", () => {
  it("names a page by its app or site, never its address, and says which page of a site", () => {
    expect(stepTitle(action({ action: "navigate", args: { url: SHEET } }))).toBe("Open Google Sheets");
    expect(
      stepTitle(action({ action: "navigate", args: { url: SHEET } }), {
        titles: new Map([[SHEET, "Ycomb jobs - Google Sheets"]]),
      }),
    ).toBe("Open Ycomb jobs");
    expect(stepTitle(action({ action: "navigate", args: { url: "https://www.example.com/jobs" } }))).toBe(
      "Open example.com/jobs",
    );
  });

  it("drops what only a screen reader needed, and addresses in a step's words", () => {
    expect(
      stepTitle(action({ action: "click", intent: "Click 'Ycomb jobs Google Sheets More info (Option + →)'" })),
    ).toBe("Click “Ycomb jobs”");
    expect(stepTitle(action({ action: "extract", intent: `Read ${SHEET}` }))).toBe("Read Google Sheets");
  });
});
