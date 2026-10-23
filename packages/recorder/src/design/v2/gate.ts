// The finish gate (spec, "Rules v2"): code, not the model, decides whether a design is done. A workflow is saved only
// when the work the user showed still happens, every rule they said is built or said not to be, its checks look for
// text that can appear, the test run passed or each failure is explained, an unattended run can fill its inputs, and
// it runs as often as they said. Each problem is a sentence the agent reads and fixes (twice at most; then it is saved
// with the gaps listed for the user). Oct 19: the agent finished with all 20 recorded steps removed, and with checks
// for text never on screen.
import {
  type Check,
  isAction,
  isOutward,
  type Locator,
  type Skill,
  type Step,
  triggerOf,
  walkSteps,
} from "@shadow/core";
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
// A rule about picking what changes each time: the newest, the top 3, the ones not already done.
const PICK = /\b(?:newest|latest|most recent|top|new|not already|already (?:did|done|saved|on)|skip)\b/i;
// How often, in words: "every day", "each working day", "every Monday", "daily", "weekdays", "monthly".
const FREQUENCY =
  /\b(?:every|each)\s+(?:working\s+)?(?:day|morning|evening|night|week|weekday|month|year|hour|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b|\b(?:daily|weekly|monthly|hourly|weekdays)\b/i;
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
  // Steps whose removal the agent explained (its tools' `why`): flagged for the user, not a problem.
  explained: Map<string, string>;
  // Reasons given since the last test run: only these explain a test failure, not the reason a step was added with
  // (Checkpoint 4: a step added "to read the page" failed its test and was saved anyway). Default: explained.
  sinceTest?: Map<string, string>;
  // The goal and what was said: how often it runs is read from them too, not only from the task model (F1).
  said?: string[];
  // What an unattended run still needs (the daemon's go-live checks).
  unattended?: (skill: Skill) => string[];
}

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

// What the step-runner needs before it can run a step (packages/player): each action's values, and a control it can
// find. Its matcher scores role and name, stored attributes and selectors; text and `near` alone it can't use.
// Checkpoint 4: reads with no control, fs.find with {folder, pattern}, a control found only "near Indian Rupee".
const NEEDS: Record<string, string[]> = {
  "web.navigate": ["url"],
  "web.type": ["text"],
  "web.select": ["option"],
  "web.press": ["key"],
  "fs.find": ["dir", "glob"],
  "fs.move": ["from", "to"],
  "fs.copy": ["from", "to"],
  "fs.rename": ["from", "to"],
  "fs.read": ["path"],
  "data.pick": ["from"],
};
const findable = (t: Locator | undefined) =>
  Boolean(t && (t.role || Object.keys(t.attrs ?? {}).length > 0 || t.fallbacks.length > 0));

export function stepProblems(step: Step): string[] {
  if (!isAction(step)) return [];
  const key = `${step.channel}.${step.action}`;
  const needs = NEEDS[key] ?? [];
  const missing = needs.filter((k) => step.args[k] === undefined || step.args[k] === "");
  const problems =
    missing.length > 0 ? [`${step.id}: ${key} needs ${needs.join(" and ")} (missing ${missing.join(", ")})`] : [];
  const noControl =
    ["web.navigate", "web.wait_for"].includes(key) || (key === "web.extract" && step.args.source === "google_sheet");
  // A key pressed on the page needs no control; one aimed at a control must be able to find it.
  if (step.channel === "web" && !noControl && (key !== "web.press" || step.target) && !findable(step.target)) {
    problems.push(
      `${step.id}: replay can't find its control: give it a role and name ({ role: "button", name: "Save" }) or copy a recorded one ({ like: "s3" }). To read a whole page, read with no target${key === "web.press" ? "; a key pressed on the page needs no target" : ""}`,
    );
  }
  return problems;
}

// A cron the scheduler can read: five or six fields, no {{…}} (Checkpoint 5: E set "{{cron_expr}}").
export const isCron = (cron?: string) =>
  Boolean(cron && !cron.includes("{{") && /^\S+(\s+\S+){4,5}$/.test(cron.trim()));

// Every step the runner can't run, and inputs it can't fill: a default is a value, never a {{…}} template.
export function runProblems(skill: Skill): string[] {
  const inputs = Object.entries(triggerOf(skill).inputs)
    .filter(([, i]) => typeof i.default === "string" && i.default.includes("{{"))
    .map(
      ([name]) =>
        `input ${name}: a default can't be a {{…}} value: use it in the step itself ({{today}}, {{today|D MMM}})`,
    );
  const schedules = triggerOf(skill)
    .when.filter((w) => w.type === "schedule" && !isCron(w.cron))
    .map((w) => `its schedule "${(w as { cron: string }).cron}" isn't a fixed cron: e.g. "0 9 * * 5"`);
  return [...inputs, ...schedules, ...[...walkSteps(skill.steps)].flatMap(({ step }) => stepProblems(step))];
}

// The work the user showed (what they typed, chose, moved or sent: a step that needed approval sent something) still
// happens: kept (in a loop counts), or its removal explained for the review. A workflow that keeps none of it isn't
// what they meant, whatever reason each removal was given (Oct 19: the Play Store run kept one step of the recording).
export function lostWork(recorded: Skill, workflow: Skill, explained: Map<string, string>): string[] {
  const now = new Set([...walkSteps(workflow.steps)].map(({ step }) => step.id));
  // The same action on the same control (by role and name) is that work kept, though the step is new (Checkpoint 5:
  // A rebuilt its pastes inside a loop and was told its work was gone).
  const sig = (s: Step) =>
    isAction(s) && s.target?.role && (s.target.name || s.target.label)
      ? `${s.channel}.${s.action}|${s.target.role}|${s.target.name ?? s.target.label}`
      : undefined;
  const doing = new Set([...walkSteps(workflow.steps)].map(({ step }) => sig(step)).filter(Boolean));
  const problems: string[] = [];
  const shown = [...walkSteps(recorded.steps)]
    .map(({ step }) => step)
    .filter((s) => isAction(s) && (WRITES.has(`${s.channel}.${s.action}`) || isOutward(s) || s.requires_approval));
  const noneKept = shown.length > 0 && shown.every((s) => !now.has(s.id) && !doing.has(sig(s)));
  for (const step of shown) {
    if (now.has(step.id) || doing.has(sig(step)) || (explained.has(step.id) && !noneKept)) continue;
    problems.push(
      `${step.id} (${step.intent}) was work the user showed, and it is gone: keep it, repeat it in a loop, or remove it with a why the user will see${noneKept ? " (none of their work is left)" : ""}`,
    );
  }
  return problems;
}

export function gate(input: GateInput): string[] {
  const { recorded, workflow, task, done, test, appeared, explained } = input;
  const sinceTest = input.sinceTest ?? explained;
  const now = new Map<string, Step>([...walkSteps(workflow.steps)].map(({ step }) => [step.id, step]));
  const problems = lostWork(recorded, workflow, explained);

  // Every rule they said or wrote: built by steps that exist, or explained.
  task.rules.forEach((rule, i) => {
    const said = done.rules.find((r) => r.rule === i);
    if (!said || (!said.not_built && said.steps.length === 0)) {
      problems.push(
        `rule ${i} "${rule.quote}" is neither built nor explained: name the steps that build it, or say why it isn't built`,
      );
      return;
    }
    // Picking what changes each time is what reading the page and an ai_step do (Checkpoint 5: B left "the newest
    // video" unbuilt, saying the recording had no selectors for it).
    if (said.not_built && PICK.test(rule.quote)) {
      problems.push(
        `rule ${i} "${rule.quote}" isn't built: what changes each time (the newest, the top 3, ones not already done) is built by reading the page (read with no target) and an ai_step that picks it, then a loop over what it returns. Build it, or say in not_built why that can't work`,
      );
      return;
    }
    // The trigger by the word the outline shows it under (Checkpoint 5: B looked for a step "trigger" for 15 calls).
    const missing = said.not_built ? [] : said.steps.filter((id) => !now.has(id === "trigger" ? "start" : id));
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
    // A check that still holds the recorded page or file on a step that now uses a {{value}} fails next time.
    const literal = step.check?.url_matches ?? step.check?.file_exists;
    const args = JSON.stringify([step.args.url, step.args.to, step.args.from]);
    if (literal && !literal.includes("{{") && args.includes("{{")) {
      problems.push(
        `${step.id}: its check still looks for "${literal}" but the step now uses a {{value}}: change the check or remove it`,
      );
    }
  }
  for (const check of workflow.success) judge("success", check);

  // The test run: every step it couldn't find or that failed is fixed, or explained.
  for (const step of test?.steps ?? []) {
    if (step.status !== "failed" && step.status !== "not_found") continue;
    if (sinceTest.has(step.id)) continue;
    const what =
      step.status === "not_found"
        ? "the test run didn't find it"
        : `it failed in the test run (${step.error ?? "no reason given"})`;
    problems.push(`${step.id}: ${what}: fix it, or explain why it will work in a real run`);
  }

  const notRun = /^not run: (.*)/.exec(test?.outcome ?? "")?.[1];
  if (notRun && !/Chrome is not connected|Shadow\.app is not running/.test(notRun)) {
    problems.push(`the test run couldn't start (${notRun}): fix that, so it can run`);
  }
  problems.push(...runProblems(workflow));
  problems.push(...(input.unattended?.(workflow) ?? []));

  // As often as they said: the task model's cadence, or frequency words in the goal and what was said (F1: the model
  // wrote "manual" while quoting "every day").
  const spoken = (input.said ?? []).map((t) => FREQUENCY.exec(t)?.[0]).find(Boolean);
  if ((task.cadence.kind !== "manual" || spoken) && triggerOf(workflow).when.every((w) => w.type === "manual")) {
    const quote = spoken ?? task.cadence.quote;
    problems.push(
      `they said ${quote ? `"${quote}"` : `it runs on a ${task.cadence.kind}`}, but it only runs when started by hand: set it with trigger`,
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
