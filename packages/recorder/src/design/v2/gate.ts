// The finish gate (spec, "Rules v2"): code, not the model, decides whether a design is done. A workflow is saved only
// when the work the user showed still happens, every rule they said is built or said not to be, its checks look for
// text that can appear, the test run passed or each failure is explained, an unattended run can fill its inputs, and
// it runs as often as they said. Each problem is a sentence the agent reads and fixes (twice at most; then it is saved
// with the gaps listed for the user). Oct 19: the agent finished with all 20 recorded steps removed, and with checks
// for text never on screen.

import { dirname } from "node:path";
import {
  applyEdits,
  BUILT_INS,
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
  webPages,
} from "@shadow/core";
import { MASK } from "../../mask.ts";
import { appOf } from "./connectors.ts";
import type { DoneReport, Proposal, TaskModel, TestReport } from "./contracts.ts";
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
  // How often a run may ask the AI (the runner's SHADOW_AI_MAX_CALLS_PER_RUN): a workflow that asks more stops midway.
  aiCallsPerRun?: number;
  // What the user answered while it was designed: a rule left unbuilt because of their own answer is their choice.
  answers?: string[];
  // The connected apps' tools that only read (lostWork: an app step that only reads replaces no write).
  readOnlyTools?: ReadonlySet<string>;
  // What code prepared from the recording, and what the agent decided about each (unbuiltProposals).
  proposals?: Map<string, Proposal>;
  decisions?: Map<string, { decision: string }>;
  // The page each recorded step worked on, and the connected apps' toolkits (drawnProblems).
  pages?: Map<string, string>;
  connectedToolkits?: ReadonlySet<string>;
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

// What an AI step's instruction points outside itself at: the page, a sheet, a list, an email. It sees only its inputs.
const READS_OUTSIDE =
  /\b(on|from|in|of) (the|this|that) (page|site|sheet|screen|spreadsheet|inbox)\b|\bvisible\b|\blistings?\b/i;

// A ranking the list doesn't hold ("the 3 with the most points") is judgement, so it stays the AI step's.
const RANKED = /\b(by|most|least|highest|lowest|best|worst|largest|smallest|cheapest|biggest)\b/i;
const COUNT = /^\s*(take|keep|return|select|pick|get|give)\b[^.]{0,20}\b(first|top|last)\s+(\d+\b|\{\{\s*\w+\s*\}\})/i;
// "the top 5 job listings" anywhere in an AI step that returns a list (the second YC design, 28 Oct: "From the job board
// page, extract the top 5 job listings", then the ones already in the sheet dropped, so a day added fewer than 5).
// "up to 5", "the 5 newest" too (the third: "Return up to 5 newest job listings that are not already recorded").
// Never a time window: "the last 7 days" is which items, not how many (advisor, 28 Oct).
const COUNTED_LIST =
  /\b(?:first|top|last|up to|at most|no more than)\s+(?:\d+|\{\{\s*\w+\s*\}\})\b(?!\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b)|\b\d+\s+(?:newest|latest|most recent|recent|new)\b/i;
// A ranking right after the count ranks it ("the top 3 by points"), and stays the AI step's; "compare by title"
// further on doesn't (the third YC design's count went through on that "by"). "Most recent" is the list's order.
const RANKS_COUNT =
  /\b(?:\d+|\{\{\s*\w+\s*\}\})\b[^.]{0,30}?\b(?:by|most(?!\s+recent)|least|highest|lowest|best|worst|largest|smallest|cheapest|biggest)\b/i;

export function stepProblems(step: Step): string[] {
  // An AI step sees only its inputs, never the page (28 Oct, the YC design: "extract the job listings visible on the
  // page" with no inputs would have invented them at the first run).
  if (isLlm(step)) {
    // The first N of a list is a count, which code does: a loop's `first` (live run, 28 Oct: "take the first 5" came back
    // as items 1, 2, 3, 2, 5, and the run stopped on its own pick check).
    const list = step.output.type.type === "list";
    const counted =
      (COUNT.test(step.instruction) && !RANKED.test(step.instruction)) ||
      (list && COUNTED_LIST.test(step.instruction) && !RANKS_COUNT.test(step.instruction));
    if (counted)
      return [
        `${step.id}: counting is code's, not an AI step's: loop over the whole list with first: N (it goes through only the first N), and put the steps that use each item in the loop`,
      ];
    return step.inputs.length === 0 && READS_OUTSIDE.test(step.instruction)
      ? [
          `${step.id}: an AI step sees only its inputs, never the page or a sheet: read the page first (read, or read_all for a list, with save_as) and give it as an input ({{name}})`,
        ]
      : [];
  }
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
// How often a run asks the AI at most: each AI step once, once per item inside a loop (its first N, else its max_items),
// the larger arm of an if. Cached answers (the same question the same day) don't count, but can't be counted on.
function aiCalls(steps: Step[]): { calls: number; steps: string[] } {
  let calls = 0;
  const named: string[] = [];
  for (const step of steps) {
    if (step.type === "llm") {
      calls += 1;
      named.push(step.id);
    } else if (step.type === "control" && step.kind === "loop") {
      const each = step.first ?? step.max_items;
      const inner = aiCalls(step.steps);
      calls += inner.calls * each;
      named.push(...inner.steps.map((id) => `${id} ×${each}`));
    } else if (step.type === "control" && step.kind === "branch") {
      const [then, other] = [aiCalls(step.steps), aiCalls(step.else)];
      const larger = then.calls >= other.calls ? then : other;
      calls += larger.calls;
      named.push(...larger.steps);
    } else if (step.type === "control") {
      const inner = aiCalls(step.steps);
      calls += inner.calls;
      named.push(...inner.steps);
    }
  }
  return { calls, steps: named };
}

// A run stops at its AI limit (SHADOW_AI_MAX_CALLS_PER_RUN, 3 unless set; 28 Oct YC → Sheet: five AI steps, the fourth
// refused, and four of them did what a template or one AI step does). Judged only when the limit is given.
function overAiLimit(skill: Skill, limit: number | undefined): string[] {
  if (limit === undefined) return [];
  const used = aiCalls(skill.steps);
  if (used.calls <= limit) return [];
  return [
    `it asks the AI up to ${used.calls} times a run (${used.steps.join(", ")}), and a run may ask ${limit}: the run stops at the next one. Keep AI steps for judgement and give one step all it needs at once (one step can read two lists and return the new items); what code can do stays code ({{list.0}} is a list's first item, a loop's first: N takes N)`,
  ];
}

// An AI step whose every input is another AI step's answer only reshapes it (28 Oct YC → Sheet: pairs made from the
// listings, then the pairs compared, each a model call on every run): the first step can return that shape itself.
export function chainedAi(skill: Skill): string[] {
  const steps = [...walkSteps(skill.steps)].map(({ step }) => step);
  const madeBy = new Map<string, Step>();
  for (const step of steps) {
    const name = (step as { output?: { name?: string } }).output?.name;
    if (name) madeBy.set(name, step);
  }
  return steps.flatMap((step) => {
    if (step.type !== "llm") return [];
    // Today's date beside another AI step's answer is still only a reshape: built-ins are no source of their own.
    const names = step.inputs
      .flatMap((ref) => [...ref.matchAll(/\{\{\s*([A-Za-z_]\w*)/g)].map((m) => m[1] as string))
      .filter((n) => !(n in BUILT_INS));
    const from = [...new Set(names.map((n) => madeBy.get(n)))];
    if (names.length === 0 || from.some((s) => s?.type !== "llm")) return [];
    const ids = from.map((s) => (s as Step).id);
    return [
      `${step.id} only reshapes what ${ids.join(" and ")} answered: ask ${ids[0]} for that shape, and give it what ${step.id} needs too; one AI step per judgement (each is a model call on every run)`,
    ];
  });
}

// A schedule on other days than they said (the third YC design, 28 Oct: "Every day" built as "0 9 * * 1-5", the prompt's
// weekday example copied). The time may differ (9:00 when they didn't say one); the days are theirs.
export function otherDays(skill: Skill, task: TaskModel, words: string[] = []): string[] {
  const days = (cron: string) => cron.trim().split(/\s+/).slice(2).join(" ");
  const cron = task.cadence.kind === "schedule" && isCron(task.cadence.cron) ? task.cadence.cron : undefined;
  // No cron in the task model (the third re-design's was empty): their own words, when they name the days.
  const text = words.join(" ");
  const spoken = /\b(?:weekdays?|monday to friday|mon-fri)\b/i.test(text)
    ? { days: "* * 1-5", quote: "weekdays" }
    : /\b(?:every day|daily|each day)\b/i.test(text)
      ? { days: "* * *", quote: "every day" }
      : undefined;
  const wanted = cron ? { days: days(cron), quote: `${task.cadence.quote || cron}" (${cron})` } : spoken;
  if (!wanted) return [];
  const quoted = cron ? `"${wanted.quote}` : `"${wanted.quote}"`;
  return triggerOf(skill).when.flatMap((w) =>
    w.type === "schedule" && isCron(w.cron) && days(w.cron) !== wanted.days
      ? [`they said ${quoted}, but its schedule "${w.cron}" runs on other days: keep their days`]
      : [],
  );
}

// A schedule at midnight they never said (the second YC design, 28 Oct: "0 0 * * *" for "every day"): a time they
// didn't say is 9:00 in the morning, as the prompt says.
export function unsaidMidnight(skill: Skill, said: string[]): string[] {
  const midnight = triggerOf(skill).when.filter(
    (w) => w.type === "schedule" && /^0\s+0\s/.test((w as { cron: string }).cron.trim()),
  );
  if (midnight.length === 0 || said.some((t) => /midnight|12\s*am|00:00|\b0:00\b/i.test(t))) return [];
  return [
    `its schedule runs at midnight ("0 0 …"), a time they didn't say: a time they didn't say is 9:00 in the morning ("0 9 …")`,
  ];
}

export function runProblems(skill: Skill, limits: { aiCallsPerRun?: number } = {}): string[] {
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
  return [
    ...inputs,
    ...schedules,
    ...steps.flatMap(stepProblems),
    ...steps.flatMap(stale),
    ...tabless(steps),
    ...overAiLimit(skill, limits.aiCallsPerRun),
  ];
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

export function lostWork(
  recorded: Skill,
  workflow: Skill,
  explained: Map<string, string>,
  // The connected apps' tools that only read: a step calling one does no work in place of the clicks.
  readOnly: ReadonlySet<string> = new Set(),
): string[] {
  const now = new Set([...walkSteps(workflow.steps)].map(({ step }) => step.id));
  // The same action on the same control (by role and name) is that work kept, though the step is new (Checkpoint 5:
  // A rebuilt its pastes inside a loop and was told its work was gone).
  const sig = (s: Step) =>
    isAction(s) && s.target?.role && (s.target.name || s.target.label)
      ? `${s.channel}.${s.action}|${s.target.role}|${s.target.name ?? s.target.label}`
      : undefined;
  // A control named from a value ("C{{row}}", the third YC design, Oct 25: each job in the next row) is any control of
  // that kind: typing into it is the typing into "A4" the user showed, done for every row.
  const any = (s: Step) => (isAction(s) && s.target?.role ? `${s.channel}.${s.action}|${s.target.role}|*` : undefined);
  const doing = new Set(
    [...walkSteps(workflow.steps)].flatMap(({ step }) => {
      const name = isAction(step) ? (step.target?.name ?? step.target?.label ?? "") : "";
      return [sig(step), name.includes("{{") ? any(step) : undefined].filter(Boolean);
    }),
  );
  const kept = (s: Step) => doing.has(sig(s)) || doing.has(any(s));
  const problems: string[] = [];
  const shown = [...walkSteps(recorded.steps)]
    .map(({ step }) => step)
    .filter((s) => isAction(s) && (WRITES.has(`${s.channel}.${s.action}`) || isOutward(s) || s.requires_approval));
  // A connected app's step does the work the clicks into its page did (connectors.ts): the recorded writes it replaced
  // are removed with a why, and that is the work kept, not lost.
  const appStep = [...walkSteps(workflow.steps)].some(
    ({ step }) => isAction(step) && step.channel === "mcp" && !readOnly.has(String(step.args.tool)),
  );
  const noneKept = shown.length > 0 && !appStep && shown.every((s) => !now.has(s.id) && !kept(s));
  for (const step of shown) {
    if (now.has(step.id) || kept(step) || (explained.has(step.id) && !noneKept)) continue;
    problems.push(
      `${step.id} (${step.intent}) was work the user showed, and it is gone: keep it, repeat it in a loop, or remove it with a why the user will see${noneKept ? " (none of their work is left)" : ""}`,
    );
  }
  return problems;
}

// What the gate and the critic say, in the blocks the agent thinks in (R5.4): a message that starts with a step's id is
// put under its block's name; an id mid-sentence gets the block after it. The ids stay: the agent edits by them.
export function inBlocks(messages: string[], workflow: Skill): string[] {
  const blockOf = new Map<string, string>();
  for (const { step, parents } of walkSteps(workflow.steps)) {
    const group = parents
      .map((id) => findStep(workflow, id))
      .reverse()
      .find((p) => p?.type === "control" && p.kind === "group");
    if (group && step.type !== "control") blockOf.set(step.id, group.intent);
  }
  if (blockOf.size === 0) return messages;
  const ids = [...blockOf.keys()]
    .sort((a, b) => b.length - a.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const anyId = new RegExp(`(?<![\\w-])(${ids.join("|")})(?![\\w-])`, "g");
  return messages.map((message) => {
    const lead = new RegExp(`^(${ids.join("|")})(?![\\w-])`).exec(message)?.[1];
    if (lead) return `In "${blockOf.get(lead)}": ${message}`;
    const named = new Set<string>();
    return message.replace(anyId, (id) => {
      if (named.has(id)) return id;
      named.add(id);
      return `${id} (in "${blockOf.get(id)}")`;
    });
  });
}

// The trigger's inputs a step still reads (only the recording's own are judged: one the agent added is its to keep). An input made for a step the design then removed (the YC recording's paste
// into a sheet's cell, done by the app now) is dropped, or the user is asked for a value nothing uses at every run.
export function withoutUnusedInputs(skill: Skill, recorded: Skill): Skill {
  const [trigger, ...rest] = skill.steps;
  if (trigger?.type !== "trigger") return skill;
  const used = JSON.stringify([rest, skill.success]);
  const kept = Object.fromEntries(
    Object.entries(trigger.inputs).filter(
      ([name]) => !(name in triggerOf(recorded).inputs) || new RegExp(`\\{\\{\\s*${name}\\b`).test(used),
    ),
  );
  return Object.keys(kept).length === Object.keys(trigger.inputs).length
    ? skill
    : { ...skill, steps: [{ ...trigger, inputs: kept }, ...rest] };
}

// A step that typed or pressed into a drawn area (`drawn`, set by the recorder: a sheet's cells, a canvas) can't be
// replayed on the page: the clicks that chose the place are gone, so it would land in whichever cell is selected and
// say ok (Rushil, 27 Oct). A connected app does that work with its own tools, for any app (the table in
// connectors.ts), so: where a connected app covers the page, the step must become an app step (`fix`, the agent is sent
// back); where the app isn't connected, or none covers the page, the workflow can't run yet and says what to connect
// (`cantRun`, for the review: Go live is refused until then).
export function drawnProblems(
  workflow: Skill,
  pages: Map<string, string>,
  connected: ReadonlySet<string>,
): { fix: string[]; cantRun: string[] } {
  const fix: string[] = [];
  const needs = new Map<string, string[]>(); // what to connect (or the site) -> the steps that need it
  // The page is the last one opened in the step's tab (core's webPages, the rule the run's preflight uses). `pages` is
  // only by the step that opened a page, so it is the fallback, never the first look (27 Oct: it was, and a typing step
  // in Google Sheets was "a site no app covers" with Sheets connected).
  for (const { step, url: opened } of webPages(workflow.steps)) {
    if (!step.drawn) continue;
    const url = opened || pages.get(step.id);
    const app = url ? appOf(url) : undefined;
    if (app && connected.has(app.toolkit)) {
      fix.push(
        `${step.id} (${step.intent}) types into a drawn area of ${app.name}, which replay can't reach: do it with the app's tool (add { do: "app", … }) and remove this step`,
      );
      const key = `a drawn area of ${app.name}, which replay can't reach, and the design didn't turn it into ${app.name} steps: record it again, or Edit it to add the app step`;
      needs.set(key, [...(needs.get(key) ?? []), step.id]);
      continue;
    }
    const key = app
      ? `a drawn area of ${app.name}: connect ${app.name} in Apps, then run it again`
      : `a drawn area of ${hostOfUrl(url)}: no connected app covers ${hostOfUrl(url)}, and replay can't reach this spot on the page`;
    needs.set(key, [...(needs.get(key) ?? []), step.id]);
  }
  const cantRun = [...needs].map(([what, ids]) => `${ids.join(", ")} work${ids.length > 1 ? "" : "s"} in ${what}`);
  return { fix, cantRun };
}

const hostOfUrl = (url?: string) => {
  try {
    return new URL(url ?? "").host;
  } catch {
    return "this site";
  }
};

// A proposal code could run but prepared nothing for ("the newest, not the third": the agent builds it) is accepted by
// the agent's say-so. Nothing checked that it was built, so the click stayed pinned to the recorded item. The steps it
// is about must have changed, or be gone: else the agent is told, and builds it or rejects it with a why.
export function unbuiltProposals(
  recorded: Skill,
  workflow: Skill,
  proposals: Map<string, Proposal>,
  decisions: Map<string, { decision: string }>,
): string[] {
  const asRecorded = (id: string) => {
    const was = findStep(recorded, id);
    const now = findStep(workflow, id);
    return !!was && !!now && JSON.stringify(was) === JSON.stringify(now);
  };
  return [...decisions].flatMap(([id, d]) => {
    const p = proposals.get(id);
    if (!p || d.decision !== "accept" || !p.runnable || p.edits.length > 0) return [];
    const kept = p.steps.filter(asRecorded);
    return kept.length === p.steps.length && kept.length > 0
      ? [
          `${id} (${p.summary.slice(0, 90)}) was accepted, but ${kept.join(", ")} ${kept.length > 1 ? "are" : "is"} still as recorded: build it, or reject it with a why`,
        ]
      : [];
  });
}

export function gate(input: GateInput): string[] {
  const { recorded, workflow, task, done, test, appeared, explained } = input;
  const sinceTest = input.sinceTest ?? explained;
  const now = new Map<string, Step>([...walkSteps(workflow.steps)].map(({ step }) => [step.id, step]));
  const problems = [
    ...lostWork(recorded, workflow, explained, input.readOnlyTools),
    ...unmadeProblems(workflow, input.unmade ?? []),
    ...(input.proposals && input.decisions
      ? unbuiltProposals(recorded, workflow, input.proposals, input.decisions)
      : []),
    ...(input.pages ? drawnProblems(workflow, input.pages, input.connectedToolkits ?? new Set()).fix : []),
  ];

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
    // Unless the reason is the user's own answer (28 Oct YC → Sheet: "exactly 5 each day", and they answered "Add as many
    // as available" for days with fewer: refused twice, the design was marked as not having built their rule).
    const words = (text: string) => norm(text.replace(/[^\p{L}\p{N}]+/gu, " "));
    const theirs = (input.answers ?? []).some(
      (a) => words(a).length >= 4 && words(said.not_built ?? "").includes(words(a)),
    );
    if (said.not_built && PICK.test(rule.quote) && !theirs) {
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
  if (notRun && !/Chrome is not connected|Shadow\.app is not running|sign in to Shadow/.test(notRun)) {
    problems.push(`the test run couldn't start (${notRun}): fix that, so it can run`);
  }
  problems.push(...runProblems(workflow, { aiCallsPerRun: input.aiCallsPerRun }));
  problems.push(...chainedAi(workflow));
  problems.push(...unsaidMidnight(workflow, input.said ?? []));
  problems.push(...otherDays(workflow, task, input.said ?? []));
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
