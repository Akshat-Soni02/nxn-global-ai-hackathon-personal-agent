// The design agent (docs/design.md, "3. Understand" and "Agents"): after Stop, the one AI that reads the recording.
// It gets the plain step list code built (every action, with what was said and seen next to the step it happened
// over, and the narration on its own), the description, and memory. Its first move labels every step (label_steps:
// what it is for, values that change as inputs, checks, approvals); then it makes the list do what the user meant:
// repeated work a loop, "only if" a branch, reading and picking an llm step. It is the only AI that asks the user
// anything. It changes the draft only through the edit operations, within designViolations' rules, and ends with
// `finish`.
//
// If it stops early (out of turns or money, an error, no model), its last valid draft is kept, with the answers the
// user already gave in it; if it changed nothing, that is the plain step list. A recording is never lost.
import { type AgentEvent, type Budget, type Episode, type Protocol, runAgent } from "@shadow/agent";
import { briefing, type EditInput, type Skill } from "@shadow/core";
import type { Llm, UsageMeter } from "@shadow/llm";
import type { MemoryStore } from "@shadow/memory";
import { type Base, type Form, labelRules, type Question } from "../compile.ts";
import type { Prompter } from "../drill.ts";
import { narrationOf } from "../narration.ts";
import type { NormalisedStep } from "../normalise.ts";
import { plainChecks } from "../plain-checks.ts";
import { skeletonOf } from "../skeleton.ts";
import { describeChanges } from "./changes.ts";
import {
  type DesignFinish,
  type DesignSession,
  designTools,
  type Note,
  outlineOf,
  recordedFolders,
  recordedOpens,
  recordedPages,
  recordingView,
  slotOf,
} from "./tools.ts";

// 16 turns (a long recording needs several looks and edits), $0.10, no live actions, and no time limit: a question
// waits for a person.
export const DESIGN_BUDGET: Partial<Budget> = { turns: 16, costUsd: 0.1, liveActions: 0 };
export const MAX_QUESTIONS = 5;

export interface DesignOptions {
  llm: Llm;
  // The workflow it starts from (the plain step list), and the questions code knows it can't decide (none asked yet).
  skill: Skill;
  questions: Question[];
  // The plain step list as code built it, to label first (label_steps). The daemon always passes it; without it the
  // agent starts from `skill` as it is (tests, older callers).
  base?: Base;
  // The recording by meaning (normalise), what the draft was compiled from.
  steps: NormalisedStep[];
  form?: Form;
  notes?: Note[];
  // The recording's Never and private words, masked in the values the model reads.
  maskTerms?: string[];
  memory?: Pick<MemoryStore, "search">;
  prompter: Prompter;
  // What else must hold before it may finish (the daemon's go-live checks for an unattended Frequency).
  checks?: (skill: Skill) => string[];
  // A recorded step's masked picture, described by the vision model (describe_step_screenshot). Only with pictures consent.
  describeScreen?: (step: NormalisedStep) => Promise<string>;
  budget?: Partial<Budget>;
  maxQuestions?: number;
  protocol?: Protocol;
  meter?: UsageMeter;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

export type DesignOutcome = {
  skill: Skill;
  // Questions still to ask (the drill after the agent: only those whose answer the agent left untouched), and the
  // ones answered during it.
  pending: Question[];
  answered: { question: Question; answer: string }[];
  // What the agent was told (its system prompt and first message), kept for debugging a poor result.
  prompt: { system: string; task: string };
  // What really changed from the plain step list, worked out from the workflow itself (labels and answers included),
  // never from the agent's summary: what the history note says.
  changes: string[];
  episode?: Episode<DesignFinish>;
} & ({ kind: "designed"; summary: string; edits: EditInput[] } | { kind: "kept"; reason: string });

export async function designWorkflow(options: DesignOptions): Promise<DesignOutcome> {
  const session: DesignSession = {
    original: options.skill,
    folders: recordedFolders(options.steps, options.skill),
    pages: recordedPages(options.steps),
    opens: recordedOpens(options.steps, skeletonOf(options.steps).idsByStep),
    draft: options.skill,
    form: options.form,
    steps: options.steps,
    idsByStep: skeletonOf(options.steps).idsByStep,
    notes: options.notes ?? [],
    maskTerms: options.maskTerms ?? [],
    pending: [...options.questions],
    answered: [],
    baseline: new Map(options.questions.map((q) => [q.id, slotOf(options.skill, q.appliesTo)])),
    base: options.base,
    labelled: !options.base,
    asked: 0,
    maxQuestions: options.maxQuestions ?? MAX_QUESTIONS,
    evidenceShown: new Set(),
    modelQuestions: new Set(),
    whenAsked: false,
    edits: [],
    prompter: options.prompter,
    memory: options.memory,
    checks: options.checks,
    describe: options.describeScreen,
  };
  const labelling = options.base
    ? `\n\n# Your first move: label_steps\nBefore any other change or question, label every step of the plain list in one label_steps call, by these rules (the same JSON fields as a step: id, intent, args, check, wait, requires_approval, save_as, timeout_ms, ai; and for the whole task: id, intent, inputs, success):\n${labelRules().join("\n")}`
    : "";
  const prompt = { system: `${ROLE}${labelling}\n\n${briefing({ edits: true })}`, task: taskOf(session) };
  const episode = await runAgent<DesignFinish>({
    llm: options.llm,
    profile: "smart",
    ...prompt,
    tools: designTools(session),
    budget: { ...DESIGN_BUDGET, ...options.budget },
    protocol: options.protocol,
    meter: options.meter,
    signal: options.signal,
    onEvent: options.onEvent,
  });

  const outcome = episode.outcome;
  if (outcome.kind === "finished") {
    return {
      kind: "designed",
      // url checks as the player reads them: a part of the address, not a regex the model wrote.
      skill: plainChecks(session.draft),
      summary: outcome.value.summary,
      edits: session.edits,
      pending: session.pending.filter((q) => stillOpen(session, q)),
      answered: session.answered,
      prompt,
      changes: describeChanges(options.skill, session.draft),
      episode,
    };
  }
  // It stopped early (out of turns or money, an error, stopped): whatever it reached is kept. Every change it made
  // passed the schema and the rules, so its last draft is a valid workflow, with the answers already given written
  // in; if it changed nothing, that is the plain step list. Nothing is thrown away, and nothing is asked twice.
  const kept = plainChecks(session.draft);
  const reason =
    outcome.kind === "out_of_budget"
      ? `it ran out of ${outcome.budget}`
      : outcome.kind === "error"
        ? `it failed: ${outcome.error}`
        : "it was stopped";
  return {
    kind: "kept",
    reason,
    skill: kept,
    pending: session.pending.filter((q) => stillOpen(session, q)),
    answered: session.answered,
    prompt,
    changes: describeChanges(options.skill, session.draft),
    episode,
  };
}

// A question is asked after the agent only if the place its answer goes is as it was when the question appeared:
// if the agent changed it (from what was said or shown), it decided; if it removed the step or input, there is
// nothing left to ask. The drill never repeats what the agent already settled.
function stillOpen(session: DesignSession, question: Question): boolean {
  const now = slotOf(session.draft, question.appliesTo);
  if (now === null) return false;
  return !session.baseline.has(question.id) || session.baseline.get(question.id) === now;
}

const ROLE = `You are Shadow's design agent. A person described a task and showed it once, often saying out loud what
they mean. Code and one model call turned the recording into a first draft: a flat list of steps that replays what
they did, once. Make the draft do what they meant, so it runs right next time, with next time's data.
- Your first message has the description, what they said, the recording (read_recording shows more) and the draft.
- The description and what they said are the rule; the recording is one example of it. "The top 5", "skip the ones
  already in my sheet", "only remote ones", "if there are fewer, take what there is" are rules the workflow follows.
- Values that will be different next time (what the description says changes: an email, a file, a date, numbers)
  must not stay as fixed text: make them inputs, or take them from an earlier step's output. A date they typed is
  usually the day it runs: {{today}}.
- The same actions done for several items become one loop (wrap_in_loop) over a list an earlier step produces. Shown
  once but said to be done for several ("do this for 5 a day") is a loop too.
- "Only if" (in the description or what was said) becomes a branch (wrap_in_branch).
- Reading, summarising, classifying, picking or working something out from text becomes an llm step (add_llm_step).
  llm steps never click or type.
- A common shape: read a list (web.extract), pick the items wanted with an llm step (the top N, only new ones, a
  filter), then a loop whose body is the recorded steps for one item, with the item's fields in place of the
  recorded values.
- Controls come only from the recording: you may move, wrap, replace and remove steps and change their intents, args,
  waits, checks and outputs, never invent a click on something the person didn't use. Remove what is noise: clicks
  that only selected text to copy, repeated page loads, detours (Drive → Recent → the file becomes "open the file").
  Keep the work they showed (typing, pasting, choosing, uploading) unless a loop now does it. Keep a step that opens
  the first page. If the task needs a control they didn't use, ask them. The user reviews what you changed.
- Never change the goal (the user's own words), and never turn approval off.
- How often it runs comes from what they said or wrote ("every morning", "daily", "on Mondays"): set it on step
  "start" (field "when", a schedule with a cron in the Mac's time). If they didn't say a time, pick a sensible one or
  ask (step "start"). Leave it by hand only when nothing says how often.
- Never ask what the goal, what they said, the recorded pages and values or the screen already answer: use it.
  ask_user looks in the recording first and shows you what it holds about your question; if that answers it, edit
  instead of asking. Before asking, recall: they may have told Shadow before. Ask only what the next run can't do
  without, with options and a default, at most ${MAX_QUESTIONS} questions; each names the step its answer changes, and
  a lasting fact about them (where their files land, which sheet they use) is marked remember. An open question whose
  answer you leave untouched is asked after you finish. An answer that comes back not_applied, and the answer to a
  question of your own, are yours to put into the workflow with an edit.
- describe_step_screenshot shows a recorded step's screenshot, described (when the user allowed pictures). Use it for
  every step marked nameless (a click with no control name, a drawn sheet or canvas), to see which item of a list was
  chosen or what a sheet held, and before asking anything about what was on screen.
- Keep step ids. Edits that are valid on their own are kept even when others in the same call aren't, so small,
  focused calls are fine. Every result says what still stops the workflow (still_to_fix): fix those before you
  finish. When nothing is left, finish with one sentence on what you changed (the saved history lists the real
  changes, from the workflow itself). If the draft is already right, finish at once.`;

function taskOf(session: DesignSession): string {
  const form = session.form;
  const said = narrationOf(session.steps, session.notes);
  return [
    "# The description",
    form
      ? JSON.stringify({
          ...form.description,
          // Only the goal was asked before recording; how often it runs is set from what they said, unless fixed.
          frequency: form.whenFixed ? form.when : "not given before recording: set it from what they said, if anything",
        })
      : "None was filled in: work out the goal from the recording.",
    "",
    // All of it, whatever the recording's length: what they said is what they mean.
    "# What they said while doing it (in order, with the recorded steps it was said over)",
    said.length > 0
      ? ["<untrusted_data>", ...said.map((s) => `- [${s.during}] ${s.said}`), "</untrusted_data>"].join("\n")
      : "Nothing: there was no narration.",
    "",
    "# The recording (by meaning; screen words shortened here, read_recording shows any part in full)",
    "<untrusted_data>",
    JSON.stringify(recordingView(session, 1, 40, { brief: true })),
    session.steps.length > 40 ? `… and ${session.steps.length - 40} more steps` : "",
    "</untrusted_data>",
    "",
    "# The draft",
    outlineOf(session.draft),
    "",
    "# Open questions from the first draft",
    session.pending.length > 0
      ? session.pending
          .map(
            (q) =>
              `- ${q.id}: ${q.text}${q.options?.length ? ` (options: ${q.options.map((o) => o.label).join(" / ")})` : ""}${q.default ? ` [default: ${q.default}]` : ""}`,
          )
          .join("\n")
      : "None.",
  ].join("\n");
}
