// The design agent's tools (docs/design.md, "The design agent's tools"), over one session: the compiled draft it
// starts from, the draft it is changing, the recording, and the questions still open. Look tools read; edit tools
// change the draft through core's edit operations, and every change is checked against what the agent may never do
// (designViolations) before it is kept; ask_user is the drill; finish ends.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
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
import { type Note, notesByStep } from "../narration.ts";
import type { NormalisedStep } from "../normalise.ts";

export type { Note } from "../narration.ts";
export { notesByStep } from "../narration.ts";

export interface DesignSession {
  // Where every target and site comes from: the workflow as compiled from the recording.
  original: Skill;
  // The folders the recording touched: the only places a new step may read from.
  folders: string[];
  draft: Skill;
  form?: Form;
  steps: NormalisedStep[];
  idsByStep: string[][];
  notes: Note[];
  // The first draft's questions not asked yet, and the answers given so far (to them and to the agent's own).
  pending: Question[];
  answered: { question: Question; answer: string }[];
  // Open questions the description or the narration already answered, with the words that answer them.
  closed: { question: Question; quote: string }[];
  asked: number;
  maxQuestions: number;
  edits: EditInput[];
  prompter: Prompter;
  memory?: Pick<MemoryStore, "search">;
  // What else must hold before the workflow is finished: what an unattended run needs (the daemon's go-live checks).
  checks?: (skill: Skill) => string[];
  // The masked picture of a recorded step, described by the vision model (only with the user's pictures consent).
  describe?: (step: NormalisedStep) => Promise<string>;
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

// A path as the player will open it: ~ expanded, made absolute, and symlinks followed as far as the path exists, so
// a link inside an allowed folder can't reach outside it.
const expand = (path: string): string => {
  const abs = resolve(path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
  let head = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return abs;
      tail.unshift(basename(head));
      head = parent;
    }
  }
};
const inside = (where: unknown, folders: string[]): boolean =>
  typeof where === "string" && folders.some((f) => expand(where) === f || expand(where).startsWith(`${f}${sep}`));
// A whole-string reference to a value an earlier step produced, or a run was given.
const isReference = (where: unknown): boolean => typeof where === "string" && /^\{\{[^}]+\}\}$/.test(where.trim());
// A glob that leaves its folder: absolute, from ~, or climbing with "..".
const climbs = (glob: unknown): boolean =>
  typeof glob === "string" && (isAbsolute(glob) || glob.startsWith("~") || /(^|[\\/])\.\.([\\/]|$)/.test(glob));
// The arguments of fs steps that name a place on disk.
const PATH_ARGS = ["dir", "path", "from", "to"] as const;

// The folders a recording touched (files picked, dropped, moved or downloaded, the folder its trigger watches, and
// where the first draft looks for files): a new or changed fs step may look only there, so no step can read ~/.ssh
// and hand it to an llm step.
export function recordedFolders(steps: NormalisedStep[], original: Skill): string[] {
  const paths = steps.flatMap((s) => [
    s.path,
    s.toPath,
    s.file?.path,
    ...(s.files ?? []).map((f) => f.path),
    ...(s.produces ?? []),
  ]);
  const folders = paths.filter((p): p is string => !!p).map((p) => dirname(expand(p)));
  const trigger = triggerOf(original);
  for (const input of Object.values(trigger.inputs)) {
    if (typeof input.resolve?.dir === "string") folders.push(expand(input.resolve.dir));
  }
  for (const when of trigger.when) {
    const dir = (when as { dir?: unknown }).dir;
    if (typeof dir === "string") folders.push(expand(dir));
  }
  for (const { step } of walkSteps(original.steps)) {
    if (isAction(step) && step.channel === "fs" && typeof step.args.dir === "string")
      folders.push(expand(step.args.dir));
  }
  return [...new Set(folders)];
}

// Every way the draft breaks the rules, as sentences the agent reads; empty when it may be kept.
//   targets       only from the recording: no new control, and no control changed
//   actions       a new step may only read (READ_ONLY), and files only in folders the recording touched; a recorded
//                 step keeps its kind of action
//   reach         no script steps, no navigating to a site the recording didn't visit
//   the user's    the form's description and Frequency stay as written
//   safety        approval is never turned off, and a step that needs it is never removed
export function designViolations(original: Skill, draft: Skill, form?: Form, folders: string[] = []): string[] {
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
  const visited = [...before.values()].filter(isAction).flatMap((s) => (s.action === "navigate" ? [s.args.url] : []));
  // A local file has no site (its origin is "null"): it counts only by its exact address.
  const sites = new Set(visited.map(originOf).filter((o): o is string => !!o && o !== "null"));
  const pages = new Set(visited.filter((u): u is string => typeof u === "string" && /^file:/i.test(u)));
  const after = new Map<string, Step>([...walkSteps(draft.steps)].map(({ step }) => [step.id, step]));
  const where = `folders the recording touched (${folders.join(", ") || "none"})`;

  // An input the agent declares may not point outside those folders either (a default path, or where to look).
  const inputsBefore = triggerOf(original).inputs;
  for (const [name, input] of Object.entries(triggerOf(draft).inputs)) {
    if (same(inputsBefore[name], input)) continue;
    const fixed = typeof input.default === "string" && /^[~/]/.test(input.default) ? input.default : undefined;
    for (const place of [input.resolve?.dir, fixed]) {
      if (place !== undefined && !inside(place, folders)) {
        problems.push(`${name}: an input may only point at ${where}, not ${String(place)}`);
      }
    }
  }

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
    // Every place a new or changed fs step names must be in a folder the recording touched (a reference to a value
    // an earlier step produced, or a run was given, is fine), and its glob stays in its folder.
    if (step.channel === "fs" && !(old && isAction(old) && same(old.args, step.args))) {
      for (const key of PATH_ARGS) {
        const place = step.args[key];
        if (place === undefined || isReference(place) || inside(place, folders)) continue;
        problems.push(`${step.id}: it may only look in ${where}, not ${String(place)}`);
      }
      if (climbs(step.args.glob)) {
        problems.push(`${step.id}: its glob (${String(step.args.glob)}) must stay inside its folder`);
      }
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
      const url = step.args.url;
      const origin = originOf(url);
      const ok =
        typeof url === "string" && /^file:/i.test(url)
          ? pages.has(url)
          : !!origin && origin !== "null" && sites.has(origin);
      if (!ok) {
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
// Words only, for comparing a quote with what was written or said: case, punctuation and spacing don't count.
const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// The recording by meaning (what compile's model saw), each step with the skill steps it became and what was said
// or seen around it. `brief` (the agent's first message): a screen's words cut short, and a screen like the one
// before it said once, so 30 screenshots of the same page don't bury the 14 sentences the person said. read_recording
// shows them whole.
export function recordingView(
  session: DesignSession,
  from = 1,
  to = session.steps.length,
  { brief = false } = {},
): unknown[] {
  const view = stepsForModel(session.steps, session.idsByStep);
  let near = notesByStep(session.steps, session.notes);
  if (brief) {
    let last = "";
    near = near.map((notes) =>
      notes.map((note) => {
        if (!note.startsWith("on screen: ")) return note;
        const full = note.slice("on screen: ".length);
        const words = full.slice(0, BRIEF_SCREEN);
        if (words === last) return "on screen: (as before)";
        last = words;
        return `on screen: ${words}${full.length > BRIEF_SCREEN ? "…" : ""}`;
      }),
    );
  }
  return view
    .map((step, i) => ({ n: i + 1, ...step, ...(near[i]?.length ? { notes: near[i] } : {}) }))
    .slice(Math.max(0, from - 1), Math.max(from, to));
}
const BRIEF_SCREEN = 300;

// ---- The tools ------------------------------------------------------------------------------------------------

const StepIds = z.array(z.string()).min(1);
const OutputSpec = z.object({ name: z.string(), type: z.record(z.string(), z.unknown()) });

export function designTools(session: DesignSession): AnyTool<DesignFinish>[] {
  const problems = () => session.checks?.(session.draft) ?? [];
  // Applies edits to the draft if the result parses, passes check.ts and breaks no rule; else nothing changes. Every
  // kept edit comes back with what still stops the workflow (validate, inside the loop): the agent fixes its own
  // draft as it goes, instead of finding out at finish.
  const change = (edits: EditInput[]) => {
    const result = applyEdits(session.draft, edits);
    if (!result.ok) return { output: { ok: false, problems: result.problems } };
    const broken = designViolations(session.original, result.skill, session.form, session.folders);
    if (broken.length > 0) return { output: { ok: false, refused: broken } };
    session.draft = result.skill;
    session.edits.push(...edits);
    return {
      output: {
        ok: true,
        workflow: outlineOf(session.draft),
        still_to_fix: problems(),
        // A reminder, not a block: each one is asked, closed, or asked after the agent finishes.
        ...(session.pending.length > 0 ? { open_questions: session.pending.map((q) => `${q.id}: ${q.text}`) } : {}),
      },
    };
  };
  const nextId = (prefix: string) => {
    const used = new Set([...walkSteps(session.draft.steps)].map(({ step }) => step.id));
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  };

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
      name: "describe_screen",
      kind: "look",
      description:
        "What was on screen at recorded step n: its picture (private text blacked out) described by the vision model. Only with the user's consent, and only when the words near the step don't say what the control was for",
      input: z.object({ step: z.number().int().min(1) }),
      run: async ({ step }) => {
        const recorded = session.steps[step - 1];
        if (!recorded) return { output: `No step ${step}: the recording has ${session.steps.length}` };
        if (!session.describe) return { output: "No pictures: the user did not allow pictures to be sent." };
        try {
          return { output: await session.describe(recorded), untrusted: true };
        } catch (error) {
          return { output: `Couldn't describe it: ${(error as Error).message}` };
        }
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
        // An answer that couldn't go in by itself is still the user's answer: the agent puts it in, or it is lost.
        const yours = "the user answered this: put it into the workflow yourself with an edit";
        const applied = applyAnswer(session.draft, open, answer);
        if (!applied.ok) return { output: { answer, not_applied: applied.error, now: yours } };
        const broken = designViolations(session.original, applied.skill, session.form, session.folders);
        if (broken.length > 0) return { output: { answer, not_applied: broken, now: yours } };
        session.draft = applied.skill;
        return { output: { answer, applied: true, workflow: outlineOf(session.draft) } };
      },
    }),

    tool({
      name: "close_question",
      kind: "look",
      description:
        "Close an open question the description or what they said already answers, quoting their words exactly (`quote`): it is never put to the user. Then make the workflow use what they said",
      input: z.object({ id: z.string(), quote: z.string().min(1) }),
      run: ({ id, quote }) => {
        const open = session.pending.find((q) => q.id === id);
        if (!open) return { output: `No open question ${id}. Open: ${session.pending.map((q) => q.id).join(", ")}` };
        // Only their own words close a question: the agent can't decide for the user by claiming they said it.
        const said = [
          ...(session.form ? Object.values(session.form.description).flat() : []),
          ...session.notes.filter((n) => n.kind === "said").map((n) => n.text),
        ].map((text) => plain(String(text)));
        const words = plain(quote);
        if (words.length < 3 || !said.some((text) => text.includes(words))) {
          return {
            output: `"${quote}" is not in the description or what they said: quote their exact words, or ask the question instead.`,
          };
        }
        session.pending = session.pending.filter((q) => q !== open);
        session.closed.push({ question: open, quote });
        return { output: { closed: id, now: "make the workflow use it if it doesn't yet" } };
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
