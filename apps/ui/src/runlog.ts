// A run's log as the Run page shows it, grouped by step (checkpoint 6: a walk-through's log was one long list, the
// step's name in every line, and "its target was not outlined" on a step that opens a page and has nothing to outline).
// Each group is one step: waiting for you, going on, your choice, and how it went.
import { type Step, walkSteps } from "@shadow/core";
import type { RunLogEvent } from "@shadow/player";
import { duration } from "./format.ts";

export type Logged = RunLogEvent & { at: number };
export interface Group {
  // The step's path ("s1", "l1[0].s3"), and its id: none for the run's own lines (started, ended).
  step?: string;
  id?: string;
  // What kind of step it is (channel.action), from its start.
  kind?: string;
  events: Logged[];
}

// The step an event is about: its path; a run waiting at a step, or going on from one, is about that step.
export function stepOf(e: RunLogEvent): string | undefined {
  if ("path" in e) return e.path;
  if (e.type === "run.end" && e.status === "waiting") return e.failedStep;
  if (e.type === "run.start") return e.resumedAt;
  return undefined;
}

export function groupsOf(events: Logged[]): Group[] {
  const kinds = new Map<string, string>();
  for (const e of events) if (e.type === "step.start") kinds.set(e.path, `${e.channel}.${e.action}`);
  const groups: Group[] = [];
  for (const e of events) {
    // A step's start is implied by its result.
    if (e.type === "step.start" || e.type === "loop.item") continue;
    const step = stepOf(e);
    const last = groups.at(-1);
    const group = last && last.step === step ? last : undefined;
    if (group) group.events.push(e);
    else groups.push({ ...(step ? { step, kind: kinds.get(step) } : {}), events: [e] });
    const into = group ?? groups.at(-1);
    if (into && !into.id && "stepId" in e) into.id = e.stepId;
  }
  return groups;
}

// A run's log by the blocks the reader sees (reports/plan-oct26-workflow-revamp.md, R7.1): steps one after another
// in the same block are one section, under the block's title, with how it went; a step in no block is a section of
// its own.
export interface Section {
  block?: { id: string; title: string };
  groups: Group[];
  state: "done" | "failed" | "waiting" | "skipped" | "running";
}

export function sectionsOf(groups: Group[], blockOf: Map<string, { id: string; title: string }>): Section[] {
  const sections: Section[] = [];
  for (const g of groups) {
    const block = g.id ? blockOf.get(g.id) : undefined;
    const last = sections.at(-1);
    if (block && last?.block?.id === block.id) last.groups.push(g);
    else sections.push({ ...(block ? { block } : {}), groups: [g], state: "running" });
  }
  for (const s of sections) s.state = stateOf(s.groups.flatMap((g) => g.events));
  return sections;
}

function stateOf(events: Logged[]): Section["state"] {
  if (events.some((e) => e.type === "step.result" && !e.result.ok)) return "failed";
  if (events.some((e) => e.type === "run.end" && e.status === "waiting")) return "waiting";
  if (events.length > 0 && events.every((e) => e.type === "step.skipped")) return "skipped";
  if (events.some((e) => e.type === "step.result")) return "done";
  return "running";
}

// Each step's block (id and title) by the step's id: what sectionsOf groups by.
export function blocksIn(steps: Step[]): Map<string, { id: string; title: string }> {
  const out = new Map<string, { id: string; title: string }>();
  for (const { step } of walkSteps(steps))
    if (step.type === "control" && step.kind === "group")
      for (const { step: inner } of walkSteps(step.steps)) out.set(inner.id, { id: step.id, title: step.intent });
  return out;
}

// Each step's intent by its id, nested steps included: the group's heading.
export function intentsOf(steps: unknown[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (list: unknown[]) => {
    for (const s of list) {
      const o = s as { id?: string; intent?: string; steps?: unknown[]; else?: unknown[] };
      if (o.id && o.intent) out.set(o.id, o.intent);
      walk(o.steps ?? []);
      walk(o.else ?? []);
    }
  };
  walk(steps);
  return out;
}

const KINDS: Record<string, string> = {
  "web.navigate": "opens a page",
  "web.click": "clicks",
  "web.type": "types",
  "web.select": "picks",
  "web.press": "presses a key",
  "web.extract": "reads",
  "web.save_pdf": "saves the page as a PDF",
  "web.upload": "uploads a file",
  "fs.find": "finds a file",
  "fs.move": "moves a file",
  "fs.copy": "copies a file",
  "fs.rename": "renames a file",
};
export const kindText = (kind?: string) => (kind ? (KINDS[kind] ?? kind) : undefined);

// What was outlined before you chose. The log's flag is false on every walk answered from the inbox (the run stops at
// the step, and the leg that goes on doesn't outline it again: packages/player/src/run.ts), so a step with a control
// that wasn't flagged is said nothing about; only a step with nothing to outline says so.
const NOTHING: Record<string, string> = {
  "web.navigate": "it opens a page: nothing to outline",
  "web.save_pdf": "it saves the page: nothing to outline",
};
function outlined(kind: string | undefined, highlighted: boolean): string {
  if (highlighted) return " (outlined on the page)";
  if (kind && NOTHING[kind]) return ` (${NOTHING[kind]})`;
  if (kind?.startsWith("web.") || kind?.startsWith("ax.")) return "";
  return kind?.startsWith("fs.")
    ? " (a file step: nothing on the page to outline)"
    : " (nothing on the page to outline)";
}

// One line of a group: the step's name is in the group's heading, not in each line.
export function lineOf(e: RunLogEvent, kind?: string): string {
  switch (e.type) {
    case "run.start":
      return e.resumedAt ? "Went on" : `Started v${e.version}`;
    case "step.result": {
      const r = e.result;
      const match = r.matchScore !== undefined ? ` · match ${r.matchScore}` : "";
      const attempt = e.attempt > 1 ? ` · try ${e.attempt}` : "";
      return `${r.ok ? "✓ Done" : "✗ Failed"} · ${duration(e.ms)}${match}${attempt}${r.ok ? "" : ` · ${r.error ?? "failed"}`}`;
    }
    case "step.approval":
      return e.approved ? "You approved it" : "You denied it";
    case "step.ask":
      return `Asked "${e.question}", you answered ${JSON.stringify(e.answer)}`;
    case "step.skipped":
      return `Skipped (${e.reason})`;
    case "step.walk": {
      const said = e.choice === "do" ? "You said: do it" : e.choice === "skip" ? "You said: skip it" : "You stopped";
      return e.choice === "stop" ? said : `${said}${outlined(kind, e.highlighted)}`;
    }
    case "loop.start":
      return `↻ ${e.items} item(s)`;
    case "loop.item_failed":
      return `↷ item ${e.index + 1} skipped: ${e.error}`;
    case "branch":
      return `⑂ ${e.took === "steps" ? "the condition held" : "otherwise"}`;
    case "repair":
      return e.outcome === "commit"
        ? `⚒ repaired (${e.by}), saved as v${e.version}: ${e.summary}`
        : `⚒ ${e.outcome} (${e.class}): ${e.summary}`;
    case "run.end":
      return e.status === "waiting"
        ? "Waiting for you"
        : `Ended: ${e.status}${e.failedStep && e.status !== "succeeded" ? ` at ${e.failedStep}` : ""}${e.error ? ` · ${e.error}` : ""}`;
    default:
      return (e as { type: string }).type;
  }
}
