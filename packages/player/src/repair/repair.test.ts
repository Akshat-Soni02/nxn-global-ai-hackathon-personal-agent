// Recovery end to end, without Chrome: the drift fixtures (fixtures/pages/drift) run in jsdom with their own scripts,
// a small web channel acts on them the way the player does (stored locators, covered targets, checks), and a
// scripted model plays the repair agent. Each scenario is one kind of failure from docs/design.md, section 9.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ActionStep, type Check, findStep, type Locator, Skill } from "@taskplayer/core";
import { type FakeReply, fakeLlm } from "@taskplayer/llm";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { runSkill } from "../run.ts";
import type { Failure, RunDeps } from "../types.ts";
import {
  type ElementInfo,
  type FoundElement,
  locatorFor,
  PAGE_SCRIPT,
  type PageOp,
  type PageOpResult,
} from "../web/inspect.ts";
import type { RepairEnv } from "./env.ts";
import { createRepairer, type RepairOutcome } from "./repair.ts";

const DRIFT = join(import.meta.dirname, "../../../../fixtures/pages/drift");
const skill = Skill.parse(JSON.parse(readFileSync(join(DRIFT, "drift-skill.json"), "utf8")));
const invoice = { path: "/tmp/inv.pdf", name: "inv.pdf", size: 1, modified: "" };

// A live page: a fixture in jsdom, with the player's web steps, page checks and page ops acting on it.
function livePage(file: string) {
  const html = readFileSync(join(DRIFT, file), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: `http://localhost:5173/drift/${file}`,
    beforeParse(window) {
      // jsdom has no modal dialogs.
      window.HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute("open", "");
      };
      window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute("open");
      };
    },
  });
  const doc = dom.window.document;
  const script = dom.window.eval(`(${PAGE_SCRIPT})`) as (op: Record<string, unknown>) => unknown;
  const hidden = (el: Element) => !!el.closest("[hidden]") || !!el.closest("dialog:not([open])");
  const byRef = (ref: string) => doc.querySelector(`[data-tp-ref="${ref}"]`);

  // Like the matcher: a fallback selector that finds one element, or an exact name among the same kind of control.
  const resolve = (target: Locator): Element | string => {
    for (const selector of target.fallbacks) {
      const all = [...doc.querySelectorAll(selector)];
      if (all.length === 1 && all[0]) return hidden(all[0]) ? "target not found: it is hidden" : all[0];
    }
    if (target.name) {
      const exact = (script({ op: "find", text: target.name, role: target.role }) as FoundElement[]).filter(
        (f) => f.score === 1,
      );
      const el = exact.length === 1 && exact[0] ? byRef(exact[0].ref) : null;
      if (el && !hidden(el)) return el;
    }
    return "target not found";
  };
  const covering = (el: Element) => {
    const modal = doc.querySelector('[aria-modal="true"], dialog[open]');
    return modal && !modal.contains(el)
      ? `target is covered by ${modal.id ? `#${modal.id}` : modal.tagName.toLowerCase()}`
      : undefined;
  };
  // Text a person would see: not script source, not hidden elements or closed dialogs.
  const textVisible = (text: string) => {
    const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    let seen = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (parent && !parent.closest("script, style") && !hidden(parent)) seen += n.textContent;
    }
    return seen.includes(text);
  };

  const web = async (step: ActionStep) => {
    if (step.action === "navigate") return { ok: true };
    if (!step.target) return { ok: false, error: "step has no target" };
    const el = resolve(step.target);
    if (typeof el === "string") return { ok: false, error: el, matchScore: 0.2 };
    const covered = covering(el);
    if (covered) return { ok: false, error: covered, matchScore: 1 };
    if (step.action === "click") (el as HTMLElement).click();
    if (step.action === "type") (el as HTMLInputElement).value = String(step.args.text);
    if (step.action === "upload" && el.getAttribute("type") !== "file") return { ok: false, error: "not a file input" };
    if (step.check?.text_visible && !textVisible(step.check.text_visible)) {
      return { ok: false, error: `check failed: ${step.check.text_visible}`, failedCheck: step.check, matchScore: 1 };
    }
    return { ok: true, matchScore: 1 };
  };
  const webCheck = async (check: Check) =>
    (!check.text_visible || textVisible(check.text_visible)) &&
    (!check.element_visible || typeof resolve(check.element_visible) !== "string");

  const page = async (op: PageOp): Promise<PageOpResult> => {
    if (op.op === "inspect") {
      const info = script({ op: "describe", ref: op.ref }) as ElementInfo | null;
      return info
        ? { ok: true, value: { ...info, locator: locatorFor(info) } }
        : { ok: false, error: `no element ${op.ref}` };
    }
    if (op.op === "click") {
      const el = byRef(op.ref);
      if (!el) return { ok: false, error: `no element ${op.ref}` };
      const covered = covering(el);
      if (covered) return { ok: false, error: covered };
      (el as HTMLElement).click();
      return { ok: true, value: "done" };
    }
    if (["outline", "find", "signals"].includes(op.op)) return { ok: true, value: script(op) };
    return { ok: true, value: "done" };
  };
  return { web, webCheck, page, textVisible, doc };
}

function setup(file: string) {
  const live = livePage(file);
  const approved: string[] = [];
  const deps: RunDeps = {
    web: live.web,
    fs: async () => ({ ok: true }),
    script: async () => ({ ok: true }),
    fileExists: async () => true,
    webCheck: live.webCheck,
    approve: async (step) => {
      approved.push(step.id);
      return true;
    },
    onFailure: () => "pause",
  };
  const env: RepairEnv = { runId: "r1", deps, page: live.page };
  return { live, deps, env, approved };
}

// Runs the workflow until it pauses at a failure.
async function failOn(file: string) {
  const s = setup(file);
  const outcome = await runSkill(skill, s.deps, { runId: "r1", inputs: { invoice } });
  expect(outcome.status).toBe("paused");
  return { ...s, outcome, failure: outcome.failure as Failure };
}

// A scripted agent: each reply may read what it was sent (refs on the page) to pick its next call.
const call = (name: string, args: unknown): FakeReply => ({ toolCalls: [{ name, arguments: args }] });
function agent(script: ((sent: string) => FakeReply)[]) {
  return fakeLlm((body, i) => {
    const sent = (body.messages as { content: string }[]).map((m) => m.content).join("\n");
    return (script[i] ?? (() => call("escalate", { reason: "script ended" })))(sent);
  });
}
const refOf = (sent: string, role: string, name: string) => {
  const ref = new RegExp(`(e\\d+) ${role} "${name}"`).exec(sent)?.[1];
  if (!ref) throw new Error(`no ${role} "${name}" in what the agent was sent`);
  return ref;
};

const committed = (outcome: RepairOutcome) => {
  if (outcome.kind !== "commit")
    throw new Error(`expected a commit, got ${outcome.kind}: ${"reason" in outcome ? outcome.reason : ""}`);
  return outcome;
};

describe("classify first", () => {
  it("resolves a login page as environment, without a model and without changing the workflow", async () => {
    const { failure, env } = await failOn("logged-out.html");
    const outcome = await createRepairer().repair(skill, failure, env);
    expect(outcome).toMatchObject({
      kind: "resolve",
      class: "environment",
      need: "log in to localhost:5173 in the automation window",
    });
  });

  it("resolves an empty folder as nothing to do", async () => {
    const failure: Failure = {
      stepId: "f1",
      path: "f1",
      step: {
        id: "f1",
        type: "action",
        intent: "find",
        channel: "fs",
        action: "find",
        args: { dir: "~/in", glob: "*.pdf" },
        requires_approval: false,
      },
      result: { ok: false, error: "no file matches *.pdf in ~/in" },
      attempts: 1,
      vars: {},
    };
    const outcome = await createRepairer().repair(skill, failure, setup("base.html").env);
    expect(outcome).toMatchObject({ kind: "resolve", class: "nothing_to_do" });
  });
});

describe("the cheap ladder", () => {
  it("retargets a reworded button with one clear match, verified by its check, and the run resumes on the new version", async () => {
    const { failure, env, deps, approved, live } = await failOn("reworded.html");
    expect(failure.stepId).toBe("s4");
    const outcome = committed(await createRepairer().repair(skill, failure, env));
    expect(outcome).toMatchObject({ by: "ladder", summary: 's4: "Submit" is now "Submit invoice"', approveOnce: [] });
    expect(findStep(outcome.skill, "s4")).toMatchObject({
      target: { role: "button", name: "Submit invoice" },
      requires_approval: true,
    });
    expect(outcome.skill).toMatchObject({ version: 2, history: [{ version: 2, by: "debug" }] });
    expect(approved).toContain("s4"); // the try asked before submitting
    expect(live.textVisible("Invoice submitted")).toBe(true);

    // The try ran s4; the run goes on from s5, on version 2. (reworded.html has no export: s5 pauses again.)
    expect(outcome.resume?.at).toBe("s5");
    const resumed = await runSkill(outcome.skill, deps, { runId: "r1", inputs: {}, resume: outcome.resume });
    expect(resumed).toMatchObject({ status: "paused", failedStep: "s5" });
  });
});

describe("the repair agent", () => {
  it("finds a renamed button the ladder can't, retargets it, tries it, and commits", async () => {
    const { failure, env } = await failOn("renamed.html");
    const llm = agent([
      () => call("find", { text: "invoice", role: "button" }),
      (sent) => call("retarget", { step: "s4", ref: refOf(sent, "button", "Send invoice") }),
      () => call("try_steps", { count: 1 }),
      () => call("commit", { summary: 'The submit button is now "Send invoice"' }),
    ]);
    const outcome = committed(await createRepairer({ llm }).repair(skill, failure, env));
    expect(outcome.by).toBe("agent");
    expect(findStep(outcome.skill, "s4")).toMatchObject({ target: { name: "Send invoice" } });
    expect(outcome.episode?.transcript.filter((e) => e.type === "refused")).toEqual([]);
    expect(outcome.episode?.turns).toBe(4);
    // The briefing and the report went in: the failed step, the page outline, the workflow.
    const first = ((llm.requests[0]?.messages ?? []) as { content: string }[]).map((m) => m.content).join("\n");
    expect(first).toMatch(/Failed step s4 at s4: "Submit the invoice"/);
    expect(first).toMatch(/button "Send invoice"/);
    expect(first).toMatch(/→ s4 web\.click/);
  });

  it("dismisses a new cookie banner by adding a step before the blocked one", async () => {
    const { failure, env } = await failOn("banner.html");
    expect(failure.result.error).toBe("target is covered by #cookies");
    const llm = agent([
      () => call("page_outline", {}),
      () =>
        call("edit", {
          edits: [
            {
              op: "insert",
              at: { before: "s2" },
              step: {
                type: "action",
                intent: "Accept the cookie banner",
                channel: "web",
                action: "click",
                target: { role: "button", name: "Accept all" },
              },
            },
          ],
        }),
      () => call("try_steps", { from: "s6", count: 2 }),
      () => call("commit", { summary: "A cookie banner covers the page: accept it first" }),
    ]);
    const outcome = committed(await createRepairer({ llm }).repair(skill, failure, env));
    expect(outcome.skill.steps.map((s) => s.id)).toEqual(["start", "s1", "s6", "s2", "s3", "s4", "s5"]);
    expect(outcome.resume?.at).toBe("s3");
  });

  it("finishes a new confirmation step with approval, and is refused a probe that would confirm", async () => {
    const { failure, env, approved } = await failOn("confirm.html");
    expect(failure.result.failedCheck).toEqual({ text_visible: "Invoice submitted" });
    const llm = agent([
      (sent) => call("click_safe", { ref: refOf(sent, "button", "Confirm") }),
      () =>
        call("edit", {
          edits: [
            { op: "set", step: "s4", field: "check", value: null },
            {
              op: "insert",
              at: { after: "s4" },
              step: {
                type: "action",
                intent: "Confirm sending",
                channel: "web",
                action: "click",
                target: { role: "button", name: "Confirm" },
                requires_approval: true,
                check: { text_visible: "Invoice submitted" },
              },
            },
          ],
        }),
      () => call("try_steps", { from: "s6", count: 1 }),
      () => call("commit", { summary: "Submitting now asks to confirm: confirm it (with approval)" }),
    ]);
    const outcome = committed(await createRepairer({ llm }).repair(skill, failure, env));
    const refused = outcome.episode?.transcript.find((e) => e.type === "refused");
    expect(refused).toMatchObject({
      tool: "click_safe",
      reason: expect.stringMatching(/"Confirm" looks like it sends/),
    });
    expect(findStep(outcome.skill, "s6")).toMatchObject({ requires_approval: true });
    expect(approved).toContain("s6");
  });

  it("opens a menu to reach a moved action, and won't commit without changes or before a try works", async () => {
    const { failure, env } = await failOn("menu.html");
    expect(failure.stepId).toBe("s5");
    const llm = agent([
      (sent) => call("click_safe", { ref: refOf(sent, "button", "More actions") }),
      () => call("page_outline", {}),
      () => call("commit", { summary: "too early" }),
      // Put the page back as the run left it (the menu closed), so the try opens it itself.
      (sent) => call("click_safe", { ref: refOf(sent, "button", "More actions") }),
      () =>
        call("edit", {
          edits: [
            {
              op: "insert",
              at: { before: "s5" },
              step: {
                type: "action",
                intent: "Open the More actions menu",
                channel: "web",
                action: "click",
                target: { role: "button", name: "More actions" },
              },
            },
            {
              op: "retarget",
              step: "s5",
              target: { role: "menuitem", name: "Export CSV", fallbacks: ["#export-item"] },
            },
          ],
        }),
      () => call("try_steps", { from: "s6", count: 2 }),
      () => call("commit", { summary: "Export moved into the More actions menu" }),
    ]);
    const outcome = committed(await createRepairer({ llm }).repair(skill, failure, env));
    const early = outcome.episode?.transcript.find(
      (e) => e.type === "result" && e.tool === "commit" && e.output.startsWith("Not committed"),
    );
    expect(early).toMatchObject({ output: expect.stringMatching(/no changes/) });
    expect(findStep(outcome.skill, "s5")).toMatchObject({ target: { role: "menuitem", name: "Export CSV" } });
    expect(outcome.resume).toBeUndefined(); // the try ran to the end of the workflow
  });

  it("escalates when it can't find a safe fix, or runs out of budget, and keeps to the run's limits", async () => {
    const { failure, env } = await failOn("renamed.html");
    const giveUp = agent([
      () => call("escalate", { reason: "no submit control", what_to_show: "click the button that sends the invoice" }),
    ]);
    expect(await createRepairer({ llm: giveUp }).repair(skill, failure, env)).toMatchObject({
      kind: "escalate",
      whatToShow: "click the button that sends the invoice",
    });

    const looper = fakeLlm(() => call("page_outline", {}));
    const repairer = createRepairer({ llm: looper, limits: { episode: { turns: 3 } } });
    expect(await repairer.repair(skill, failure, env)).toMatchObject({
      kind: "escalate",
      reason: "the repair ran out of turns",
    });
    await repairer.repair(skill, failure, env);
    expect(await repairer.repair(skill, failure, env)).toMatchObject({
      kind: "escalate",
      reason: "this run already used its 2 repairs",
    });
    expect(repairer.spent.episodes).toBe(2);

    expect(await createRepairer().repair(skill, failure, env)).toMatchObject({
      kind: "escalate",
      reason: expect.stringMatching(/no model/),
    });
  });

  it("is refused an edit that breaks the user's decisions", async () => {
    const { failure, env } = await failOn("renamed.html");
    const llm = agent([
      () => call("edit", { edits: [{ op: "set", step: "s4", field: "requires_approval", value: false }] }),
      () => call("escalate", { reason: "refused" }),
    ]);
    const outcome = await createRepairer({ llm }).repair(skill, failure, env);
    expect(outcome.episode?.transcript.find((e) => e.type === "refused")).toMatchObject({
      reason: "s4: approval can't be turned off",
    });
  });
});
