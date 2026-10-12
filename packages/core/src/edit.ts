// Workflow edits: pure, typed operations on a skill's step tree. The workflow editor, the repair agent and the design
// agent all change a workflow only through these, so a person's edit and an agent's edit are the same thing, checked
// the same way: the edited skill must parse and pass check.ts, or the edit is refused with the reasons.
// Steps are addressed by id, and ids are kept, so a run paused at a step can resume on the edited version.
import { z } from "zod";
import { Locator, type Skill, Skill as SkillSchema, type Step } from "./skill.ts";

// Where a step goes: next to a step, or first / last inside a loop or branch (`arm: "else"` for a branch's else).
export const Position = z.union([
  z.object({ before: z.string() }).strict(),
  z.object({ after: z.string() }).strict(),
  z
    .object({
      into: z.string(),
      arm: z.enum(["steps", "else"]).default("steps"),
      at: z.enum(["start", "end"]).default("end"),
    })
    .strict(),
]);
export type Position = z.infer<typeof Position>;

// The fields `set` may change, per kind of step. Anything else is a `replace`.
export const STEP_FIELDS = {
  trigger: ["intent", "when", "inputs"],
  action: ["intent", "requires_approval", "ask", "target", "args", "wait", "check", "output", "timeout_ms", "on_fail"],
  llm: ["intent", "requires_approval", "ask", "instruction", "inputs", "output"],
  loop: ["intent", "requires_approval", "ask", "over", "item", "max_items", "on_item_fail"],
  branch: ["intent", "requires_approval", "ask", "if"],
} as const;
const ALL_FIELDS = [...new Set(Object.values(STEP_FIELDS).flat())] as [string, ...string[]];

// A step as written in an edit. It is checked when the edited skill is parsed; a missing id is made up.
const StepJson = z.record(z.string(), z.unknown());

export const Edit = z.discriminatedUnion("op", [
  z.object({ op: z.literal("retarget"), step: z.string(), target: Locator }).strict(),
  z.object({ op: z.literal("insert"), at: Position, step: StepJson }).strict(),
  z.object({ op: z.literal("replace"), step: z.string(), with: StepJson }).strict(),
  z.object({ op: z.literal("remove"), step: z.string() }).strict(),
  z.object({ op: z.literal("move"), step: z.string(), to: Position }).strict(),
  // null removes an optional field (a wait, a check, an ask).
  z.object({ op: z.literal("set"), step: z.string(), field: z.enum(ALL_FIELDS), value: z.unknown() }).strict(),
  z
    .object({ op: z.literal("set_skill"), field: z.enum(["name", "description", "success"]), value: z.unknown() })
    .strict(),
]);
export type Edit = z.infer<typeof Edit>;
// An edit as written by a person or a model, before defaults are filled in.
export type EditInput = z.input<typeof Edit>;

// One line per operation, for agent prompts and the briefing.
export const EDIT_DOCS: Record<Edit["op"], string> = {
  retarget: "{ op: retarget, step, target: Locator }  point an action at a different control",
  insert: "{ op: insert, at: Position, step }  add a step (any kind but trigger); its id is made up if missing",
  replace: "{ op: replace, step, with }  swap a step for another; it keeps the old id",
  remove: "{ op: remove, step }  remove a step (not the trigger)",
  move: "{ op: move, step, to: Position }  move a step, with everything inside it",
  set: "{ op: set, step, field, value }  change one field; null removes an optional one",
  set_skill: "{ op: set_skill, field: name | description | success, value }  change the workflow itself",
};

export type EditResult = { ok: true; skill: Skill } | { ok: false; problems: string[] };

// Applies edits in order to a copy of the skill, then checks the result as a whole (so a step and the step that
// uses its output can be inserted in either order). The original is never changed.
export function applyEdits(skill: Skill, edits: EditInput[]): EditResult {
  const draft = structuredClone(skill) as Skill & Record<string, unknown>;
  const problems: string[] = [];
  edits.forEach((input, i) => {
    const parsed = Edit.safeParse(input);
    const problem = parsed.success
      ? applyOne(draft, parsed.data)
      : parsed.error.issues.map((issue) => `${issue.path.join(".") || "edit"}: ${issue.message}`).join("; ");
    if (problem) problems.push(edits.length > 1 ? `edit ${i + 1} (${input.op}): ${problem}` : problem);
  });
  if (problems.length > 0) return { ok: false, problems };
  const parsed = SkillSchema.safeParse(draft);
  if (parsed.success) return { ok: true, skill: parsed.data };
  return {
    ok: false,
    problems: parsed.error.issues.map((issue) =>
      issue.path.length > 0 ? `${placeOf(draft, issue.path)}: ${issue.message}` : labelPlaces(draft, issue.message),
    ),
  };
}

export function applyEdit(skill: Skill, edit: EditInput): EditResult {
  return applyEdits(skill, [edit]);
}

// What an edit does, in words: for transcripts and a version's history note.
export function describeEdit(edit: EditInput): string {
  switch (edit.op) {
    case "retarget":
      return `${edit.step}: target is now ${locatorText(edit.target)}`;
    case "insert":
      return `added ${String(edit.step.id ?? "a step")} (${String(edit.step.intent ?? edit.step.type)}) ${positionText(edit.at)}`;
    case "replace":
      return `replaced ${edit.step} (${String(edit.with.intent ?? edit.with.type)})`;
    case "remove":
      return `removed ${edit.step}`;
    case "move":
      return `moved ${edit.step} ${positionText(edit.to)}`;
    case "set":
      return edit.value === null ? `${edit.step}: removed ${edit.field}` : `${edit.step}: set ${edit.field}`;
    case "set_skill":
      return `set the workflow's ${edit.field}`;
  }
}

export function locatorText(target: Partial<Locator>): string {
  const what = target.name ?? target.label ?? target.text ?? target.attrs?.id ?? "?";
  return `${target.role ?? "element"} "${what}"`;
}

// ---- Applying one edit ----------------------------------------------------------------------------------------

type Container = { list: Step[]; index: number };
type Draft = Skill & Record<string, unknown>;

function applyOne(draft: Draft, edit: Edit): string | undefined {
  if (edit.op === "set_skill") {
    (draft as Record<string, unknown>)[edit.field] = edit.value;
    return undefined;
  }
  if (edit.op === "insert") {
    const step = withIds(draft, edit.step);
    if (step.type === "trigger") return "a workflow has one trigger, the first step";
    return place(draft, edit.at, step as unknown as Step);
  }

  const found = locate(draft.steps, edit.step);
  if (!found) return `no step ${edit.step}`;
  const step = found.list[found.index] as Step;
  const kind = kindOf(step);

  switch (edit.op) {
    case "retarget":
      if (step.type !== "action") return `${edit.step} is a ${kind} step: only actions have a target`;
      step.target = edit.target;
      return undefined;
    case "replace": {
      if (step.type === "trigger") return "the trigger can't be replaced: set its fields";
      const next = withIds(draft, { ...edit.with, id: step.id });
      if (next.type === "trigger") return "a workflow has one trigger, the first step";
      found.list[found.index] = next as unknown as Step;
      return undefined;
    }
    case "remove":
      if (step.type === "trigger") return "the trigger can't be removed";
      found.list.splice(found.index, 1);
      return undefined;
    case "move": {
      if (step.type === "trigger") return "the trigger is always the first step";
      const target = "before" in edit.to ? edit.to.before : "after" in edit.to ? edit.to.after : edit.to.into;
      if (idsIn([step]).includes(target)) return `${edit.step} can't be moved next to or into itself`;
      found.list.splice(found.index, 1);
      const problem = place(draft, edit.to, step);
      if (problem) found.list.splice(found.index, 0, step); // put it back; the edit is refused anyway
      return problem;
    }
    case "set": {
      const allowed = STEP_FIELDS[kind] as readonly string[];
      if (!allowed.includes(edit.field)) {
        return `a ${kind} step has no field ${edit.field} (it has ${allowed.join(", ")})`;
      }
      const record = step as unknown as Record<string, unknown>;
      if (edit.value === null) delete record[edit.field];
      else record[edit.field] = edit.value;
      return undefined;
    }
  }
}

function kindOf(step: Step): keyof typeof STEP_FIELDS {
  return step.type === "control" ? step.kind : step.type;
}

// Edits work on drafts whose new steps are not parsed yet (a branch without `else`), so these walks don't assume
// defaults.
function locate(steps: Step[] | undefined, id: string): Container | undefined {
  if (!steps) return undefined;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index] as Step;
    if (step.id === id) return { list: steps, index };
    if (step.type === "control") {
      const inner = locate(step.steps, id) ?? (step.kind === "branch" ? locate(step.else, id) : undefined);
      if (inner) return inner;
    }
  }
  return undefined;
}

function place(draft: Draft, at: Position, step: Step): string | undefined {
  if ("into" in at) {
    const found = locate(draft.steps, at.into);
    const parent = found?.list[found.index];
    if (!parent) return `no step ${at.into}`;
    if (parent.type !== "control") return `${at.into} is not a loop or branch: steps go before or after it`;
    if (at.arm === "else" && parent.kind !== "branch") return `${at.into} is a loop: it has no else`;
    const list = at.arm === "else" && parent.kind === "branch" ? parent.else : parent.steps;
    if (at.at === "start") list.unshift(step);
    else list.push(step);
    return undefined;
  }
  const anchor = "before" in at ? at.before : at.after;
  const found = locate(draft.steps, anchor);
  if (!found) return `no step ${anchor}`;
  if ("before" in at && found.list === draft.steps && found.index === 0) return "nothing goes before the trigger";
  found.list.splice("before" in at ? found.index : found.index + 1, 0, step);
  return undefined;
}

// Gives every step in a new subtree an id, when it has none, that no step in the draft uses.
function withIds(draft: Draft, step: Record<string, unknown>): Record<string, unknown> {
  const used = new Set(idsIn(draft.steps));
  let n = Math.max(0, ...[...used].map((id) => Number(/^s(\d+)$/.exec(id)?.[1] ?? 0)));
  const fill = (s: Record<string, unknown>): Record<string, unknown> => {
    const out = { ...s };
    if (typeof out.id !== "string" || !out.id) {
      do n++;
      while (used.has(`s${n}`));
      out.id = `s${n}`;
    }
    used.add(out.id as string);
    for (const arm of ["steps", "else"]) {
      if (Array.isArray(out[arm])) out[arm] = (out[arm] as Record<string, unknown>[]).map(fill);
    }
    return out;
  };
  return fill(step);
}

function idsIn(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((s: { id?: unknown; steps?: unknown; else?: unknown }) => [
    ...(typeof s?.id === "string" ? [s.id] : []),
    ...idsIn(s?.steps),
    ...idsIn(s?.else),
  ]);
}

const positionText = (at: z.input<typeof Position>): string =>
  "before" in at
    ? `before ${at.before}`
    : "after" in at
      ? `after ${at.after}`
      : `${at.at === "start" ? "first" : "last"} in ${at.into}${at.arm === "else" ? " (else)" : ""}`;

// ---- Saying where a problem is ----------------------------------------------------------------------------------

// "steps.3.steps.1.args.text" -> "s7 (args.text)": the id of the deepest step on the path, and what is left of it.
function placeOf(draft: unknown, path: readonly PropertyKey[]): string {
  let node: unknown = draft;
  let id: string | undefined;
  let rest: string[] = [];
  for (const key of path) {
    node = node && typeof node === "object" ? (node as Record<PropertyKey, unknown>)[key as string] : undefined;
    rest.push(String(key));
    const maybeId = node && typeof node === "object" && "type" in node ? (node as { id?: unknown }).id : undefined;
    if (typeof maybeId === "string") {
      id = maybeId;
      rest = [];
    }
  }
  if (!id) return path.join(".");
  return rest.length > 0 ? `${id} (${rest.join(".")})` : id;
}

// check.ts's messages start with a path ("steps.2.args: …"); name the step instead.
function labelPlaces(draft: unknown, message: string): string {
  const match = /^(steps(?:\.[\w-]+)*)(:.*)$/s.exec(message);
  if (!match?.[1]) return message;
  return `${placeOf(draft, match[1].split("."))}${match[2]}`;
}
