// Drill: the compiler's questions, asked once, right after compile and before the skill is saved. Never on a replay.
// Each answer is written into the skill at the question's appliesTo path and re-validated with the Skill schema.
// Lasting answers go to memory, so the next compile of a similar task doesn't ask again.
import { Skill } from "@taskplayer/core";
import type { MemoryStore } from "@taskplayer/memory";
import type { Question } from "./compile.ts";

export interface Prompter {
  // Shows the question and resolves with what you typed. An empty answer takes the default.
  ask(question: Question): Promise<string>;
}

export interface DrillResult {
  skill: Skill;
  answers: { id: string; answer: string }[];
  problems: string[];
}

// Answers may fill in what a step does, never which element it acts on: that only ever comes from the recording.
const PROTECTED = new Set(["target", "channel", "action", "version"]);

export async function drill(
  skill: Skill,
  questions: Question[],
  options: { prompter: Prompter; memory?: Pick<MemoryStore, "add"> },
): Promise<DrillResult> {
  let current = skill;
  const answers: DrillResult["answers"] = [];
  const problems: string[] = [];
  for (const question of questions) {
    const answer = (await options.prompter.ask(question)).trim() || question.default || "";
    if (!answer) continue;
    answers.push({ id: question.id, answer });
    if (question.appliesTo) {
      const result = applyAnswer(current, question, answer);
      if (result.ok) current = result.skill;
      else problems.push(`${question.id}: ${result.error}`);
    }
    if (question.remember && options.memory) {
      await options.memory.add({ kind: question.remember, text: `${question.text} ${answer}`, skillId: current.id });
    }
  }
  return { skill: current, answers, problems };
}

export function applyAnswer(
  skill: Skill,
  question: Question,
  answer: string,
): { ok: true; skill: Skill } | { ok: false; error: string } {
  const copy = JSON.parse(JSON.stringify(skill)) as Record<string, unknown>;
  let keys = (question.appliesTo ?? "").split(".").filter(Boolean);
  if (keys.length === 0) return { ok: false, error: "no appliesTo path" };
  if (keys.some((k) => PROTECTED.has(k)))
    return { ok: false, error: `${question.appliesTo} can't be set by an answer` };

  let node = copy;
  // "steps.s3" with an object answer replaces the whole step (keep an llm step, or the recorded rule instead).
  if (keys[0] === "steps" && keys.length === 2) {
    const steps = copy.steps as { id: string }[];
    const index = steps.findIndex((s) => s.id === keys[1]);
    const value = valueFor(question, answer, undefined);
    if (index < 0) return { ok: false, error: `no step ${keys[1]}` };
    if (typeof value !== "object" || value === null) return { ok: false, error: `${question.appliesTo} needs a step` };
    steps[index] = JSON.parse(JSON.stringify(value));
    const parsed = Skill.safeParse(copy);
    if (parsed.success) return { ok: true, skill: parsed.data };
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  // "steps.s3.requires_approval" addresses a step by its id; "steps.2.x" by its position.
  if (keys[0] === "steps" && keys.length > 2) {
    const steps = copy.steps as { id: string }[];
    const step =
      steps.find((s) => s.id === keys[1]) ?? (/^\d+$/.test(keys[1] ?? "") ? steps[Number(keys[1])] : undefined);
    if (!step) return { ok: false, error: `no step ${keys[1]}` };
    node = step as Record<string, unknown>;
    keys = keys.slice(2);
  }
  for (const key of keys.slice(0, -1)) {
    if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  const last = keys.at(-1) as string;
  node[last] = valueFor(question, answer, node[last]);

  const parsed = Skill.safeParse(copy);
  if (parsed.success) return { ok: true, skill: parsed.data };
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

// An option chosen by number or label gives its value. Otherwise the typed text is read as the type already there.
function valueFor(question: Question, answer: string, current: unknown): unknown {
  const options = question.options ?? [];
  const chosen =
    (/^\d+$/.test(answer) ? options[Number(answer) - 1] : undefined) ??
    options.find((o) => o.label.toLowerCase() === answer.toLowerCase());
  if (chosen && chosen.value !== undefined) return chosen.value;
  const text = chosen?.label ?? answer;
  if (typeof current === "boolean") return /^(y|yes|true|ok|sure)$/i.test(text);
  if (typeof current === "number" && Number.isFinite(Number(text))) return Number(text);
  if (/^[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      // not JSON: keep it as text
    }
  }
  return text;
}
