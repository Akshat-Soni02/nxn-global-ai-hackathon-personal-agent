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
  type Step,
  triggerOf,
  type VarType,
  walkSteps,
} from "@shadow/core";
import { z } from "zod";
import { requireApprovals } from "../../approvals.ts";
import { producedType } from "../../compile.ts";
import { maskText } from "../../mask.ts";
import { DoneReport } from "./contracts.ts";
import { isCron, stepProblems } from "./gate.ts";
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
// A control: the target of a recorded step ({ like: "s3" }), or one described by role and name (a new target: it
// stays unverified until the test run finds it on the live page).
const TargetSpec = z.union([z.object({ like: z.string() }), LocatorSpec]);
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
// The types the model writes (Checkpoint 5: "list", { title: "text" }, "list of text"), in core's own form.
const typeFrom = (t: unknown): unknown => {
  if (typeof t === "string") {
    const list = /^list(?: of (.+?)s?)?$/.exec(t.trim());
    const name = t.trim();
    return list ? { type: "list", items: typeFrom(list[1] ?? "object") } : { type: name === "string" ? "text" : name };
  }
  if (Array.isArray(t)) return { type: "list", items: typeFrom(t[0] ?? "object") };
  if (!t || typeof t !== "object") return { type: "text" };
  const { type, items, fields } = t as { type?: unknown; items?: unknown; fields?: Record<string, unknown> };
  if (type === "list") return { type, items: typeFrom(items ?? "object") };
  const named = type === undefined ? (t as Record<string, unknown>) : type === "object" ? fields : undefined;
  return named
    ? { type: "object", fields: Object.fromEntries(Object.entries(named).map(([k, v]) => [k, typeFrom(v)])) }
    : t;
};

export function designToolsV2(session: SessionV2): AnyTool<DoneReport>[] {
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
  const anyStep = (id: string): Step | undefined =>
    [...walkSteps(session.draft.steps), ...walkSteps(session.original.steps)].find(({ step }) => step.id === id)?.step;
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
        return stepProblems(step).filter((p) => !same || !p.includes("can't find its control"));
      });
    if (unrunnable.length > 0) return { output: { ok: false, problems: unrunnable } };
    const approved = requireApprovals(result.skill);
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
    session.draft = marked.ok ? marked.skill : approved.skill;
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

  // A step spec -> an action step: channel, action and type from `do`, the target copied or new, values as args.
  const compile = (
    spec: StepSpec,
    id: string,
  ): { step: Record<string, unknown>; unverified: boolean } | { error: string } => {
    const { do: verb, intent, target, tab, save_as: named, args, output, ...rest } = spec;
    // A result named the way ai_step names it, { output: { name } } (D2): saved, never sent as an arg.
    const save_as = named ?? (output as { name?: string } | undefined)?.name;
    const pair = DO[verb] ?? (/^(web|fs|data|ax)\.\w+$/.test(verb) ? (verb.split(".") as [string, string]) : undefined);
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
    if (target && "like" in target) {
      const like = anyStep(target.like);
      if (!like) return { error: unknown(target.like) };
      if (!isAction(like) || !like.target)
        return {
          error: `${target.like} has no control to copy (${isAction(like) && like.action === "navigate" ? "it opens a page" : "it has none"}): to read a whole page, read with no target`,
        };
      locator = like.target;
    } else if (target) {
      locator = { ...target, fallbacks: [] };
      unverified = true;
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
      inputs: z.array(z.string()).min(1),
      output: z.object({
        name: z.string().min(1),
        type: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
      }),
      why: Why,
    }),
    prepare: unstring,
    run: ({ after, intent, instruction, inputs, output, why }) => {
      if (!known(after)) return { output: { ok: false, problems: [unknown(after)] } };
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
      'Queue a question for the user: only what the recording, the goal and what they said can\'t answer. step: the step its answer changes ("start" for how often it runs and its inputs). Asked after you build, with the others, in one batch',
    input: z.object({
      question: z.string().min(1),
      why: z.string().min(1),
      step: z.string(),
      options: z.array(z.string()).max(6).optional(),
      default: z.string().optional(),
      confirm: z.boolean().optional(),
    }),
    prepare: unstring,
    run: ({ question, why, step, options, default: fallback, confirm }) => {
      if (step !== "start" && !known(step)) return { output: { ok: false, problems: [unknown(step)] } };
      const seen = session.evidence?.about(question) ?? [];
      if (seen.length > 0 && !confirm) {
        return {
          output: {
            not_asked: "The recording may already answer this: use it. If it doesn't, ask again with confirm: true.",
            seen,
          },
          untrusted: true,
        };
      }
      const key = (s: string, q: string) =>
        `${s}|${q
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim()}`;
      if (session.questions.some((q) => key(q.step, q.text) === key(step, question))) {
        return { output: { ok: true, note: "already queued" } };
      }
      const id = `q${session.questions.length + 1}`;
      session.questions.push({
        id,
        text: question,
        why,
        step,
        options: options ?? [],
        ...(fallback ? { default: fallback } : {}),
      });
      return { output: { queued: id, note: "asked after you build, with the other questions, in one batch" } };
    },
  });

  // The safe test run, inside the episode (the agent loop has no step between turns): at most MAX_TESTS per design.
  const test = async (): Promise<unknown> => {
    if (!session.runTest) {
      return "the test run can't run here (Chrome isn't connected to Shadow): finish, and the review will say it wasn't tested";
    }
    if (session.tests >= MAX_TESTS)
      return `tested ${MAX_TESTS} times already: finish, explaining in done what still fails`;
    session.tests++;
    const report = await session.runTest();
    session.lastTest = report;
    session.sinceTest = new Map();
    session.testedDraft = JSON.stringify(session.draft.steps);
    const ids = (status: string) => report.steps.filter((s) => s.status === status).map((s) => s.id);
    const why = (status: string) =>
      report.steps.filter((s) => s.status === status).map((s) => `${s.id}: ${s.error ?? status.replace("_", " ")}`);
    return {
      outcome: report.outcome,
      done: ids("done"),
      found: ids("found"),
      not_found: why("not_found"),
      failed: why("failed"),
      not_reached: ids("not_reached"),
    };
  };

  const done: AnyTool<DoneReport> = tool({
    name: "done",
    kind: "finish",
    description:
      "The workflow does what they meant: one sentence on what you changed, and for each rule of the task model (by its number) the steps that build it, or not_built with why",
    input: DoneReport,
    prepare: unstring,
    run: async (report) => {
      // A workflow changed since its last test is tested once more first: the gate reads the report.
      if (session.runTest && session.testedDraft !== JSON.stringify(session.draft.steps) && session.tests < MAX_TESTS) {
        await test();
      }
      const left = session.finish?.(report) ?? [];
      if (left.length > 0 && session.refusedDone < MAX_DONE_REFUSALS) {
        session.refusedDone++;
        return { output: { refused: "not finished yet", problems: left } };
      }
      // Refused twice: saved with what is left listed for the user, never lost.
      session.gaps = left;
      return {
        output: left.length > 0 ? { finished: "with gaps the review lists", gaps: left } : "finished",
        finish: report,
      };
    },
  });

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
        'Add any step: { do, intent, target?, values }. do: open, click, type, select, press, read, read_all, read_sheet, wait, upload, find_files, move_file, pick_row, open_app, press_in_app, type_in_app, menu (or channel.action). open takes page: a step that opened it or a tab name ("s1", "KPI Sheet"); code writes the address. target: { like: "s3" } for a control they used, or { role, name } for a new one (unverified until the test run finds it). Where: after, before or into',
      input: z.object({ step: StepSpec, ...Where, why: Why }),
      prepare: unstring,
      run: ({ step, after, before, into, why }, ctx) => {
        for (const id of [after, before, into])
          if (id && !known(id)) return { output: { ok: false, problems: [unknown(id)] } };
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
        target: TargetSpec.optional(),
        tab: z.string().optional(),
        check: z.record(z.string(), z.unknown()).optional(),
        wait: z.record(z.string(), z.unknown()).optional(),
        save_as: z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/)
          .optional(),
        page: z.string().optional(),
        why: Why,
      }),
      prepare: unstring,
      run: ({ step: id, intent, args: given, target, tab, check, wait, save_as, page, why }) => {
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
        const when = args?.when ?? args?.schedule ?? args?.cron;
        if (step.type === "trigger" && when !== undefined) return setWhen(when, why);
        if (intent) edits.push({ op: "set", step: id, field: "intent", value: intent });
        if (!isAction(step) && (args || target || tab || check || wait || save_as)) {
          return {
            output: {
              ok: false,
              problems: [`${id} is a ${step.type} step: only actions have values, a control, a tab or checks`],
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
          if (target) {
            if ("like" in target) {
              const like = anyStep(target.like);
              if (!like || !isAction(like) || !like.target)
                return { output: { ok: false, problems: [`${target.like} has no control to copy`] } };
              edits.push({ op: "retarget", step: id, target: like.target });
            } else {
              edits.push({ op: "retarget", step: id, target: { ...target, fallbacks: [] } });
              unverified = true;
            }
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
                  ? 'say how often it runs: trigger { when: { schedule: "0 9 * * 1" } } (B and E sent change with no when)'
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
        "A step's full evidence (step), a proposal (proposal), the timeline between two steps (from, to), or the workflow as it is now (nothing)",
      input: z.object({
        step: z.string().optional(),
        proposal: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
      prepare: unstring,
      run: ({ step, proposal, from, to }) => {
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
      run: async () => ({ output: await test() }),
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
  return tools.map((t) => ({
    ...t,
    run: async (input: unknown, ctx: ToolContext) => {
      const result = await t.run(input, ctx);
      return { ...result, output: hide(result.output) };
    },
  }));
}
