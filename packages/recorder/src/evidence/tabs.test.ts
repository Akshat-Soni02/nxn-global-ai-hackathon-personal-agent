import type { TraceEvent } from "@shadow/core";
import { describe, expect, it } from "vitest";
import type { NormalisedStep } from "../normalise.ts";
import { tabName, tabsOf } from "./tabs.ts";

const ev = (event: TraceEvent["event"], tabId: number, extra: Partial<TraceEvent> = {}): TraceEvent => ({
  id: `t${tabId}-${event}`,
  sessionId: "s",
  at: tabId,
  event,
  tabId,
  ...extra,
});
const at = (tabId: number): NormalisedStep => ({ index: 0, kind: "click", at: 10, tabId, events: [] });

describe("tab names", () => {
  it("takes the title's own part, not the site, a mail count or an address", () => {
    expect(tabName("Shadow checkpoint 1 test - Google Sheets")).toBe("Shadow checkpoint 1 test");
    expect(tabName("(298) - rushil@example.com - Searce Mail")).toBe("Searce Mail");
    expect(tabName("Find the best startup jobs and remote jobs curated by Y Combinator. | Y Combinator")).toBe(
      "Y Combinator",
    );
    expect(tabName(undefined, "https://www.ycombinator.com/jobs")).toBe("ycombinator.com");
  });

  it("lists the tabs used, with how each was opened, and tells two of the same name apart", () => {
    const trace = [
      ev("tab_open", 1, {
        title: "Inbox (3) - Searce Mail",
        url: "https://mail.google.com/mail/u/0/#inbox",
        preexisting: true,
      }),
      ev("tab_open", 2, {
        title: "Inbox (3) - Searce Mail",
        url: "https://mail.google.com/mail/u/1/#inbox",
        openerTabId: 1,
      }),
      ev("tab_open", 3, { title: "Unused", url: "https://example.com" }),
    ];
    const { tabs, nameOf } = tabsOf(trace, [at(1), at(2)]);
    expect(tabs.map((t) => [t.id, t.name, t.preexisting, t.openedBy])).toEqual([
      [1, "Searce Mail", true, undefined],
      [2, "Searce Mail (2)", undefined, 1],
    ]);
    expect(nameOf(2)).toBe("Searce Mail (2)");
  });
});

describe("a tab opened blank", () => {
  // Checkpoint 4 (A): the tab was blank when Record started, so it was called "about:blank" though it held Hacker News.
  it("is named from the page it went to, not the blank page's title", () => {
    const trace = [
      ev("tab_open", 1, { title: "about:blank", url: "about:blank", preexisting: true }),
      { ...ev("navigate", 1, { url: "https://news.ycombinator.com/" }), id: "nav" },
    ];
    expect(tabsOf(trace, [at(1)]).nameOf(1)).toBe("news.ycombinator.com");
  });
});
