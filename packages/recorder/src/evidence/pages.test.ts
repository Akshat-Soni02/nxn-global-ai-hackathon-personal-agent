import { describe, expect, it } from "vitest";
import type { NormalisedStep } from "../normalise.ts";
import { effectsOf, pagesOf } from "./pages.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit";
const step = (kind: NormalisedStep["kind"], extra: Partial<NormalisedStep> = {}): NormalisedStep =>
  ({ index: 0, kind, at: 0, events: [], ...extra }) as NormalisedStep;

describe("pages and effects for the agent", () => {
  it("gives the real address of each page by the step that opened it and by tab name", () => {
    const steps = [
      step("navigate", { url: SHEET }),
      step("click", { navigatesTo: "https://mail.google.com/mail/u/0/#inbox" }),
      step("navigate", { url: "chrome://newtab/" }),
    ];
    const pages = pagesOf(steps, [["s1"], ["s2"], ["s3"]], [{ id: 1, name: "KPI Sheet", firstUrl: SHEET }]);
    expect(pages.get("s1")).toBe(SHEET);
    expect(pages.get("s2")).toBe("https://mail.google.com/mail/u/0/#inbox");
    expect(pages.has("s3")).toBe(false); // Chrome's own pages can't be opened by replay
    expect(pages.get("KPI Sheet")).toBe(SHEET);
  });

  it("gives what each recorded click did, by its draft step", () => {
    const steps = [step("click", { effect: { changed: "large", navigated: true } }), step("type", { value: "x" })];
    expect([...effectsOf(steps, [["s4"], ["s5"]])]).toEqual([["s4", { changed: "large", navigated: true }]]);
  });

  it("says a click went somewhere when the page it went to says so, though the click reported nothing (D, 24 Oct)", () => {
    const left = step("click", { navigatesTo: "https://en.wikipedia.org/wiki/Thuggee" });
    expect([...effectsOf([left], [["s2"]])]).toEqual([["s2", { changed: "large", navigated: true }]]);
    expect([...effectsOf([step("click", {})], [["s2"]])]).toEqual([]); // a click that stayed, with nothing measured
  });
});
