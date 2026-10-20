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
});
