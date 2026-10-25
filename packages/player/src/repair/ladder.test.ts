import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { detourFrom } from "./ladder.ts";

const nav = (id: string, url: string) => ({
  id,
  type: "action",
  intent: `open ${url}`,
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
  target: { role: "link", name, fallbacks: [] },
  ...extra,
});
const workflow = (steps: unknown[]) =>
  Skill.parse({
    id: "w",
    name: "w",
    version: 1,
    description: { goal: "g" },
    steps: [{ id: "start", type: "trigger", intent: "t" }, ...steps],
  });

describe("skipping a detour (Oct 25: the run died in Drive's Recent list)", () => {
  // As saved from the YC recording: My Drive → Recent → the sheet (s4, s5), then YC jobs opened by its address (s6).
  const yc = workflow([
    nav("s2", "https://drive.google.com/drive/my-drive"),
    click("s4", "Recent"),
    click("s5", "Ycomb jobs Google Sheets"),
    nav("s6", "https://www.ycombinator.com/jobs"),
    { ...click("s7", "first job"), output: undefined },
  ]);

  it("drops the steps that only led somewhere, up to the step that opens a page by its address", () => {
    expect(detourFrom(yc, "s5")).toEqual({ skipped: ["s5"], opens: "s6" });
    expect(detourFrom(yc, "s4")).toEqual({ skipped: ["s4", "s5"], opens: "s6" });
  });

  it("never skips work: a step that saves a value, asks, needs approval or sends", () => {
    const reads = workflow([
      click("s4", "Recent"),
      {
        id: "s5",
        type: "action",
        intent: "read",
        channel: "web",
        action: "extract",
        target: { fallbacks: ["main"] },
        output: { name: "x", type: { type: "text" } },
      },
      nav("s6", "https://example.com"),
    ]);
    expect(detourFrom(reads, "s4")).toBeUndefined();
    const sends = workflow([click("s4", "Send"), nav("s6", "https://example.com")]);
    expect(detourFrom(sends, "s4")).toBeUndefined();
    const approved = workflow([click("s4", "Recent", { requires_approval: true }), nav("s6", "https://example.com")]);
    expect(detourFrom(approved, "s4")).toBeUndefined();
  });

  it("needs a later open in the same tab, by a fixed address", () => {
    const otherTab = workflow([click("s4", "Recent"), { ...nav("s6", "https://example.com"), tab: "Sheet" }]);
    expect(detourFrom(otherTab, "s4")).toBeUndefined();
    const built = workflow([click("s4", "Recent"), nav("s6", "https://example.com/{{today}}")]);
    expect(detourFrom(built, "s4")).toBeUndefined();
    const none = workflow([click("s4", "Recent"), click("s5", "File")]);
    expect(detourFrom(none, "s4")).toBeUndefined();
  });
});
