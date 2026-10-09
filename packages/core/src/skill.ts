// The skill format: the only contract between record and replay. Record writes skills, replay reads them.
// Changes here need sign-off from both sides. See "The workflow format" in docs/design.md.
//
// A skill is a workflow: a description (goal, what changes, what stays, never) and a TREE of steps. The first step
// is always the `trigger`: when the workflow runs and the inputs it starts with. Then each step is
//   action   one thing done in the browser, a Mac app, files or a script (deterministic)
//   llm      a transform: instruction + inputs -> one typed output. Never drives the UI
//   control  kind "loop" (its steps run for each item of a list) or kind "branch" (its steps run if a condition
//            holds, its else steps otherwise)
// Every step has an id, an intent (what it is for, used by the editor and by debug), `requires_approval`, and an
// optional `ask` (a question for the user before it runs). The workflow replay receives is final: the drill happened
// at record time.
//
// Variables (vars.ts): every value a step reads is a variable declared, with its type, by an earlier step: the
// trigger's `inputs`, an action's or llm step's `output`, an ask's `output`, or a loop's `item` (visible only inside
// the loop). Types: text, number, boolean, date, file ({ path, name, size, modified }), secret, list (items),
// object (fields). Names are unique in a skill. check.ts verifies every reference when a skill is parsed.
//
// References: {{name}}, then .field for an object's field or .N for a list position, e.g. {{invoice.amount}},
// {{emails.0.subject}}, {{invoice_file.path}}; {{today}} is built in (YYYY-MM-DD). A string that is exactly one
// reference keeps the value's type; inside longer text the value becomes text (objects and lists as JSON).
// A file value can be given wherever a path is expected. Moving or copying an empty list is a no-op.
//
// Args by action (the same, as data agents are briefed with: ACTION_DOCS in briefing.ts):
//   web.navigate  { url }
//   web.click     {}
//   web.type      { text, clear?: boolean }            focuses the target, then types it key by key
//   web.select    { option }                            visible option label
//   web.press     { key }                               e.g. "Enter", "Escape"
//   web.upload    { file }                              target is the <input type=file>, the control that opens it,
//                                                       or a drop zone; no native dialog either way
//   web.drag      { to: Locator }                       drags the target onto `to` (a card onto a list)
//   web.wait_for  {}                                    waits for `check` (or the target) within timeout_ms
//   web.extract   { all?, limit?, each?, join? }        each: per-element template using {{text}} and {{href}}
//   web.extract   { source: "google_sheet" }            the open Google Sheet's rows (CSV export), as objects
//   web.extract   { source: "table" }                   the target <table>'s rows, as objects keyed by header
//   fs.find       { dir, glob, pick: "newest" | "all", since_run_start? }   since_run_start ignores older files
// A file input's resolve: { dir, glob, pick, ask?, accept?, max_mb? }. ask: false takes the newest match without
// asking. accept ("image/*,.pdf", the HTML syntax) and max_mb say which files it takes: checked before the run.
// What each action produces (and so the outputs it may declare) is listed in check.ts.
//   fs.move|copy  { from, to }                          `to` ending in "/" is a folder (created if missing)
//   fs.rename     { from, to }
//   fs.read       { path }
//   fs.write      { path, content, append? }
//   ax.open       { app, name? }                       launches or brings forward a Mac app (bundle id)
//   ax.press      { button?: "right" }                 presses the target (AXPress; right: its context menu)
//   ax.set_value  { text }                             focuses the target and sets its value
//   ax.focus      {}
//   ax.menu       { app, path: string[] }              a menu bar item by its titles, e.g. ["File", "Export As…"]
//   ax.key        { app, key, modifiers?: ("cmd"|"shift"|"option"|"ctrl")[] }   a shortcut or Return/Escape/arrow
//                 ax targets: role = AX role, name = title or description, label, near, and attrs
//                 { app, window?, identifier?, subrole?, path? (" > "-joined) }
//   script.applescript { source }
//   script.shortcut    { name, input? }
//   script.shell       { command }                      allow-listed commands only
//   data.pick  { from, where: { Column: value }, column, pick?: "first"|"last" }   a rule over rows; no model call
import { z } from "zod";
import { checkVariables } from "./check.ts";
import { VarName, VarType } from "./vars.ts";

export const CHANNELS = ["web", "fs", "script", "data", "ax", "vision"] as const;
export const Channel = z.enum(CHANNELS);
export type Channel = z.infer<typeof Channel>;

// Actions each channel supports. The recorder must only emit these; the player must implement all of them.
export const ACTIONS = {
  web: ["navigate", "click", "type", "select", "press", "upload", "drag", "wait_for", "extract"],
  fs: ["find", "move", "copy", "rename", "read", "write"],
  script: ["applescript", "shortcut", "shell"],
  // A rule over rows saved by an earlier step. Judgement and text work are llm steps, not data actions.
  data: ["pick"],
  // Mac apps through the Accessibility API, run by Task Player.app (apps/mac).
  ax: ["open", "press", "set_value", "focus", "menu", "key"],
  vision: ["click", "type"],
} as const satisfies Record<Channel, readonly string[]>;

// How a control is remembered. Never pixel coordinates.
export const Locator = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  near: z.string().optional(),
  attrs: z.record(z.string(), z.string()).optional(),
  fallbacks: z.array(z.string()).default([]),
  framePath: z.array(z.string()).optional(),
});
export type Locator = z.infer<typeof Locator>;

export const Check = z
  .object({
    url_matches: z.string(),
    text_visible: z.string(),
    element_visible: Locator,
    file_exists: z.string(),
  })
  .partial();
export type Check = z.infer<typeof Check>;

// A variable a step produces: its name and type.
export const Output = z.object({
  name: VarName,
  type: VarType,
  description: z.string().optional(),
});
export type Output = z.infer<typeof Output>;

// A value the run starts with, declared on the trigger step.
export const Input = z.object({
  type: VarType,
  description: z.string().optional(),
  // Used when the run does not supply a value (e.g. trigger-fired runs and tests).
  default: z.unknown().optional(),
  // How to fill the input at run time, e.g. { dir, glob, pick: "newest" } for files.
  resolve: z.record(z.string(), z.unknown()).optional(),
  // The value seen while recording. Shown in the editor; never used as the value of a run.
  example: z.unknown().optional(),
});
export type Input = z.infer<typeof Input>;

export const Trigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("schedule"), cron: z.string() }),
  z.object({ type: z.literal("folder_watch"), dir: z.string(), glob: z.string().optional() }),
]);
export type Trigger = z.infer<typeof Trigger>;

// The description the user wrote before recording. Frequency is not here: it became the trigger step's `when`.
export const Description = z.object({
  goal: z.string().min(1),
  changes: z.array(z.string()).default([]),
  constants: z.array(z.string()).default([]),
  never: z.array(z.string()).default([]),
});
export type Description = z.infer<typeof Description>;

// A question for the user before a step runs. "value": the answer becomes the variable `output`.
// "confirm": the step runs only if they say yes.
export const Ask = z
  .object({
    question: z.string().min(1),
    kind: z.enum(["value", "confirm"]).default("value"),
    output: Output.optional(),
  })
  .refine((a) => a.kind === "confirm" || a.output !== undefined, {
    message: "a value question needs an output",
    path: ["output"],
  });
export type Ask = z.infer<typeof Ask>;

const stepBase = {
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  // What this step achieves, in words. The editor shows it; debug relies on it.
  intent: z.string(),
  requires_approval: z.boolean().default(false),
  ask: Ask.optional(),
};

export const ActionStep = z
  .object({
    ...stepBase,
    type: z.literal("action"),
    channel: Channel,
    action: z.string(),
    target: Locator.optional(),
    args: z.record(z.string(), z.unknown()).default({}),
    wait: Check.optional(),
    check: Check.optional(),
    // The variable this step's result becomes (found files, extracted text, rows). See check.ts for what each
    // action produces.
    output: Output.optional(),
    // How long `wait` and `check` may take before the step fails. Player default applies when absent.
    timeout_ms: z.number().int().positive().optional(),
    on_fail: z
      .object({
        retries: z.number().int().min(0).default(0),
        fallback: z.enum(["agent", "ask"]).default("ask"),
      })
      .optional(),
  })
  .refine((s) => (ACTIONS[s.channel] as readonly string[]).includes(s.action), {
    message: "action is not supported by this channel",
    path: ["action"],
  })
  .refine((s) => s.channel !== "vision", {
    message: "vision steps are chosen by replay at run time, never written into a skill",
    path: ["channel"],
  });
export type ActionStep = z.infer<typeof ActionStep>;

export const LlmStep = z
  .object({
    ...stepBase,
    type: z.literal("llm"),
    instruction: z.string().min(1),
    // References to the data it reads, e.g. ["{{email.body}}"]. It sees nothing else.
    inputs: z.array(z.string()).default([]),
    // Its answer, checked against the declared type before it is saved.
    output: Output,
  })
  .refine((s) => !/"type":"(file|secret)"/.test(JSON.stringify(s.output.type)), {
    message: "an llm step cannot produce files or secrets",
    path: ["output", "type"],
  });
export type LlmStep = z.infer<typeof LlmStep>;

// A condition compares values (references are resolved first). Judgement-based conditions come from an llm step
// whose output is a boolean, then { left: "{{is_urgent}}", op: "equals", right: true }.
export interface Comparison {
  left: unknown;
  op: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "exists" | "not_exists";
  right?: unknown;
}
export type Condition = Comparison | { all: Condition[] } | { any: Condition[] } | { not: Condition };

const Comparison = z.object({
  left: z.unknown(),
  op: z.enum(["equals", "not_equals", "contains", "greater_than", "less_than", "exists", "not_exists"]),
  right: z.unknown().optional(),
});
export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    Comparison,
    z.object({ all: z.array(Condition).min(1) }),
    z.object({ any: z.array(Condition).min(1) }),
    z.object({ not: Condition }),
  ]),
) as z.ZodType<Condition>;

const LoopFields = z.object({
  ...stepBase,
  type: z.literal("control"),
  kind: z.literal("loop"),
  // A reference to a list, e.g. "{{emails}}".
  over: z.string(),
  // The current item, a variable visible only inside the loop: {{email}}.
  item: Output,
  max_items: z.number().int().positive().max(1000).default(100),
  // "stop": the first failing item fails the run. "skip": it is logged and the loop goes on.
  on_item_fail: z.enum(["stop", "skip"]).default("stop"),
});

const BranchFields = z.object({
  ...stepBase,
  type: z.literal("control"),
  kind: z.literal("branch"),
  if: Condition,
});

// The first step of every workflow: when it runs, and the inputs it starts with.
export const TriggerStep = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  type: z.literal("trigger"),
  intent: z.string(),
  when: z
    .array(Trigger)
    .min(1)
    .default([{ type: "manual" }]),
  inputs: z.record(VarName, Input).default({}),
});
export type TriggerStep = z.infer<typeof TriggerStep>;

export type LoopStep = z.infer<typeof LoopFields> & { steps: Step[] };
// No "then" key: an object with one is treated as a promise by `await`.
export type BranchStep = z.infer<typeof BranchFields> & { steps: Step[]; else: Step[] };
export type ControlStep = LoopStep | BranchStep;
export type Step = TriggerStep | ActionStep | LlmStep | ControlStep;

export type StepInput =
  | z.input<typeof TriggerStep>
  | z.input<typeof ActionStep>
  | z.input<typeof LlmStep>
  | (z.input<typeof LoopFields> & { steps: StepInput[] })
  | (z.input<typeof BranchFields> & { steps: StepInput[]; else?: StepInput[] });

// Discriminated on `type`, then on `kind`, so a bad step reports its own problem instead of "invalid input".
export const Step: z.ZodType<Step, StepInput> = z.lazy(() =>
  z.discriminatedUnion("type", [
    TriggerStep,
    ActionStep,
    LlmStep,
    z.discriminatedUnion("kind", [
      LoopFields.extend({ steps: z.array(Step).min(1) }),
      BranchFields.extend({ steps: z.array(Step).min(1), else: z.array(Step).default([]) }),
    ]),
  ]),
) as z.ZodType<Step, StepInput>;

export const VersionNote = z.object({
  version: z.number().int().min(1),
  // record: made from a recording · user: edited in the editor · debug: a self-correction during a run
  by: z.enum(["record", "user", "debug"]),
  summary: z.string(),
  at: z.string(), // ISO 8601
});
export type VersionNote = z.infer<typeof VersionNote>;

export const Skill = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    // Short, for lists and notifications: "Weekly KPI email → Sheet".
    name: z.string().min(1),
    version: z.number().int().min(1),
    description: Description,
    // steps[0] is the trigger step; the tree follows.
    steps: z.array(Step).min(2),
    success: z.array(Check).default([]),
    // Newest last. Every version is kept on disk; this says how each one came about.
    history: z.array(VersionNote).default([]),
  })
  .superRefine((skill, ctx) => {
    const seen = new Set<string>();
    for (const { step, parents } of walkSteps(skill.steps)) {
      if (seen.has(step.id)) ctx.addIssue({ code: "custom", message: `duplicate step id ${step.id}`, path: ["steps"] });
      seen.add(step.id);
      if (step.type === "trigger" && (parents.length > 0 || step !== skill.steps[0])) {
        ctx.addIssue({ code: "custom", message: `${step.id}: only the first step can be a trigger`, path: ["steps"] });
      }
    }
    if (skill.steps[0]?.type !== "trigger") {
      ctx.addIssue({ code: "custom", message: "the first step must be the trigger", path: ["steps", 0] });
      return;
    }
    for (const problem of checkVariables(skill.steps)) ctx.addIssue({ code: "custom", message: problem, path: [] });
  });
export type Skill = z.infer<typeof Skill>;

export function parseSkill(data: unknown): Skill {
  return Skill.parse(data);
}

export const isTrigger = (step: Step): step is TriggerStep => step.type === "trigger";
export const isAction = (step: Step): step is ActionStep => step.type === "action";
export const isLlm = (step: Step): step is LlmStep => step.type === "llm";
export const isLoop = (step: Step): step is LoopStep => step.type === "control" && step.kind === "loop";
export const isBranch = (step: Step): step is BranchStep => step.type === "control" && step.kind === "branch";

// Every step in the tree, depth first, with the ids of the control steps it sits in.
export function* walkSteps(steps: Step[], parents: string[] = []): Generator<{ step: Step; parents: string[] }> {
  for (const step of steps) {
    yield { step, parents };
    if (isLoop(step)) yield* walkSteps(step.steps, [...parents, step.id]);
    if (isBranch(step)) {
      yield* walkSteps(step.steps, [...parents, step.id]);
      yield* walkSteps(step.else, [...parents, step.id]);
    }
  }
}

export function findStep(skill: Pick<Skill, "steps">, id: string): Step | undefined {
  for (const { step } of walkSteps(skill.steps)) if (step.id === id) return step;
  return undefined;
}

// The trigger step, always steps[0] in a parsed skill.
export function triggerOf(skill: Pick<Skill, "steps">): TriggerStep {
  const first = skill.steps[0];
  if (first?.type !== "trigger") throw new Error("the first step must be the trigger");
  return first;
}
