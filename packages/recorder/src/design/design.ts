// The design agent (docs/design.md, "3. Understand" and "Agents"): after Stop, it turns the compiled first draft (a
// flat list of steps) into the workflow the user meant, using the description form, the recording, what was said and
// seen, and memory: values that change become inputs, repeated work a loop, "only if" a branch, reading and
// summarising an llm step. Unclear parts are asked (the drill). It changes the draft only through the edit operations,
// within designViolations' rules, and ends with `finish`.
//
// If it can't finish (no model, an error, its budget runs out), the compiled draft is kept, with the answers the user
// already gave applied to it: a recording is never lost, and nothing is asked twice.
import { type AgentEvent, type Budget, type Episode, type Protocol, runAgent } from "@shadow/agent";
import { briefing, type EditInput, type Skill, triggerOf, walkSteps } from "@shadow/core";
import type { Llm, UsageMeter } from "@shadow/llm";
import type { MemoryStore } from "@shadow/memory";
import type { Form, Question } from "../compile.ts";
import { applyAnswer, type Prompter } from "../drill.ts";
import { narrationOf } from "../narration.ts";
import type { NormalisedStep } from "../normalise.ts";
import { skeletonOf } from "../skeleton.ts";
import {
  type DesignFinish,
  type DesignSession,
  designTools,
  type Note,
  outlineOf,
  recordedFolders,
  recordedPages,
  recordingView,
} from "./tools.ts";

// 16 turns (a long recording needs several looks and edits), $0.10, no live actions, and no time limit: a question
// waits for a person.
export const DESIGN_BUDGET: Partial<Budget> = { turns: 16, costUsd: 0.1, liveActions: 0 };
export const MAX_QUESTIONS = 5;

export interface DesignOptions {
  llm: Llm;
  // The compiled first draft, and its questions (none asked yet).
  skill: Skill;
  questions: Question[];
  // The recording by meaning (normalise), what the draft was compiled from.
  steps: NormalisedStep[];
  form?: Form;
  notes?: Note[];
  memory?: Pick<MemoryStore, "search">;
  prompter: Prompter;
  // What else must hold before it may finish (the daemon's go-live checks for an unattended Frequency).
  checks?: (skill: Skill) => string[];
  // A recorded step's masked picture, described by the vision model (describe_screen). Only with pictures consent.
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
  // Questions still to ask (the drill after the agent), the ones answered during it, and the ones the agent closed
  // because the description or the narration already answered them (never put to the user).
  pending: Question[];
  answered: { question: Question; answer: string }[];
  closed: { question: Question; quote: string }[];
  // What the agent was told (its system prompt and first message), kept for debugging a poor result.
  prompt: { system: string; task: string };
  episode?: Episode<DesignFinish>;
} & ({ kind: "designed"; summary: string; edits: EditInput[] } | { kind: "kept"; reason: string });

export async function designWorkflow(options: DesignOptions): Promise<DesignOutcome> {
  const session: DesignSession = {
    original: options.skill,
    folders: recordedFolders(options.steps, options.skill),
    pages: recordedPages(options.steps),
    draft: options.skill,
    form: options.form,
    steps: options.steps,
    idsByStep: skeletonOf(options.steps).idsByStep,
    notes: options.notes ?? [],
    pending: [...options.questions],
    answered: [],
    closed: [],
    asked: 0,
    maxQuestions: options.maxQuestions ?? MAX_QUESTIONS,
    edits: [],
    prompter: options.prompter,
    memory: options.memory,
    checks: options.checks,
    describe: options.describeScreen,
  };
  const prompt = { system: `${ROLE}\n\n${briefing({ edits: true })}`, task: taskOf(session) };
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
      skill: session.draft,
      summary: outcome.value.summary,
      edits: session.edits,
      pending: session.pending.filter((q) => stillOpen(session.draft, q)),
      answered: session.answered,
      closed: session.closed,
      prompt,
      episode,
    };
  }
  // Back to the compiled draft, keeping what the user already answered.
  let kept = options.skill;
  for (const { question, answer } of session.answered) {
    if (!answer || !question.appliesTo) continue;
    const applied = applyAnswer(kept, question, answer);
    if (applied.ok) kept = applied.skill;
  }
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
    pending: session.pending,
    answered: session.answered,
    closed: session.closed,
    prompt,
    episode,
  };
}

// A first-draft question about a step or an input the agent has since removed has nothing left to answer.
function stillOpen(skill: Skill, question: Question): boolean {
  const [root, id, inputs, name] = (question.appliesTo ?? "").split(".");
  if (root !== "steps" || !id) return true;
  const step = [...walkSteps(skill.steps)].find(({ step }) => step.id === id)?.step;
  if (!step) return false;
  if (step.type === "trigger" && inputs === "inputs" && name) return name in triggerOf(skill).inputs;
  return true;
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
- Controls come only from the recording: you may move and wrap steps and change their intents, args, waits, checks
  and outputs, never invent a click on something the person didn't use. The steps that type, paste, select or upload
  what they showed are the work itself: move or wrap them, never remove them. If the task needs a control they didn't
  use, ask them.
- Never change the description or the Frequency (the user's own), and never turn approval off.
- Never ask what the description or what they said already answers: use it. An open question from the first draft
  that they already answered: close it (close_question), quoting their words. Ask (ask_user) only what is left, with
  options and a default, at most ${MAX_QUESTIONS} questions; open questions you neither ask nor close are asked after
  you finish. An answer that comes back not_applied is yours to put into the workflow with an edit.
- describe_screen shows a step's picture described (when the user allowed pictures): use it before asking, when the
  words near a step don't say what the control was for.
- Keep step ids. An edit is all or nothing: make a big change in a few calls, each one valid on its own. Every kept
  edit says what still stops the workflow (still_to_fix): fix those before you finish. When nothing is left, finish
  with one sentence on what you changed. If the draft is already right, finish at once.`;

function taskOf(session: DesignSession): string {
  const form = session.form;
  const said = narrationOf(session.steps, session.notes);
  return [
    "# The description",
    form
      ? JSON.stringify({ ...form.description, frequency: form.when })
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
