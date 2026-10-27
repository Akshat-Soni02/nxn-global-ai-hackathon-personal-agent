// What an automatic repair may never change (docs/design.md, section 9 "Repair"). Enforced in code by comparing the
// draft with the original, never by the prompt: a repair that needs one of these goes to the user instead.
//   outward actions   no new step that sends, submits, pays, publishes or deletes (except a confirmation that
//                     finishes an outward step it follows, needing approval), or matches a Never entry
//   user's decisions  the trigger, inputs and defaults, the description, args the user set, llm instructions,
//                     max_items, on_item_fail
//   safety switches   approval never turned off, no ask removed
//   reach             no script or connected-app (mcp) steps added, no navigating to a site the workflow doesn't
//                     already use
import { isAction, type Locator, type Skill, type Step, triggerOf, walkSteps } from "./skill.ts";

// Words on a control that mean the action leaves a mark outside (conservative on purpose: a false alarm sends the
// fix to the user, a miss could send an email).
const OUTWARD =
  /\b(send|sent|submit|pay|payment|purchase|buy|order|checkout|check out|publish|post|share|delete|remove|trash|erase|transfer|sign|approve|confirm|reply|forward|invite|upload)\b/i;

const targetWords = (target: Locator | undefined): string[] =>
  target
    ? [target.name, target.label, target.text, target.attrs?.value, target.attrs?.["aria-label"]].filter(
        (w): w is string => !!w,
      )
    : [];

// Whether an action step acts outward: by its control's words, or its kind (moving files to the Trash, a menu item).
export function isOutward(step: Step): boolean {
  if (!isAction(step)) return false;
  const key = `${step.channel}.${step.action}`;
  if (key === "web.press" || key === "ax.key") {
    // ⌘Enter and Ctrl+Enter send in mail and chat (Gmail, Outlook, comment boxes); Mac apps call the key Return.
    const modifiers = (step.args.modifiers as string[] | undefined) ?? [];
    if ((step.args.key === "Enter" || step.args.key === "Return") && modifiers.some((m) => m === "cmd" || m === "ctrl"))
      return true;
  }
  if (key === "web.click" || key === "ax.press" || key === "web.press" || key === "ax.key") {
    return targetWords(step.target).some((w) => OUTWARD.test(w));
  }
  if (key === "ax.menu") return ((step.args.path as string[] | undefined) ?? []).some((w) => OUTWARD.test(w));
  if (key === "web.upload") return true;
  // A connected app's tool writes to the app unless its hints say it only reads: code here can't see the hints, so
  // every tool counts as outward (requireApprovals exempts the read-only ones it is told about).
  if (key === "mcp.call") return true;
  if (key === "fs.move" && /\.Trash/.test(String(step.args.to ?? ""))) return true;
  return false;
}

// Enter (without Shift), or typed text with a new line (typing it presses Enter), sends in a chat and submits a form. A
// step the user recorded that does so is theirs; one a repair adds or turns an action into is not, so it asks. (Not
// part of isOutward: a plain Enter in a search box is not outward, and design asks about these by its own rule.)
function sendsByEnter(step: Step): boolean {
  if (!isAction(step)) return false;
  const key = `${step.channel}.${step.action}`;
  if ((key === "web.press" || key === "ax.key") && /^(enter|return)$/i.test(String(step.args.key ?? ""))) {
    return !((step.args.modifiers as string[] | undefined) ?? []).includes("shift");
  }
  return (
    (key === "web.type" || key === "ax.set_value") && /[\r\n]/.test(String(step.args.text ?? step.args.value ?? ""))
  );
}
const outwardForRepair = (step: Step) => isOutward(step) || sendsByEnter(step);

// The Never entry a step's control or action matches, if any ("Never click Archive" and a target named "Archive").
export function neverMatch(step: Step, never: string[]): string | undefined {
  if (!isAction(step)) return undefined;
  // A connected app's tool by the words in its name: GMAIL_SEND_EMAIL is "gmail", "send", "email".
  const toolWords = step.channel === "mcp" ? String(step.args.tool ?? "").split(/[_.-]+/) : [];
  const words = [
    ...targetWords(step.target),
    ...(((step.args.path as string[] | undefined) ?? []) as string[]),
    ...toolWords,
  ]
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 3);
  return never.find((entry) => {
    const text = entry.toLowerCase();
    return words.some((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(text));
  });
}

// Every way the draft breaks the rules, as sentences the repair agent reads, sorted as docs/agents/rules.md sorts them
// (Oct 25): `never`, whatever the reason (the user's decisions, safety switches, scripts, their Never list); `ask`,
// not repair's to decide alone (a new step that acts outward, a connected-app call, a new site, removing an AI step, a
// loop or a step that needs approval): the repair agent asks the user, and commits on yes.
export function repairCheck(original: Skill, draft: Skill): { never: string[]; ask: string[] } {
  const problems: string[] = [];
  const ask: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  if (!same(triggerOf(original), triggerOf(draft))) {
    problems.push("the trigger (when it runs, its inputs and their defaults) is the user's: it can't change");
  }
  if (!same(original.description, draft.description)) problems.push("the description is the user's: it can't change");

  const before = new Map([...walkSteps(original.steps)].map(({ step }) => [step.id, step]));
  const after = new Map([...walkSteps(draft.steps)].map(({ step }) => [step.id, step]));
  const hosts = new Set([...before.values()].flatMap((s) => hostOf(s) ?? []));

  for (const [id, old] of before) {
    const now = after.get(id);
    if (!now) {
      const ok = "can't be removed without the user's OK";
      if (old.type === "llm") ask.push(`${id}: an llm step is the user's decision: it ${ok}`);
      if (old.type === "control" && old.kind === "loop") ask.push(`${id}: a loop ${ok}`);
      if ("requires_approval" in old && old.requires_approval) ask.push(`${id}: a step that needs approval ${ok}`);
      if ("ask" in old && old.ask) problems.push(`${id}: a step with a question for the user can't be removed`);
      continue;
    }
    if ("requires_approval" in old && old.requires_approval && !("requires_approval" in now && now.requires_approval)) {
      problems.push(`${id}: approval can't be turned off`);
    }
    if ("ask" in old && old.ask && !("ask" in now && same(old.ask, now.ask))) {
      problems.push(`${id}: its question for the user can't be removed or changed`);
    }
    if (old.type === "llm" && (now.type !== "llm" || now.instruction !== old.instruction)) {
      problems.push(`${id}: the llm step's instruction is the user's: it can't change`);
    }
    if (old.type === "control" && old.kind === "loop") {
      if (now.type !== "control" || now.kind !== "loop") problems.push(`${id}: a loop can't be replaced`);
      else if (now.max_items !== old.max_items || now.on_item_fail !== old.on_item_fail) {
        problems.push(`${id}: max_items and on_item_fail are the user's: they can't change`);
      }
    }
    if (isAction(old) && isAction(now)) {
      if (old.channel === now.channel && old.action === now.action && !same(old.args, now.args)) {
        problems.push(`${id}: its args are the user's values: retarget it or change its wait, not its args`);
      }
      // An outward step may be retargeted (the same action on a changed control), never turned into another action.
      const sameAction = old.channel === now.channel && old.action === now.action;
      if (outwardForRepair(now) && !(outwardForRepair(old) && sameAction)) {
        ask.push(`${id}: it would now act outward (${actionText(now)})`);
      }
    }
    if (isAction(now) && !(isAction(old) && old.channel === "script") && now.channel === "script") {
      problems.push(`${id}: repairs can't add scripts`);
    }
    if (isAction(now) && !(isAction(old) && old.channel === "mcp") && now.channel === "mcp") {
      ask.push(`${id}: a connected-app call in place of the page (repairs can't add connected-app calls alone)`);
    }
  }

  for (const [id, step] of after) {
    const old = before.get(id);
    if (!old) {
      if (isAction(step) && step.channel === "script") problems.push(`${id}: repairs can't add scripts`);
      if (isAction(step) && step.channel === "mcp")
        ask.push(`${id}: a new connected-app call (repairs can't add connected-app calls alone)`);
      if (outwardForRepair(step) && !completesOutward(draft, step, before)) {
        ask.push(
          `${id}: a new step can't act outward (${actionText(step)}) without the user's OK, except to finish an outward step it directly follows, with requires_approval`,
        );
      }
    }
    const never = neverMatch(step, draft.description.never);
    if (never && !(old && neverMatch(old, original.description.never) === never && same(old, step))) {
      problems.push(`${id}: it matches the user's Never rule "${never}"`);
    }
    const host = hostOf(step);
    if (host && !hosts.has(host)) ask.push(`${id}: ${host} is a site this workflow doesn't use`);
  }
  return { never: problems, ask };
}

// Every rule the draft breaks, both kinds: what a repair with nobody to ask (the ladder) may never do.
export function repairViolations(original: Skill, draft: Skill): string[] {
  const { never, ask } = repairCheck(original, draft);
  return [...never, ...ask];
}

// A new outward step is allowed in one case: it finishes what an existing outward step started (a "Confirm" after
// "Submit", on a new confirmation page). It must directly follow that step and need approval itself.
function completesOutward(draft: Skill, step: Step, before: Map<string, Step>): boolean {
  if (!("requires_approval" in step && step.requires_approval)) return false;
  const previous = previousSibling(draft.steps, step.id);
  const original = previous ? before.get(previous.id) : undefined;
  return !!original && isOutward(original) && isOutward(previous as Step);
}

function previousSibling(steps: Step[], id: string): Step | undefined {
  for (const [i, step] of steps.entries()) {
    if (step.id === id) return i > 0 ? steps[i - 1] : undefined;
    if (step.type === "control") {
      const inner =
        previousSibling(step.steps, id) ?? (step.kind === "branch" ? previousSibling(step.else, id) : undefined);
      if (inner) return inner;
    }
  }
  return undefined;
}

function hostOf(step: Step): string | undefined {
  if (!isAction(step) || step.channel !== "web" || step.action !== "navigate") return undefined;
  try {
    return new URL(String(step.args.url)).host;
  } catch {
    return undefined; // a URL built from a variable: its host is checked by args staying the same
  }
}

const actionText = (step: Step): string =>
  isAction(step)
    ? `${step.channel}.${step.action}${step.target ? ` on "${targetWords(step.target)[0] ?? "?"}"` : ""}`
    : step.type;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
