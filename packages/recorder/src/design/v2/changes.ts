// What the design agent really changed, worked out by comparing the plain step list it started from with the workflow
// it ended with: never taken from its own summary. Its labels (label_steps) and its answered questions count too, so
// this is the one account of a recording's design (Oct 15: an agent finished with "made the date dynamic, added a
// branch…" and had changed none of it).
import { isAction, type Skill, type Step, triggerOf, walkSteps } from "@shadow/core";

const MAX_LINES = 40;

export function describeChanges(before: Skill, after: Skill): string[] {
  const lines: string[] = [];
  const show = (value: unknown) => {
    const text = JSON.stringify(value) ?? "nothing";
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  };

  // How it runs, and what it starts with.
  const whenBefore = triggerOf(before).when;
  const whenAfter = triggerOf(after).when;
  if (JSON.stringify(whenBefore) !== JSON.stringify(whenAfter)) {
    lines.push(`runs: ${whenText(whenBefore)} → ${whenText(whenAfter)}`);
  }
  const inputsBefore = triggerOf(before).inputs;
  const inputsAfter = triggerOf(after).inputs;
  for (const name of Object.keys(inputsAfter)) {
    if (!(name in inputsBefore)) lines.push(`input ${name} added`);
  }
  for (const name of Object.keys(inputsBefore)) {
    if (!(name in inputsAfter)) lines.push(`input ${name} removed`);
  }
  for (const field of ["changes", "constants", "never"] as const) {
    if (JSON.stringify(before.description[field]) !== JSON.stringify(after.description[field])) {
      lines.push(`description ${field}: ${show(after.description[field])}`);
    }
  }

  // Steps: added, removed, moved into a loop or branch, and what changed in the ones kept.
  const placeOf = (skill: Skill) =>
    new Map([...walkSteps(skill.steps)].map(({ step, parents }) => [step.id, { step, parent: parents.at(-1) ?? "" }]));
  const was = placeOf(before);
  const now = placeOf(after);
  const removed = [...was.keys()].filter((id) => !now.has(id));
  if (removed.length > 0) lines.push(`removed ${removed.join(", ")}`);
  for (const [id, { step }] of now) {
    if (!was.has(id)) lines.push(`added ${id}: ${kindOf(step)} "${step.intent}"`);
  }
  let intents = 0;
  for (const [id, { step, parent }] of now) {
    const old = was.get(id);
    if (!old || step.type === "trigger") continue;
    if (old.parent !== parent) lines.push(`moved ${id} ${parent ? `into ${parent}` : "out to the top"}`);
    if (old.step.intent !== step.intent) intents++;
    if (isAction(old.step) && isAction(step)) {
      for (const key of new Set([...Object.keys(old.step.args), ...Object.keys(step.args)])) {
        if (JSON.stringify(old.step.args[key]) !== JSON.stringify(step.args[key])) {
          lines.push(`${id}: ${key} ${show(old.step.args[key])} → ${show(step.args[key])}`);
        }
      }
      if (!old.step.output && step.output) lines.push(`${id}: saves ${step.output.name}`);
      if (JSON.stringify(old.step.check) !== JSON.stringify(step.check)) lines.push(`${id}: check ${show(step.check)}`);
    }
    if ("requires_approval" in old.step && "requires_approval" in step) {
      if (!old.step.requires_approval && step.requires_approval) lines.push(`${id}: needs approval`);
      if (old.step.requires_approval && !step.requires_approval) lines.push(`${id}: no longer needs approval`);
    }
  }
  if (intents > 0) lines.push(`${intents} step${intents === 1 ? "" : "s"} described`);
  if (JSON.stringify(before.success) !== JSON.stringify(after.success)) lines.push(`success: ${show(after.success)}`);

  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `…and ${lines.length - MAX_LINES} more`] : lines;
}

// One line for a history note: what changed, or that nothing did.
export function changesSummary(lines: string[]): string {
  if (lines.length === 0) return "no changes to the recorded steps";
  const text = lines.join("; ");
  return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}

function kindOf(step: Step): string {
  // A connected app's tool by its name ("app GOOGLESHEETS_BATCH_UPDATE"): mcp.call alone says nothing.
  if (step.type === "action" && step.channel === "mcp") return `app ${String(step.args.tool ?? "")}`;
  if (step.type === "action") return `${step.channel}.${step.action}`;
  if (step.type === "control") return step.kind;
  return step.type;
}

function whenText(when: ReturnType<typeof triggerOf>["when"]): string {
  const parts = when.map((w) =>
    w.type === "schedule" ? `schedule ${w.cron}` : w.type === "folder_watch" ? `folder ${w.dir}` : w.type,
  );
  return parts.join(", ") || "manual";
}
