// The tabs of a recording (spec 2.4), each named from its page so the agent and the review can say "in KPI Sheet":
// the title's own part (not a mail count or an address), the site name when the first part is long, else the site's
// host. Two tabs of one name get a number; their first addresses tell them apart.
import type { TraceEvent } from "@shadow/core";
import type { NormalisedStep } from "../normalise.ts";

export interface TabInfo {
  id: number;
  name: string;
  firstUrl?: string;
  preexisting?: boolean;
  openedBy?: number;
  windowId?: number;
}

const SEPARATOR = /\s+[-–|·]\s+/;
const COUNTER = /^(\w+\s)?\(\d+\)$/; // "(298)", "Inbox (3)"
const ADDRESS = /^\S+@\S+$/;
const NAME_MAX = 40;

export function tabName(title?: string, url?: string): string {
  const parts = (title ?? "")
    .split(SEPARATOR)
    .map((p) => p.trim())
    .filter((p) => p && !COUNTER.test(p) && !ADDRESS.test(p));
  const first = parts[0];
  const lastPart = parts.at(-1);
  if (first && first.length <= NAME_MAX) return first;
  if (lastPart && lastPart.length <= NAME_MAX) return lastPart;
  if (first) return `${first.slice(0, NAME_MAX - 1)}…`;
  try {
    return new URL(url ?? "").host.replace(/^www\./, "") || "a tab";
  } catch {
    return "a tab";
  }
}

export function tabsOf(
  trace: TraceEvent[],
  steps: NormalisedStep[],
): { tabs: TabInfo[]; nameOf: (tabId?: number) => string | undefined } {
  const seen = new Map<number, TabInfo & { title?: string }>();
  for (const e of [...trace].sort((a, b) => a.at - b.at)) {
    if (e.tabId === undefined) continue;
    const tab = seen.get(e.tabId) ?? { id: e.tabId, name: "" };
    const url = e.url && /^(https?|file):/.test(e.url) ? e.url : undefined;
    if (e.event === "tab_open") {
      // A blank tab's title ("about:blank", "New Tab") says nothing: the tab is named from the page it goes to.
      if (url) tab.title ??= e.title;
      if (e.preexisting) tab.preexisting = true;
      if (e.openerTabId !== undefined) tab.openedBy ??= e.openerTabId;
      if (e.windowId !== undefined) tab.windowId ??= e.windowId;
    }
    tab.firstUrl ??= url;
    seen.set(e.tabId, tab);
  }
  const used = new Set(steps.map((s) => s.tabId));
  const list = [...seen.values()].filter((t) => used.has(t.id));
  for (const tab of list) tab.name = tabName(tab.title, tab.firstUrl);
  const counts = new Map<string, number>();
  for (const tab of list) {
    const n = (counts.get(tab.name) ?? 0) + 1;
    counts.set(tab.name, n);
    if (n > 1) tab.name = `${tab.name} (${n})`;
  }
  const tabs = list.map(({ title: _title, ...t }) => t);
  return { tabs, nameOf: (id) => tabs.find((t) => t.id === id)?.name };
}
