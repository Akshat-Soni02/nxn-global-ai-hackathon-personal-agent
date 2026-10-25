// The finish gate (spec, "Rules v2"): code, not the model, decides whether a design is done. A workflow is saved only
// when the work the user showed still happens, every rule they said is built or said not to be, its checks look for
// text that can appear, the test run passed or each failure is explained, an unattended run can fill its inputs, and
// it runs as often as they said. Each problem is a sentence the agent reads and fixes (twice at most; then it is saved
// with the gaps listed for the user). Oct 19: the agent finished with all 20 recorded steps removed, and with checks
// for text never on screen.

import { dirname } from "node:path";
import {
  applyEdits,
  type Check,
  type EditInput,
  findStep,
  isAction,
  isLlm,
  isOutward,
  type Locator,
  type Skill,
  type Step,
  triggerOf,
  walkSteps,
} from "@shadow/core";
import { MASK } from "../../mask.ts";
import type { DoneReport, TaskModel, TestReport } from "./contracts.ts";
import { expand, withDates } from "./places.ts";

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
  // Files the recording shows appearing with nothing recorded making them (evidence.unmade).
  unmade?: string[];
}

// A file the recording shows appearing with nothing recorded making it (checkpoint 6: a PDF saved through the
// browser's print dialog) is made by some step next time, in that folder; else the workflow can't do the task, and says
// so instead of offering "Looks right".
export function unmadeProblems(skill: Skill, unmade: string[]): string[] {
  const folders = [...walkSteps(skill.steps)].flatMap(({ step }) => {
    if (!isAction(step)) return [];
    const key = `${step.channel}.${step.action}`;
    const a = step.args;
    const place =
      key === "web.save_pdf"
        ? `${a.dir}/`
        : ["fs.move", "fs.copy", "fs.rename"].includes(key)
          ? a.to
          : key === "fs.write"
            ? a.path
            : undefined;
    if (typeof place !== "string" || !/^[~/]/.test(place)) return [];
    const where = String(withDates(place));
    return [expand(where.endsWith("/") ? where : dirname(where))];
  });
  return unmade
    .filter((path) => !folders.includes(expand(dirname(path))))
    .map(
      (path) =>
        `${path} appeared in the recording, but no step makes a file in ${dirname(path)}: build what made it (a page printed to PDF is save_pdf; a download is a click on the page's own control), or say in done why it can't be built`,
    );
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
  "web.save_pdf": ["dir", "name"],
  "fs.find": ["dir", "glob"],
  "fs.move": ["from", "to"],
  "fs.copy": ["from", "to"],
  "fs.rename": ["from", "to"],
  "fs.read": ["path"],
  "data.pick": ["from"],
  "mcp.call": ["tool"],
};
const findable = (t: Locator | undefined) =>
  Boolean(t && (t.role || Object.keys(t.attrs ?? {}).length > 0 || t.fallbacks.length > 0));

// A control the agent writes by role alone matches every control with that role (Checkpoint 5: C read { role: "cell" }
// on a table of 50 rates, and the test run found it ambiguous). It needs a name too, except to read them all or the
// page's one main part. A recorded control is the test run's to judge: it may be the only one of its kind.
export function roleAlone(step: Step): string[] {
  if (!isAction(step) || step.channel !== "web" || !step.target?.role || step.target.name) return [];
  const t = step.target;
  if (Object.keys(t.attrs ?? {}).length > 0 || t.fallbacks.length > 0 || step.args.all === true || t.role === "main")
    return [];
  return [
    `${step.id}: a role alone matches every ${t.role} on the page: give it a name too, copy a recorded control ({ like: "s3" }), or read the whole page (change: target: null)`,
  ];
}

export function stepProblems(step: Step): string[] {
  if (!isAction(step)) return [];
  const key = `${step.channel}.${step.action}`;
  const needs = NEEDS[key] ?? [];
  const missing = needs.filter((k) => step.args[k] === undefined || step.args[k] === "");
  const problems =
    missing.length > 0 ? [`${step.id}: ${key} needs ${needs.join(" and ")} (missing ${missing.join(", ")})`] : [];
  const noControl =
    ["web.navigate", "web.wait_for", "web.save_pdf"].includes(key) ||
    (key === "web.extract" && step.args.source === "google_sheet");
  // A key pressed on the page needs no control; one aimed at a control must be able to find it.
  if (step.channel === "web" && !noControl && (key !== "web.press" || step.target) && !findable(step.target)) {
    problems.push(
      `${step.id}: replay can't find its control: give it a role and name ({ role: "button", name: "Save" }) or copy a recorded one ({ like: "s3" }). To read a whole page, read with no target (change: target: null)${key === "web.press" ? "; a key pressed on the page needs no target" : ""}`,
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
  const steps = [...walkSteps(skill.steps)].map(({ step }) => step);
  return [...inputs, ...schedules, ...steps.flatMap(stepProblems), ...steps.flatMap(stale), ...tabless(steps)];
}

// A check that still holds the recorded page or file on a step that now uses a {{value}} fails next time. A run problem,
// so a kept draft is judged by it too (Checkpoint 5: D kept s2 opening {{featured_title}} but checking /wiki/Thuggee).
const stale = (step: Step): string[] => {
  if (!isAction(step)) return [];
  // Each check against the value it checks: the page opened, or where the file goes (live D: the plain list's rename
  // reads {{downloaded_1}} but goes to a fixed name, and its check is right).
  const literal = step.check?.url_matches ?? step.check?.file_exists;
  const checked = String((step.check?.url_matches !== undefined ? step.args.url : step.args.to) ?? "");
  return literal && !literal.includes("{{") && checked.includes("{{")
    ? [
        `${step.id}: its check still looks for "${literal}" but the step now uses a {{value}}: change the check or remove it`,
      ]
    : [];
};

// A web step with no tab runs in the window's first tab (Checkpoint 5: D's s1 opened the Main Page in tab "API", and the
// read after it read a page the test run had left in the first tab): after a page opened in a named tab, its steps
// name that tab too.
const tabless = (steps: Step[]): string[] => {
  let opened: { id: string; tab: string } | undefined;
  const tabs = new Set(["main"]); // tabs a page was opened in
  return steps.flatMap((step) => {
    if (!isAction(step) || step.channel !== "web") return [];
    if (step.action === "navigate") {
      opened = step.tab ? { id: step.id, tab: step.tab } : undefined;
      if (step.tab) tabs.add(step.tab);
      return [];
    }
    // A tab is made the first time a step names it, empty (checkpoint 6: D's read named the recorded tab while the page
    // had opened in the first one, read nothing, and its AI step made an article up).
    if (step.tab && !tabs.has(step.tab)) {
      return [
        `${step.id}: no earlier step opens a page in tab "${step.tab}", so it would act on a blank tab: leave its tab out to stay on the page the steps before it opened`,
      ];
    }
    return opened && !step.tab
      ? [
          `${step.id} runs in the window's first tab, but ${opened.id} opened its page in tab "${opened.tab}": give it tab "${opened.tab}" too`,
        ]
      : [];
  });
};

// What the tab rule asks for, done by code after every change (A, 24 Oct: the agent named tabs on two opens, left the
// steps after them without, and the gate refused it twice saying "give it tab Notes too"): a step with no tab, after a
// page opened in a named tab, gets that tab. Those tabs are code's (`owned`): taken back and worked out again from the
// steps as they are now, so an open added later moves them. A tab the agent named is never changed, even before the
// open that makes it (A's 4th design: code moved the notes read to "HN" one call before the Notes tab was opened).
export function tabsFixed(
  skill: Skill,
  owned: Map<string, string> = new Map(),
): { skill: Skill; fixed: Map<string, string>; owned: Map<string, string> } {
  let opened: { id: string; tab: string } | undefined;
  const fixed = new Map<string, string>();
  const mine = new Map<string, string>();
  const edits: EditInput[] = [];
  for (const { step } of walkSteps(skill.steps)) {
    if (!isAction(step) || step.channel !== "web") continue;
    if (step.action === "navigate") {
      opened = step.tab ? { id: step.id, tab: step.tab } : undefined;
      continue;
    }
    const codes = step.tab !== undefined && owned.get(step.id) === step.tab;
    if (step.tab !== undefined && !codes) continue; // the agent's
    const want = opened?.tab;
    if (want) mine.set(step.id, want);
    if (want === step.tab) continue;
    const { tab: _, ...rest } = step;
    edits.push({ op: "replace", step: step.id, with: (want ? { ...rest, tab: want } : rest) as never });
    fixed.set(
      step.id,
      want
        ? `code gave it tab "${want}": it acts on the page ${opened?.id} opened there`
        : "code took its tab back: no page before it opens in a named tab",
    );
  }
  const result = edits.length > 0 ? applyEdits(skill, edits) : undefined;
  if (edits.length > 0 && !result?.ok) return { skill, fixed: new Map(), owned };
  return { skill: result?.ok ? result.skill : skill, fixed, owned: mine };
}

// Two reads that got exactly the same text in the test run read the same page (A's 4th design: its "read the notes"
// read Hacker News again, and every story was then "already saved"): the later one is in the wrong tab or not needed.
export function sameReads(skill: Skill, test: TestReport | undefined): string[] {
  const reads = new Set(
    [...walkSteps(skill.steps)].flatMap(({ step }) => (isAction(step) && step.action === "extract" ? [step.id] : [])),
  );
  const seen = new Map<string, string>();
  return (test?.steps ?? []).flatMap((t) => {
    if (!reads.has(t.id) || t.status !== "done" || typeof t.value !== "string" || !t.value.trim()) return [];
    const first = seen.get(t.value);
    if (!first) {
      seen.set(t.value, t.id);
      return [];
    }
    return [
      `${t.id} read exactly what ${first} read in the test run (the same page): give it the tab of the page it should read, or remove it`,
    ];
  });
}

// The work the user showed (what they typed, chose, moved or sent: a step that needed approval sent something) still
// happens: kept (in a loop counts), or its removal explained for the review. A workflow that keeps none of it isn't
// what they meant, whatever reason each removal was given (Oct 19: the Play Store run kept one step of the recording).
// The steps that ran in the test but got nothing: a read of an empty control, an AI step that answered nothing. The
// runner counts them as done (checkpoint 6: D's read got "" three times and an AI step made up an article from it). An
// AI step's empty list is an answer: nothing new today ("skip the ones already saved").
export function emptyIn(skill: Skill, test: TestReport | undefined): string[] {
  const steps = new Map([...walkSteps(skill.steps)].map(({ step }) => [step.id, step]));
  const empty = (v: unknown) =>
    v == null ||
    (typeof v === "string" && !v.trim()) ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && Object.keys(v).length === 0);
  return (test?.steps ?? []).flatMap((t) => {
    const step = steps.get(t.id);
    const makes =
      step && ((isLlm(step) && step.output.type.type !== "list") || (isAction(step) && step.output !== undefined));
    return t.status === "done" && makes && empty(t.value) ? [t.id] : [];
  });
}

// An AI step's answer that isn't in what it read: right for one it works out (a summary, a name it makes), wrong for
// one it picks from a page (checkpoint 5: D's took a picture's caption for the title). Shown to the agent with the
// test's results, never refused: only it knows which kind the step is.
export function unfoundIn(skill: Skill, test: TestReport | undefined): string[] {
  const all = [...walkSteps(skill.steps)].map(({ step }) => step);
  const ran = new Map((test?.steps ?? []).map((t) => [t.id, t]));
  const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v ?? ""));
  const saved = (name: string) => {
    const by = all.find((s) => (isLlm(s) || isAction(s)) && s.output?.name === name);
    return by ? text(ran.get(by.id)?.value) : "";
  };
  return all.filter(isLlm).flatMap((ai) => {
    const t = ran.get(ai.id);
    if (t?.status !== "done") return [];
    const read = ai.inputs
      .flatMap((i) => [...i.matchAll(/\{\{\s*(\w+)/g)].map((m) => saved(m[1] ?? "")))
      .join("\n")
      .toLowerCase();
    if (!read.trim()) return [];
    const answers = (Array.isArray(t.value) ? t.value : [t.value]).filter(
      (v): v is string => typeof v === "string" && v.trim() !== "",
    );
    const missing = answers.find((a) => !read.includes(a.trim().toLowerCase()));
    return missing
      ? [
          `${ai.id} answered "${missing.slice(0, 80)}", which isn't in what it read: right for an answer it works out, wrong for one it picks from the page`,
        ]
      : [];
  });
}

// A control given only by a selector that the test run didn't find (B, 24 Oct: six guessed YouTube selectors in a row,
// each not found): what to do instead, the way that works on any page.
export function guessed(skill: Skill, id: string): string {
  const step = findStep(skill, id);
  const t = step && isAction(step) ? step.target : undefined;
  return t && !t.role && !t.name && !t.text
    ? `; a selector not found isn't fixed by guessing another: read the page (read with no target), let an ai_step pick what changes in the list's order, then click it by its name ({ role: "link", name: "{{picked}}" })`
    : "";
}

// An AI answer that goes into a page's address but isn't in what it read was made up (D, 24 Oct: it built
// /wiki/Battle_of_Schliengen from the title; on a day the title doesn't make the address, a "no such article" page opens,
// loads, and is saved as the PDF). Not explained away: open what the page links to instead.
export function madeUpAddresses(skill: Skill, test: TestReport | undefined): string[] {
  const all = [...walkSteps(skill.steps)].map(({ step }) => step);
  const opens = new Map<string, string>(); // a variable → the step whose address uses it
  for (const s of all)
    if (isAction(s) && s.action === "navigate")
      for (const m of String(s.args.url ?? "").matchAll(/\{\{\s*(\w+)/g)) opens.set(m[1] ?? "", s.id);
  const unfound = unfoundIn(skill, test);
  return all.flatMap((s) => {
    const step = isLlm(s) ? opens.get(s.output.name) : undefined;
    const doubt = unfound.find((u) => u.startsWith(`${s.id} answered`));
    return step && doubt
      ? [
          `${s.id}'s answer goes into ${step}'s address but isn't in what it read: it may be made up, and a page that doesn't exist still opens. Click the link where it is ({ place: "<the step that clicked it>" }) instead`,
        ]
      : [];
  });
}

// An address made of two (checkpoint 6: "https://en.wikipedia.org" before a value that was already a whole address),
// from the runner's "(it tried to open …)": said how to fix it.
export function joined(error?: string): string {
  const tried = /it tried to open (\S+)\)/.exec(error ?? "")?.[1];
  return tried && (tried.match(/:\/\//g) ?? []).length > 1
    ? `; its address is two joined: a value that is already a whole address is opened alone ({{value}})`
    : "";
}

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
  // A connected app's step does the work the clicks into its page did (connectors.ts): the recorded writes it replaced
  // are removed with a why, and that is the work kept, not lost.
  const appStep = [...walkSteps(workflow.steps)].some(({ step }) => isAction(step) && step.channel === "mcp");
  const noneKept = shown.length > 0 && !appStep && shown.every((s) => !now.has(s.id) && !doing.has(sig(s)));
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
  const problems = [...lostWork(recorded, workflow, explained), ...unmadeProblems(workflow, input.unmade ?? [])];

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
  }
  for (const check of workflow.success) judge("success", check);

  // The test run: every step it couldn't find or that failed is fixed, or explained.
  for (const step of test?.steps ?? []) {
    if (step.status !== "failed" && step.status !== "not_found") continue;
    if (sinceTest.has(step.id)) continue;
    const what =
      step.status === "not_found"
        ? `the test run didn't find it${guessed(workflow, step.id)}`
        : `it failed in the test run (${step.error ?? "no reason given"})${joined(step.error)}`;
    problems.push(`${step.id}: ${what}: fix it, or explain why it will work in a real run`);
  }

  problems.push(...sameReads(workflow, test).filter((p) => !sinceTest.has(p.split(" ")[0] ?? "")));
  problems.push(...madeUpAddresses(workflow, test));
  for (const id of emptyIn(workflow, test)) {
    if (sinceTest.has(id)) continue;
    problems.push(
      `${id}: it got nothing in the test run (an empty value): fix what it reads, or explain why a real run will have one`,
    );
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
