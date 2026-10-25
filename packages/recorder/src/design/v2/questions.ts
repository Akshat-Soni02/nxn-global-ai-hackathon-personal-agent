// The questions left after a design (spec, "Questions: who writes, who answers"); grown in Task 9.
import { type Skill, triggerOf, walkSteps } from "@shadow/core";
import type { Question } from "../../compile.ts";
import type { Prompter } from "../../drill.ts";
import type { QueuedQuestion } from "./session.ts";

// As many as the design needs, all on one screen (Oct 25, P5: five, then defaults, dropped questions that mattered); a
// ceiling only against a runaway list.
export const MAX_QUESTIONS = 12;

// What sits where a question's answer goes ("steps.start.inputs.invoice.resolve.dir"), as JSON, so the agent's
// change to it can be noticed; null when the step or input the question is about is gone (nothing left to ask).
export function slotOf(skill: Skill, appliesTo: string | undefined): string | null {
  let keys = (appliesTo ?? "").split(".").filter(Boolean);
  let node: unknown = skill;
  if (keys[0] === "steps" && keys.length >= 2) {
    const step =
      keys[1] === "0" ? skill.steps[0] : [...walkSteps(skill.steps)].find(({ step }) => step.id === keys[1])?.step;
    if (!step) return null;
    if (step.type === "trigger" && keys[2] === "inputs" && keys[3] && !(keys[3] in triggerOf(skill).inputs))
      return null;
    node = step;
    keys = keys.slice(2);
  }
  for (const key of keys) {
    if (node === null || typeof node !== "object") return "-";
    node = (node as Record<string, unknown>)[key];
  }
  return JSON.stringify(node) ?? "-";
}

// Code's questions (which file, which row) asked only if the design left the place its answer goes as it was: if the
// agent changed it (from what was said or shown), it decided; if it removed it, there is nothing left to ask.
export function openCodeQuestions(questions: Question[], before: Skill, now: Skill): Question[] {
  return questions.filter((q) => {
    const slot = slotOf(now, q.appliesTo);
    return slot !== null && slot === slotOf(before, q.appliesTo);
  });
}

const stepOf = (q: Question) => /^steps\.([^.]+)/.exec(q.appliesTo ?? "")?.[1];

// One question per step: code's wins (its answer goes straight in), then the agent's, MAX_QUESTIONS in all; the rest
// take their defaults and the review lists them.
// "start" holds many places (each input, how often it runs), so a question there doesn't stand for another one there.
export function batchOf(
  code: Question[],
  agent: QueuedQuestion[],
): {
  code: Question[];
  agent: QueuedQuestion[];
  // Not asked (another question changes the same step, or past MAX_QUESTIONS): they take their defaults.
  skipped: { code: Question[]; agent: QueuedQuestion[] };
} {
  const taken = new Set(code.map(stepOf).filter((s): s is string => Boolean(s) && s !== "start"));
  const keptCode = code.slice(0, MAX_QUESTIONS);
  const room = Math.max(0, MAX_QUESTIONS - keptCode.length);
  const theirs = agent.filter((q) => !taken.has(q.step)).slice(0, room);
  return {
    code: keptCode,
    agent: theirs,
    skipped: { code: code.slice(MAX_QUESTIONS), agent: agent.filter((q) => !theirs.includes(q)) },
  };
}

// Every question is put to the user at once, so they reach the Record screen as one batch, each next to its step.
export async function askBatch(
  prompter: Prompter,
  draft: Skill,
  code: Question[],
  agent: QueuedQuestion[],
): Promise<{
  code: { question: Question; answer: string }[];
  agent: { question: QueuedQuestion; answer: string }[];
}> {
  const asQuestion = (q: QueuedQuestion): Question => ({
    id: q.id,
    text: q.text,
    options: q.options.map((o) => ({ label: o, value: o })),
    ...(q.default ? { default: q.default } : {}),
  });
  const [fromCode, fromAgent] = await Promise.all([
    Promise.all(
      code.map(async (question) => ({
        question,
        answer: await prompter.ask(question, { step: stepOf(question), draft }),
      })),
    ),
    Promise.all(
      agent.map(async (question) => ({
        question,
        answer: await prompter.ask(asQuestion(question), { step: question.step, draft }),
      })),
    ),
  ]);
  return { code: fromCode, agent: fromAgent };
}
