// One timeline (spec 2.12): the tabs, the steps by their draft ids (spec 2.9), what was said, and what was left out,
// in time order on the recording's clock. A step's screen words and caption are added under it by the evidence text
// (evidence.ts), as the size cap allows.
import type { Effect } from "@shadow/core";
import type { Noise, NormalisedStep } from "../normalise.ts";
import type { StepClass } from "./classes.ts";
import type { StepScreen } from "./screens.ts";
import type { TabInfo } from "./tabs.ts";

export interface TimelineLine {
  at: number;
  text: string;
  step?: string;
}
export interface TimelineInput {
  start: number;
  steps: NormalisedStep[];
  ids: string[][];
  classes: StepClass[];
  tabs: TabInfo[];
  screens: StepScreen[];
  said: { at: number; until?: number; text: string }[];
  noise: Noise[];
}

const MODS: Record<string, string> = { cmd: "⌘", ctrl: "Ctrl+", option: "⌥", shift: "⇧" };
export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const quote = (t: string, max = 60) => `"${t.length > max ? `${t.slice(0, max - 1)}…` : t}"`;
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 80);
const labelOf = (s: NormalisedStep) =>
  s.target?.name ?? s.target?.label ?? s.target?.seenAs ?? s.target?.text ?? s.element?.title ?? "";

export function describeStep(s: NormalisedStep): string {
  // A key pressed on the page itself has no target worth naming (its text is the whole page, scripts and all).
  const named = s.target && s.target.tag !== "body" && s.target.tag !== "html";
  const on = named && s.target ? ` ${s.target.role ?? s.target.tag} ${quote(labelOf(s))}` : "";
  switch (s.kind) {
    case "navigate":
      return `${s.back ? "go back to" : "open"} ${shortUrl(s.navigatesTo ?? s.url ?? "")}`;
    case "click":
      return `click${on}${s.navigatesTo ? ` → ${shortUrl(s.navigatesTo)}` : ""}${s.opensTab !== undefined ? " (opens a tab)" : ""}`;
    case "type":
      return `type ${s.secret ? "(a secret)" : s.pasted ? "(the copied text)" : quote(s.value ?? "")} into${on}`;
    case "copy":
      return `copy ${quote(s.value ?? "")}${on ? ` from${on}` : ""}`;
    case "press":
      return `press ${(s.modifiers ?? []).map((m) => MODS[m] ?? "").join("")}${s.value ?? ""}${on ? ` in${on}` : ""}${s.sends ? " (sends it)" : ""}`;
    case "select":
      return `choose ${quote(s.value ?? "")} in${on}`;
    case "upload":
      return `upload ${s.file?.name ?? "a file"}${on ? ` with${on}` : ""}`;
    default:
      return `${s.kind.replace(/_/g, " ")}${on}${s.value ? ` ${quote(s.value)}` : ""}${s.path ? ` ${s.path}` : ""}${s.toPath ? ` → ${s.toPath}` : ""}`;
  }
}

const effectText = (e: Effect) =>
  e.navigated
    ? "went to another page"
    : e.opened
      ? `opened a ${e.opened}`
      : e.expanded
        ? "expanded"
        : e.emptied
          ? "emptied the field"
          : e.changed === "none"
            ? "changed nothing"
            : `changed the page (${e.changed})`;

function facts(s: NormalisedStep): string {
  const parts: string[] = [];
  if (s.list)
    parts.push(
      `item ${s.list.index + 1} of ${s.list.count}${s.list.container.name ? ` in "${s.list.container.name}"` : ""}`,
    );
  if (s.cell) parts.push(`cell ${s.cell.ref}${s.cell.sheet ? ` of "${s.cell.sheet}"` : ""}`);
  if (s.effect) parts.push(effectText(s.effect));
  return parts.length > 0 ? `: ${parts.join("; ")}` : "";
}

export function timelineOf(input: TimelineInput): TimelineLine[] {
  const nameOf = (id?: number) => input.tabs.find((t) => t.id === id)?.name;
  const lines: TimelineLine[] = [];
  for (const tab of input.tabs) {
    const first = input.steps.find((s) => s.tabId === tab.id)?.at ?? input.start;
    const how = tab.preexisting
      ? " (open before Record)"
      : tab.openedBy !== undefined
        ? ` (opened from "${nameOf(tab.openedBy) ?? "another tab"}")`
        : "";
    lines.push({
      at: tab.preexisting ? input.start : first,
      text: `tab "${tab.name}": ${shortUrl(tab.firstUrl ?? "")}${how}`,
    });
  }
  input.steps.forEach((s, i) => {
    const ids = input.ids[i] ?? [];
    const tab = nameOf(s.tabId);
    lines.push({
      at: s.at,
      ...(ids[0] ? { step: ids[0] } : {}),
      text: `${ids.join("+") || "-"}${tab ? ` [${tab}]` : ""} ${input.classes[i] ?? "act"}: ${describeStep(s)}${facts(s)}`,
    });
  });
  for (const said of input.said) {
    const text = said.text.trim();
    if (text) lines.push({ at: said.at, text: `said: ${quote(text, 300)}` });
  }
  for (const n of input.noise) lines.push({ at: n.at, text: `(left out) ${n.what}: ${n.why}` });
  return lines.sort((a, b) => a.at - b.at).map((l) => ({ ...l, text: `${clock(l.at - input.start)}  ${l.text}` }));
}

export function timelineSlice(lines: TimelineLine[], from?: string, to?: string): TimelineLine[] {
  const a = from ? lines.findIndex((l) => l.step === from) : 0;
  const b = to ? lines.findIndex((l) => l.step === to) : lines.length - 1;
  return a < 0 || b < 0 || b < a ? [] : lines.slice(a, b + 1);
}
