import { describe, expect, it } from "vitest";
import { compile } from "../compile.ts";
import type { NormalisedStep } from "../normalise.ts";
import { flowOf } from "./flow.ts";

const PAGE = "http://localhost:5173/paste-form.html";
const target = (name: string) => ({
  tag: "input",
  url: PAGE,
  role: "textbox",
  name,
  fallbacks: [],
  selectors: { css: `[name='${name}']` },
});
let k = 0;
const step = (kind: NormalisedStep["kind"], extra: Partial<NormalisedStep>): NormalisedStep => ({
  index: k,
  kind,
  at: ++k * 1_000,
  tabId: 1,
  url: PAGE,
  events: [`e${k}`],
  ...extra,
});

describe("where values go", () => {
  it("follows a copy into the field it was pasted in, and into a field it was typed in again", async () => {
    const steps = [
      step("navigate", { events: [] }),
      step("copy", { value: "1,234", target: target("Total") }),
      step("type", { pasted: true, fromCopy: "e2", target: target("Amount") }),
      step("type", { value: "Total 1,234 for Oct", target: target("Note") }),
    ].map((s, index) => ({ ...s, index }));
    const { skill, base } = await compile(steps);
    const flows = flowOf(steps, skill, base.idsByStep);
    expect(flows).toEqual([
      { from: "s2", to: "s3", how: "pasted", value: "1,234" },
      { from: "s2", to: "s4", how: "typed", value: "1,234" },
    ]);
  });
});
