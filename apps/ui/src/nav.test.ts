import { describe, expect, it } from "vitest";
import { backLink } from "./nav.ts";

describe("Back (W3)", () => {
  it("takes a workflow or a run to its list, and a re-record to the workflow it was started from", () => {
    expect(backLink(["workflows", "kpi-1"])).toEqual({ label: "Workflows", href: "#/workflows" });
    expect(backLink(["runs", "r-9"])).toEqual({ label: "Runs", href: "#/runs" });
    expect(backLink(["record", "again", "kpi-1"])).toEqual({ label: "The workflow", href: "#/workflows/kpi-1" });
  });

  it("takes Record to Workflows, where what it makes lands, and has no Back on the lists and the rest", () => {
    expect(backLink(["record"])).toEqual({ label: "Workflows", href: "#/workflows" });
    for (const screen of ["inbox", "workflows", "runs", "apps", "settings"]) expect(backLink([screen])).toBeUndefined();
    expect(backLink([])).toBeUndefined();
  });
});
