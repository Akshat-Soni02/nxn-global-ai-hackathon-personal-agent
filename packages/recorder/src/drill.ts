// Drill: the compiler's questions, asked once, right after compile and before the skill is saved. Never on a replay.
// Each answer is written into the skill at the question's appliesTo path and re-validated with the Skill schema.
// Lasting answers go to memory, so the next compile of a similar task doesn't ask again.
import { Skill } from "@shadow/core";
import type { MemoryStore } from "@shadow/memory";
import type { Question } from "./compile.ts";

export interface Prompter {
  // Shows the question and resolves with what you typed. An empty answer takes the default. `about` is what the
  // window shows with it: the step it is about, on the draft workflow.
  ask(question: Question, about?: { step?: string; draft?: Skill }): Promise<string>;
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
    // The step the answer changes, shown on the draft next to the question (a question with no step is about the
    // whole workflow).
    const step = /^steps\.([^.]+)/.exec(question.appliesTo ?? "")?.[1];
    const about = step && !/^\d+$/.test(step) ? { step, draft: current } : { draft: current };
    const answer = (await options.prompter.ask(question, about)).trim() || question.default || "";
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

  // An answer about one of the run's inputs ("steps.start.inputs.count", or ".default", or the trigger by its position
  // "steps.0"): an input is a typed object, so the answer becomes its default, and an input that doesn't exist yet
  // is created, typed from the answer ("5" a number, "yes" a yes/no). Writing the bare answer there would never parse.
  if (keys[0] === "steps" && keys[2] === "inputs" && keys[3] && (keys.length === 4 || keys[4] === "default")) {
    const steps = copy.steps as Record<string, unknown>[];
    const trigger = keys[1] === "0" ? steps[0] : steps.find((s) => s.id === keys[1]);
    if (trigger?.type === "trigger") {
      const inputs = (trigger.inputs ?? {}) as Record<string, Record<string, unknown>>;
      trigger.inputs = inputs;
      const name = keys[3] as string;
      const current = inputs[name];
      const value = valueFor(question, answer, current?.default);
      if (keys.length === 4 && isInput(value)) inputs[name] = value as Record<string, unknown>;
      else if (current) current.default = typed(value, (current.type as { type?: string })?.type);
      else inputs[name] = { type: { type: typeOf(value) }, default: typed(value, typeOf(value)) };
      const parsed = Skill.safeParse(copy);
      if (parsed.success) return { ok: true, skill: parsed.data };
      return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    }
  }

  let node = copy;
  // "steps.s3" with an object answer replaces the whole step (keep an llm step, or the recorded rule instead).
  if (keys[0] === "steps" && keys.length === 2) {
    const found = locate(copy.steps as Record<string, unknown>[], keys[1] as string);
    const value = valueFor(question, answer, undefined);
    if (!found) return { ok: false, error: `no step ${keys[1]}` };
    if (typeof value !== "object" || value === null) return { ok: false, error: `${question.appliesTo} needs a step` };
    found.list[found.index] = JSON.parse(JSON.stringify(value));
    const parsed = Skill.safeParse(copy);
    if (parsed.success) return { ok: true, skill: parsed.data };
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  // "steps.s3.requires_approval" addresses a step by its id; "steps.2.x" by its position.
  if (keys[0] === "steps" && keys.length > 2) {
    const steps = copy.steps as Record<string, unknown>[];
    const byId = locate(steps, keys[1] as string);
    const step = byId ? byId.list[byId.index] : /^\d+$/.test(keys[1] ?? "") ? steps[Number(keys[1])] : undefined;
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

// A step by id anywhere in the tree: inside a loop, or either arm of a branch. Answers address steps by id, and the
// design agent moves recorded steps into loops, so a top-level search missed them ("no step s3").
function locate(
  steps: Record<string, unknown>[],
  id: string,
): { list: Record<string, unknown>[]; index: number } | undefined {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step?.id === id) return { list: steps, index: i };
    for (const key of ["steps", "else"]) {
      const inner = step?.[key];
      if (Array.isArray(inner)) {
        const found = locate(inner as Record<string, unknown>[], id);
        if (found) return found;
      }
    }
  }
  return undefined;
}

// A whole input as an option's value: { type: { type: "number" }, default: 5 }.
const isInput = (value: unknown): boolean =>
  typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "object";
const YES = /^(y|yes|true|ok|sure)$/i;
const YES_OR_NO = /^(y|yes|true|ok|sure|n|no|false)$/i;
// The type a new input gets from its answer.
function typeOf(value: unknown): "number" | "boolean" | "text" {
  if (typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()))) return "number";
  if (typeof value === "boolean" || (typeof value === "string" && YES_OR_NO.test(value.trim()))) return "boolean";
  return "text";
}
// The answer as a value of that type; anything else stays as it is (the schema says if it is wrong).
function typed(value: unknown, type: string | undefined): unknown {
  if (typeof value !== "string") return value;
  if (type === "number" && Number.isFinite(Number(value))) return Number(value);
  if (type === "boolean") return YES.test(value.trim());
  return value;
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
