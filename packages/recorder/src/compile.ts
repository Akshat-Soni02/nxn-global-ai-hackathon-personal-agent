// Compile: normalised steps -> a Skill. Code builds the skeleton (actions, targets, recorded values); Nemotron adds
// what code can't know: what each step is for, which values change each run, how to tell it worked, what to ask you.
// The model's answer is merged by step id, validated with the same zod schema the player parses, and sent back with
// the errors when it fails (at most 3 attempts). If it never passes, the skeleton is saved: a recording is never lost.
import { ACTIONS, Check, Input, type LlmStep, Skill, Trigger, type VarType } from "@taskplayer/core";
import type { ChatMessage } from "@taskplayer/llm";
import type { MemoryStore } from "@taskplayer/memory";
import { z } from "zod";
import type { NormalisedStep } from "./normalise.ts";
import { type ActionDraft, type SkillDraft, skeletonOf, skillInput, TRIGGER_ID } from "./skeleton.ts";

export type Chat = (messages: ChatMessage[]) => Promise<string>;

// A drill question. appliesTo is where the answer goes in the skill ("steps.start.inputs.invoice.resolve.dir",
// "steps.s3.requires_approval", "steps.start.when", "description.goal"); an option's value is the JSON stored there.
export const Question = z.object({
  id: z.string(),
  text: z.string(),
  appliesTo: z.string().optional(),
  options: z.array(z.object({ label: z.string(), value: z.unknown().optional() })).optional(),
  default: z.string().optional(),
  // A lasting fact about you: saved to memory so the next compile doesn't ask again.
  remember: z.enum(["fact", "preference"]).optional(),
});
export type Question = z.infer<typeof Question>;

// What the model may return. Targets, channels and actions are deliberately absent.
export const Annotations = z.object({
  id: z.string().optional(),
  intent: z.string().optional(),
  inputs: z.record(z.string(), Input).optional(),
  when: z.array(Trigger).optional(),
  success: z.array(Check).optional(),
  steps: z
    .array(
      z.object({
        id: z.string(),
        intent: z.string().optional(),
        args: z.record(z.string(), z.unknown()).optional(),
        check: Check.optional(),
        wait: Check.optional(),
        requires_approval: z.boolean().optional(),
        // Only for a data.pick step, and only when no rule can express the choice: one model call on every run.
        ai: z
          .object({
            instruction: z.string(),
            output: z.enum(["text", "number", "date", "json"]).default("text"),
            reason: z.string(),
          })
          .optional(),
        save_as: z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/)
          .optional(),
        timeout_ms: z.number().int().positive().max(600_000).optional(),
        on_fail: z
          .object({ retries: z.number().int().min(0).max(5).optional(), fallback: z.enum(["agent", "ask"]).optional() })
          .optional(),
      }),
    )
    .default([]),
  questions: z.array(Question).max(8).default([]),
});
export type Annotations = z.infer<typeof Annotations>;

export interface CompileOptions {
  chat?: Chat;
  memory?: Pick<MemoryStore, "search">;
  maxAttempts?: number;
  // US dollars per million input tokens, to show what a per-run AI step costs (the fast profile's model price).
  pricePerMTok?: number;
}

export interface Compiled {
  skill: Skill;
  questions: Question[];
  model: "nemotron" | "none";
  attempts: number;
  warnings: string[];
}

export async function compile(steps: NormalisedStep[], options: CompileOptions = {}): Promise<Compiled> {
  if (steps.length === 0) throw new Error("nothing to compile: the trace has no steps");
  const { draft, idsByStep, questions: skeletonQuestions } = skeletonOf(steps);
  const ownQuestions = [...skeletonQuestions, ...codeQuestions(draft, steps)];
  const reported = steps.flatMap((s, i) =>
    s.drawnBefore
      ? [
          `${idsByStep[i]?.[0]}: ${s.drawnBefore} click(s) before it landed on a drawn area (no element to replay); they were left out`,
        ]
      : [],
  );
  const warnings: string[] = [...reported];
  const skeletonOnly = (attempts: number): Compiled => ({
    skill: Skill.parse(skillInput(draft)),
    questions: [...ownQuestions, describeQuestion(draft)],
    model: "none",
    attempts,
    warnings,
  });

  if (!options.chat) {
    warnings.push("No model configured (NEBIUS_* in .env), so the skill was built by code only.");
    return skeletonOnly(0);
  }

  const memory = options.memory ? await options.memory.search(memoryQuery(steps), { limit: 8 }) : [];
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    {
      role: "user",
      content: JSON.stringify({
        steps: forModel(steps, idsByStep),
        skeleton: skeletonForModel(draft),
        memory: memory.map((m) => m.text),
      }),
    },
  ];

  const maxAttempts = options.maxAttempts ?? 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let raw: string;
    try {
      raw = await options.chat(messages);
    } catch (error) {
      warnings.push(`Model call failed: ${error instanceof Error ? error.message : String(error)}`);
      return skeletonOnly(attempt);
    }
    let issues: string[];
    let merged: SkillDraft | undefined;
    let notes: Annotations | undefined;
    let costQuestions: Question[] = [];
    try {
      notes = Annotations.parse(extractJson(raw));
      merged = merge(draft, notes);
      costQuestions = aiQuestions(merged, notes, steps, idsByStep, options.pricePerMTok);
      const parsed = Skill.safeParse(skillInput(merged));
      issues = [
        ...(parsed.success
          ? []
          : parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message)),
      ];
    } catch (error) {
      issues = [
        error instanceof z.ZodError
          ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
          : String(error),
      ];
    }
    if (issues.length === 0 && merged && notes) {
      const asked = new Set(notes.questions.map((q) => q.appliesTo));
      return {
        skill: Skill.parse(skillInput(merged)),
        questions: [...costQuestions, ...notes.questions, ...ownQuestions.filter((q) => !asked.has(q.appliesTo))],
        model: "nemotron",
        attempts: attempt,
        warnings,
      };
    }
    messages.push(
      { role: "assistant", content: raw },
      {
        role: "user",
        content: `That JSON was rejected:\n- ${issues.join("\n- ")}\nReturn the corrected JSON object only.`,
      },
    );
  }
  warnings.push(`The model's answer failed the schema check ${maxAttempts} times, so the code-only skill was kept.`);
  return skeletonOnly(maxAttempts);
}

export function systemPrompt(): string {
  return [
    "You turn one recorded demonstration of a computer task into a reusable skill for an automation player.",
    "You get JSON with: steps (what the person did, in order), skeleton (a valid draft skill that code built from those steps), memory (things the person told us before).",
    "Reply with ONE JSON object and nothing else. Every field is optional:",
    '{"id": string, "intent": string, "inputs": {...}, "when": [...], "success": [...], "steps": [{"id": "s1", "intent": string, "args": {...}, "check": {...}, "wait": {...}, "requires_approval": boolean, "save_as": string, "on_fail": {"retries": number, "fallback": "agent" | "ask"}}], "questions": [...]}',
    "Rules:",
    "- Never output targets, selectors, channels or actions. Code copies those from the recording.",
    "- id: a short lowercase kebab-case name for the task, such as upload-invoice. intent: one plain sentence.",
    '- Give every step an intent that says what it achieves ("Attach the invoice"), not how ("click the button").',
    '- Values that will be different next time (files, dates, amounts, names) become inputs the run starts with: {"type": {"type": "text" | "number" | "boolean" | "date" | "file" | "secret"}, "description": string, "resolve": {...}}. A file input needs resolve {"dir", "glob", "pick": "newest" | "all"}; with "all" its type is {"type": "list", "items": {"type": "file"}}. Refer to any variable as {{NAME}}, to a field as {{NAME.field}} (a file has path, name, size, modified: {{NAME.name}}), to a list item as {{NAME.0}}, and to today\'s date as {{today}}. Keep the skeleton\'s input names. When a typed value becomes an input, code keeps what was typed as its default.',
    "- check: what is true after a step if it worked. Fields: url_matches, text_visible, element_visible, file_exists. success: checks for the whole task, such as a confirmation message.",
    "- requires_approval: true for steps that submit, pay, send, delete or post. You may add approvals, never remove them.",
    "- Step args are read by the player exactly as: navigate {url}; click {}; type {text, clear}; select {option} (the visible label); press {key}; upload {file}; drag {to} (code fills it); extract {all?, limit?, each?, join?}; fs.find {dir, glob, pick, since_run_start?}; fs.move and fs.copy {from, to} (a `to` ending in / is a folder); fs.rename {from, to}. Keep the skeleton's arg names.",
    '- save_as: "name" makes a step\'s result (extracted text, found files) a variable for later steps, used as {{name}}. Only use it after the step that produces it; names are unique. timeout_ms: raise it for slow steps (big uploads, downloads).',
    '- when: [{"type": "manual"}] unless the task clearly runs on a schedule ({"type": "schedule", "cron"}) or when a file appears ({"type": "folder_watch", "dir", "glob"}). If unsure, ask.',
    '- Ask, don\'t guess: anything you are unsure about becomes a question {"id", "text", "appliesTo", "options": [{"label", "value"}], "default", "remember": "fact" | "preference"}. appliesTo is where the answer goes in the skill, whose first step (id "start") holds when and inputs: such as "steps.start.inputs.invoice.resolve.dir", "steps.s3.requires_approval", "steps.start.when" or "description.goal"; value is the JSON stored there; default is the label of the default option. Set remember when the answer is a lasting fact about the person. At most 5 questions, and none that memory already answers.',
    '- A copy from a sheet or table becomes read rows -> data.pick {from, where, column}. Write the rule the person meant: if the copied row\'s date was the day they recorded, they almost always mean today\'s row: where {"Date": "{{today}}"}. A rule is free on every run.',
    '- Only when no rule can say which value ("the invoice that looks overdue", "the row about the client in this email") add "ai": {"instruction", "output": "text" | "number" | "date" | "json", "reason"} to that data.pick step. It calls the model on every run, so the person is asked to approve the cost. Never use ai for what where/column can express. Write dates in the instruction as {{today}}, never as a fixed date.',
    "Examples of when to ask and when not to:",
    '- Ask: the file you uploaded (this exact file, or the newest of its kind?); a value typed once that may change ("38 hours every week?"); which sheet row (today\'s, or always this one?); approval for a step that pays, sends, deletes or posts; what a click on a drawn area was for.',
    "- Don't ask: anything the recording already shows (which page, which button, the order of steps); anything memory answers; selectors or layout; wording, colours or style; the same thing twice.",
    '- A good question has options and a default: {"text": "Run it when a new invoice lands in Downloads?", "appliesTo": "steps.start.when", "options": [{"label": "yes", "value": [{"type": "folder_watch", "dir": "~/Downloads", "glob": "invoice-*.pdf"}]}, {"label": "only when I press Run", "value": [{"type": "manual"}]}], "default": "yes"}.',
    `- For reference, the actions the player supports per channel: ${JSON.stringify(ACTIONS)}.`,
  ].join("\n");
}

// The model sees what you did, by meaning: no selectors, never a secret's value.
function forModel(steps: NormalisedStep[], idsByStep: string[][]) {
  return steps.map((s, i) => ({
    ids: idsByStep[i],
    did: s.kind,
    page: s.url,
    element: s.target
      ? { role: s.target.role, name: s.target.name, label: s.target.label, near: s.target.near }
      : s.element && {
          role: s.element.role,
          name: s.element.title || s.element.description,
          label: s.element.label,
          near: s.element.near,
        },
    // Mac apps: which app, a menu path, a shortcut.
    app: s.app?.name ?? s.app?.id,
    menu: s.menu,
    keys: s.kind === "app_key" ? [...(s.modifiers ?? []), s.value].join("+") : undefined,
    dropped_on: s.to && { role: s.to.role, name: s.to.name, label: s.to.label, near: s.to.near },
    value: s.secret ? "(secret, not recorded)" : s.value?.slice(0, 200),
    checked: s.checked,
    file: s.file?.name,
    path: s.path,
    to: s.toPath,
    led_to: s.navigatesTo,
    produced: s.produces,
    likely_changes: s.candidate,
    // A copy: what was copied; from a sheet also its header and the one row it came from (no other rows).
    copied: s.kind === "copy" ? s.value?.slice(0, 200) : undefined,
    sheet:
      s.kind === "copy" && s.context?.header
        ? { header: s.context.header, row: s.context.row, column: s.context.column }
        : undefined,
    pasted_from_copy: s.pasted ? Boolean(s.fromCopy) : undefined,
  }));
}

function skeletonForModel(draft: SkillDraft) {
  return { ...draft, steps: draft.steps.map(({ target: _target, ...step }) => step) };
}

function memoryQuery(steps: NormalisedStep[]): string {
  return steps
    .flatMap((s) => [
      s.target?.name,
      s.target?.label,
      s.target?.near,
      s.file?.name,
      hostOf(s.url),
      s.element?.title,
      s.app?.name,
    ])
    .filter(Boolean)
    .join(" ");
}

function merge(draft: SkillDraft, notes: Annotations): SkillDraft {
  const out: SkillDraft = JSON.parse(JSON.stringify(draft));
  if (notes.id) out.id = notes.id;
  if (notes.intent) {
    out.name = notes.intent;
    out.description = { ...out.description, goal: notes.intent };
  }
  if (notes.inputs) out.inputs = { ...out.inputs, ...notes.inputs };
  if (notes.when?.length) out.when = notes.when;
  if (notes.success) out.success = notes.success;
  for (const note of notes.steps) {
    const step = out.steps.find((s) => s.id === note.id);
    if (!step) continue;
    if (note.intent) step.intent = note.intent;
    if (note.check) step.check = note.check;
    if (note.wait) step.wait = note.wait;
    if (note.on_fail) step.on_fail = note.on_fail;
    // The model names the variable; its type is what the action produces.
    if (note.save_as) step.output = { name: note.save_as, type: producedType(step) };
    if (note.timeout_ms) step.timeout_ms = note.timeout_ms;
    // The model may add an approval, never remove one code asked for.
    if (note.requires_approval) step.requires_approval = true;
    for (const [key, value] of Object.entries(note.args ?? {})) {
      // A drag's destination comes from the recording, like its target.
      if (step.action === "drag" && key === "to") continue;
      // So do a Mac step's app, menu path and shortcut.
      if (step.channel === "ax" && ["app", "path", "key", "modifiers", "button"].includes(key)) continue;
      // A navigate step stays on the site you recorded, whatever the model says.
      if (step.action === "navigate" && key === "url" && !sameOrigin(step.args?.url, value)) continue;
      // A secret stays a secret input.
      const current = step.args?.[key];
      if (
        typeof current === "string" &&
        Object.keys(out.inputs).some((name) => current.includes(`{{${name}}}`)) &&
        (step.action === "type" || step.action === "set_value")
      )
        continue;
      // A recorded value the model turns into an input becomes that input's default, so runs that nobody types
      // a value for (triggers, schedules) still replay what you did.
      const recorded = step.args?.[key];
      const input = typeof value === "string" ? /^\{\{\s*([a-z][a-z0-9_]*)\s*\}\}$/.exec(value)?.[1] : undefined;
      const declared = input ? out.inputs?.[input] : undefined;
      if (
        declared &&
        declared.type.type !== "file" &&
        declared.type.type !== "secret" &&
        declared.default === undefined &&
        typeof recorded === "string" &&
        !recorded.includes("{{")
      ) {
        declared.default =
          declared.type.type === "number" && Number.isFinite(Number(recorded)) ? Number(recorded) : recorded;
      }
      step.args = { ...step.args, [key]: value };
    }
  }
  return out;
}

// A data.pick step the model says no rule can express becomes a question before the skill is saved: keep it as an
// llm step (a model call on every run, with its cost shown) or keep the recorded rule (free). Each option carries the
// whole step, so the drill's answer replaces the step outright. Tokens are estimated from the data the step reads
// (about 4 characters a token).
function aiQuestions(
  draft: SkillDraft,
  notes: Annotations,
  steps: NormalisedStep[],
  idsByStep: string[][],
  pricePerMTok: number | undefined,
): Question[] {
  return notes.steps.flatMap((note) => {
    const step = draft.steps.find((s) => s.id === note.id);
    if (!note.ai || !step || step.channel !== "data" || step.action !== "pick") return [];
    const source = steps[idsByStep.findIndex((ids) => ids.includes(step.id))];
    const row = JSON.stringify(source?.context?.row ?? {}).length;
    const rows = Number(source?.context?.rows ?? 1);
    const tokens = Math.ceil((note.ai.instruction.length + row * Math.max(rows, 1)) / 4) + 50;
    const dollars = pricePerMTok ? (tokens * pricePerMTok) / 1_000_000 : undefined;
    const cost =
      dollars === undefined
        ? ""
        : dollars < 0.0001
          ? " (under $0.0001 a run)"
          : ` (about $${dollars.toPrecision(2)} a run)`;
    const from = step.args?.from;
    const llm: LlmStep = {
      id: step.id,
      type: "llm",
      intent: step.intent,
      instruction: note.ai.instruction,
      inputs: typeof from === "string" ? [from] : [],
      output: { name: step.output?.name ?? `${step.id}_value`, type: OUTPUT_OF[note.ai.output] },
      requires_approval: step.requires_approval ?? false,
    };
    return [
      {
        id: `ai-${step.id}`,
        text: `${step.id} asks the model on every run, about ${tokens} tokens${cost}. Why: ${note.ai.reason}. Keep it?`,
        appliesTo: `steps.${step.id}`,
        options: [
          { label: "keep the AI step", value: llm },
          { label: "use the recorded rule instead (no model call)", value: step },
        ],
        default: "keep the AI step",
      },
    ];
  });
}

const OUTPUT_OF: Record<"text" | "number" | "date" | "json", VarType> = {
  text: { type: "text" },
  number: { type: "number" },
  date: { type: "date" },
  json: { type: "object" },
};

// The type of a step's result, for a variable the model names with save_as (what each action produces: check.ts).
function producedType(step: ActionDraft): VarType {
  const a = step.args ?? {};
  switch (`${step.channel}.${step.action}`) {
    case "web.extract":
      return a.source
        ? { type: "list", items: { type: "object" } }
        : a.all && typeof a.each !== "string"
          ? { type: "list", items: { type: "text" } }
          : { type: "text" };
    case "fs.find":
      return a.pick === "all" ? { type: "list", items: { type: "file" } } : { type: "file" };
    case "fs.move":
    case "fs.copy":
      return Array.isArray(a.from) ? { type: "list", items: { type: "file" } } : { type: "file" };
    case "fs.rename":
    case "fs.write":
      return { type: "file" };
    case "data.pick":
      return typeof a.column === "string" ? { type: "text" } : { type: "object" };
    default:
      return { type: "text" };
  }
}

// What is wrong with the references in a draft, as the schema reports it (check.ts): undeclared variables, missing
// fields, outputs an action cannot produce. Sent back to the model so it can fix them.
export function templateProblems(draft: SkillDraft): string[] {
  const parsed = Skill.safeParse(skillInput(draft));
  return parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join(".")}${i.path.length ? ": " : ""}${i.message}`);
}

// Reasoning models may wrap the answer in <think> blocks or code fences: keep only the JSON object.
export function extractJson(raw: string): unknown {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) text = fenced[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("the reply contains no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

// Questions code can ask without a model: where files of each kind arrive, when the recording didn't show it.
function codeQuestions(draft: SkillDraft, steps: NormalisedStep[]): Question[] {
  return Object.entries(draft.inputs ?? {}).flatMap(([name, input]) => {
    if (input.type.type !== "file" && input.type.type !== "list") return [];
    const example = steps.find((s) => s.kind === "upload" && s.candidate?.dir === undefined && s.file)?.file?.name;
    if (!example) return [];
    return [
      {
        id: `dir-${name}`,
        text: `Where do files like ${example} arrive?`,
        appliesTo: `steps.${TRIGGER_ID}.inputs.${name}.resolve.dir`,
        default: "~/Downloads",
        remember: "fact" as const,
      },
    ];
  });
}

function describeQuestion(draft: SkillDraft): Question {
  return {
    id: "intent",
    text: "Describe this task in one sentence",
    appliesTo: "description.goal",
    default: draft.description.goal,
  };
}

function sameOrigin(a: unknown, b: unknown): boolean {
  try {
    return new URL(String(a)).origin === new URL(String(b)).origin;
  } catch {
    return false;
  }
}

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
}
