// The finish gate (spec, "Rules v2"): code, not the model, decides whether a design is done. A workflow is saved only
// when the work the user showed still happens, every rule they said is built or said not to be, its checks look for
// text that can appear, the test run passed or each failure is explained, an unattended run can fill its inputs, and
// it runs as often as they said. Each problem is a sentence the agent reads and fixes (twice at most; then it is saved
// with the gaps listed for the user). Oct 19: the agent finished with all 20 recorded steps removed, and with checks
// for text never on screen.
import { type Check, isAction, isOutward, type Skill, type Step, triggerOf, walkSteps } from "@shadow/core";
import { MASK } from "../../mask.ts";
import type { DoneReport, TaskModel, TestReport } from "./contracts.ts";

// Actions that change something the user cares about: what they typed, chose, uploaded or moved.
const WRITES = new Set([
  "web.type",
  "web.select",
  "web.upload",
  "web.drag",
  "fs.move",
  "fs.copy",
  "fs.rename",
  "fs.write",
  "ax.set_value",
]);
// Apps that draw their content: no text check can see it (it isn't in the page's text).
const CANVAS = /^https:\/\/docs\.google\.com\/(spreadsheets|document|presentation)\//;

export interface GateInput {
  // The plain recorded workflow: what the user showed.
  recorded: Skill;
  workflow: Skill;
  task: TaskModel;
  done: DoneReport;
  test?: TestReport;
  // Every text that appeared on screen after an action, while recording or in the test run.
  appeared: Set<string>;
  // Steps whose removal or test failure the agent explained (its tools' `why`): flagged for the user, not a problem.
  explained: Map<string, string>;
  // What an unattended run still needs (the daemon's go-live checks).
  unattended?: (skill: Skill) => string[];
}

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

export function gate(input: GateInput): string[] {
  const { recorded, workflow, task, done, test, appeared, explained } = input;
  const problems: string[] = [];
  const now = new Map<string, Step>([...walkSteps(workflow.steps)].map(({ step }) => [step.id, step]));

  // The work the user showed still happens: kept (in a loop counts), or its removal explained for the review. A
  // workflow that keeps none of it isn't what they meant, whatever reason each removal was given (Oct 19: the Play
  // Store run kept one step of the recording).
  const shown = [...walkSteps(recorded.steps)]
    .map(({ step }) => step)
    .filter((s) => isAction(s) && (WRITES.has(`${s.channel}.${s.action}`) || isOutward(s)));
  const noneKept = shown.length > 0 && shown.every((s) => !now.has(s.id));
  for (const step of shown) {
    if (now.has(step.id) || (explained.has(step.id) && !noneKept)) continue;
    problems.push(
      `${step.id} (${step.intent}) was work the user showed, and it is gone: keep it, repeat it in a loop, or remove it with a why the user will see${noneKept ? " (none of their work is left)" : ""}`,
    );
  }

  // Every rule they said or wrote: built by steps that exist, or explained.
  task.rules.forEach((rule, i) => {
    const said = done.rules.find((r) => r.rule === i);
    if (!said || (!said.not_built && said.steps.length === 0)) {
      problems.push(
        `rule ${i} "${rule.quote}" is neither built nor explained: name the steps that build it, or say why it isn't built`,
      );
      return;
    }
    const missing = said.not_built ? [] : said.steps.filter((id) => !now.has(id));
    if (missing.length > 0) problems.push(`rule ${i} "${rule.quote}": no step ${missing.join(", ")} in the workflow`);
  });

  // Checks look only for text that can appear: seen on screen after an action, never on a drawn app, never empty.
  let page = "";
  const judge = (where: string, check: Check | undefined) => {
    const text = check?.text_visible;
    if (text === undefined) return;
    if (!text.trim()) problems.push(`${where}: a text check can't be empty (it would always hold)`);
    else if (text.includes(MASK))
      problems.push(`${where}: "${text}" holds a hidden value (${MASK}): check for text without it`);
    else if (CANVAS.test(page))
      problems.push(`${where}: a text check can't see a sheet's or document's drawn content: use url_matches or none`);
    else if (![...appeared].some((seen) => norm(seen).includes(norm(text)))) {
      problems.push(
        `${where}: "${text}" never appeared on screen: check for text that did, or for the page (url_matches)`,
      );
    }
  };
  for (const { step } of walkSteps(workflow.steps)) {
    if (!isAction(step)) continue;
    if (step.channel === "web" && step.action === "navigate") page = String(step.args.url ?? "");
    judge(step.id, step.wait);
    judge(step.id, step.check);
  }
  for (const check of workflow.success) judge("success", check);

  // The test run: every step it couldn't find or that failed is fixed, or explained.
  for (const step of test?.steps ?? []) {
    if (step.status !== "failed" && step.status !== "not_found") continue;
    if (explained.has(step.id)) continue;
    const what =
      step.status === "not_found"
        ? "the test run didn't find it"
        : `it failed in the test run (${step.error ?? "no reason given"})`;
    problems.push(`${step.id}: ${what}: fix it, or explain why it will work in a real run`);
  }

  problems.push(...(input.unattended?.(workflow) ?? []));

  // As often as they said.
  if (task.cadence.kind !== "manual" && triggerOf(workflow).when.every((w) => w.type === "manual")) {
    problems.push(
      `they said ${task.cadence.quote ? `"${task.cadence.quote}"` : `it runs on a ${task.cadence.kind}`}, but it only runs when started by hand: set it with trigger`,
    );
  }

  // Runs start on a blank window: a workflow that works in the browser opens a page first.
  const firstWeb = [...walkSteps(workflow.steps)]
    .map(({ step }) => step)
    .find((s) => isAction(s) && s.channel === "web");
  if (firstWeb && isAction(firstWeb) && firstWeb.action !== "navigate") {
    problems.push(`${firstWeb.id}: runs start on a blank window, so the workflow must open a page first`);
  }
  return problems;
}
