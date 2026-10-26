// Names people read (reports/plan-oct26-workflow-revamp.md, R2–R3): a page by its tab's name or app, never its address
// (a sheet's address holds its id); a control without what only a screen reader needed; a step by what it does. Shared
// by the recorder (block names) and the window (node titles).
import { isAction, type Step } from "./skill.ts";

export interface PageNames {
  // A page's name by its address (the recording's tab names: "Ycomb jobs", "Jobs | Y Combinator").
  titles?: Map<string, string>;
}

const KNOWN: [RegExp, string][] = [
  [/^docs\.google\.com\/spreadsheets/, "Google Sheets"],
  [/^docs\.google\.com\/document/, "Google Docs"],
  [/^docs\.google\.com\/presentation/, "Google Slides"],
  [/^drive\.google\.com/, "Google Drive"],
  [/^mail\.google\.com/, "Gmail"],
  [/^calendar\.google\.com/, "Google Calendar"],
];

// A page by name: the tab's name, else the app it is in, else the site. A tab "named" by its site
// ("docs.google.com", "ycombinator.com (2)": one with no title) is no name.
export function pageName(url: string, names: PageNames = {}): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url.includes("{{") ? "a page made from a value" : "the page";
  }
  const byPath = [...(names.titles ?? [])].find(([at]) => {
    try {
      const t = new URL(at);
      return t.origin === u.origin && t.pathname === u.pathname;
    } catch {
      return false;
    }
  })?.[1];
  const title = cleanName(names.titles?.get(url) ?? byPath ?? "");
  if (title && !/^[\w.-]+\.[a-z]{2,}(\s*\(\d+\))?$/i.test(title)) return title;
  const host = u.hostname.replace(/^www\./, "");
  return KNOWN.find(([re]) => re.test(`${host}${u.pathname}`))?.[1] ?? host;
}

// A control's or tab's words without what only the screen reader needed: "Ycomb jobs Google Sheets More info
// (Option + →)" → "Ycomb jobs".
export function cleanName(text: string): string {
  return text
    .replace(/\s*\((?:Option|Alt|Ctrl|Control|Cmd|Command|Shift|⌘|⌥)[^)]*\)/gi, "")
    .replace(/\s+More info\b.*$/i, "")
    .replace(/\s+(?:-\s+)?Google (?:Sheets|Docs|Slides|Drive)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Any address in a text, as its page's name ("Open https://docs.google.com/spreadsheets/d/…/edit" → "Open Google
// Sheets").
export const withoutAddresses = (text: string, names: PageNames = {}): string =>
  text.replace(/https?:\/\/[^\s"')]+/g, (url) => pageName(url, names));

// A step's title for a reader: a block's name, "Open ‹page›" for an open, the intent cleaned of addresses and
// screen-reader words otherwise.
export function stepTitle(step: Step, names: PageNames = {}): string {
  if (step.type === "control" && step.kind === "group") return step.intent;
  if (step.type === "control" && step.kind === "loop") return step.intent || `For each ${step.item.name}`;
  if (isAction(step) && step.channel === "web" && step.action === "navigate") {
    const url = String(step.args.url ?? "");
    const name = pageName(url, names);
    // A site without a tab name or an app says which page: "ycombinator.com/jobs", when that is short.
    let path = "";
    try {
      const u = new URL(url);
      if (name === u.hostname.replace(/^www\./, "")) path = u.pathname.replace(/\/+$/, "");
    } catch {}
    return `Open ${path && path.length <= 32 ? `${name}${path}` : name}`;
  }
  // A quoted control name is cleaned on its own: cleaning the whole sentence cut it at "More info" (with its quote).
  return withoutAddresses(step.intent, names).replace(/'([^']*)'/g, (_, inner: string) => `“${cleanName(inner)}”`);
}
