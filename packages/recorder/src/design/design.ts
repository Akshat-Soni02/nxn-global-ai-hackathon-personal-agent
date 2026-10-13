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
import type { NormalisedStep } from "../normalise.ts";
import { skeletonOf } from "../skeleton.ts";
import { type DesignFinish, type DesignSession, designTools, type Note, outlineOf, recordingView } from "./tools.ts";

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
  budget?: Partial<Budget>;
  maxQuestions?: number;
  protocol?: Protocol;
  meter?: UsageMeter;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

export type DesignOutcome = {
  skill: Skill;
  // Questions still to ask (the drill after the agent), and the ones answered during it.
  pending: Question[];
  answered: { question: Question; answer: string }[];
  episode?: Episode<DesignFinish>;
} & ({ kind: "designed"; summary: string; edits: EditInput[] } | { kind: "kept"; reason: string });

export async function designWorkflow(options: DesignOptions): Promise<DesignOutcome> {
  const session: DesignSession = {
    original: options.skill,
    draft: options.skill,
    form: options.form,
    steps: options.steps,
    idsByStep: skeletonOf(options.steps).idsByStep,
    notes: options.notes ?? [],
    pending: [...options.questions],
    answered: [],
    asked: 0,
    maxQuestions: options.maxQuestions ?? MAX_QUESTIONS,
    edits: [],
    prompter: options.prompter,
    memory: options.memory,
    checks: options.checks,
  };
  const episode = await runAgent<DesignFinish>({
    llm: options.llm,
    profile: "smart",
    system: `${ROLE}\n\n${briefing({ edits: true })}`,
    task: taskOf(session),
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
  return { kind: "kept", reason, skill: kept, pending: session.pending, answered: session.answered, episode };
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

const ROLE = `You are Shadow's design agent. A person described a task and showed it once. Code and one model call turned
the recording into a first draft: a flat list of steps that replays what they did. Make the draft do what they
meant, so it runs right next time, with next time's data.
- Start with read_description, read_recording and workflow.
- Values that will be different next time (what the description says changes: an email, a file, a date, numbers)
  must not stay as fixed text: make them inputs, or take them from an earlier step's output.
- The same actions done for several items become one loop (wrap_in_loop) over a list an earlier step produces.
- "Only if" (in the description or what was said) becomes a branch (wrap_in_branch).
- Reading, summarising, classifying or working something out from text becomes an llm step (add_llm_step). llm steps
  never click or type.
- Controls come only from the recording: you may move and wrap steps and change their intents, args, waits, checks
  and outputs, never invent a click on something the person didn't use. If the task needs one, ask them.
- Never change the description or the Frequency (the user's own), and never turn approval off.
- Ask (ask_user) only what the recording and the description can't tell you, with options and a default, at most
  ${MAX_QUESTIONS} questions. The open questions from the first draft are listed: ask the ones that matter by id;
  the rest are asked after you finish.
- Keep step ids. When validate says ok, finish with one sentence on what you changed. If the draft is already right,
  finish at once.`;

function taskOf(session: DesignSession): string {
  const form = session.form;
  return [
    "# The description",
    form
      ? JSON.stringify({ ...form.description, frequency: form.when })
      : "None was filled in: work out the goal from the recording.",
    "",
    "# The recording (by meaning; read_recording shows any part again)",
    "<untrusted_data>",
    JSON.stringify(recordingView(session, 1, 40)),
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
