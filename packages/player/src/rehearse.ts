// The design agent's safe test run (spec, "The test run in safe mode"): the workflow walked through in the automation
// window with nobody pressing the buttons. Done for real: opening pages and switching tabs, reading, finding files, AI
// steps (3 at most), and clicks on links, tabs, menu items and expanders that only went somewhere or opened something
// when recorded. Only found and outlined, never done: typing, uploads, anything needing approval, anything outward,
// file changes, and any button that acts. A name like Archive, Mark, Move or Save is never pressed even when its
// recorded effect was "went somewhere": Gmail's Archive returns to the inbox, and archives the email.
import { type ActionStep, isAction, isOutward, type LlmStep, type Skill, walkSteps } from "@shadow/core";
import type { RunLogEvent, WalkChoice } from "./types.ts";

export const ACTION_VERBS =
  /\b(archive|delete|remove|trash|mark|move|label|star|assign|approve|send|submit|pay|post|save|publish|share|confirm|reply|forward|invite|upload|buy|order|book|apply|unsubscribe|accept|decline|reject|cancel|join|leave|follow|unfollow|subscribe|like|vote|dismiss|snooze|mute|block|resolve|merge|close)\b/i;
const READS = new Set(["web.navigate", "web.wait_for", "web.extract", "fs.find", "fs.read", "data.pick", "ax.open"]);
const SAFE_ROLES = new Set(["link", "tab", "menuitem", "treeitem"]);
export const MAX_LLM = 3;

// What a step's click did when it was recorded (the trace's effect, through effectsOf).
export interface RecordedEffect {
  changed?: string;
  navigated?: boolean;
  opened?: string;
  expanded?: boolean;
}

// `recorded`: the step's control is the one recorded, unchanged. A link the agent added, or a recorded step whose
// control it changed, has no effect of its own: it is only outlined (its old effect was another control's).
export function rehearsalChoice(
  step: ActionStep | LlmStep,
  recordedEffect: RecordedEffect | undefined,
  llmSoFar: number,
  recorded = true,
): { choice: WalkChoice; why: string } {
  const effect = recorded ? recordedEffect : undefined;
  if (step.type === "llm") {
    return llmSoFar < MAX_LLM
      ? { choice: "do", why: "reads text" }
      : { choice: "skip", why: `at most ${MAX_LLM} AI steps in a test run` };
  }
  const key = `${step.channel}.${step.action}`;
  if (step.requires_approval || isOutward(step)) return { choice: "skip", why: "it needs your approval" };
  if (READS.has(key)) return { choice: "do", why: "it only reads or opens a page" };
  if (key !== "web.click") return { choice: "skip", why: "it would change something" };
  const words = [step.target?.name, step.target?.label, step.target?.text].filter(Boolean).join(" ");
  if (ACTION_VERBS.test(words)) return { choice: "skip", why: `"${words}" acts on something` };
  const role = step.target?.role ?? "";
  const went = Boolean(effect?.navigated || effect?.opened || effect?.expanded);
  // A link or tab with no recorded effect (an older recording) only goes somewhere; a menu item needs its effect.
  if (!recorded) return { choice: "skip", why: "a control that wasn't recorded: it may change something" };
  if (SAFE_ROLES.has(role) && (went || (effect === undefined && (role === "link" || role === "tab")))) {
    return { choice: "do", why: `a ${role} that only goes somewhere` };
  }
  if (effect?.expanded || effect?.opened) return { choice: "do", why: "it opens a menu or a section" };
  return { choice: "skip", why: "a button: it may change something" };
}

// Mail apps mark a message read when it is opened: the test run says so before it opens one.
const MAIL = /^https:\/\/(mail\.google\.com|outlook\.(live|office|office365)\.com)\//;

// What the test run will do and only outline, in the order it meets the steps, and what doing them changes for you.
export function rehearsalPlan(
  skill: Skill,
  effects: Map<string, RecordedEffect>,
  // The steps whose control is the one recorded, unchanged; without it, every step's is.
  recorded?: Set<string>,
): { does: string[]; outlines: string[]; warnings: string[] } {
  const does: string[] = [];
  const outlines: string[] = [];
  let llm = 0;
  let emails = 0;
  let page = ""; // the page the steps are on: the last one opened
  for (const { step } of walkSteps(skill.steps)) {
    if (step.type !== "action" && step.type !== "llm") continue;
    if (isAction(step) && step.action === "navigate") page = String(step.args.url ?? "");
    const { choice, why } = rehearsalChoice(step, effects.get(step.id), llm, !recorded || recorded.has(step.id));
    if (choice === "do") {
      if (step.type === "llm") llm++;
      does.push(`${step.id} ${step.intent}`);
      const opensMail =
        isAction(step) && step.action === "click" && (MAIL.test(page) || /email|message/i.test(step.intent));
      if (opensMail) emails++;
    } else outlines.push(`${step.id} ${step.intent} (${why})`);
  }
  const warnings =
    emails > 0
      ? [`Opening ${emails} email${emails === 1 ? "" : "s"} will mark ${emails === 1 ? "it" : "them"} as read`]
      : [];
  return { does, outlines, warnings };
}

export interface RehearsalStep {
  id: string;
  path: string;
  status: "done" | "failed" | "found" | "not_found" | "not_reached";
  error?: string;
  value?: unknown;
}

export interface Rehearsal {
  walk(step: ActionStep | LlmStep, path: string): Promise<WalkChoice>;
  // Called by the highlight around each outline: no error means the control was found.
  onHighlight(step: ActionStep, error?: string): void;
  log(event: RunLogEvent): void;
  report(outcome: string): { steps: RehearsalStep[]; outcome: string };
}

export function rehearsal(
  skill: Skill,
  effects: Map<string, RecordedEffect>,
  onLine?: (line: string) => void,
  // The steps whose control is the one recorded, unchanged; without it, every step's is.
  recorded?: Set<string>,
): Rehearsal {
  let llm = 0;
  const steps = new Map<string, RehearsalStep>(); // by path
  const missed = new Map<string, string>(); // step id -> why the outline failed
  const say = (line: string) => onLine?.(line);
  return {
    async walk(step, path) {
      const { choice, why } = rehearsalChoice(step, effects.get(step.id), llm, !recorded || recorded.has(step.id));
      if (choice === "do" && step.type === "llm") llm++;
      if (choice === "skip") {
        const target =
          isAction(step) && step.target ? (step.target.name ?? step.target.label ?? step.target.text) : undefined;
        steps.set(path, {
          id: step.id,
          path,
          status: missed.has(step.id) ? "not_found" : "found",
          ...(missed.has(step.id) ? { error: missed.get(step.id) } : {}),
        });
        say(
          missed.has(step.id)
            ? `Test run: couldn't find "${target ?? step.intent}"`
            : `Test run: found "${target ?? step.intent}" (not done: ${why})`,
        );
      }
      return choice;
    },
    onHighlight(step, error) {
      if (error) missed.set(step.id, error);
      else missed.delete(step.id);
    },
    log(event) {
      if (event.type !== "step.result") return;
      const ok = event.result.ok;
      steps.set(event.path, {
        id: event.stepId,
        path: event.path,
        status: ok ? "done" : "failed",
        ...(ok
          ? event.result.value !== undefined
            ? { value: event.result.value }
            : {}
          : { error: event.result.error }),
      });
      say(`Test run: ${event.stepId} ${ok ? "✓" : `failed: ${event.result.error ?? "no reason"}`}`);
    },
    report(outcome) {
      const reached = new Set([...steps.values()].map((s) => s.id));
      const rest: RehearsalStep[] = [...walkSteps(skill.steps)]
        .map(({ step }) => step)
        .filter((s) => (s.type === "action" || s.type === "llm") && !reached.has(s.id))
        .map((s) => ({ id: s.id, path: s.id, status: "not_reached" }));
      return { steps: [...steps.values(), ...rest], outcome };
    },
  };
}
