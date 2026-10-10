// The repair agent's tools (docs/design.md, "The repair agent's tools"), over one session: the original workflow, the
// draft being repaired, and what the last try showed. Look tools read; probe tools act on the live page within the
// guard; edit tools change the draft through core's edit operations; try runs the draft live; finish ends.
import { type AnyTool, tool } from "@taskplayer/agent";
import {
  applyEdits,
  Edit,
  type EditInput,
  isOutward,
  neverMatch,
  repairViolations,
  type Skill,
  type Step,
  walkSteps,
} from "@taskplayer/core";
import { z } from "zod";
import type { Failure, Resume } from "../types.ts";
import type { PageOp } from "../web/inspect.ts";
import type { FailureClass } from "./classify.ts";
import type { RepairEnv } from "./env.ts";
import { workflowOutline } from "./report.ts";
import { type TryResult, tryDraft } from "./verify.ts";

export type RepairFinish =
  | { kind: "resolve"; class: Exclude<FailureClass, "drift">; reason: string }
  | { kind: "commit"; summary: string }
  | { kind: "escalate"; reason: string; whatToShow?: string };

export interface RepairSession {
  original: Skill;
  draft: Skill;
  failure: Failure;
  env: RepairEnv;
  report: string;
  // Every edit applied to the draft, in order: the new version's "what changed".
  edits: EditInput[];
  // The last try, and the draft it ran on.
  tried?: { draft: string; result: TryResult; from: string };
}

const key = (skill: Skill) => JSON.stringify(skill.steps);

export function repairTools(session: RepairSession): AnyTool<RepairFinish>[] {
  const { env } = session;
  const page = async (op: PageOp) => {
    if (!env.page) return { output: "No browser is connected: only the workflow and the report can be looked at." };
    const result = await env.page(op);
    return result.ok
      ? { output: result.value, untrusted: true }
      : { output: `The page answered with an error: ${result.error}`, untrusted: true };
  };

  const tools: AnyTool<RepairFinish>[] = [
    // ---- Look ----
    tool({
      name: "failure_report",
      kind: "look",
      description: "The failure report again: the failed step, its error, the page, the run so far, site notes",
      input: z.object({}),
      run: () => ({ output: session.report }),
    }),
    tool({
      name: "page_outline",
      kind: "look",
      description:
        "The page now, as headings, dialogs, forms and controls with refs (e12). scope: a ref, to outline one part",
      input: z.object({ scope: z.string().optional() }),
      run: ({ scope }) => page({ op: "outline", scope }),
    }),
    tool({
      name: "find",
      kind: "look",
      description: "Controls whose name looks like `text`, best first; role narrows it (button, link, textbox, …)",
      input: z.object({ text: z.string().min(1), role: z.string().optional() }),
      run: ({ text, role }) => page({ op: "find", text, role }),
    }),
    tool({
      name: "inspect",
      kind: "look",
      description: "One element by ref in detail, with the locator a step would store for it",
      input: z.object({ ref: z.string() }),
      run: ({ ref }) => page({ op: "inspect", ref }),
    }),
    tool({
      name: "workflow",
      kind: "look",
      description: "The draft workflow: one line per step, or one step in full with `step`",
      input: z.object({ step: z.string().optional() }),
      run: ({ step }) => {
        if (!step) return { output: workflowOutline(session.draft, session.failure.stepId) };
        const found = [...walkSteps(session.draft.steps)].find((s) => s.step.id === step);
        return { output: found ? found.step : `No step ${step}` };
      },
    }),
    // ---- Probe the live page ----
    tool({
      name: "click_safe",
      kind: "probe",
      description: "Click a control that only changes the view (opens a menu, dismisses a banner, expands a section)",
      input: z.object({ ref: z.string() }),
      run: ({ ref }) => page({ op: "click", ref }),
    }),
    tool({
      name: "press",
      kind: "probe",
      description: "Press a key on the page: Escape, Tab, ArrowDown, ArrowUp",
      input: z.object({ key: z.enum(["Escape", "Tab", "ArrowDown", "ArrowUp"]) }),
      run: ({ key: k }) => page({ op: "press", key: k }),
    }),
    tool({
      name: "scroll",
      kind: "probe",
      description: "Scroll to an element (ref), or the page down or up",
      input: z.object({ ref: z.string().optional(), direction: z.enum(["down", "up"]).optional() }),
      run: (input) => page({ op: "scroll", ...input }),
    }),
    tool({
      name: "go_back",
      kind: "probe",
      description: "Go back one page",
      input: z.object({}),
      run: () => page({ op: "back" }),
    }),
    tool({
      name: "navigate",
      kind: "probe",
      description: "Open a URL on a site this workflow already uses",
      input: z.object({ url: z.string().url() }),
      run: ({ url }) => page({ op: "navigate", url }),
    }),
    // Waiting doesn't act on the page: a look, not a live action.
    tool({
      name: "wait",
      kind: "look",
      description: "Wait for the page (up to 10 seconds)",
      input: z.object({ ms: z.number().int().min(100).max(10_000) }),
      run: ({ ms }) => page({ op: "wait", ms }),
    }),
    // ---- Edit the draft ----
    tool({
      name: "retarget",
      kind: "edit",
      description: "Point an action step at the element with this ref (its locator is taken from the page)",
      input: z.object({ step: z.string(), ref: z.string() }),
      run: async ({ step, ref }) => {
        if (!env.page) return { output: "No browser is connected." };
        const inspected = await env.page({ op: "inspect", ref });
        if (!inspected.ok) return { output: `Not applied: ${inspected.error}` };
        const { locator } = inspected.value as { locator: EditInput & object };
        return applyToDraft(session, [{ op: "retarget", step, target: locator as never }]);
      },
    }),
    tool({
      name: "edit",
      kind: "edit",
      description:
        "Apply edit operations to the draft (see Edit operations in the briefing). Every edit is checked; a refused one says why",
      input: z.object({ edits: z.array(Edit).min(1).max(10) }),
      run: ({ edits }) => applyToDraft(session, edits),
    }),
    // ---- Try ----
    tool({
      name: "try_steps",
      kind: "try",
      description:
        "Run the draft on the live page from a step (default: the failed one) for `count` steps, as the real player does. Outward steps ask the user first. Says whether the result is evidence",
      input: z.object({ from: z.string().optional(), count: z.number().int().min(1).max(5).default(2) }),
      run: async ({ from, count }) => {
        const start: Resume = { at: from ?? session.failure.path, vars: session.failure.vars };
        const result = await tryDraft(session.draft, env, start, count);
        session.tried = { draft: key(session.draft), result, from: start.at };
        // A try moves the live page on: the next try starts where this one stopped.
        if (result.resume) session.failure = { ...session.failure, path: result.resume.at, vars: result.resume.vars };
        return {
          output: {
            ok: result.ok,
            ran: result.ran,
            error: result.error,
            next: result.resume?.at ?? "(the workflow finished)",
            evidence: result.evidence ?? "none yet: a step that didn't throw is not evidence; try one more step",
          },
          liveActions: Math.max(1, result.ran.length),
        };
      },
    }),
    // ---- Finish ----
    tool({
      name: "resolve",
      kind: "finish",
      description:
        "End without changing the workflow: transient (site down, retry later), environment (the user must do something, say what), nothing_to_do, or data (this input is bad)",
      input: z.object({
        class: z.enum(["transient", "environment", "nothing_to_do", "data"]),
        reason: z.string().min(1),
      }),
      run: ({ class: c, reason }) => ({ output: "resolved", finish: { kind: "resolve", class: c, reason } }),
    }),
    tool({
      name: "commit",
      kind: "finish",
      description:
        "Save the draft as the next version. Allowed only after try_steps ran the current draft through the failed step and showed evidence",
      input: z.object({ summary: z.string().min(1).max(300) }),
      run: ({ summary }) => {
        const problem = commitProblem(session);
        if (problem) return { output: `Not committed: ${problem}` };
        return { output: "committed", finish: { kind: "commit", summary } };
      },
    }),
    tool({
      name: "escalate",
      kind: "finish",
      description: "Hand over to the user: say why, and what they should show (do by hand) so it can be learned",
      input: z.object({ reason: z.string().min(1), what_to_show: z.string().optional() }),
      run: ({ reason, what_to_show }) => ({
        output: "escalated",
        finish: { kind: "escalate", reason, whatToShow: what_to_show },
      }),
    }),
  ];
  if (env.recall) {
    const recall = env.recall;
    tools.push(
      tool({
        name: "recall",
        kind: "look",
        description: "Search site notes and earlier fixes",
        input: z.object({ query: z.string().min(1) }),
        run: async ({ query }) => ({ output: (await recall(query)).join("\n") || "nothing found" }),
      }),
    );
  }
  if (env.note) {
    const note = env.note;
    tools.push(
      tool({
        name: "note",
        kind: "remember",
        description: 'Save a fact about this site for later repairs ("the portal shows a cookie banner first")',
        input: z.object({ fact: z.string().min(1).max(300) }),
        run: async ({ fact }) => {
          await note(fact);
          return { output: "noted" };
        },
      }),
    );
  }
  return tools;
}

function applyToDraft(session: RepairSession, edits: EditInput[]) {
  const result = applyEdits(session.draft, edits);
  if (!result.ok) return { output: `Not applied: ${result.problems.join("; ")}` };
  session.draft = result.skill;
  session.edits.push(...edits);
  return { output: `Applied. The draft now:\n${workflowOutline(session.draft, session.failure.stepId)}` };
}

function commitProblem(session: RepairSession): string | undefined {
  if (session.edits.length === 0) return "the draft has no changes: if nothing needs changing, resolve instead";
  const tried = session.tried;
  if (!tried || tried.draft !== key(session.draft)) return "the current draft hasn't been tried: call try_steps first";
  if (!tried.result.ok) return `the last try failed (${tried.result.error})`;
  if (!tried.result.evidence) return "the last try showed no evidence that the fix works: try one more step";
  return undefined;
}

// ---- The guard ----------------------------------------------------------------------------------------------------

// What the repair agent may do, checked in code before each call: probes never act outward, never touch what the
// user's Never list names, never leave the sites the workflow uses; edits never break section 9's rules.
export function repairGuard(session: RepairSession) {
  const hosts = new Set<string>();
  for (const { step } of walkSteps(session.original.steps)) {
    if (step.type === "action" && step.action === "navigate") {
      try {
        hosts.add(new URL(String(step.args.url)).host);
      } catch {}
    }
  }
  return async ({ tool: t, input }: { tool: AnyTool; input: unknown }): Promise<string | undefined> => {
    if (t.name === "click_safe" && session.env.page) {
      const inspected = await session.env.page({ op: "inspect", ref: (input as { ref: string }).ref });
      if (!inspected.ok) return undefined; // the tool reports the missing element itself
      const info = inspected.value as { role: string; name: string; attrs: Record<string, string> };
      const asStep = {
        id: "probe",
        type: "action",
        intent: "probe",
        requires_approval: false,
        channel: "web",
        action: "click",
        target: { role: info.role, name: info.name, fallbacks: [] },
        args: {},
      } as Step;
      if (isOutward(asStep))
        return `"${info.name}" looks like it sends, submits, pays, publishes or deletes: probes never do`;
      const never = neverMatch(asStep, session.original.description.never);
      if (never) return `"${info.name}" matches the user's Never rule "${never}"`;
      if (info.role === "link" && info.attrs.href && !/^(#|javascript:)/.test(info.attrs.href)) {
        try {
          const host = new URL(info.attrs.href, "http://same.invalid").host;
          if (host !== "same.invalid" && hosts.size > 0 && !hosts.has(host)) return `that link leaves for ${host}`;
        } catch {}
      }
    }
    if (t.name === "navigate") {
      const host = new URL((input as { url: string }).url).host;
      if (!hosts.has(host)) return `${host} is not a site this workflow uses (${[...hosts].join(", ") || "none"})`;
    }
    if (t.name === "retarget" && session.env.page) {
      const { step, ref } = input as { step: string; ref: string };
      const inspected = await session.env.page({ op: "inspect", ref });
      if (!inspected.ok) return undefined;
      const { locator } = inspected.value as { locator: never };
      const result = applyEdits(session.draft, [{ op: "retarget", step, target: locator }]);
      if (result.ok) {
        const violations = repairViolations(session.original, result.skill);
        if (violations.length > 0) return violations.join("; ");
      }
    }
    if (t.name === "edit") {
      const result = applyEdits(session.draft, (input as { edits: EditInput[] }).edits);
      if (result.ok) {
        const violations = repairViolations(session.original, result.skill);
        if (violations.length > 0) return violations.join("; ");
      }
    }
    if (t.name === "commit") {
      const violations = repairViolations(session.original, session.draft);
      if (violations.length > 0) return violations.join("; ");
    }
    return undefined;
  };
}
