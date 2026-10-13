// The design agent's tools (docs/design.md, "The design agent's tools"), over one session: the compiled draft it
// starts from, the draft it is changing, the recording, and the questions still open. Look tools read; edit tools
// change the draft through core's edit operations, and every change is checked against what the agent may never do
// (designViolations) before it is kept; ask_user is the drill; finish ends.
import { type AnyTool, tool } from "@shadow/agent";
import {
  applyEdits,
  type EditInput,
  isAction,
  type Locator,
  type Skill,
  type Step,
  triggerOf,
  walkSteps,
} from "@shadow/core";
import type { MemoryStore } from "@shadow/memory";
import { z } from "zod";
import { type Form, type Question, stepsForModel } from "../compile.ts";
import { applyAnswer, type Prompter } from "../drill.ts";
import type { NormalisedStep } from "../normalise.ts";

// Something said or seen while recording, on the recording's clock: the narration's text, or the masked words read
// from a screenshot.
export interface Note {
  at: number;
  kind: "said" | "screen";
  text: string;
}

export interface DesignSession {
  // Where every target and site comes from: the workflow as compiled from the recording.
  original: Skill;
  draft: Skill;
  form?: Form;
  steps: NormalisedStep[];
  idsByStep: string[][];
  notes: Note[];
  // The first draft's questions not asked yet, and the answers given so far (to them and to the agent's own).
  pending: Question[];
  answered: { question: Question; answer: string }[];
  asked: number;
  maxQuestions: number;
  edits: EditInput[];
  prompter: Prompter;
  memory?: Pick<MemoryStore, "search">;
  // What else must hold before the workflow is finished: what an unattended run needs (the daemon's go-live checks).
  checks?: (skill: Skill) => string[];
}

export type DesignFinish = { summary: string };

// ---- What the agent may never do ------------------------------------------------------------------------------

const keyOf = (target: Locator | undefined): string => JSON.stringify(sortKeys(target ?? null));
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
const originOf = (url: unknown): string | undefined => {
  try {
    return typeof url === "string" ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};

// Steps the agent may add: they only read or open a page the recording visited; they change nothing.
const READ_ONLY = new Set(["fs.find", "fs.read", "data.pick", "web.extract", "web.wait_for", "web.navigate"]);

// Every way the draft breaks the rules, as sentences the agent reads; empty when it may be kept.
//   targets       only from the recording: no new control, and no control changed
//   actions       a new step may only read (READ_ONLY); a recorded step keeps its kind of action
//   reach         no script steps, no navigating to a site the recording didn't visit
//   the user's    the form's description and Frequency stay as written
//   safety        approval is never turned off, and a step that needs it is never removed
export function designViolations(original: Skill, draft: Skill, form?: Form): string[] {
  const problems: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (form && !same(triggerOf(draft).when, triggerOf(original).when)) {
    problems.push("the Frequency is the user's (they chose it on the form): it can't change");
  }
  if (form && !same(draft.description, original.description)) {
    problems.push("the description is the user's (their own words on the form): it can't change");
  }

  const before = new Map<string, Step>([...walkSteps(original.steps)].map(({ step }) => [step.id, step]));
  const recorded = new Set([...before.values()].filter(isAction).map((s) => keyOf(s.target)));
  const sites = new Set(
    [...before.values()]
      .filter(isAction)
      .map((s) => (s.action === "navigate" ? originOf(s.args.url) : undefined))
      .filter((o): o is string => !!o),
  );
  const after = new Map<string, Step>([...walkSteps(draft.steps)].map(({ step }) => [step.id, step]));

  for (const step of after.values()) {
    if (!isAction(step)) continue;
    const old = before.get(step.id);
    const kind = `${step.channel}.${step.action}`;
    if (!old && !READ_ONLY.has(kind)) {
      problems.push(
        `${step.id}: a new ${kind} step would do something the user didn't show. Only steps that read (${[...READ_ONLY].join(", ")}) can be added; ask the user to show the rest`,
      );
    } else if (old && (!isAction(old) || `${old.channel}.${old.action}` !== kind)) {
      problems.push(
        `${step.id}: a recorded step keeps its kind of action (it was ${isAction(old) ? `${old.channel}.${old.action}` : old.type})`,
      );
    }
    if (step.target && !recorded.has(keyOf(step.target))) {
      problems.push(
        `${step.id}: its target is not one you recorded. Targets come only from the recording: if a step needs a control the user didn't use, ask them`,
      );
    } else if (old && isAction(old) && old.target && keyOf(old.target) !== keyOf(step.target)) {
      problems.push(`${step.id}: its target can't change (it is what the user clicked)`);
    }
    if (step.channel === "script" && !(old && isAction(old) && old.channel === "script")) {
      problems.push(`${step.id}: script steps can't be added`);
    }
    if (step.action === "navigate" && !(old && isAction(old) && same(old.args.url, step.args.url))) {
      const origin = originOf(step.args.url);
      if (!origin || !sites.has(origin)) {
        problems.push(`${step.id}: it may only open a site the recording visited (${[...sites].join(", ") || "none"})`);
      }
    }
  }
  for (const [id, old] of before) {
    if (!("requires_approval" in old) || !old.requires_approval) continue;
    const now = after.get(id);
    if (!now) problems.push(`${id}: a step that needs approval can't be removed`);
    else if (!("requires_approval" in now) || !now.requires_approval) {
      problems.push(`${id}: approval can't be turned off`);
    }
  }
  return problems;
}

// ---- Showing the workflow ------------------------------------------------------------------------------------

// One line per step, nested: what the agent and the drill see of the draft.
export function outlineOf(skill: Skill): string {
  const lines: string[] = [];
  const trigger = triggerOf(skill);
  const when = trigger.when.map((w) => (w.type === "schedule" ? `schedule ${w.cron}` : w.type)).join(", ");
  const inputs = Object.entries(trigger.inputs)
    .map(([name, input]) => {
      const fill =
        input.default !== undefined
          ? ` = ${JSON.stringify(input.default)}`
          : input.resolve
            ? ` from ${JSON.stringify(input.resolve)}`
            : "";
      return `${name} (${typeText(input.type)})${fill}`;
    })
    .join("; ");
  lines.push(`${trigger.id}  trigger  when: ${when}${inputs ? `  inputs: ${inputs}` : ""}`);
  const walk = (steps: Step[], depth: number) => {
    for (const step of steps) {
      if (step.type === "trigger") continue;
      const pad = "  ".repeat(depth);
      const approval = step.requires_approval ? "  [approval]" : "";
      if (step.type === "action") {
        const target = step.target
          ? `  on ${step.target.role ?? "element"} "${step.target.name ?? step.target.label ?? step.target.text ?? "?"}"`
          : "";
        const args = Object.keys(step.args).length > 0 ? `  args ${clip(JSON.stringify(step.args), 160)}` : "";
        const out = step.output ? `  → ${step.output.name} (${typeText(step.output.type)})` : "";
        lines.push(
          `${pad}${step.id}  ${step.channel}.${step.action}  "${step.intent}"${target}${args}${out}${approval}`,
        );
      } else if (step.type === "llm") {
        lines.push(
          `${pad}${step.id}  llm  "${step.intent}"  reads ${step.inputs.join(", ") || "nothing"}  → ${step.output.name} (${typeText(step.output.type)})${approval}`,
        );
      } else if (step.kind === "loop") {
        lines.push(
          `${pad}${step.id}  loop "${step.intent}"  for each ${step.item.name} in ${step.over} (max ${step.max_items}, ${step.on_item_fail} on a failing item)${approval}`,
        );
        walk(step.steps, depth + 1);
      } else {
        lines.push(`${pad}${step.id}  if ${JSON.stringify(step.if)}  "${step.intent}"${approval}`);
        walk(step.steps, depth + 1);
        if (step.else.length > 0) {
          lines.push(`${pad}  else`);
          walk(step.else, depth + 1);
        }
      }
    }
  };
  walk(skill.steps, 1);
  return lines.join("\n");
}

function typeText(type: { type: string; items?: { type: string } }): string {
  return type.type === "list" && type.items ? `list of ${type.items.type}` : type.type;
}
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}…`);

// The recording by meaning (what compile's model saw), each step with the skill steps it became and what was said
// or seen around it.
export function recordingView(session: DesignSession, from = 1, to = session.steps.length): unknown[] {
  const view = stepsForModel(session.steps, session.idsByStep);
  const near = notesByStep(session.steps, session.notes);
  return view
    .map((step, i) => ({ n: i + 1, ...step, ...(near[i]?.length ? { notes: near[i] } : {}) }))
    .slice(Math.max(0, from - 1), Math.max(from, to));
}

// Each note goes with the last step that started before it (a second's grace: people talk as they click), or the
// first step when it came before any.
export function notesByStep(steps: NormalisedStep[], notes: Note[]): string[][] {
  const out: string[][] = steps.map(() => []);
  for (const note of [...notes].sort((a, b) => a.at - b.at)) {
    let index = 0;
    for (let i = 0; i < steps.length; i++) if ((steps[i]?.at ?? 0) <= note.at + 1000) index = i;
    out[index]?.push(`${note.kind === "said" ? "said" : "on screen"}: ${note.text}`);
  }
  return out;
}

// ---- The tools ------------------------------------------------------------------------------------------------

const StepIds = z.array(z.string()).min(1);
const OutputSpec = z.object({ name: z.string(), type: z.record(z.string(), z.unknown()) });

export function designTools(session: DesignSession): AnyTool<DesignFinish>[] {
  // Applies edits to the draft if the result parses, passes check.ts and breaks no rule; else nothing changes.
  const change = (edits: EditInput[]) => {
    const result = applyEdits(session.draft, edits);
    if (!result.ok) return { output: { ok: false, problems: result.problems } };
    const broken = designViolations(session.original, result.skill, session.form);
    if (broken.length > 0) return { output: { ok: false, refused: broken } };
    session.draft = result.skill;
    session.edits.push(...edits);
    return { output: { ok: true, workflow: outlineOf(session.draft) } };
  };
  const nextId = (prefix: string) => {
    const used = new Set([...walkSteps(session.draft.steps)].map(({ step }) => step.id));
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  };
  const problems = () => session.checks?.(session.draft) ?? [];

  return [
    // ---- Look ----
    tool({
      name: "read_description",
      kind: "look",
      description: "What the user wrote before recording: goal, Frequency, what changes, what stays, never",
      input: z.object({}),
      run: () => ({
        output: session.form
          ? { ...session.form.description, frequency: session.form.when }
          : "No form was filled in for this recording: work out the goal from the recording, and ask if unsure.",
      }),
    }),
    tool({
      name: "read_recording",
      kind: "look",
      description:
        "What the user did, in order and by meaning (n = step number), with the workflow steps each became (ids) and what was said or seen near it. from/to: step numbers",
      input: z.object({ from: z.number().int().min(1).optional(), to: z.number().int().min(1).optional() }),
      run: ({ from, to }) => ({ output: recordingView(session, from, to), untrusted: true }),
    }),
    tool({
      name: "workflow",
      kind: "look",
      description: "The draft workflow: one line per step, or one step in full with `step`",
      input: z.object({ step: z.string().optional() }),
      run: ({ step }) => {
        if (!step) return { output: outlineOf(session.draft) };
        const found = [...walkSteps(session.draft.steps)].find((s) => s.step.id === step);
        return { output: found ? found.step : `No step ${step}` };
      },
    }),
    tool({
      name: "recall",
      kind: "look",
      description: "What the user told Shadow before: earlier answers and facts about them and their sites",
      input: z.object({ query: z.string().min(1) }),
      run: async ({ query }) => {
        if (!session.memory) return { output: "No memory." };
        const found = await session.memory.search(query, { limit: 8 });
        return { output: found.length > 0 ? found.map((m) => m.text) : "Nothing remembered about that." };
      },
    }),

    // ---- Edit the draft ----
    tool({
      name: "edit",
      kind: "edit",
      description:
        "Apply edit operations to the draft, in order (see the briefing): set a field, insert, replace, remove or move a step. All or none are kept",
      input: z.object({ edits: z.array(z.record(z.string(), z.unknown())).min(1).max(30) }),
      run: ({ edits }) => change(edits as unknown as EditInput[]),
    }),
    tool({
      name: "wrap_in_loop",
      kind: "edit",
      description:
        'Put steps that sit next to each other into a new loop over a list: over "{{list}}", item { name, type } (the current item, used inside as {{name}})',
      input: z.object({
        steps: StepIds,
        over: z.string(),
        item: OutputSpec,
        intent: z.string().min(1),
        on_item_fail: z.enum(["stop", "skip"]).optional(),
      }),
      run: ({ steps, over, item, intent, on_item_fail }) => {
        const id = nextId("l");
        const loop = { id, type: "control", kind: "loop", intent, over, item, on_item_fail, steps: [] };
        return change([
          { op: "insert", at: { before: steps[0] as string }, step: loop },
          ...steps.map((s): EditInput => ({ op: "move", step: s, to: { into: id } })),
        ]);
      },
    }),
    tool({
      name: "wrap_in_branch",
      kind: "edit",
      description:
        "Put steps that sit next to each other under a condition: if { left, op, right } (ops: equals, not_equals, contains, greater_than, less_than, exists, not_exists). `otherwise`: steps to run when it doesn't hold",
      input: z.object({
        steps: StepIds,
        if: z.record(z.string(), z.unknown()),
        intent: z.string().min(1),
        otherwise: z.array(z.string()).optional(),
      }),
      run: ({ steps, if: condition, intent, otherwise }) => {
        const id = nextId("b");
        const branch = { id, type: "control", kind: "branch", intent, if: condition, steps: [], else: [] };
        return change([
          { op: "insert", at: { before: steps[0] as string }, step: branch },
          ...steps.map((s): EditInput => ({ op: "move", step: s, to: { into: id } })),
          ...(otherwise ?? []).map((s): EditInput => ({ op: "move", step: s, to: { into: id, arm: "else" } })),
        ]);
      },
    }),
    tool({
      name: "add_llm_step",
      kind: "edit",
      description:
        "Add a step that reads text and produces one typed value (summarise, classify, pull out fields, compute). It never clicks or types. inputs: references such as {{email.body}}",
      input: z.object({
        after: z.string(),
        intent: z.string().min(1),
        instruction: z.string().min(1),
        inputs: z.array(z.string()).min(1),
        output: OutputSpec,
      }),
      run: ({ after, intent, instruction, inputs, output }) =>
        change([
          {
            op: "insert",
            at: { after },
            step: { id: nextId("ai"), type: "llm", intent, instruction, inputs, output, requires_approval: false },
          },
        ]),
    }),

    // ---- Check ----
    tool({
      name: "validate",
      kind: "look",
      description: "What still stops the workflow from being finished",
      input: z.object({}),
      run: () => {
        const left = problems();
        return {
          output: {
            ok: left.length === 0,
            problems: left,
            open_questions: session.pending.map((q) => ({ id: q.id, text: q.text })),
          },
        };
      },
    }),

    // ---- Ask (the drill) ----
    tool({
      name: "ask_user",
      kind: "look",
      description:
        "Ask the user one question, shown on the draft next to `step`. Either an open question by its id, whose answer goes into the workflow by itself, or your own question with options and a default; you get the answer and change the workflow yourself",
      input: z.object({
        id: z.string().optional(),
        question: z.string().optional(),
        options: z.array(z.string()).max(6).optional(),
        default: z.string().optional(),
        step: z.string().optional(),
      }),
      run: async ({ id, question, options, default: fallback, step }) => {
        if (session.asked >= session.maxQuestions) {
          return { output: `You have asked ${session.maxQuestions} questions: decide the rest yourself, or finish.` };
        }
        const open = id ? session.pending.find((q) => q.id === id) : undefined;
        if (id && !open)
          return { output: `No open question ${id}. Open: ${session.pending.map((q) => q.id).join(", ")}` };
        const asking: Question = open ?? {
          id: `design-${session.asked + 1}`,
          text: question ?? "",
          options: options?.map((label) => ({ label })),
          default: fallback,
        };
        if (!asking.text) return { output: "Give the question, or the id of an open question." };
        session.asked++;
        const answer =
          (await session.prompter.ask(asking, { step, draft: session.draft })).trim() || asking.default || "";
        session.answered.push({ question: asking, answer });
        if (!open) return { output: { answer } };
        session.pending = session.pending.filter((q) => q !== open);
        if (!answer || !open.appliesTo) return { output: { answer } };
        const applied = applyAnswer(session.draft, open, answer);
        if (!applied.ok) return { output: { answer, not_applied: applied.error } };
        const broken = designViolations(session.original, applied.skill, session.form);
        if (broken.length > 0) return { output: { answer, not_applied: broken } };
        session.draft = applied.skill;
        return { output: { answer, applied: true, workflow: outlineOf(session.draft) } };
      },
    }),

    // ---- Finish ----
    tool({
      name: "finish",
      kind: "finish",
      description: "The workflow is right: end with one sentence saying what you changed",
      input: z.object({ summary: z.string().min(1).max(300) }),
      run: ({ summary }) => {
        const left = problems();
        if (left.length > 0) return { output: { refused: "not finished yet", problems: left } };
        return { output: "finished", finish: { summary } };
      },
    }),
  ];
}
