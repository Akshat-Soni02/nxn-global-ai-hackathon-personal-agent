// What design agent v2 can't read from the evidence text: real addresses (the text masks ids inside them: a sheet's id
// reads ███), and what each recorded click did. The agent names a page by the step that opened it or its tab ("s1",
// "KPI Sheet") and code writes the address; the test run reads the effects to decide what it may click.
import type { Effect } from "@shadow/core";
import type { NormalisedStep } from "../normalise.ts";
import type { TabInfo } from "./tabs.ts";

// Replay opens web pages and local files; Chrome's own pages refuse it.
const opens = (url?: string): url is string => /^(https?|file):/i.test(url ?? "");

export function pagesOf(steps: NormalisedStep[], idsByStep: string[][], tabs: TabInfo[]): Map<string, string> {
  const pages = new Map<string, string>();
  steps.forEach((s, i) => {
    const url = s.navigatesTo ?? (s.kind === "navigate" ? s.url : undefined);
    const id = idsByStep[i]?.[0];
    if (id && opens(url)) pages.set(id, url);
  });
  for (const tab of tabs) if (opens(tab.firstUrl) && !pages.has(tab.name)) pages.set(tab.name, tab.firstUrl);
  return pages;
}

export function effectsOf(steps: NormalisedStep[], idsByStep: string[][]): Map<string, Effect> {
  const effects = new Map<string, Effect>();
  steps.forEach((s, i) => {
    const id = idsByStep[i]?.[0];
    // A click that left the page reports no effect of its own (the page it measured is gone): the page it went to says
    // it went somewhere (D, 24 Oct: the featured article's link).
    const effect =
      s.effect ?? (s.kind === "click" && s.navigatesTo ? { changed: "large", navigated: true } : undefined);
    if (id && effect) effects.set(id, effect as Effect);
  });
  return effects;
}
