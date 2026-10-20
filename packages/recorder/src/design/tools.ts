// The design agent's tools (docs/design.md, "The design agent's tools"), over one session: the compiled draft it
// starts from, the draft it is changing, the recording, and the questions still open. Look tools read; edit tools
// change the draft through core's edit operations, and every change is checked against what the agent may never do
// (designViolations) before it is kept; ask_user is the drill; finish ends.
import { type AnyTool, tool } from "@shadow/agent";
import {
  applyEdits,
  type EditInput,
  isAction,
  isOutward,
  type Locator,
  type Skill,
  type Step,
  triggerOf,
  walkSteps,
} from "@shadow/core";
import type { MemoryStore } from "@shadow/memory";
import { z } from "zod";
import { type Base, type Form, Labels, labelDraft, type Question, stepsForModel } from "../compile.ts";
import { applyAnswer, type Prompter } from "../drill.ts";
import { type Note, notesByStep } from "../narration.ts";
import type { NormalisedStep } from "../normalise.ts";
import { clip, outlineOf } from "./v2/outline.ts";
import { climbs, inside, isReference, originOf, PATH_ARGS, samePage, withDates } from "./v2/places.ts";

export type { Note } from "../narration.ts";
export { notesByStep } from "../narration.ts";
export { outlineOf } from "./v2/outline.ts";
export { recordedFolders, recordedOpens, recordedPages } from "./v2/places.ts";
export { slotOf } from "./v2/questions.ts";

export interface DesignSession {
  // Where every target and site comes from: the workflow as compiled from the recording.
  original: Skill;
  // The folders the recording touched: the only places a new step may read from.
  folders: string[];
  // Every page the recording was on or reached: the only sites a step may open.
  pages: string[];
  // For each skill step a recorded click became, the page it opened.
  opens: Record<string, string>;
  draft: Skill;
  form?: Form;
  steps: NormalisedStep[];
  idsByStep: string[][];
  notes: Note[];
  // Words masked wherever the recording's values reach the model: the Never list and the private words.
  maskTerms?: string[];
  // The first draft's questions not asked yet, and the answers given so far (to them and to the agent's own).
  pending: Question[];
  answered: { question: Question; answer: string }[];
  // Code's questions the recording already answered (spec 2.10): applied to the plain list, and again after labelling,
  // which rebuilds the draft from the plain list.
  found: { question: Question; answer: string }[];
  // For each open question, what sat where its answer goes when the question appeared (slotOf): if the agent changes
  // that place, it decided from what was said, and the question isn't asked after it.
  baseline: Map<string, string | null>;
  // The plain step list, to label first (label_steps), and whether that happened. Without one there is nothing to label.
  base?: Base;
  labelled: boolean;
  asked: number;
  maxQuestions: number;
  // Questions already shown what the recording holds about them (ask_user looks there first), by their text.
  evidenceShown: Set<string>;
  // Open questions a model wrote (label_steps), by id: like the agent's own, they are checked against the recording
  // before they are asked. Code's questions ask about next time ("which file?"), which one recording can't answer.
  modelQuestions: Set<string>;
  // The user was asked about the run's settings (step "start"): what they answered about how often it runs stands.
  whenAsked: boolean;
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

// Steps the agent may add: they only read or open a page the recording visited; they change nothing.
const READ_ONLY = new Set(["fs.find", "fs.read", "data.pick", "web.extract", "web.wait_for", "web.navigate"]);

// Every way the draft breaks the rules, as sentences the agent reads; empty when it may be kept.
//   targets       only from the recording: no new control, and no control changed
//   actions       a new step may only read (READ_ONLY), and files only in folders the recording touched; a recorded
//                 action keeps its kind (or becomes "open the page it opened"), or is replaced or removed
//   reach         no script steps, no navigating to a site the recording didn't visit
//   the user's    the goal stays as written; how often it runs too, when it is fixed (recorded again)
//   safety        approval is never turned off; a workflow that opened a page first still does
// `recording`: every page the recording was on or reached (by a click, too), and for each recorded click the page it
// opened (by skill step id), so a click may become "open that page" and nothing else.
export function designViolations(
  original: Skill,
  draft: Skill,
  form?: Form,
  folders: string[] = [],
  recording: { pages?: string[]; opens?: Record<string, string> } = {},
): string[] {
  const problems: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  // Only the goal is the user's own words, written before recording. How often it runs is set from what they said,
  // unless it is fixed (a task recorded again keeps its workflow's).
  if (form?.whenFixed && !same(triggerOf(draft).when, triggerOf(original).when)) {
    problems.push("how often it runs is the user's (this workflow already had it): it can't change");
  }
  if (form && draft.description.goal !== original.description.goal) {
    problems.push("the goal is the user's (their own words before recording): it can't change");
  }

  const before = new Map<string, Step>([...walkSteps(original.steps)].map(({ step }) => [step.id, step]));
  const recorded = new Set([...before.values()].filter(isAction).map((s) => keyOf(s.target)));
  const visited = [
    ...[...before.values()].filter(isAction).flatMap((s) => (s.action === "navigate" ? [s.args.url] : [])),
    ...(recording.pages ?? []),
  ];
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
      if (place !== undefined && !inside(withDates(place), folders)) {
        problems.push(`${name}: an input may only point at ${where}, not ${String(place)}`);
      }
    }
  }

  for (const step of after.values()) {
    const old = before.get(step.id);
    // A recorded action may be replaced (by an llm step, a loop) or removed: the user reviews the result.
    if (!isAction(step)) continue;
    const kind = `${step.channel}.${step.action}`;
    // A recorded step that only took them to a page (a click, a key press such as Enter in a search box) may become
    // "open that page", that page and no other (Drive -> Recent -> the sheet becomes one step that opens the sheet).
    // Never a step that submitted, sends or needs approval: its page is a result, and opening it would skip the work.
    const clickToPage =
      !!old &&
      isAction(old) &&
      old.channel === "web" &&
      (old.action === "click" || old.action === "press") &&
      kind === "web.navigate";
    const opened =
      clickToPage &&
      isAction(old) &&
      !old.requires_approval &&
      !isOutward(old) &&
      samePage(step.args.url, recording.opens?.[step.id]);
    if (!old && !READ_ONLY.has(kind)) {
      problems.push(
        `${step.id}: a new ${kind} step would do something the user didn't show. Only steps that read (${[...READ_ONLY].join(", ")}) can be added; ask the user to show the rest`,
      );
    } else if (clickToPage && !opened) {
      problems.push(
        `${step.id}: a step may become "open this page" only for the page it opened (${recording.opens?.[step.id] ?? "it opened none"}), and never one that submits, sends or needs approval`,
      );
    } else if (old && !opened && (!isAction(old) || `${old.channel}.${old.action}` !== kind)) {
      problems.push(
        `${step.id}: a recorded step keeps its kind of action (it was ${isAction(old) ? `${old.channel}.${old.action}` : old.type})`,
      );
    }
    // Every place a new or changed fs step names must be in a folder the recording touched (a reference to a value
    // an earlier step produced, or a run was given, is fine), and its glob stays in its folder.
    if (step.channel === "fs" && !(old && isAction(old) && same(old.args, step.args))) {
      for (const key of PATH_ARGS) {
        const place = step.args[key];
        if (place === undefined || isReference(place) || inside(withDates(place), folders)) continue;
        problems.push(`${step.id}: it may only look in ${where}, not ${String(place)}`);
      }
      if (climbs(withDates(step.args.glob))) {
        problems.push(`${step.id}: its glob (${String(step.args.glob)}) must stay inside its folder`);
      }
    }
    if (step.target && !recorded.has(keyOf(step.target))) {
      problems.push(
        `${step.id}: its target is not one you recorded. Targets come only from the recording: if a step needs a control the user didn't use, ask them`,
      );
    } else if (old && isAction(old) && old.target && !clickToPage && keyOf(old.target) !== keyOf(step.target)) {
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
  // Recorded steps may be removed (noise: selection clicks, repeated page loads, detours): the agent runs in front of
  // the user, who sees what changed (describeChanges) and reviews the workflow before it runs.
  // Runs start on a blank window: a workflow whose first web step opened a page must still open one first.
  const firstWeb = (skill: Skill) =>
    [...walkSteps(skill.steps)].map(({ step }) => step).find((s) => isAction(s) && s.channel === "web");
  const wasFirst = firstWeb(original);
  const nowFirst = firstWeb(draft);
  if (
    wasFirst &&
    isAction(wasFirst) &&
    wasFirst.action === "navigate" &&
    nowFirst &&
    isAction(nowFirst) &&
    nowFirst.action !== "navigate"
  ) {
    problems.push(
      `${nowFirst.id}: runs start on a blank window, so the workflow must still open a page first (${wasFirst.id} did): keep it, or open a page the recording visited`,
    );
  }
  // A step that needs approval may go, but while it stays its approval stays on.
  for (const [id, old] of before) {
    if (!("requires_approval" in old) || !old.requires_approval) continue;
    const now = after.get(id);
    if (now && (!("requires_approval" in now) || !now.requires_approval)) {
      problems.push(`${id}: approval can't be turned off`);
    }
  }
  return problems;
}

// ---- Showing the workflow ------------------------------------------------------------------------------------

// The recording by meaning (what compile's model saw), each step with the skill steps it became and the screen words
// seen at it. `brief` (the agent's first message): of each picture's words, only the lines around what the step
// acted on (the line holding the clicked control's name, a typed or copied value, and a few lines either side), or the
// top of the page when no line holds them; a stretch like the one before is said once. A page's full text is mostly
// menus and headers, and 29 of them buried the 14 sentences the person said. read_recording shows them whole.
export function recordingView(
  session: DesignSession,
  from = 1,
  to = session.steps.length,
  { brief = false } = {},
): unknown[] {
  const view = stepsForModel(session.steps, session.idsByStep, session.maskTerms);
  let near = notesByStep(session.steps, session.notes);
  if (brief) {
    let last = "";
    near = near.map((notes, i) =>
      notes.map((note) => {
        if (!note.startsWith("on screen: ")) return note;
        const { words, around } = focusOn(note.slice("on screen: ".length), anchorsOf(view[i]));
        if (words === last) return "on screen: (as before)";
        last = words;
        return around ? `on screen, around "${around}": ${words}` : `on screen, top of page: ${words}`;
      }),
    );
  }
  return view
    .map((step, i) => ({
      n: i + 1,
      ...step,
      ...(near[i]?.length ? { notes: near[i] } : {}),
      // A control with no name (a link with no text, a click on a drawn sheet or canvas): what it was is only in the
      // picture. Said here so the agent looks rather than guesses or asks.
      ...(session.describe && namelessAction(step) ? { nameless: `describe_step_screenshot ${i + 1} shows it` } : {}),
    }))
    .slice(Math.max(0, from - 1), Math.max(from, to));
}

// A click, drag or key press whose control had no name or label.
function namelessAction(step: ReturnType<typeof stepsForModel>[number]): boolean {
  if (!["click", "drag", "press", "app_press"].includes(String(step.did))) return false;
  const element = step.element as { name?: unknown; label?: unknown } | undefined;
  return !element?.name && !element?.label;
}
// Lines either side of the one that holds what the step acted on, and the most characters of either kind of excerpt.
const AROUND_LINES = 4;
const AROUND_CHARS = 600;
const TOP_CHARS = 300;

// The words a step acted on, as they'd appear on screen: the control's name or label, a typed or copied value.
function anchorsOf(step: ReturnType<typeof stepsForModel>[number] | undefined): string[] {
  const element = step?.element as { name?: unknown; label?: unknown } | undefined;
  return [element?.name, element?.label, step?.value, step?.copied]
    .filter((w): w is string => typeof w === "string" && w.trim().length >= 2 && !w.startsWith("(secret"))
    .map((w) => w.trim().slice(0, 40));
}

// The lines of a picture's words around the first one holding an anchor, or its top when none does.
function focusOn(text: string, anchors: string[]): { words: string; around?: string } {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const anchor of anchors) {
    const at = lines.findIndex((l) => l.toLowerCase().includes(anchor.toLowerCase()));
    if (at < 0) continue;
    const words = lines.slice(Math.max(0, at - AROUND_LINES), at + AROUND_LINES + 1).join(" · ");
    return { words: words.length > AROUND_CHARS ? `${words.slice(0, AROUND_CHARS)}…` : words, around: anchor };
  }
  const top = lines.join(" · ");
  return { words: top.length > TOP_CHARS ? `${top.slice(0, TOP_CHARS)}…` : top };
}

// ---- How often it runs, from what was said ------------------------------------------------------------------------

// Words that say how often a task is done ("every morning", "daily", "on Mondays").
const CADENCE =
  /\b(?:every\s+(?:single\s+)?(?:day|morning|evening|night|week|weekday|month|hour|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|weekly|monthly|hourly|each\s+(?:day|morning|week|month)|on\s+(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|weekdays))\b/i;

// What stops finishing while the goal or the narration says how often it's done and the workflow only runs by hand:
// they said it, so it should run that way. Settled once the user was asked about the run's settings (step "start"),
// and never when how often it runs is fixed (recorded again).
export function cadenceGap(session: DesignSession): string | undefined {
  if (session.form?.whenFixed || session.whenAsked) return undefined;
  if (triggerOf(session.draft).when.some((w) => w.type !== "manual")) return undefined;
  const sources: [string, string][] = [
    ["the goal", session.form?.description.goal ?? session.draft.description.goal],
    ...session.notes.filter((n) => n.kind === "said").map((n): [string, string] => ["what they said", n.text]),
  ];
  for (const [where, text] of sources) {
    const said = CADENCE.exec(text)?.[0];
    if (!said) continue;
    return `they said "${said}" (${where}), but it only runs when started by hand: set how often it runs with edit (set on step "start", field "when", e.g. [{"type":"schedule","cron":"0 9 * * *"}]), or ask them when (ask_user with step "start")`;
  }
  return undefined;
}

// ---- What the recording already says about a question -----------------------------------------------------------

// Words that say nothing about what a question is after.
const STOP_WORDS = new Set(
  "what which where when should would could does this that with from your into have there their them they the and for you want like each every need about workflow step steps run runs time please answer user".split(
    " ",
  ),
);

// What the goal, the narration, the recorded pages and values, and the screen words hold that a question is about:
// shown to the agent before the question goes to the user, so it isn't asked what was already said or shown (Oct 15:
// "What is the URL of the sheet?", with the sheet's address in the recording five times).
export function evidenceFor(session: DesignSession, question: string): string[] {
  const words = [...new Set(question.toLowerCase().match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? [])].filter(
    (w) => !STOP_WORDS.has(w),
  );
  const wantsPage = /\b(url|link|address|page|site|sheet|spreadsheet|doc|document|tab)\b/i.test(question);
  const wantsFile = /\b(file|folder|path|directory)\b/i.test(question);
  const hits = (text: string) => words.filter((w) => text.toLowerCase().includes(w)).length;
  // Free text (the goal, what was said, a value, a screen line) must share two of the question's words, or its only
  // one: a single common word ("invoice") says nothing about what is asked.
  const enough = Math.min(2, words.length);
  const about = (text: string) => words.length > 0 && hits(text) >= enough;
  const found: string[] = [];
  const add = (where: string, what: string) => {
    if (found.length < 10 && !found.some((f) => f.endsWith(`: ${what}`))) found.push(`${where}: ${what}`);
  };

  const goal = session.form?.description.goal ?? session.draft.description.goal;
  if (goal && about(goal)) add("the goal", goal);
  for (const note of session.notes) {
    if (note.kind === "said" && about(note.text)) add("they said", clip(note.text, 200));
  }
  session.steps.forEach((step, i) => {
    for (const url of [step.navigatesTo, step.url]) {
      if (url && (wantsPage || hits(url) > 0)) add(`page at step ${i + 1}`, url);
    }
    if (step.value && !step.secret && about(step.value)) add(`value at step ${i + 1}`, clip(step.value, 120));
    const path = step.path ?? step.file?.path;
    if (path && (wantsFile || hits(path) > 0)) add(`file at step ${i + 1}`, path);
  });
  for (const note of session.notes) {
    if (note.kind !== "screen") continue;
    const line = note.text.split("\n").find((l) => about(l));
    if (line) add("on screen", clip(line.trim(), 160));
  }
  return found;
}

// ---- The tools ------------------------------------------------------------------------------------------------

// The steps are labelled before anything else changes, so the labels go onto the plain list as recorded.
const LABEL_FIRST = "label the steps first: label_steps, once, before any other change or question";

const StepIds = z.array(z.string()).min(1);
const OutputSpec = z.object({ name: z.string(), type: z.record(z.string(), z.unknown()) });

export function designTools(session: DesignSession): AnyTool<DesignFinish>[] {
  const problems = () => {
    const gap = cadenceGap(session);
    return [...(session.checks?.(session.draft) ?? []), ...(gap ? [gap] : [])];
  };
  // Edits applied to a draft: the result must parse, pass check.ts and break no rule.
  const attempt = (draft: Skill, edits: EditInput[]) => {
    const result = applyEdits(draft, edits);
    if (!result.ok) return { ok: false as const, problems: result.problems };
    const broken = designViolations(session.original, result.skill, session.form, session.folders, {
      pages: session.pages,
      opens: session.opens,
    });
    if (broken.length > 0) return { ok: false as const, refused: broken };
    return { ok: true as const, skill: result.skill };
  };
  const kept = (extra: Record<string, unknown> = {}) => ({
    output: {
      ok: true,
      ...extra,
      workflow: outlineOf(session.draft),
      still_to_fix: problems(),
      // A reminder, not a block: each one is answered with an edit, asked, or asked after the agent finishes.
      ...(session.pending.length > 0 ? { open_questions: session.pending.map((q) => `${q.id}: ${q.text}`) } : {}),
    },
  });
  // Applies edits to the draft. Valid together, they are all kept. Otherwise (unless they only make sense together,
  // `together`: a loop and the steps moved into it) each edit that is valid on its own is kept, in order, and the
  // others come back with why: one bad edit never costs the rest (Oct 14: a refused batch was re-sent cut in half).
  // Every result says what still stops the workflow, so the agent fixes its own draft as it goes.
  const change = (edits: EditInput[], { together = false } = {}) => {
    if (!session.labelled) return { output: { ok: false, problems: [LABEL_FIRST] } };
    const whole = attempt(session.draft, edits);
    if (whole.ok) {
      session.draft = whole.skill;
      session.edits.push(...edits);
      return kept();
    }
    const { ok: _whole, ...why } = whole;
    if (together || edits.length === 1) return { output: { ok: false, ...why } };
    let draft = session.draft;
    const applied: EditInput[] = [];
    const failed: Record<string, unknown>[] = [];
    edits.forEach((edit, i) => {
      const one = attempt(draft, [edit]);
      if (one.ok) {
        draft = one.skill;
        applied.push(edit);
        return;
      }
      const { ok: _one, ...reason } = one;
      failed.push({ edit: i + 1, op: edit.op, step: (edit as { step?: unknown }).step, ...reason });
    });
    if (applied.length === 0) return { output: { ok: false, ...why, one_by_one: failed } };
    session.draft = draft;
    session.edits.push(...applied);
    return kept({ partly: `${applied.length} of ${edits.length} edits kept, in order`, not_applied: failed });
  };
  const nextId = (prefix: string) => {
    const used = new Set([...walkSteps(session.draft.steps)].map(({ step }) => step.id));
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  };

  // The first move when there is a plain list to label: label_steps (only then is it offered).
  const labelSteps: AnyTool<DesignFinish>[] = session.base
    ? [
        tool<Labels, DesignFinish>({
          name: "label_steps",
          kind: "edit",
          description:
            "Your first move, once: label every step of the plain list (what it is for, values that change as inputs, checks, approvals, save_as), by the labelling rules. Steps by id; no targets, channels or actions",
          input: Labels,
          run: (labels) => {
            if (session.labelled || !session.base) {
              return {
                output: { ok: false, problems: ["the steps are labelled already: change single steps with edit"] },
              };
            }
            const labelled = labelDraft(session.base, labels);
            if (!labelled.ok) return { output: { ok: false, problems: labelled.problems } };
            let skill = labelled.skill;
            for (const { question, answer } of session.found) {
              const applied = applyAnswer(skill, question, answer);
              if (applied.ok) skill = applied.skill;
            }
            const broken = designViolations(session.original, skill, session.form, session.folders, {
              pages: session.pages,
              opens: session.opens,
            });
            if (broken.length > 0) return { output: { ok: false, refused: broken } };
            // The labelled list is what the rules compare against from now on: an approval the labels added is protected.
            session.draft = skill;
            session.original = skill;
            session.labelled = true;
            session.pending.push(...labelled.questions);
            for (const q of labelled.questions) session.modelQuestions.add(q.id);
            return {
              output: {
                ok: true,
                workflow: outlineOf(session.draft),
                still_to_fix: problems(),
                // Cheap AI steps kept without asking the user: what each costs a run.
                ...(labelled.kept.length > 0 ? { ai_steps_kept: labelled.kept } : {}),
                ...(session.pending.length > 0
                  ? { open_questions: session.pending.map((q) => `${q.id}: ${q.text}`) }
                  : {}),
              },
            };
          },
        }),
      ]
    : [];

  return [
    // ---- Look ----
    tool({
      name: "read_description",
      kind: "look",
      description:
        "What the user wrote before recording: the goal (and, for a task recorded again, what it already had)",
      input: z.object({}),
      run: () => ({
        output: session.form
          ? {
              ...session.form.description,
              frequency: session.form.whenFixed
                ? session.form.when
                : "not given before recording: set it from what they said, if anything",
            }
          : "No form was filled in for this recording: work out the goal from the recording, and ask if unsure.",
      }),
    }),
    tool({
      name: "read_recording",
      kind: "look",
      description:
        "What the user did, in order and by meaning (n = step number), with the workflow steps each became (ids) and the screen words seen near it (what was said is the list in your first message). from/to: step numbers",
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
      name: "describe_step_screenshot",
      kind: "look",
      description:
        "See what was on screen at recorded step n: its picture (private text blacked out) described by the vision model. Use it whenever the words don't tell you enough: a step marked nameless (a click with no control name, a drawn page such as a sheet or canvas), which item of a list was chosen, what a table or sheet held (rows already there, the next empty row), or what the user was looking at. Look before you ask the user",
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
    ...labelSteps,
    tool({
      name: "edit",
      kind: "edit",
      description:
        "Apply edit operations to the draft, in order (see the briefing): set a field, insert, replace, remove or move any step, the trigger's when and inputs too. Valid together, all are kept; otherwise each one valid on its own is kept and the others come back with why. Small, focused calls are fine",
      input: z.object({ edits: z.array(z.record(z.string(), z.unknown())).min(1).max(100) }),
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
        return change(
          [
            { op: "insert", at: { before: steps[0] as string }, step: loop },
            ...steps.map((s): EditInput => ({ op: "move", step: s, to: { into: id } })),
          ],
          { together: true },
        );
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
        return change(
          [
            { op: "insert", at: { before: steps[0] as string }, step: branch },
            ...steps.map((s): EditInput => ({ op: "move", step: s, to: { into: id } })),
            ...(otherwise ?? []).map((s): EditInput => ({ op: "move", step: s, to: { into: id, arm: "else" } })),
          ],
          { together: true },
        );
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
        'Ask the user one question, shown on the draft next to `step`. Either an open question by its id, whose answer goes into the workflow by itself, or your own question with options and a default: then `step` is required (the id of the step its answer changes; the run\'s settings are on "start"), and you change the workflow yourself with the answer. remember: the answer is a lasting fact about them (where their files land, which sheet they use), kept for their next recordings',
      input: z.object({
        id: z.string().optional(),
        question: z.string().optional(),
        options: z.array(z.string()).max(6).optional(),
        default: z.string().optional(),
        step: z.string().optional(),
        remember: z.enum(["fact", "preference"]).optional(),
        // Ask even though the recording holds something about it (after seeing what, and finding it doesn't answer).
        confirm: z.boolean().optional(),
      }),
      run: async ({ id, question, options, default: fallback, step, remember, confirm }) => {
        if (!session.labelled) return { output: LABEL_FIRST };
        if (session.asked >= session.maxQuestions) {
          return { output: `You have asked ${session.maxQuestions} questions: decide the rest yourself, or finish.` };
        }
        const open = id ? session.pending.find((q) => q.id === id) : undefined;
        if (id && !open)
          return { output: `No open question ${id}. Open: ${session.pending.map((q) => q.id).join(", ")}` };
        // A question of its own must say what its answer changes: one that changes nothing in the workflow (\"Should I
        // continue?\") is not worth the user's time.
        if (!open && !(step && [...walkSteps(session.draft.steps)].some(({ step: s }) => s.id === step))) {
          return {
            output: `Say which step the answer changes: step = the id of a step in the workflow (the run's settings are on "start")${step ? `; there is no step ${step}` : ""}. A question whose answer changes nothing isn't asked.`,
          };
        }
        const asking: Question = open ?? {
          id: `design-${session.asked + 1}`,
          text: question ?? "",
          options: options?.map((label) => ({ label })),
          default: fallback,
          ...(remember ? { remember } : {}),
        };
        if (!asking.text) return { output: "Give the question, or the id of an open question." };
        // The recording first: what the goal, the narration, the pages, the values and the screen words hold about it.
        // Shown once per question; asked only if the agent, having seen it, still needs the user.
        const key = asking.text.trim().toLowerCase();
        const byModel = !open || session.modelQuestions.has(open.id);
        if (byModel && !confirm && !session.evidenceShown.has(key)) {
          session.evidenceShown.add(key);
          const recorded = evidenceFor(session, asking.text);
          if (recorded.length > 0) {
            return {
              output: {
                not_asked:
                  "The recording may already answer this. If it does, put the answer into the workflow with an edit instead of asking. If it doesn't, ask again with confirm: true.",
                recorded,
              },
            };
          }
        }
        session.asked++;
        const answer =
          (await session.prompter.ask(asking, { step, draft: session.draft })).trim() || asking.default || "";
        session.answered.push({ question: asking, answer });
        // Asked about the run's settings: what they said about how often it runs stands.
        if (step === "start" || open?.appliesTo?.startsWith("steps.start.when")) session.whenAsked = true;
        if (!open) return { output: { answer } };
        session.pending = session.pending.filter((q) => q !== open);
        if (!answer || !open.appliesTo) return { output: { answer } };
        // An answer that couldn't go in by itself is still the user's answer: the agent puts it in, or it is lost.
        const yours = "the user answered this: put it into the workflow yourself with an edit";
        const applied = applyAnswer(session.draft, open, answer);
        if (!applied.ok) return { output: { answer, not_applied: applied.error, now: yours } };
        const broken = designViolations(session.original, applied.skill, session.form, session.folders, {
          pages: session.pages,
          opens: session.opens,
        });
        if (broken.length > 0) return { output: { answer, not_applied: broken, now: yours } };
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
