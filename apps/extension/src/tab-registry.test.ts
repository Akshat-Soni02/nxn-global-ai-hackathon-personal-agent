import { describe, expect, it } from "vitest";
import { TabRegistry } from "./tab-registry.ts";

describe("the tabs a recording used", () => {
  it("announces a tab that was open before Record once, at its first use, with where it was", () => {
    const tabs = new TabRegistry();
    tabs.start([
      { id: 11, windowId: 1, url: "https://docs.google.com/spreadsheets/d/S/edit", title: "KPI Sheet" },
      { id: 12, windowId: 1, url: "https://news.test/", title: "News" },
    ]);
    expect(tabs.firstUse(11)).toEqual({
      tabId: 11,
      windowId: 1,
      url: "https://docs.google.com/spreadsheets/d/S/edit",
      title: "KPI Sheet",
      preexisting: true,
    });
    expect(tabs.firstUse(11)).toBeUndefined();
    // A tab opened while recording has its own tab_open already: nothing to announce.
    tabs.opened({ id: 13, windowId: 1, url: "https://mail.google.com/", openerTabId: 11 });
    expect(tabs.firstUse(13)).toBeUndefined();
    // A tab never seen before (opened before the extension loaded) is not invented.
    expect(tabs.firstUse(99)).toBeUndefined();
  });
});
