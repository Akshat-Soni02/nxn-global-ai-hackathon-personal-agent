// Design agent v2's tools (spec, "Tools" and "Forgiveness"). Built from the Oct 19 runs, where 6 of 11 and 9 of 16
// turns went on calls the old tools rejected: inputs sent as JSON strings, a loop with no steps, a step missing its
// type, an id the tool didn't know. Here a field sent as a string is parsed; a step is written as what it does
// ({ do: "click" }) and code fills in its channel, action and type; an unknown id is answered with the real ones; a
// wrong tool gets the right call back; and several calls run in one turn (callsPerTurn). Every change carries a `why`
// the review shows. Only what is harmful is refused (rules.ts); approval on outward steps is added by code.
import { type AnyTool, type ToolContext, tool } from "@shadow/agent";
import {
  applyEdits,
  type EditInput,
  findStep,
  isAction,
  isLlm,
  type Locator,
  pageName,
  Skill,
  type Step,
  triggerOf,
  type VarType,
  walkSteps,
} from "@shadow/core";
import { z } from "zod";
import { requireApprovals } from "../../approvals.ts";
import { producedType } from "../../compile.ts";
import { MASK, maskText } from "../../mask.ts";
import { describeArgument, fitArguments, missingArguments, readOnlyTools, rowProblems, withIds } from "./connectors.ts";
import { DoneReport } from "./contracts.ts";
import { emptyIn, guessed, isCron, joined, roleAlone, sameReads, stepProblems, tabsFixed, unfoundIn } from "./gate.ts";
import { outlineOf } from "./outline.ts";
import { maySend, refusals } from "./rules.ts";
import { MAX_DONE_REFUSALS, MAX_TESTS, type SessionV2 } from "./session.ts";

// A tool input, or one of its fields, sent as a JSON string: parsed. Anything that isn't JSON stays as it was.
export function unstring(value: unknown): unknown {
  const parse = (v: unknown) => {
    if (typeof v !== "string" || !/^\s*[[{]/.test(v)) return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  const top = parse(value);
  if (!top || typeof top !== "object" || Array.isArray(top)) return top;
  return Object.fromEntries(Object.entries(top).map(([k, v]) => [k, parse(v)]));
}

// What a step can do, as the model writes it, and the channel and action it becomes. "web.click" works too.
const DO: Record<string, [string, string]> = {
  open: ["web", "navigate"],
  click: ["web", "click"],
  type: ["web", "type"],
  select: ["web", "select"],
  press: ["web", "press"],
  read: ["web", "extract"],
  read_all: ["web", "extract"],
  read_sheet: ["web", "extract"],
  wait: ["web", "wait_for"],
  upload: ["web", "upload"],
  save_pdf: ["web", "save_pdf"],
  find_files: ["fs", "find"],
  read_file: ["fs", "read"],
  move_file: ["fs", "move"],
  copy_file: ["fs", "copy"],
  rename_file: ["fs", "rename"],
  pick_row: ["data", "pick"],
  open_app: ["ax", "open"],
  press_in_app: ["ax", "press"],
  type_in_app: ["ax", "set_value"],
  menu: ["ax", "menu"],
  key_in_app: ["ax", "key"],
};

// How to do what a proposal with nothing prepared describes (Checkpoint 4: accepting one changed nothing).
const BUILD_IT: Record<string, string> = {
  list_item:
    "read the list or the page (read_all on the list, or read with no target) and let ai_step pick the item; loop over them if there are several",
  repeat: "read the items (read_all, or read the page and ai_step), then loop over them",
  all_files: "find_files with pick: all, then loop over the files",
  constant: "keep the value as it is",
};

const LocatorSpec = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  near: z.string().optional(),
});
// A control: the target of a recorded step ({ like: "s3" }); the one in the place a recorded step's was ({ place: "s2" }:
// today's featured article, the top story, whatever it says that day); or a new one, by a selector ({ css: "h1" }) or by
// role and name (unverified until the test run finds it on the live page).
const TargetSpec = z.union([
  z.object({ like: z.string() }),
  z.object({ place: z.string() }),
  z.object({ css: z.string().min(1) }),
  LocatorSpec,
]);
// A step as the model writes it: what it does, what for, its control, and its values (at the top or under args).
const StepSpec = z
  .object({
    do: z.string(),
    intent: z.string().min(1),
    target: TargetSpec.optional(),
    tab: z.string().optional(),
    save_as: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
    args: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
type StepSpec = z.infer<typeof StepSpec>;
const Where = { after: z.string().optional(), before: z.string().optional(), into: z.string().optional() };
const Why = z.string().default("");
// A write to the workflow file always says why: a recorded step it leaves out is explained by it (the third YC design,
// Oct 25, sent writes without one and its removals counted as lost work). whys: a why by step id, for any step.
const FileWhy = z.string().min(1, "say why (the user reads it; it explains every recorded step this leaves out)");
const Whys = z.record(z.string(), z.string()).optional();
// Step ids as a list, or in one string ("s2, s3", "[s2, s3]"): the real runs sent all three.
const split = (ids: string) => ids.split(/[\s,[\]"']+/).filter(Boolean);
const Ids = z.union([z.string(), z.array(z.string())]).transform((s) => (Array.isArray(s) ? s : [s]).flatMap(split));
// What a loop repeats: steps already there, or new steps made inside it (Checkpoint 5: a step using {{story.title}}
// can't be added before the loop that declares story, so A spent 20 calls on it, twice).
const Body = z
  .union([z.string(), z.array(z.union([z.string(), StepSpec]))])
  .transform((s) =>
    (Array.isArray(s) ? s : [s]).flatMap((x): (string | StepSpec)[] => (typeof x === "string" ? split(x) : [x])),
  );
// "The top 3" says neither the page's order nor the most points, and models read it as the most points (A, 24 Oct:
// measured on Hacker News, and the design wrote it again after the prompt said not to): an AI step that picks a number
// of items says how.
export function vaguePick(instruction: string): string | undefined {
  const top = /\btop\s+(\d+|two|three|four|five|ten)\b/i.test(instruction);
  return top && !/\b(order|first|position|most|highest|largest|by)\b/i.test(instruction)
    ? `say how to pick: the ones in the list's order, with the count as the loop's first: 3 (or "the 3 with the most points"); a model reads "top 3" as the most points`
    : undefined;
}

// The types the model writes (Checkpoint 5: "list", { title: "text" }, "list of text"), in core's own form.
const typeFrom = (t: unknown): unknown => {
  if (typeof t === "string") {
    const list = /^list(?: of (.+?)s?)?$/.exec(t.trim());
    const name = t.trim();
    // JSON Schema's names too (the third YC design wrote string, integer and array).
    const alias: Record<string, string> = { string: "text", integer: "number", float: "number", bool: "boolean" };
    if (name === "array") return { type: "list", items: { type: "object" } };
    return list ? { type: "list", items: typeFrom(list[1] ?? "object") } : { type: alias[name] ?? name };
  }
  if (Array.isArray(t)) return { type: "list", items: typeFrom(t[0] ?? "object") };
  if (!t || typeof t !== "object") return { type: "text" };
  const { type, items, fields, properties } = t as {
    type?: unknown;
    items?: unknown;
    fields?: Record<string, unknown>;
    properties?: Record<string, unknown>;
  };
  if (type === "list" || type === "array") return { type: "list", items: typeFrom(items ?? "object") };
  // A scalar written as an object ({ "type": "string" }) is that scalar.
  if (typeof type === "string" && type !== "object") return typeFrom(type);
  // An object's fields, also as JSON Schema writes them (properties).
  const named =
    type === undefined ? (t as Record<string, unknown>) : type === "object" ? (fields ?? properties) : undefined;
  return named
    ? { type: "object", fields: Object.fromEntries(Object.entries(named).map(([k, v]) => [k, typeFrom(v)])) }
    : t;
};

// A question about the time of day it runs: never asked, 9:00 is the default (Checkpoint 5: A, B and D2 asked it; D2
// made it an input), and the review shows the time so it can be changed.
export const isTimeOfDay = (question: string) => /\b(what|which) time\b|\btime of day\b|\bwhat hour\b/i.test(question);
// A question about how often it runs: its Frequency in the review is where that is set, and the form already held the
// user's choice (28 Oct: the YC design asked "How often should the collection run?" twice, the form said by hand).
export const isFrequency = (question: string) => /\bhow (often|frequently)\b|\bfrequency\b/i.test(question);
// A question about how to build it, not what they want (checkpoint 6: D asked which PDF method, Puppeteer, wkhtmltopdf or
// pandoc, and whether "the script" should overwrite): never the user's to answer.
export const isHowTo = (question: string) =>
  /\b(method|approach|technique|library|puppeteer|wkhtmltopdf|pandoc|selenium|the script|an api)\b/i.test(question);

// The tools the design agent edits with: "file" (Oct 25), the workflow as JSON it reads, writes whole or edits by exact
// text, as an agentic IDE edits code; "verbs", one tool per kind of change (add, change, loop…), kept for older evals.
export type DesignMode = "file" | "verbs";

// The workflow as the model reads and edits it in file mode: the same formatting every time, so exact text matches.
// A block's steps are folded to their ids (R5): the agent reads ~10 named blocks, not 33 steps; written back, an id is
// that step as it is, so nothing is lost. read_workflow { step } shows any step in full; `full` shows every one.
export const workflowFile = (skill: Skill, options: { full?: boolean } = {}) =>
  JSON.stringify({ steps: options.full ? skill.steps : folded(skill.steps), success: skill.success }, null, 2);

function folded(steps: Step[]): unknown[] {
  return steps.map((s) => {
    if (s.type !== "control") return s;
    if (s.kind === "group") return { ...s, steps: s.steps.map((x) => x.id) };
    return { ...s, steps: folded(s.steps), ...(s.kind === "branch" ? { else: folded(s.else) } : {}) };
  });
}

// Which page each of these steps reads or types on: the page the last open before it went to (Oct 27: the design put
// "Read all job listings" right after "Open the sheet", and read the sheet). Said with every write, so a step on the
// wrong page shows at once. In run order; a loop's steps follow what is open when it starts.
export function pagesOfSteps(skill: Skill, ids: Set<string>): string[] {
  const out: string[] = [];
  let open: { id: string; url: string } | undefined;
  for (const { step } of walkSteps(skill.steps)) {
    if (!isAction(step) || step.channel !== "web") continue;
    if (step.action === "navigate") {
      open = { id: step.id, url: String(step.args.url ?? "") };
      continue;
    }
    if (!ids.has(step.id) || !["extract", "type", "click", "select", "press"].includes(step.action)) continue;
    const verb = step.action === "extract" ? "reads" : step.action === "type" ? "types on" : "acts on";
    out.push(
      open
        ? `${step.id} ${verb} ${pageName(open.url)} (the page ${open.id} opened)`
        : `${step.id} ${verb} no page yet: a run starts on a blank window, open one first`,
    );
  }
  return out.slice(0, 12);
}

// What file mode keeps from the verbs: looking, testing, asking, proposals, and finishing.
const FILE_MODE = new Set(["accept", "reject", "restore", "look", "test", "ask", "done", "finish", "ask_user"]);

export function designToolsV2(session: SessionV2, options: { mode?: DesignMode } = {}): AnyTool<DoneReport>[] {
  const ids = () => [...walkSteps(session.draft.steps)].map(({ step }) => step.id);
  const known = (id: string) => ids().includes(id);
  const unknown = (id: string) =>
    `no step ${id}${id === "trigger" ? " (the trigger is start)" : ""}. Steps: ${ids().join(", ")}`;
  const nextId = (prefix: string, taken: string[] = []) => {
    // Never an id the recording had (a removed step keeps its id and its why for the review), nor one code left out.
    const recorded = [...walkSteps(session.original.steps)].map(({ step }) => step.id);
    const used = new Set([...ids(), ...recorded, ...session.dropped.keys(), ...taken]);
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  };
  // A recorded step anywhere: in the draft, the recording, or what code left out.
  // Code's left-out steps too (x4): the model names them as targets (Oct 27, "no step x4" four times).
  const anyStep = (id: string): Step | undefined =>
    [...walkSteps(session.draft.steps), ...walkSteps(session.original.steps)].find(({ step }) => step.id === id)
      ?.step ?? (session.dropped.get(id)?.step as Step | undefined);
  // The locator for a control the model names. A recorded one is as recorded; one in a recorded place is that place's
  // selector without its words, so it finds whatever is there next time (checkpoint 6: today's featured article).
  const locatorOf = (
    target: z.infer<typeof TargetSpec>,
  ): { locator: Locator; unverified: boolean } | { error: string } => {
    if ("like" in target) {
      const like = anyStep(target.like);
      if (!like) return { error: unknown(target.like) };
      if (isAction(like) && like.target) return { locator: like.target, unverified: false };
      const opens = isAction(like) && like.action === "navigate";
      return {
        error: `${target.like} has no control to copy (${opens ? `it opens a page: to click what is in the place it was, target { place: "${target.like}" }` : "it has none"}). To read a whole page, read with no target`,
      };
    }
    if ("place" in target) {
      const recorded = session.evidence?.step(target.place) as { place?: string } | undefined;
      if (recorded?.place) return { locator: { fallbacks: [recorded.place] }, unverified: false };
      // A place sent as the selector itself (the D eval, 24 Oct): that selector, unverified like a css target. A step's
      // id is never a selector, though "h1" may be either: whether such a step exists decides. Words aren't a selector
      // (C, 24 Oct: { place: "Indian Rupee" } was taken as one, and the read found nothing).
      const selector = /[#.[\]>:=]/.test(target.place) || /^[a-z][a-z0-9-]*$/.test(target.place);
      if (!anyStep(target.place) && !session.dropped.has(target.place) && selector)
        return { locator: { fallbacks: [target.place] }, unverified: true };
      return {
        error: anyStep(target.place)
          ? `${target.place} has no recorded place: use { like: "…" }, { css: "…" } or { role, name }`
          : `"${target.place}" is neither a step nor a selector: place takes a step's id ("s2") to act on what is where it was; to find a control by its words, { role, name }; to read a whole page, no target`,
      };
    }
    if ("css" in target) return { locator: { fallbacks: [target.css] }, unverified: true };
    return { locator: { ...target, fallbacks: [] }, unverified: true };
  };
  const position = (where: { after?: string; before?: string; into?: string }) =>
    where.into ? { into: where.into } : where.before ? { before: where.before } : { after: where.after ?? lastTop() };
  const lastTop = () => session.draft.steps.at(-1)?.id ?? "start";
  // How often it runs: "manual", a cron, { schedule }, { folder, glob }, or the trigger's own list.
  const setWhen = (when: unknown, why: string) => {
    const w = when as { schedule?: string; folder?: string; glob?: string };
    const value =
      when === "manual"
        ? [{ type: "manual" }]
        : typeof when === "string"
          ? [{ type: "schedule", cron: when }]
          : Array.isArray(when)
            ? when
            : w?.schedule
              ? [{ type: "schedule", cron: w.schedule }]
              : w?.folder
                ? [{ type: "folder_watch", dir: w.folder, ...(w.glob ? { glob: w.glob } : {}) }]
                : undefined;
    if (!value)
      return { output: { ok: false, problems: ['say when: "manual", { schedule: "0 9 * * *" } or { folder, glob }'] } };
    const bad = (value as { type?: string; cron?: string }[]).find((x) => x.type === "schedule" && !isCron(x.cron));
    if (bad)
      return {
        output: {
          ok: false,
          problems: [
            `a schedule is a fixed cron (minute hour day month weekday, e.g. "0 9 * * 5"), never a {{value}}: "${bad.cron}"`,
          ],
        },
      };
    return apply([{ op: "set", step: "start", field: "when", value }], why, ["start"]);
  };

  // Edits applied to the draft: they must parse and break no rule. Approval on outward steps is added here, by code.
  const apply = (edits: EditInput[], why: string, touched: string[], unverified: string[] = []) => {
    const result = applyEdits(session.draft, edits);
    if (!result.ok) return { output: { ok: false, problems: result.problems.map(hint) } };
    return commit(result.skill, why, touched, unverified);
  };
  // A new workflow, from edits or written whole (write_workflow, edit_workflow): checked like every change, then kept.
  // What code set right in the arguments of the app steps it just compiled (fitArguments), said to the agent with the
  // change that took it, so it learns the tool's own spelling instead of guessing again.
  const argumentNotes: string[] = [];
  const commit = (next: Skill, why: string, touched: string[], unverified: string[] = []) => {
    const fixedArguments = argumentNotes.splice(0);
    const result = { skill: next };
    // Said, so a change that didn't take isn't read as done (Checkpoint 5: C sent eight that changed nothing).
    const unchanged = JSON.stringify(result.skill) === JSON.stringify(session.draft);
    const refused = refusals(session.original, result.skill, session.facts);
    if (refused.length > 0) return { output: { ok: false, refused } };
    // A step it added or changed must be one the runner can run (Checkpoint 4: reads with no control, fs.find with
    // {folder, pattern}). A recorded control it didn't touch is the gate's to judge, not a reason to refuse this edit.
    const was = new Map([...walkSteps(session.draft.steps)].map(({ step }) => [step.id, step]));
    const unrunnable = [...walkSteps(result.skill.steps)]
      .map(({ step }) => step)
      .filter((step) => touched.includes(step.id) && JSON.stringify(step) !== JSON.stringify(was.get(step.id)))
      .flatMap((step) => {
        const old = was.get(step.id) ?? session.dropped.get(step.id)?.step ?? findStep(session.original, step.id);
        const same =
          old && "target" in old && isAction(step) && JSON.stringify(old.target) === JSON.stringify(step.target);
        return [...stepProblems(step), ...roleAlone(step)].filter(
          (p) => !same || !/can't find its control|role alone/.test(p),
        );
      });
    if (unrunnable.length > 0) return { output: { ok: false, problems: unrunnable } };
    const approved = requireApprovals(result.skill, { readOnlyTools: readOnlyTools(session.apps) });
    // What it added or changed that may send (an Enter in a message box, a copy of a recorded send): approval too.
    const before = new Map([...walkSteps(session.draft.steps)].map(({ step }) => [step.id, JSON.stringify(step)]));
    const sending = [...walkSteps(approved.skill.steps)]
      .map(({ step }) => step)
      .filter(
        (step) =>
          isAction(step) &&
          !step.requires_approval &&
          before.get(step.id) !== JSON.stringify(step) &&
          maySend(step, session.original),
      )
      .map((step) => step.id);
    const marked = applyEdits(
      approved.skill,
      sending.map((id): EditInput => ({ op: "set", step: id, field: "requires_approval", value: true })),
    );
    // The steps this change made, by the ids code gave them: later calls name them so.
    const had = new Set([...walkSteps(session.draft.steps)].map(({ step }) => step.id));
    // Tabs as the gate wants them, by code: a step after a named tab's page acts in that tab.
    const tidy = tabsFixed(marked.ok ? marked.skill : approved.skill, session.autoTabs);
    session.draft = tidy.skill;
    session.autoTabs = tidy.owned;
    for (const [id, note] of tidy.fixed) if (!session.whys.has(id)) session.whys.set(id, note);
    const made = [...walkSteps(session.draft.steps)].map(({ step }) => step.id).filter((id) => !had.has(id));
    const added = [...approved.added, ...(marked.ok ? sending : [])];
    for (const id of touched) {
      if (!why) continue;
      session.whys.set(id, why);
      session.sinceTest.set(id, why);
    }
    for (const id of unverified) session.unverified.add(id);
    return {
      output: {
        ok: true,
        ...(added.length > 0 ? { approval_added: added } : {}),
        ...(tidy.fixed.size > 0 ? { tabs_fixed: [...tidy.fixed].map(([id, note]) => `${id}: ${note}`) } : {}),
        ...(fixedArguments.length > 0 ? { arguments_fixed: fixedArguments } : {}),
        ...(made.length > 0 ? { new_steps: made } : {}),
        ...(() => {
          const on = pagesOfSteps(session.draft, new Set([...touched, ...made]));
          return on.length > 0 ? { works_on: on } : {};
        })(),
        ...(unchanged ? { note: "nothing changed: the workflow is exactly as it was (its why is kept)" } : {}),
        workflow: outlineOf(session.draft),
      },
    };
  };
  // The edit layer's messages, with what to do about them.
  const hint = (problem: string): string => {
    const missing = /no step (\S+)/.exec(problem)?.[1];
    if (missing) return `${problem}. Steps: ${ids().join(", ")}`;
    // The workflow's own steps: it can't be emptied (the Oct 19 Play Store run removed all but one).
    if (/^steps: .*(at least|too small)/i.test(problem)) {
      return `${problem}: a workflow keeps at least one step besides its trigger: remove fewer, or say in done why they go`;
    }
    // A list's item used outside a loop (Checkpoint 5: 20 calls on "{{story.title}} uses story").
    const item = /uses (\w+), which is not declared by an earlier step/.exec(problem)?.[1];
    // Not a list's item: a value a step saves, and this edit removes or moves that step (Checkpoint 5: B's copied_1).
    const saver = [...walkSteps(session.draft.steps)].find(({ step }) => "output" in step && step.output?.name === item)
      ?.step.id;
    if (saver) return `${problem}: ${saver} saves it: change the steps that use it first, or remove them too`;
    // A step's id sent as a value, from a step that saves none (D2: an ai_step reading {{s1}}, a navigate).
    if (item && known(item))
      return `${problem}: ${item} saves nothing: read what you need first (read with no target reads the page; save_as: a name), then use {{that name}}`;
    // Not an item either, as nothing reads a field of it (D2: {{article_title}} before the step that reads it).
    if (item && !problem.includes(`{{${item}.`))
      return `${problem}: nothing saves ${item} yet: first add the step that does (save_as on a read, or an ai_step's output name)`;
    if (item)
      return `${problem}: to use each item of a list, first put the steps that use it in a loop (loop: steps, over: "{{list}}", item: { name: "${item}" }); you can loop the recorded steps and then change their values, or add this step into a loop that has it (into: the loop's id)`;
    if (/steps.*(at least|too small)/i.test(problem))
      return `${problem}: give loop or branch the steps to repeat (steps: [ids])`;
    return problem;
  };

  // How the user wrote, as an example to copy (the recording's first typing and the page it was on), so an app step
  // refused for want of an app says what to do instead (Oct 27: the YC design sent do: "app" three times).
  const typingExample = (): string => {
    let page: string | undefined;
    for (const { step } of walkSteps(session.original.steps)) {
      if (!isAction(step) || step.channel !== "web") continue;
      if (step.action === "navigate") page = step.id;
      if (step.action === "type")
        return `: { "do": "open", "page": "${page ?? "s1"}" }, then { "do": "type", "target": { "like": "${step.id}" }, "text": "{{…}}" } (the user typed into ${step.id})`;
    }
    return "";
  };

  // A step spec -> an action step: channel, action and type from `do`, the target copied or new, values as args.
  const compile = (
    spec: StepSpec,
    id: string,
  ): { step: Record<string, unknown>; unverified: boolean } | { error: string } => {
    const { do: verb, intent, target, tab, save_as: named, args, output, ...rest } = spec;
    // A result named the way ai_step names it, { output: { name } } (D2): saved, never sent as an arg.
    const save_as = named ?? (output as { name?: string } | undefined)?.name;
    // A connected app's tool (connectors.ts): { do: "app", tool, arguments }. No control and no tab: it doesn't touch a
    // page. Only the tools of an app the user chose to use, with their required arguments.
    if (verb === "app" || verb === "mcp" || verb === "mcp.call") {
      const values: Record<string, unknown> = { ...rest, ...(args ?? {}) };
      const name = String(values.tool ?? "");
      const tools = session.apps.flatMap((a) => a.tools);
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        return {
          error:
            session.apps.length === 0
              ? `no app is connected for this workflow, so it writes on the page as the user did: open the page, then type into it${typingExample()}`
              : `no app tool "${name}". The tools: ${tools.map((t) => t.name).join(", ")}`,
        };
      }
      const given = (values.arguments ?? {}) as Record<string, unknown>;
      if (typeof given !== "object" || Array.isArray(given))
        return { error: `arguments is an object of the tool's arguments (look { app_tool: "${name}" })` };
      const fit = fitArguments(tool, given);
      const missing = missingArguments(tool, fit.args);
      if (fit.problems.length > 0 || missing.length > 0)
        return {
          error: [
            ...fit.problems,
            ...(missing.length > 0
              ? [
                  `${name} needs ${missing.map((m) => describeArgument(tool, m)).join(", ")} in arguments (look { app_tool: "${name}" } for each one)`,
                ]
              : []),
          ].join("; "),
        };
      argumentNotes.push(...fit.notes);
      const filled = withIds(fit.args, session.apps);
      if (!filled.ok) return { error: filled.error };
      const step: Record<string, unknown> = {
        id,
        type: "action",
        intent,
        channel: "mcp",
        action: "call",
        args: { tool: name, arguments: filled.value },
      };
      if (save_as) step.output = { name: save_as, type: { type: "object" } };
      return { step, unverified: false };
    }
    // "web.read" is read, as the model writes it (Checkpoint 5: D's web.read and web.read_all were refused).
    const plain = verb.replace(/^(web|fs|data|ax)\./, "");
    const pair =
      DO[verb] ??
      DO[plain] ??
      (/^(web|fs|data|ax)\.\w+$/.test(verb) ? (verb.split(".") as [string, string]) : undefined);
    if (!pair) {
      return {
        error: `"${verb}" is not something a step can do. Use one of: ${Object.keys(DO).join(", ")} (or channel.action, such as web.click). To repeat steps use loop; to decide use branch; to work something out from text use ai_step`,
      };
    }
    const [channel, action] = pair;
    const values: Record<string, unknown> = { ...rest, ...(args ?? {}) };
    if (verb === "read_all") values.all = true;
    if (verb === "read_sheet") values.source = "google_sheet";
    // A page by name ("s1", "KPI Sheet"): the text the agent reads masks ids inside addresses, so code writes it.
    if (action === "navigate" && typeof values.page === "string") {
      const url = session.pages.get(values.page);
      if (!url) return { error: `no page ${values.page}. Pages: ${[...session.pages.keys()].join(", ") || "none"}` };
      values.url = url;
      delete values.page;
    }
    let locator: Locator | undefined;
    let unverified = false;
    // A read "like" a step that opens a page reads that page (Oct 27: the YC design sent read_all { like: "s2" }, s2
    // the open of the jobs page, three times, refused each time).
    const likes = target && "like" in target ? anyStep(target.like) : undefined;
    const readsAPage = action === "extract" && likes && isAction(likes) && likes.action === "navigate";
    if (target && !readsAPage) {
      const found = locatorOf(target);
      if ("error" in found) return found;
      ({ locator, unverified } = found);
    }
    // A read with no control reads the page: its main part, else its body (Checkpoint 4: "read the page and let an AI
    // step pick" failed three times with "extract needs a target").
    if (action === "extract" && !locator && values.source === undefined) {
      locator = { fallbacks: ["main", "body"] };
      delete values.all;
    }
    const step: Record<string, unknown> = {
      id,
      type: "action",
      intent,
      channel,
      action,
      args: values,
      ...(locator ? { target: locator } : {}),
      ...(tab ? { tab } : {}),
    };
    if (save_as) step.output = { name: save_as, type: producedType({ channel, action, args: values } as never) };
    return { step, unverified };
  };

  // The type of the items of a list variable, so a loop's item fits it (check.ts compares them).
  const itemType = (name: string): VarType | undefined => {
    const bare = name.replace(/^\{\{|\}\}$/g, "").trim();
    const input = triggerOf(session.draft).inputs[bare];
    const found =
      input?.type ??
      [...walkSteps(session.draft.steps)]
        .map(({ step }) => ("output" in step && step.output?.name === bare ? step.output.type : undefined))
        .find(Boolean);
    return found?.type === "list" ? found.items : undefined;
  };

  const loop: AnyTool<DoneReport> = tool({
    name: "loop",
    kind: "edit",
    description:
      'Repeat steps for every item of a list an earlier step produces: over "{{list}}" (or its name), item { name } (used inside as {{name}}). steps: ids of steps that sit next to each other, or new steps ({ do, intent, target, values }, as add takes) made inside it; with only new steps, say where (after or before). The common shape: read a list, pick the items wanted (ai_step or a pick_row), loop over them',
    input: z.object({
      steps: Body,
      after: z.string().optional(),
      before: z.string().optional(),
      over: z.string().min(1),
      item: z.object({ name: z.string().min(1), type: z.record(z.string(), z.unknown()).optional() }),
      intent: z.string().min(1),
      on_item_fail: z.enum(["stop", "skip"]).optional(),
      why: Why,
    }),
    prepare: unstring,
    run: ({ steps, over, item, intent, on_item_fail, after, before, why }) => {
      if (steps.length === 0)
        return {
          output: { ok: false, problems: ["loop needs the steps to repeat (steps: [ids]): it moves them inside"] },
        };
      const there = steps.filter((s): s is string => typeof s === "string");
      const missing = [...there, after, before].find((s) => s && !known(s));
      if (missing) return { output: { ok: false, problems: [unknown(missing)] } };
      const id = nextId("l");
      const list = /^\{\{.*\}\}$/.test(over.trim()) ? over.trim() : `{{${over.trim()}}}`;
      // Looping over what an ai_step returns makes it a list, whatever it was declared as (Checkpoint 5: "is a text,
      // not a list", and no tool changes an ai_step's type; the prompt's own example declared none).
      const ai = [...walkSteps(session.draft.steps)]
        .map(({ step }) => step)
        .filter(isLlm)
        .find((st) => `{{${st.output.name}}}` === list.replace(/\s/g, ""));
      const one = ai && ai.output.type.type !== "list" ? ai.output.type : undefined;
      const listed = one && { type: "list", items: one.type === "text" ? { type: "object" } : one };
      const type = listed?.items ?? itemType(list) ?? (item.type ? typeFrom(item.type) : { type: "object" });
      const shell = {
        id,
        type: "control",
        kind: "loop",
        intent,
        over: list,
        item: { name: item.name, type },
        on_item_fail,
        steps: [],
      };
      const made: string[] = [];
      const unverified: string[] = [];
      const inside: EditInput[] = [];
      for (const s of steps) {
        if (typeof s === "string") {
          inside.push({ op: "move", step: s, to: { into: id } });
          continue;
        }
        const built = compile(s, nextId("s", made));
        if ("error" in built) return { output: { ok: false, problems: [built.error] } };
        made.push(built.step.id as string);
        if (built.unverified) unverified.push(built.step.id as string);
        inside.push({ op: "insert", at: { into: id }, step: built.step });
      }
      const at = there[0] ? { before: there[0] } : position({ after, before });
      return apply(
        [
          ...(listed && ai
            ? [{ op: "set", step: ai.id, field: "output", value: { ...ai.output, type: listed } } as EditInput]
            : []),
          { op: "insert", at, step: shell },
          ...inside,
        ],
        why,
        [id, ...there, ...made],
        unverified,
      );
    },
  });

  const branch: AnyTool<DoneReport> = tool({
    name: "branch",
    kind: "edit",
    description:
      "Do steps that sit next to each other only when a condition holds: if { left, op, right } (equals, not_equals, contains, greater_than, less_than, exists, not_exists), else: steps for when it doesn't",
    input: z.object({
      steps: Ids,
      if: z.record(z.string(), z.unknown()),
      else: z.array(z.string()).optional(),
      intent: z.string().min(1),
      why: Why,
    }),
    prepare: unstring,
    run: ({ steps, if: condition, else: otherwise, intent, why }) => {
      if (steps.length === 0)
        return { output: { ok: false, problems: ["branch needs the steps it guards (steps: [ids])"] } };
      const missing = [...steps, ...(otherwise ?? [])].find((s) => !known(s));
      if (missing) return { output: { ok: false, problems: [unknown(missing)] } };
      const id = nextId("b");
      return apply(
        [
          {
            op: "insert",
            at: { before: steps[0] as string },
            step: { id, type: "control", kind: "branch", intent, if: condition, steps: [], else: [] },
          },
          ...steps.map((s): EditInput => ({ op: "move", step: s, to: { into: id } })),
          ...(otherwise ?? []).map((s): EditInput => ({ op: "move", step: s, to: { into: id, arm: "else" } })),
        ],
        why,
        [id, ...steps, ...(otherwise ?? [])],
      );
    },
  });

  const aiStep: AnyTool<DoneReport> = tool({
    name: "ai_step",
    kind: "edit",
    description:
      "Add a step that reads text and works one value out of it (pick the newest, the ones not already in the sheet, a category, a summary). It never clicks or types. inputs: references such as {{emails}}",
    input: z.object({
      after: z.string(),
      intent: z.string().min(1),
      instruction: z.string().min(1),
      inputs: z
        .array(z.string())
        .min(
          1,
          'give it the text it reads: read the page first (read with no target, save_as: "page"), then ["{{page}}"]',
        ),
      output: z.object({
        name: z.string().min(1),
        type: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
      }),
      why: Why,
    }),
    prepare: unstring,
    run: ({ after, intent, instruction, inputs, output, why }) => {
      if (!known(after)) return { output: { ok: false, problems: [unknown(after)] } };
      const vague = vaguePick(instruction);
      if (vague) return { output: { ok: false, problems: [vague] } };
      const id = nextId("ai");
      // A step's id stands for what it saved ({{s6}} -> {{subject}}): the YC run sent one.
      const saved = (i: string) => {
        const step = findStep(session.draft, i.replace(/^\{\{|\}\}$/g, "").trim());
        return step && "output" in step && step.output ? `{{${step.output.name}}}` : undefined;
      };
      const refs = inputs.map((i) => saved(i) ?? (/^\{\{.*\}\}$/.test(i.trim()) ? i.trim() : `{{${i.trim()}}}`));
      return apply(
        [
          {
            op: "insert",
            at: { after },
            step: {
              id,
              type: "llm",
              intent,
              instruction,
              inputs: refs,
              output: {
                name: output.name,
                type: output.type === undefined ? { type: "text" } : typeFrom(output.type),
              },
            },
          },
        ],
        why,
        [id],
      );
    },
  });

  const ask: AnyTool<DoneReport> = tool({
    name: "ask",
    kind: "look",
    description:
      'Ask the user a question: only what the recording, the goal and what they said can\'t answer. step: the step its answer changes ("start" for its inputs). Answered at once when the user is watching (then build with the answer), else asked after you build, with the others, in one batch',
    input: z.object({
      question: z.string().min(1),
      why: z.string().min(1),
      step: z.string(),
      options: z.array(z.string()).max(6).optional(),
      default: z.string().optional(),
      confirm: z.boolean().optional(),
    }),
    prepare: unstring,
    // `confirm` is still accepted from older prompts, and means nothing now.
    run: async ({ question, why, step: named, options, default: fallback }) => {
      // A step written as words ("after opening the jobs page"; the YC design sent one six times, refused each time):
      // asked about the workflow's start, and said so.
      const step = named === "start" || known(named) ? named : "start";
      const moved =
        step !== named ? `"${named}" is no step id, so it is asked about the start (${unknown(named)})` : "";
      if (isTimeOfDay(question))
        return {
          output: {
            ok: false,
            problems: [
              'a time they didn\'t say is 9:00: set it in the trigger (the cron "0 9 * * *" is every day at 9:00), never ask it',
            ],
          },
        };
      if (isFrequency(question))
        return {
          output: {
            ok: false,
            problems: [
              "how often it runs is its Frequency in the review, set by the user there: set the trigger only if they said how often (a cron), never ask it",
            ],
          },
        };
      if (isHowTo(question))
        return {
          output: {
            ok: false,
            problems: [
              "how to build it is yours to decide, from the steps you have (save_pdf saves a page as a PDF; files are never overwritten): ask only what the user wants",
            ],
          },
        };
      // What the recording says about it, shown with the answer, never a reason not to ask (Oct 25, P3: the YC design's
      // "which fields say a job is already in the sheet?" was held back because the narration mentioned the sheet).
      const seen = session.evidence?.about(question) ?? [];
      const key = (s: string, q: string) =>
        `${s}|${q
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim()}`;
      if (session.questions.some((q) => key(q.step, q.text) === key(step, question))) {
        return { output: { ok: true, note: "already queued" } };
      }
      // Already answered while it built: the same answer, the user isn't asked twice.
      const earlier = session.answeredNow?.find((a) => key(a.question.step, a.question.text) === key(step, question));
      if (earlier) return { output: { answered: earlier.answer, note: "already answered: build with it" } };
      const id = `q${session.questions.length + (session.answeredNow?.length ?? 0) + 1}`;
      const queued = {
        id,
        text: question,
        why,
        step,
        options: options ?? [],
        ...(fallback ? { default: fallback } : {}),
      };
      // Asked now (N9): the user answers while it builds, and the agent builds with the answer, instead of a guess it
      // must undo after the batch at the end.
      if (session.askNow) {
        const given = (await session.askNow(queued)).trim() || fallback || "";
        session.answeredNow = [...(session.answeredNow ?? []), { question: queued, answer: given }];
        return {
          output: {
            answered: given,
            note: given ? "the user answered: build with it" : "no answer: decide it yourself, and say so in a why",
          },
        };
      }
      session.questions.push(queued);
      return {
        output: {
          queued: id,
          note: `asked after you build, with the other questions, in one batch${moved ? `; ${moved}` : ""}`,
          ...(seen.length > 0 ? { the_recording_says: seen } : {}),
        },
        ...(seen.length > 0 ? { untrusted: true } : {}),
      };
    },
  });

  // The safe test run, inside the episode (the agent loop has no step between turns): at most MAX_TESTS per design
  // asked by the agent; done's own test of what is about to be saved is never refused.
  const test = async (atDone = false): Promise<unknown> => {
    if (!session.runTest) {
      return "the test run can't run here (Chrome isn't connected to Shadow): finish, and the review will say it wasn't tested";
    }
    if (session.tests >= MAX_TESTS && !atDone)
      return `tested ${MAX_TESTS} times already: finish, explaining in done what still fails`;
    session.tests++;
    const report = await session.runTest();
    session.lastTest = report;
    session.sinceTest = new Map();
    session.testedDraft = JSON.stringify(session.draft.steps);
    const ids = (status: string) => report.steps.filter((s) => s.status === status).map((s) => s.id);
    const why = (status: string) =>
      report.steps
        .filter((s) => s.status === status)
        .map(
          (s) =>
            `${s.id}: ${s.error ?? status.replace("_", " ")}${joined(s.error)}${status === "not_found" ? guessed(session.draft, s.id) : ""}`,
        );
    return {
      outcome: report.outcome,
      done: ids("done"),
      found: ids("found"),
      not_found: why("not_found"),
      failed: why("failed"),
      not_reached: ids("not_reached"),
      // Ran, but got nothing: what a later step uses would be empty (code's check, not the runner's).
      empty: emptyIn(session.draft, report),
      // An AI answer not in what it read: wrong if it was to pick it from there.
      not_in_what_it_read: unfoundIn(session.draft, report),
      // Two reads that got the same page: one is in the wrong tab.
      same_reads: sameReads(session.draft, report),
      // What each step read or worked out, short (Checkpoint 5: D's AI step took the image caption for the title, and the
      // test said only that a check failed). Page text: shown as data.
      values: Object.fromEntries(
        report.steps
          .filter((s) => s.value !== undefined)
          .map((s) => [s.id, (typeof s.value === "string" ? s.value : JSON.stringify(s.value)).slice(0, 160)]),
      ),
    };
  };

  const done: AnyTool<DoneReport> = tool({
    name: "done",
    kind: "finish",
    description:
      "The workflow does what they meant: one sentence on what you changed, and for each rule of the task model (by its number) the steps that build it, or not_built with why",
    input: DoneReport,
    // A long summary is cut, not refused (the YC design, Oct 25: 600 characters made done invalid).
    prepare: (raw) => {
      const input = unstring(raw) as { summary?: unknown } | undefined;
      const summary = input?.summary;
      return typeof summary === "string" && summary.length > 500
        ? { ...input, summary: `${summary.slice(0, 497)}...` }
        : input;
    },
    run: async (report) => {
      // A workflow changed since its last test is tested once more first, past MAX_TESTS: the gate reads the report, and
      // what is saved is what was tested (28 Oct YC → Sheet: three tests on earlier drafts, the saved one never ran,
      // and its first real run stopped at the run's AI limit).
      if (session.runTest && session.testedDraft !== JSON.stringify(session.draft.steps)) {
        await test(true);
      }
      const left = session.finish?.(report) ?? [];
      if (left.length > 0 && session.refusedDone < MAX_DONE_REFUSALS) {
        session.refusedDone++;
        return { output: { refused: "not finished yet", problems: left } };
      }
      // Code's checks pass: the critic reads it whole. Its gaps go back while done may be refused; then the review
      // lists them, and they never hold up the save.
      if (left.length === 0 && session.critic) {
        const gaps = await session.critic(report);
        if (gaps.length > 0 && session.refusedDone < MAX_DONE_REFUSALS) {
          session.refusedDone++;
          return {
            output: {
              refused: "a second look found gaps: fix them, or say in done why not (not_built, with why)",
              problems: gaps,
            },
          };
        }
        session.critique = gaps;
      }
      // Refused twice: saved with what is left listed for the user, never lost.
      session.gaps = left;
      return {
        output: left.length > 0 ? { finished: "with gaps the review lists", gaps: left } : "finished",
        finish: report,
      };
    },
  });

  // ---- The workflow as a file (Oct 25): read it, write it whole, or replace exact text in it, as an agentic IDE edits
  // code. Every write goes through the same checks as every other change (commit). Short forms are expanded by code.

  const canonical = workflowFile;

  // How often it runs, as the model may write it: "manual", a cron, { schedule }, { folder, glob }, or the list itself.
  const whenOf = (when: unknown): unknown => {
    const w = when as { schedule?: string; folder?: string; glob?: string };
    if (when === "manual") return [{ type: "manual" }];
    if (typeof when === "string") return [{ type: "schedule", cron: when }];
    // A schedule's cron under another name (the YC design, Oct 25: { type: "schedule", expr: "0 9 * * *" }).
    if (Array.isArray(when))
      return when.map((w) => {
        const e = w as { type?: string; cron?: string; expr?: string; schedule?: string; expression?: string };
        return (e?.type === "schedule" || e?.type === "cron") && !e.cron
          ? {
              ...e,
              type: "schedule",
              cron: e.expr ?? e.schedule ?? e.expression,
              expr: undefined,
              schedule: undefined,
              expression: undefined,
            }
          : w;
      });
    if (w?.schedule) return [{ type: "schedule", cron: w.schedule }];
    if (w?.folder) return [{ type: "folder_watch", dir: w.folder, ...(w.glob ? { glob: w.glob } : {}) }];
    return when;
  };

  // One step as written, with its short forms made real: { do: "click" } → channel and action, page names → addresses,
  // { like | place | css } targets → locators, "<id:s4>" → a document's id, AI steps' and loops' types filled in. A
  // `why` on a step is the reason the review shows, kept apart (the workflow has no such field).
  const expandStep = (
    raw: unknown,
    out: {
      problems: string[];
      taken: string[];
      unverified: string[];
      whys: Map<string, string>;
      lists: Map<string, unknown>;
    },
  ): unknown => {
    // A step named by its id: that step as it is, moved here (the YC design, Oct 25, wrote a loop's steps so).
    if (typeof raw === "string") {
      const found = anyStep(raw.trim());
      if (!found) out.problems.push(`"${raw}" in a steps list: ${unknown(raw.trim())}`);
      return found ?? raw;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const { why, ...s } = raw as Record<string, unknown>;
    // The full form written with the short form's names (the YC design, Oct 25: type "ai_step", type "condition",
    // action "read_all"): what they say.
    if (typeof s.type === "string" && /^(ai|ai_step|llm_step)$/.test(s.type)) s.type = "llm";
    if (s.type === "loop") Object.assign(s, { type: "control", kind: "loop" });
    if (typeof s.type === "string" && /^(branch|condition|if)$/.test(s.type))
      Object.assign(s, { type: "control", kind: "branch" });
    // A connected app's step written without `do` ({ id, tool, arguments }, with or without type "action"): what it is
    // (28 Oct: the YC design wrote it so nine times and was refused each time for "type: Invalid discriminator").
    if (
      typeof s.tool === "string" &&
      !("do" in s) &&
      !("channel" in s) &&
      (s.type === undefined || s.type === "action")
    ) {
      s.do = "app";
      delete s.type;
    }
    const short = typeof s.action === "string" ? DO[s.action] : undefined;
    if (s.type === "action" && !("do" in s) && short && short[1] !== s.action) {
      s.do = s.action;
      delete s.type;
      delete s.channel;
      delete s.action;
    }
    const newId = (prefix: string) => {
      const id = nextId(prefix, out.taken);
      out.taken.push(id);
      return id;
    };
    const keepWhy = (id: unknown) => {
      if (typeof why === "string" && why && typeof id === "string") out.whys.set(id, why);
    };
    if (s.type === "trigger") {
      if ("when" in s) s.when = whenOf(s.when);
      // An input's type as a word ({ type: "number" }) or the input as one ("text"): what they mean (28 Oct, the YC
      // design wrote both and was refused four times, told "a step, type: Invalid input").
      if (s.inputs && typeof s.inputs === "object" && !Array.isArray(s.inputs))
        s.inputs = Object.fromEntries(
          Object.entries(s.inputs as Record<string, unknown>).map(([name, input]) => {
            const spec: Record<string, unknown> =
              typeof input === "string" ? { type: input } : { ...(input as Record<string, unknown>) };
            if ("type" in spec) spec.type = typeFrom(spec.type);
            return [name, spec];
          }),
        );
      // The runner doesn't fill templates in defaults (Checkpoint 4), as the input tool says.
      for (const [name, input] of Object.entries((s.inputs ?? {}) as Record<string, { default?: unknown }>))
        if (JSON.stringify(input?.default ?? "").includes("{{"))
          out.problems.push(
            `inputs.${name}: a default can't be a {{…}} value: use {{today}} in the step itself ({{today|D MMM}}), no input needed`,
          );
      keepWhy(s.id);
      return s;
    }
    // A block as the agent may write it: { "block": "Open the jobs sheet", "steps": [ … ] } (R5).
    if (typeof s.block === "string" && Array.isArray(s.steps)) {
      const { block, ...rest } = s;
      Object.assign(s, { ...rest, type: "control", kind: "group", intent: block });
      delete s.block;
    }
    // Loops, branches and blocks: their inner steps too.
    if (s.type === "control" || "over" in s || ("if" in s && Array.isArray(s.steps))) {
      const kind = s.kind ?? ("over" in s ? "loop" : "branch");
      const step: Record<string, unknown> = { ...s, type: "control", kind };
      step.id ??= newId(kind === "loop" ? "l" : "b");
      step.steps = Array.isArray(s.steps) ? s.steps.map((x) => expandStep(x, out)) : [];
      if (kind === "branch") step.else = Array.isArray(s.else) ? s.else.map((x) => expandStep(x, out)) : [];
      if (kind === "loop") {
        const item = typeof s.item === "string" ? { name: s.item } : ((s.item ?? {}) as Record<string, unknown>);
        step.item = {
          ...item,
          type: item.type
            ? typeFrom(item.type)
            : (out.lists.get(
                String(s.over ?? "")
                  .replace(/^\{\{|\}\}$/g, "")
                  .trim(),
              ) ??
              itemType(String(s.over ?? "")) ?? { type: "text" }),
        };
        step.intent ??= `for each ${item.name ?? "item"} in ${s.over}`;
      } else step.intent ??= kind === "group" ? "Steps" : "if it holds";
      keepWhy(step.id);
      return step;
    }
    // AI steps: { instruction, inputs, output } is enough.
    if (s.type === "llm" || "instruction" in s) {
      const step: Record<string, unknown> = { ...s, type: "llm" };
      step.id ??= newId("ai");
      // A name written bare is the value it names, as the ai_step tool takes it (the second YC design, 28 Oct: inputs
      // ["yc_page"] would have given the model the word "yc_page"); words with spaces stay words.
      if (Array.isArray(s.inputs))
        step.inputs = s.inputs.map((i) =>
          typeof i === "string" && /^[A-Za-z_][\w.]*$/.test(i.trim()) ? `{{${i.trim()}}}` : i,
        );
      step.intent ??= String(s.instruction ?? "").slice(0, 80);
      const output = typeof s.output === "string" ? { name: s.output } : ((s.output ?? {}) as Record<string, unknown>);
      step.output = { ...output, type: output.type === undefined ? { type: "text" } : typeFrom(output.type) };
      const made = (step.output as { name?: unknown; type: { type?: string; items?: unknown } }).type;
      if (made.type === "list") out.lists.set(String(output.name), made.items);
      const vague = vaguePick(String(s.instruction ?? ""));
      if (vague) out.problems.push(`${step.id}: ${vague}`);
      keepWhy(step.id);
      return step;
    }
    // A step written with `do`: code makes it what it does.
    if ("do" in s) {
      const id = typeof s.id === "string" ? s.id : newId("s");
      // The step's own fields aren't the action's values (the fifth YC design, Oct 25: "id" and "requires_approval"
      // landed in its args): they are put on the step after it is built.
      const KEPT = ["id", "type", "requires_approval", "ask", "wait", "check", "timeout_ms", "on_fail", "output"];
      const values = Object.fromEntries(Object.entries(s).filter(([k]) => !KEPT.includes(k)));
      // { output: { name } } on a do step is its save_as.
      const named = (s.output as { name?: unknown } | undefined)?.name;
      if (values.save_as === undefined && typeof named === "string") values.save_as = named;
      // An empty or missing intent is said for it (Oct 27: a write with "intent": "" on ten steps was refused ten times).
      if (typeof values.intent !== "string" || !values.intent.trim()) {
        const t = values.target as { like?: string; place?: string; css?: string; name?: string } | undefined;
        const on = t?.name ?? t?.css ?? (t?.like ? `like ${t.like}` : t?.place ? `at ${t.place}'s place` : "");
        values.intent = `${String(s.do).replace(/_/g, " ")}${on ? ` ${on}` : ""}${values.page ? ` ${values.page}` : ""}`;
      }
      const spec = StepSpec.safeParse({ intent: `${s.do}`, ...values });
      if (!spec.success) {
        out.problems.push(
          `${id}: ${spec.error.issues.map((i) => `${i.path.join(".") || "step"}: ${i.message}`).join("; ")}`,
        );
        return s;
      }
      const built = compile(spec.data, id);
      if ("error" in built) {
        out.problems.push(`${id}: ${built.error}`);
        return s;
      }
      const called = built.step.args as { tool?: string; arguments?: Record<string, unknown> } | undefined;
      const calledTool = session.apps.flatMap((a) => a.tools).find((t) => t.name === called?.tool);
      if (calledTool && called?.arguments)
        out.problems.push(...rowProblems(calledTool, called.arguments, out.lists).map((p) => `${id}: ${p}`));
      if (built.unverified) out.unverified.push(id);
      const keep = Object.fromEntries(
        KEPT.filter((k) => k !== "id" && k !== "type" && k !== "output" && k in s).map((k) => [k, s[k]]),
      );
      keepWhy(id);
      return { ...built.step, ...keep };
    }
    // A full action step: its page and target short forms only.
    if (s.type === "action") {
      const step: Record<string, unknown> = { ...s };
      const args = { ...((s.args ?? {}) as Record<string, unknown>) };
      if (s.action === "navigate" && typeof args.page === "string") {
        const url = session.pages.get(args.page);
        if (!url)
          out.problems.push(`${s.id}: no page ${args.page}. Pages: ${[...session.pages.keys()].join(", ") || "none"}`);
        else {
          args.url = url;
          delete args.page;
        }
      }
      if (s.channel === "mcp") {
        const filled = withIds(args.arguments ?? {}, session.apps);
        if (!filled.ok) out.problems.push(`${s.id}: ${filled.error}`);
        else args.arguments = filled.value;
      }
      step.args = args;
      const target = s.target as Record<string, unknown> | undefined;
      if (target && ("like" in target || "place" in target || "css" in target)) {
        const parsed = TargetSpec.safeParse(target);
        const found = parsed.success
          ? locatorOf(parsed.data)
          : { error: "a target is { like }, { place }, { css } or a locator" };
        if ("error" in found) out.problems.push(`${s.id}: ${found.error}`);
        else {
          step.target = found.locator;
          if (found.unverified && typeof s.id === "string") out.unverified.push(s.id);
        }
      }
      keepWhy(s.id);
      return step;
    }
    return s;
  };

  // The agent reads the workflow masked (a private word is ███), so what it writes back has ███ where those words were.
  // Code puts each back from the draft: by the same step and field, else by the one value that masks so. A masked value
  // it can't place is refused, never saved: ███ would be typed into the page.
  const unmasked = (written: unknown, problems: string[]): unknown => {
    const hidden = (text: string) => maskText(text, session.maskTerms ?? []).text;
    // A step (anything with an id) starts its own path, so a step moved or wrapped in a loop keeps its values.
    const at = (v: unknown, path: string) => {
      const id = v && typeof v === "object" && !Array.isArray(v) ? (v as { id?: unknown }).id : undefined;
      return typeof id === "string" ? id : path;
    };
    const byPath = new Map<string, string>();
    const byMasked = new Map<string, Set<string>>();
    const collect = (v: unknown, path: string) => {
      if (typeof v === "string") {
        const m = hidden(v);
        if (m === v) return;
        byPath.set(path, v);
        byMasked.set(m, (byMasked.get(m) ?? new Set()).add(v));
      } else if (Array.isArray(v)) for (const [i, x] of v.entries()) collect(x, at(x, `${path}.${i}`));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) collect(x, at(x, `${path}.${k}`));
    };
    collect(session.draft.steps, "steps");
    const put = (v: unknown, path: string): unknown => {
      if (typeof v === "string") {
        if (!v.includes(MASK)) return v;
        const same = byPath.get(path);
        if (same !== undefined && hidden(same) === v) return same;
        const only = byMasked.get(v);
        if (only?.size === 1) return [...only][0];
        problems.push(
          `${path}: "${v}" holds ${MASK}, a private value you can't see: keep that field as it was (read_workflow), or take the value from a step or an input`,
        );
        return v;
      }
      if (Array.isArray(v)) return v.map((x, i) => put(x, at(x, `${path}.${i}`)));
      if (v && typeof v === "object")
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, put(x, at(x, `${path}.${k}`))]));
      return v;
    };
    return put(written, "steps");
  };

  // A schema problem's place by the step it is in, not its position (the YC design read "steps.9.steps.1.steps.9"):
  // "s12 (web.read), action" for steps.4.action.
  const placeOf = (steps: unknown[], path: PropertyKey[]): string => {
    if (path[0] !== "steps") return path.join(".") || "workflow";
    let node: unknown = { steps };
    let step = "";
    let rest: string[] = [];
    for (const key of path) {
      node = (node as Record<string, unknown> | undefined)?.[key as string];
      rest.push(String(key));
      const s = node as { id?: unknown; type?: unknown; channel?: unknown; action?: unknown } | undefined;
      // A step is a node with an id or a step's type; a value's own `type` (an input's, a when's) is a place in one.
      const isStep = typeof s?.id === "string" || ["trigger", "action", "llm", "control"].includes(String(s?.type));
      if (s && typeof s === "object" && !Array.isArray(s) && isStep) {
        const kind = s.channel ? ` (${s.channel}.${s.action})` : "";
        step = `${typeof s.id === "string" ? s.id : "a step"}${kind}`;
        rest = [];
      }
    }
    return step ? `${step}${rest.length > 0 ? `, ${rest.join(".")}` : ""}` : path.join(".");
  };

  // A workflow as written, made real and checked; kept only if every check passes.
  const writeWorkflow = (written: unknown, why: string, whys: Record<string, string> = {}) => {
    const given = unstring(written);
    // Sent as text that isn't JSON (the YC design sent one five times, told only "write it as { steps }"): where it broke.
    if (typeof given === "string") {
      try {
        JSON.parse(given);
      } catch (error) {
        const at = Number(/position (\d+)/.exec((error as Error).message)?.[1] ?? -1);
        const around = at >= 0 ? `, near ${JSON.stringify(given.slice(Math.max(0, at - 80), at + 40))}` : "";
        return {
          output: {
            ok: false,
            problems: [
              `the workflow was sent as text that isn't valid JSON (${(error as Error).message})${around}: send it as an object { "steps": [ … ] }, not a string`,
            ],
          },
        };
      }
    }
    const body = Array.isArray(given) ? { steps: given } : ((given ?? {}) as Record<string, unknown>);
    if (!Array.isArray(body.steps)) {
      return { output: { ok: false, problems: ['write the workflow as { "steps": [ … ] } (read_workflow shows it)'] } };
    }
    const out = {
      problems: [] as string[],
      taken: [] as string[],
      unverified: [] as string[],
      whys: new Map<string, string>(),
      lists: new Map<string, unknown>(),
    };
    // "success" is the workflow's own field (its final checks), never a step (the third YC design wrote it as a step,
    // then as a word in the list, and was refused for it until it stopped).
    const isSuccess = (x: unknown) =>
      x === "success" || (Boolean(x) && typeof x === "object" && (x as { id?: unknown }).id === "success");
    const plain = (unmasked(body.steps, out.problems) as unknown[]).filter((x) => !isSuccess(x));
    let steps = plain.map((s) => expandStep(s, out)) as Record<string, unknown>[];
    // The trigger stays first: a workflow written without it keeps the one it had.
    if (steps[0]?.type !== "trigger") steps = [session.draft.steps[0] as unknown as Record<string, unknown>, ...steps];
    if (out.problems.length > 0) return { output: { ok: false, problems: out.problems } };
    // What code owns stays as it is: the id, the name, the version, the description (the user's) and the history.
    const parsed = Skill.safeParse({
      ...session.draft,
      steps,
      success: Array.isArray(body.success) ? body.success : session.draft.success,
    });
    if (!parsed.success) {
      return {
        output: {
          ok: false,
          problems: parsed.error.issues.slice(0, 12).map((i) => hint(`${placeOf(steps, i.path)}: ${i.message}`)),
        },
      };
    }
    // Every step added, changed or removed carries the why (its own, else the change's).
    const json = (skill: Skill) =>
      new Map([...walkSteps(skill.steps)].map(({ step }) => [step.id, JSON.stringify(step)]));
    const before = json(session.draft);
    const after = json(parsed.data);
    const touched = [
      ...[...after].filter(([id, s]) => before.get(id) !== s).map(([id]) => id),
      ...[...before.keys()].filter((id) => !after.has(id)),
    ];
    const result = commit(parsed.data, why, touched, out.unverified);
    const output = result.output as { ok?: boolean } & Record<string, unknown>;
    if (output.ok) {
      // A why by id, for any step: one this write changes, or one an earlier write left out (the third YC design,
      // Oct 25, had no way to explain the typing steps it had already replaced, and sent done six times).
      for (const [id, reason] of [...out.whys, ...Object.entries(whys)]) {
        if (!reason.trim()) continue;
        session.whys.set(id, reason);
        session.sinceTest.set(id, reason);
      }
      // The recorded steps this write left out, so the agent knows what its why now explains.
      const recorded = new Set([...walkSteps(session.original.steps)].map(({ step }) => step.id));
      const removed = [...before.keys()].filter((id) => !after.has(id) && recorded.has(id));
      if (removed.length > 0) output.recorded_steps_left_out = removed;
    }
    return result;
  };

  // The nearest real line to text that didn't match, so the next try copies it exactly.
  const nearest = (text: string, wanted: string): string => {
    const first = wanted.trim().split("\n")[0]?.trim() ?? "";
    const lines = text.split("\n");
    let best = "";
    let score = 0;
    for (const line of lines) {
      const l = line.trim();
      let n = 0;
      while (n < Math.min(l.length, first.length) && l[n] === first[n]) n++;
      if (n > score) {
        score = n;
        best = line;
      }
    }
    return best ? ` The nearest line: ${JSON.stringify(best)}` : "";
  };

  const fileTools: AnyTool<DoneReport>[] = [
    tool({
      name: "read_workflow",
      kind: "look",
      description:
        "The workflow as JSON, exactly as edit_workflow matches it: the whole of it, or one step by id (step). Read before you edit",
      input: z.object({ step: z.string().optional() }),
      prepare: unstring,
      run: ({ step }) => {
        if (!step) return { output: canonical(session.draft) };
        const found = findStep(session.draft, step === "trigger" ? "start" : step);
        return { output: found ? JSON.stringify(found, null, 2) : unknown(step) };
      },
    }),
    tool({
      name: "write_workflow",
      kind: "edit",
      description:
        'Replace the whole workflow: { "steps": [ … ] } (and "success" if you change the final checks), with the trigger first. Every step it doesn\'t list is removed: for one step or a value, use edit_workflow. For a plan or a big restructure. Short forms are fine: { "do": "click", "target": { "like": "s3" } }, { "do": "open", "page": "s9" }, { "do": "app", "tool": "…", "arguments": { … } }, an AI step as { "instruction", "inputs", "output" }, a loop as { "over": "{{list}}", "item": "job", "steps": [ … ] }, and a "why" on any step for the review. Every write is checked; a failed check changes nothing and says what to fix',
      // An object in the schema, so the model sends one (the fourth YC design, Oct 25: `workflow` as "anything" was sent
      // as a JSON string 12 times, broken each time at the same nesting). Text is still read, and its error said.
      input: z.object({
        workflow: z
          .union([
            z.object({ steps: z.array(z.unknown()), success: z.array(z.unknown()).optional() }).passthrough(),
            z.array(z.unknown()),
            z.string(),
          ])
          .describe('the workflow as a JSON object { "steps": [ … ] }, never a string'),
        why: FileWhy,
        whys: Whys,
      }),
      prepare: unstring,
      run: ({ workflow, why, whys }) => writeWorkflow(workflow, why, whys),
    }),
    tool({
      name: "edit_workflow",
      kind: "edit",
      description:
        "Change part of the workflow by exact text: edits [{ old, new }], applied in order, all or none. Each old must appear exactly once in what read_workflow shows (copy it, with enough lines around it to be unique); new replaces it (empty removes it). For small changes: a value, one step, a field",
      input: z.object({
        edits: z.union([
          z.array(z.object({ old: z.string().min(1), new: z.string() })).min(1),
          z.object({ old: z.string().min(1), new: z.string() }),
        ]),
        why: FileWhy,
        whys: Whys,
      }),
      prepare: unstring,
      run: ({ edits, why, whys }) => {
        // Matched on the text as the agent read it (masked); writeWorkflow puts the private values back. A step inside a
        // block is folded to its id in that text: an edit that quotes it (read_workflow { step }) is matched on the
        // workflow with every step in full.
        const mask = (t: string) => maskText(t, session.maskTerms ?? []).text;
        const list = Array.isArray(edits) ? edits : [edits];
        const short = mask(canonical(session.draft));
        let text = list.every((e) => short.includes(e.old)) ? short : mask(canonical(session.draft, { full: true }));
        for (const [i, e] of (Array.isArray(edits) ? edits : [edits]).entries()) {
          const count = text.split(e.old).length - 1;
          if (count !== 1) {
            return {
              output: {
                ok: false,
                problems: [
                  count === 0
                    ? `edit ${i + 1}: its old text isn't in the workflow (read_workflow shows it exactly).${nearest(text, e.old)}`
                    : `edit ${i + 1}: its old text appears ${count} times: include more lines around it so it is unique`,
                ],
              },
            };
          }
          text = text.replace(e.old, () => e.new);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          const at = Number(/position (\d+)/.exec((error as Error).message)?.[1] ?? -1);
          const around = at >= 0 ? `: near ${JSON.stringify(text.slice(Math.max(0, at - 60), at + 60))}` : "";
          return {
            output: {
              ok: false,
              problems: [`after the edits it isn't valid JSON (${(error as Error).message})${around}`],
            },
          };
        }
        return writeWorkflow(parsed, why, whys);
      },
    }),
  ];

  const tools: AnyTool<DoneReport>[] = [
    tool({
      name: "accept",
      kind: "edit",
      description:
        "Use a change code prepared from the recording (a proposal, by id): repeat steps for every item, today's date, an item of a list, open a page directly. Say why it fits what they meant",
      input: z.object({ proposal: z.string(), why: Why }),
      prepare: unstring,
      run: ({ proposal, why }) => {
        const p = session.proposals.get(proposal);
        if (!p)
          return {
            output: {
              ok: false,
              problems: [`no proposal ${proposal}. Proposals: ${[...session.proposals.keys()].join(", ") || "none"}`],
            },
          };
        if (session.decisions.has(proposal))
          return { output: { ok: false, problems: [`${proposal} is decided already`] } };
        if (!p.runnable || p.edits.length === 0) {
          session.decisions.set(proposal, { decision: "accept", why });
          // Checkpoint 4: "nothing to change" was read as done, and the steps still found today's items by their text.
          return {
            output: {
              ok: true,
              note: p.runnable
                ? `nothing prepared to apply: build it yourself: ${BUILD_IT[p.kind] ?? "with the tools"}`
                : "noted for the review: replay can't do this yet",
            },
          };
        }
        const result = apply(p.edits, why, p.steps);
        if ((result.output as { ok: boolean }).ok) session.decisions.set(proposal, { decision: "accept", why });
        return result;
      },
    }),
    tool({
      name: "reject",
      kind: "edit",
      description: "Say a proposal doesn't fit what they meant, and why (it is shown in the review)",
      input: z.object({ proposal: z.string(), why: z.string().min(1) }),
      prepare: unstring,
      run: ({ proposal, why }) => {
        if (!session.proposals.has(proposal)) return { output: { ok: false, problems: [`no proposal ${proposal}`] } };
        session.decisions.set(proposal, { decision: "reject", why });
        return { output: { ok: true } };
      },
    }),
    tool({
      name: "remove",
      kind: "edit",
      description:
        "Remove steps that aren't part of the task (a click that changed nothing, a detour), with why: the user sees it",
      input: z.object({
        steps: Ids,
        why: Why,
      }),
      prepare: unstring,
      run: ({ steps, why }) => {
        const missing = steps.find((s) => !known(s));
        if (missing) return { output: { ok: false, problems: [unknown(missing)] } };
        return apply(
          steps.map((s): EditInput => ({ op: "remove", step: s })),
          why,
          steps,
        );
      },
    }),
    tool({
      name: "restore",
      kind: "edit",
      description: "Put back a step code left out as noise (the list is in your first message), with why",
      input: z.object({ step: z.string(), why: Why }),
      prepare: unstring,
      run: ({ step, why }) => {
        const gone = session.dropped.get(step);
        if (!gone)
          return {
            output: {
              ok: false,
              problems: [`no left-out step ${step}. Left out: ${[...session.dropped.keys()].join(", ") || "none"}`],
            },
          };
        const at = known(gone.after) ? { after: gone.after } : { after: lastTop() };
        const result = apply([{ op: "insert", at, step: gone.step as Record<string, unknown> }], why, [step]);
        if ((result.output as { ok: boolean }).ok) session.dropped.delete(step);
        return result;
      },
    }),
    tool({
      name: "add",
      kind: "edit",
      description:
        'Add any step: { do, intent, target?, values }. do: open, click, type, select, press, read, read_all, read_sheet, wait, upload, find_files, move_file, pick_row, open_app, press_in_app, type_in_app, menu (or channel.action), or app (a connected app\'s tool: { do: "app", tool, arguments }, no target). open takes page: a step that opened it or a tab name ("s1", "KPI Sheet"); code writes the address. target: { like: "s3" } for a control they used, or { role, name } for a new one (unverified until the test run finds it). Where: after, before or into',
      input: z.object({ step: StepSpec, ...Where, why: Why }),
      // A step sent with its fields beside where it goes, not inside step (A, 24 Oct: four AI steps and a loop, all
      // refused as "step: expected object"): put inside step, an AI step or a loop marked so it goes to its tool.
      prepare: (raw) => {
        const input = unstring(raw);
        if (!input || typeof input !== "object" || Array.isArray(input) || "step" in input) return input;
        const { after, before, into, why, ...rest } = input as Record<string, unknown>;
        const kind = "instruction" in rest ? "ai_step" : "over" in rest && "steps" in rest ? "loop" : undefined;
        if (!kind && !("do" in rest)) return input;
        return { step: kind ? { do: kind, ...rest } : rest, after, before, into, why };
      },
      run: ({ step, after, before, into, why }, ctx) => {
        for (const id of [after, before, into])
          if (id && !known(id)) return { output: { ok: false, problems: [unknown(id)] } };
        if ("over" in step && "steps" in step) {
          const repeat = loop.input.safeParse({
            ...step,
            ...(before ? { before } : { after: after ?? lastTop() }),
            why,
          });
          if (!repeat.success)
            return {
              output: { ok: false, problems: repeat.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
            };
          return loop.run(repeat.data, ctx);
        }
        // An AI step sent to add (Checkpoint 5: A, B, D2 and E all did; D2's came back as an extract with an instruction).
        if ("instruction" in step) {
          const output = step.output ?? (step.save_as ? { name: step.save_as } : undefined);
          const ai = aiStep.input.safeParse({ ...step, output, after: after ?? lastTop(), why });
          if (!ai.success)
            return { output: { ok: false, problems: ai.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) } };
          return aiStep.run(ai.data, ctx);
        }
        const id = nextId("s");
        const built = compile(step, id);
        if ("error" in built) return { output: { ok: false, problems: [built.error] } };
        return apply(
          [{ op: "insert", at: position({ after, before, into }), step: built.step }],
          why,
          [id],
          built.unverified ? [id] : [],
        );
      },
    }),
    tool({
      name: "change",
      kind: "edit",
      description:
        'Change a step: its intent, its values (args, merged; e.g. { text: "{{today}}" }), the page it opens (page: a step or tab name), its control (target: { like } or { role, name }), its tab, its check or wait, or save_as (its result becomes a variable)',
      input: z.object({
        step: z.string(),
        intent: z.string().optional(),
        args: z.record(z.string(), z.unknown()).optional(),
        target: TargetSpec.nullable().optional(),
        tab: z.string().optional(),
        check: z.record(z.string(), z.unknown()).optional(),
        wait: z.record(z.string(), z.unknown()).optional(),
        save_as: z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/)
          .optional(),
        page: z.string().optional(),
        // How often it runs, sent to change (the D eval, 24 Oct: five calls with a when that was dropped unseen).
        when: z.unknown().optional(),
        // An AI step's instruction and what it reads (A, 24 Oct: no way to change them, so it removed them, then the
        // steps that used their answers were in the way).
        instruction: z.string().min(1).optional(),
        inputs: z.array(z.string()).optional(),
        why: Why,
      }),
      // "None" or "null" for the target is no target: read the whole page (C, 24 Oct: five calls refused; D's checkpoint
      // 6: six).
      prepare: (raw) => {
        const input = unstring(raw);
        if (!input || typeof input !== "object" || Array.isArray(input)) return input;
        const o = input as Record<string, unknown>;
        return typeof o.target === "string" && /^\s*(none|null|nil)?\s*$/i.test(o.target) ? { ...o, target: null } : o;
      },
      run: ({
        step: id,
        intent,
        args: given,
        target,
        tab,
        check,
        wait,
        save_as,
        page,
        when: sent,
        instruction,
        inputs,
        why,
      }) => {
        const url = page === undefined ? undefined : session.pages.get(page);
        if (page !== undefined && !url) {
          return {
            output: {
              ok: false,
              problems: [`no page ${page}. Pages: ${[...session.pages.keys()].join(", ") || "none"}`],
            },
          };
        }
        const args = url ? { ...(given ?? {}), url } : given;
        const step = anyStep(id);
        if (!step || !known(id)) return { output: { ok: false, problems: [unknown(id)] } };
        const edits: EditInput[] = [];
        let unverified = false;
        // How often it runs is the trigger's: a change to it that says when is one (Checkpoint 4: nine calls on this).
        const when = sent ?? args?.when ?? args?.schedule ?? args?.cron;
        if (step.type === "trigger" && when !== undefined) return setWhen(when, why);
        if (intent) edits.push({ op: "set", step: id, field: "intent", value: intent });
        if (isLlm(step)) {
          const vague = instruction ? vaguePick(instruction) : undefined;
          if (vague) return { output: { ok: false, problems: [vague] } };
          if (instruction) edits.push({ op: "set", step: id, field: "instruction", value: instruction });
          if (inputs) edits.push({ op: "set", step: id, field: "inputs", value: inputs });
        }
        if (!isAction(step) && (args || target || tab || check || wait || save_as)) {
          const ai = isLlm(step) ? ': an AI step changes its instruction or inputs (inputs: ["{{name}}"])' : "";
          return {
            output: {
              ok: false,
              problems: [`${id} is a ${step.type} step: only actions have values, a control, a tab or checks${ai}`],
            },
          };
        }
        if (isAction(step)) {
          if (args) edits.push({ op: "set", step: id, field: "args", value: { ...step.args, ...args } });
          if (check) edits.push({ op: "set", step: id, field: "check", value: check });
          if (wait) edits.push({ op: "set", step: id, field: "wait", value: wait });
          if (save_as)
            edits.push({
              op: "set",
              step: id,
              field: "output",
              value: {
                name: save_as,
                type: producedType({ ...step, args: { ...step.args, ...(args ?? {}) } } as never),
              },
            });
          // A read with no control reads the whole page (Checkpoint 5: C couldn't take a read's control away, and eight
          // changes "to read the whole page" kept reading { role: "cell" }).
          // A page opened by its address has no control (Checkpoint 5: D gave s2 a control 15 times, changing nothing).
          if (target && step.action === "navigate")
            return {
              output: {
                ok: false,
                problems: [
                  `${id} opens a page by its address and has no control: to click a link instead, add { do: "click", target } after the step before it and remove ${id}; to open an address an earlier step read, change its args.url to that {{value}}`,
                ],
              },
            };
          if (target === null) {
            if (step.action !== "extract")
              return { output: { ok: false, problems: [`${id}: only a read can do without a control`] } };
            edits.push({ op: "retarget", step: id, target: { fallbacks: ["main", "body"] } });
          } else if (target) {
            const found = locatorOf(target);
            if ("error" in found) return { output: { ok: false, problems: [found.error] } };
            edits.push({ op: "retarget", step: id, target: found.locator });
            unverified = unverified || found.unverified;
          }
          // First, so the other changes in this call apply on top of it (a replace built from the step as it was would
          // undo them).
          if (tab)
            edits.unshift({
              op: "replace",
              step: id,
              with: { ...step, ...(args ? { args: { ...step.args, ...args } } : {}), tab } as never,
            });
        }
        if (edits.length === 0)
          return {
            output: {
              ok: false,
              problems: [
                step.type === "trigger"
                  ? 'how often it runs is set with the trigger tool: call trigger with { when: { schedule: "0 9 * * *" } } (every day at 9:00)'
                  : "say what to change: intent, args, page, target, tab, check, wait or save_as",
              ],
            },
          };
        return apply(edits, why, [id], unverified ? [id] : []);
      },
    }),
    tool({
      name: "move",
      kind: "edit",
      description: "Move a step (with what is inside it): after, before or into a loop or branch",
      input: z.object({ step: z.string(), ...Where, why: Why }),
      prepare: unstring,
      run: ({ step, after, before, into, why }) => {
        for (const id of [step, after, before, into])
          if (id && !known(id)) return { output: { ok: false, problems: [unknown(id)] } };
        return apply([{ op: "move", step, to: position({ after, before, into }) }], why, [step]);
      },
    }),
    loop,
    branch,
    aiStep,
    tool({
      name: "trigger",
      kind: "edit",
      description:
        'How often it runs: "manual", { schedule: "0 9 * * *" } (a cron in the Mac\'s time), or { folder: "~/Downloads", glob: "*.pdf" }',
      input: z.object({
        when: z.union([
          z.literal("manual"),
          z.object({ schedule: z.string() }),
          z.object({ folder: z.string(), glob: z.string().optional() }),
        ]),
        why: Why,
      }),
      prepare: unstring,
      run: ({ when, why }) => setWhen(when, why),
    }),
    tool({
      name: "input",
      kind: "edit",
      description:
        "A value the run starts with (one that changes each time and no step can read): its name, type, a default and what it is",
      input: z.object({
        name: z.string().regex(/^[a-z][a-z0-9_]*$/),
        type: z.enum(["text", "number", "date", "boolean", "file"]),
        default: z.unknown().optional(),
        about: z.string().min(1),
        why: Why,
      }),
      prepare: unstring,
      run: ({ name, type, default: value, about, why }) => {
        if (typeof value === "string" && value.includes("{{"))
          return {
            output: {
              ok: false,
              problems: [
                `a default can't be a {{…}} value: use {{today}} in the step itself ({{today|D MMM}}), no input needed`,
              ],
            },
          };
        const inputs = {
          ...triggerOf(session.draft).inputs,
          [name]: { type: { type }, description: about, ...(value !== undefined ? { default: value } : {}) },
        };
        return apply([{ op: "set", step: "start", field: "inputs", value: inputs }], why, ["start"]);
      },
    }),
    tool({
      name: "look",
      kind: "look",
      description:
        "A step's full evidence (step), a proposal (proposal), the timeline between two steps (from, to), a connected app tool's arguments (app_tool), every tool of a connected app (app_tools: its name), or the workflow as it is now (nothing)",
      input: z.object({
        step: z.string().optional(),
        proposal: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        app_tool: z.string().optional(),
        app_tools: z.string().optional(),
      }),
      prepare: unstring,
      run: ({ step, proposal, from, to, app_tool, app_tools }) => {
        // Every tool of a connected app (the message lists only the few that fit the recorded work).
        if (app_tools) {
          const app = session.apps.find((a) => a.toolkit === app_tools.toLowerCase() || a.name === app_tools);
          return {
            output: app
              ? app.tools.map(
                  (t) =>
                    `${t.name}${t.readOnly ? " (reads only)" : ""}: ${t.description.split("\n")[0]?.slice(0, 120) ?? ""}`,
                )
              : `no connected app ${app_tools}. Apps: ${session.apps.map((a) => a.toolkit).join(", ") || "none"}`,
          };
        }
        if (app_tool) {
          const found = session.apps.flatMap((a) => a.tools).find((t) => t.name === app_tool);
          return {
            output: found
              ? {
                  name: found.name,
                  description: found.description,
                  reads_only: found.readOnly,
                  arguments: found.inputSchema,
                }
              : `no app tool ${app_tool}. The tools: ${session.apps.flatMap((a) => a.tools.map((t) => t.name)).join(", ") || "none (no app connected)"}`,
          };
        }
        if (proposal) return { output: session.proposals.get(proposal) ?? `no proposal ${proposal}` };
        if (step) return { output: session.evidence?.step(step) ?? anyStep(step) ?? unknown(step), untrusted: true };
        if (from || to) return { output: session.evidence?.timeline(from, to) ?? "no timeline", untrusted: true };
        return { output: outlineOf(session.draft) };
      },
    }),
    ask,
    tool({
      name: "test",
      kind: "look",
      description:
        "Test the workflow in the automation window, safely: it opens pages and reads, and only outlines what would type, send or change something. Returns what it did, found, couldn't find, and why",
      input: z.object({}),
      run: async () => ({ output: await test(), untrusted: true }),
    }),
    done,
  ];

  // The old names the model reaches for (Oct 19: wrap_in_branch sent as an edit op, wrap_in_loop never found).
  const alias = (name: string, to: AnyTool<DoneReport>): AnyTool<DoneReport> => ({
    ...to,
    name,
    description: `Same as ${to.name}. ${to.description}`,
  });
  tools.push(
    alias("wrap_in_loop", loop),
    alias("wrap_in_branch", branch),
    alias("add_llm_step", aiStep),
    alias("ask_user", ask),
    alias("finish", done),
    tool({
      name: "edit",
      kind: "look",
      description: "Not a tool any more: says which tools change the workflow",
      input: z.record(z.string(), z.unknown()),
      run: () => ({
        output: {
          use: "add, change, remove, move, loop, branch, ai_step, trigger, input (several calls per turn are fine)",
        },
      }),
    }),
  );
  // Every result the model reads is masked like the evidence: the outline, a step's record and a proposal's prepared
  // change hold recorded values (an email typed, a key copied, a Never or private word).
  const hide = (value: unknown): unknown =>
    typeof value === "string"
      ? maskText(value, session.maskTerms ?? []).text
      : Array.isArray(value)
        ? value.map(hide)
        : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hide(v)]))
          : value;
  // A call sent again as it was, on the same workflow, fails the same way (Checkpoint 5: A sent one add 20 times; B, D2
  // and E resent theirs 3 or 4 times): said so, so the model changes the call instead of sending it again.
  const failed = new Map<string, string>();
  // A field a tool doesn't have is dropped by its schema without a word, so the model sends it again and again (the D
  // eval, 24 Oct: change { step: "start", when } five times). Said with the result, with the fields it has.
  let ignored: string[] = [];
  // The trigger by the word "trigger", wherever a step is named (the D eval, 24 Oct: change and ask both sent it).
  const named = (input: unknown) => {
    const trigger = session.draft.steps.find((s) => s.type === "trigger")?.id;
    if (!trigger || known("trigger") || !input || typeof input !== "object" || Array.isArray(input)) return input;
    const fields = ["step", "after", "before", "into"] as const;
    const o = input as Record<string, unknown>;
    return { ...o, ...Object.fromEntries(fields.filter((f) => o[f] === "trigger").map((f) => [f, trigger])) };
  };
  const listed = options.mode === "file" ? [...fileTools, ...tools.filter((t) => FILE_MODE.has(t.name))] : tools;
  return listed.map((t) => ({
    ...t,
    prepare: (raw: unknown) => {
      const input = named(t.prepare ? t.prepare(raw) : raw);
      const shape = (t.input as { shape?: Record<string, unknown> }).shape;
      ignored =
        shape && input && typeof input === "object" && !Array.isArray(input)
          ? Object.keys(input).filter((k) => !(k in shape))
          : [];
      return input;
    },
    run: async (input: unknown, ctx: ToolContext) => {
      const key = `${t.name} ${JSON.stringify(input)} ${JSON.stringify(session.draft.steps)}`;
      const before = failed.get(key);
      if (before) {
        const again = `you sent this exact call before and it failed: ${before}. Sent again it fails the same way: change it (other values, another tool) or move on`;
        return { output: hide({ ok: false, problems: [again] }) };
      }
      const result = await t.run(input, ctx);
      const out = result.output as { ok?: boolean; problems?: string[]; refused?: string[]; note?: string } | undefined;
      if (out?.ok === false) failed.set(key, [...(out.problems ?? []), ...(out.refused ?? [])].join("; "));
      // A change that changed nothing changes nothing again (Checkpoint 5: C and D sent the same no-op 8 and 15 times).
      if (out?.note?.startsWith("nothing changed")) failed.set(key, out.note);
      const shape = (t.input as { shape?: Record<string, unknown> }).shape ?? {};
      const said =
        ignored.length > 0 && out && typeof out === "object"
          ? {
              ...out,
              ignored: `${ignored.join(", ")}: not ${t.name}'s (it takes ${Object.keys(shape).join(", ")}); left out`,
            }
          : result.output;
      return { ...result, output: hide(said) };
    },
  }));
}
