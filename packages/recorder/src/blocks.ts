// Blocks by code (reports/plan-oct26-workflow-revamp.md, R2): a saved workflow's browser steps grouped into named
// nodes, one per thing the user did on a page: "Open Ycomb jobs", "Copy from ycombinator.com", "Fill in Ycomb jobs".
// The YC recording saved 33 browser events as 33 cards (Oct 26); people read the task in 5–10 things.
//
// A page segment starts at each step that opens a page (web.navigate) and takes the web steps after it, up to the next
// open or the next step that isn't a web step. AI steps, app steps, files, Mac apps, loops and ifs stay nodes of their
// own; a segment of one step stays a step. Blocks already there (the design's) are kept as they are.
import {
  cleanName as clean,
  type EditInput,
  isAction,
  isGroup,
  type PageNames,
  pageName,
  Skill,
  type Step,
  walkSteps,
} from "@shadow/core";

export type BlockNames = PageNames;
export { clean, pageName };

type Body = Exclude<Step, { type: "trigger" }>;

const short = (text: string, max = 48) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

const isWeb = (s: Step) => isAction(s) && s.channel === "web";
const opensPage = (s: Step) => isAction(s) && s.channel === "web" && s.action === "navigate";
const TYPES = new Set(["type", "press", "select", "upload"]);
// A step that does the task's work: reads something, types, or sends.
const works = (s: Step) => isAction(s) && (Boolean(s.output) || TYPES.has(s.action) || s.requires_approval);
const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
};

// What a segment does, in a name: open, copy from, fill in, send.
function nameOf(steps: Body[], page: string): string {
  const actions = steps.filter(isAction);
  const reads = actions.some((s) => s.output);
  const types = actions.some((s) => TYPES.has(s.action));
  const outward = actions.find((s) => s.requires_approval);
  if (outward) return short(`${clean(outward.intent)} on ${page}`);
  if (types && reads) return short(`Copy and fill in on ${page}`);
  if (types) return short(`Fill in ${page}`);
  if (reads) return short(`Copy from ${page}`);
  // Only got somewhere: named for where it ended (a document clicked in a list), else the page.
  const last = actions.at(-1);
  const clicked = last?.action === "click" ? clean(last.target?.name ?? last.target?.text ?? "") : "";
  return short(`Open ${clicked && clicked.length <= 40 && !clicked.includes("{{") ? clicked : page}`);
}

// The steps of one list, grouped; inner lists (loops, if arms) too.
function group(steps: Step[], names: BlockNames, taken: Set<string>, page: { current: string }): Step[] {
  const out: Step[] = [];
  let segment: Body[] = [];
  let segmentHost: string | undefined;
  const close = () => {
    segmentHost = undefined;
    if (segment.length >= 2) {
      let n = 1;
      while (taken.has(`b${n}`)) n++;
      taken.add(`b${n}`);
      out.push({
        id: `b${n}`,
        type: "control",
        kind: "group",
        intent: nameOf(segment, page.current),
        requires_approval: false,
        steps: segment,
      } as Step);
    } else out.push(...segment);
    segment = [];
  };
  for (const step of steps) {
    if (step.type === "trigger" || isGroup(step)) {
      close();
      out.push(step);
      continue;
    }
    if (step.type === "control") {
      close();
      const inner = { ...step, steps: group(step.steps, names, taken, page) } as Step;
      if (step.kind === "branch")
        (inner as { else: Step[] }).else = group(step.else, names, taken, { current: page.current });
      out.push(inner);
      continue;
    }
    if (!isWeb(step)) {
      close();
      out.push(step);
      continue;
    }
    if (opensPage(step)) {
      // A new block once this one did its work, or when the page is on another site; opening pages on one site
      // before any work ("drive", then "drive" again) is one "Open …".
      const url = String((step as { args: { url?: unknown } }).args.url ?? "");
      const host = hostOf(url);
      if (segment.some(works) || (host && segmentHost && host !== segmentHost)) close();
      segmentHost = host ?? segmentHost;
      if (!url.includes("{{")) page.current = pageName(url, names);
    }
    segment.push(step);
  }
  close();
  return out;
}

// The workflow with its browser steps in named blocks. Never worse than it was: a result that doesn't parse is the
// workflow unchanged.
export function blocksOf(skill: Skill, names: BlockNames = {}): Skill {
  const taken = new Set<string>();
  const collect = (steps: Step[]) => {
    for (const s of steps) {
      taken.add(s.id);
      if (s.type === "control") {
        collect(s.steps);
        if (s.kind === "branch") collect(s.else);
      }
    }
  };
  collect(skill.steps);
  const parsed = Skill.safeParse({ ...skill, steps: group(skill.steps, names, taken, { current: "the page" }) });
  return parsed.success ? parsed.data : skill;
}

// The same grouping as edits (R2.5, "Tidy up" for a workflow saved before blocks): one `wrap` per block blocksOf
// would make, applied to a draft so the user sees it and saves it as a version.
export function blockPlan(skill: Skill, names: BlockNames = {}): EditInput[] {
  const had = new Set([...walkSteps(skill.steps)].map(({ step }) => step.id));
  return [...walkSteps(blocksOf(skill, names).steps)].flatMap(({ step }) =>
    isGroup(step) && !had.has(step.id)
      ? [{ op: "wrap" as const, steps: step.steps.map((s) => s.id), intent: step.intent, id: step.id }]
      : [],
  );
}

// How many nodes a reader sees: blocks and steps at the top level of each list, a loop or if counting once.
export function nodeCount(steps: Step[]): number {
  return steps.reduce(
    (n, s) =>
      n +
      (s.type === "trigger"
        ? 0
        : s.type === "control" && s.kind !== "group"
          ? 1 + nodeCount(s.steps) + (s.kind === "branch" ? nodeCount(s.else) : 0)
          : 1),
    0,
  );
}
