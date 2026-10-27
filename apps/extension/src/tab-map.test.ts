import { describe, expect, it } from "vitest";
import { TabMap } from "./tab-map.ts";

describe("the automation window's tabs", () => {
  it("keeps one tab per name for the whole run, and closes the extra ones at the end", () => {
    const tabs = new TabMap(10);
    expect(tabs.lookup(undefined)).toBe(10);
    expect(tabs.lookup("Gmail")).toBeUndefined();
    tabs.remember("Gmail", 11);
    tabs.remember("KPI Sheet", 12);
    expect(tabs.lookup("Gmail")).toBe(11); // back to it: the same tab, not a reload
    expect(tabs.has(12)).toBe(true);
    tabs.forget(12); // you closed it
    expect(tabs.lookup("KPI Sheet")).toBeUndefined();
    expect(tabs.extras()).toEqual([11]);
    expect(TabMap.from(tabs.toJSON()).lookup("Gmail")).toBe(11);
  });

  it("belongs to the run that opened it: one run ending closes only its own tabs (C9)", () => {
    const tabs = new TabMap(10);
    // Run A waits for you (its tabs are kept on purpose); run B uses a tab with the same name and finishes.
    tabs.remember("Sheet", 21, "run-a");
    tabs.remember("Sheet", 31, "run-b");
    expect(tabs.lookup("Sheet", "run-a")).toBe(21);
    expect(tabs.lookup("Sheet", "run-b")).toBe(31); // not A's tab
    expect(tabs.lookup("Sheet", "run-c")).toBeUndefined();
    expect(tabs.extras("run-b")).toEqual([31]);
    expect(tabs.extras("run-a")).toEqual([21]);
    expect(tabs.extras().sort()).toEqual([21, 31]); // no owner: everything (the daemon went away)
    tabs.forgetOwner("run-b");
    expect(tabs.extras()).toEqual([21]);
    expect(TabMap.from(tabs.toJSON()).lookup("Sheet", "run-a")).toBe(21);
  });
});
