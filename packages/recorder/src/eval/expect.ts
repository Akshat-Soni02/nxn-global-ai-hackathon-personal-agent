// The bench's yardstick: what a correct workflow does next time, in the user's words, turned into checks on the saved
// workflow (docs/superpowers/specs/2026-10-19-record-v2-design.md, 0.2). One recording's expect.json lists them; a
// known gap is marked expectedToFail, so a run that hits it reads as ⚠, not as a regression.
import { isAction, isLoop, type Skill, triggerOf, walkSteps } from "@shadow/core";
import { z } from "zod";

const common = { why: z.string(), expectedToFail: z.boolean().optional() };
export const Expectation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("has_loop"), over: z.string().optional(), ...common }),
  z.object({ kind: z.literal("uses_today"), ...common }),
  // A write the user showed is still in the workflow: an action ("web.type") whose args match `value` (a regex).
  z.object({ kind: z.literal("write_kept"), action: z.string(), value: z.string().optional(), ...common }),
  z.object({ kind: z.literal("no_text_only_target"), ...common }),
  z.object({ kind: z.literal("trigger"), type: z.enum(["manual", "schedule", "folder_watch"]), ...common }),
  z.object({ kind: z.literal("max_questions"), n: z.number().int().min(0), ...common }),
  // No question asked of the user matched this (a regex, case-insensitive).
  z.object({ kind: z.literal("not_asked"), pattern: z.string(), ...common }),
]);
export type Expectation = z.infer<typeof Expectation>;
export const Expectations = z.array(Expectation);

export interface Verdict {
  expectation: Expectation;
  ok: boolean;
  detail: string;
}

export function checkExpectations(skill: Skill, asked: string[], expectations: Expectation[]): Verdict[] {
  return expectations.map((e) => verdictOf(e, skill, asked));
}

function verdictOf(e: Expectation, skill: Skill, asked: string[]): Verdict {
  const all = [...walkSteps(skill.steps)].map(({ step }) => step);
  const actions = all.filter(isAction);
  switch (e.kind) {
    case "has_loop": {
      const loops = all.filter(isLoop);
      const hit = loops.find((l) => !e.over || l.over.includes(e.over));
      const detail = loops.map((l) => `${l.id} over ${l.over}`).join(", ") || "no loop";
      return { expectation: e, ok: Boolean(hit), detail };
    }
    case "uses_today": {
      const hit = actions.find((a) => JSON.stringify(a.args).includes("{{today"));
      return { expectation: e, ok: Boolean(hit), detail: hit ? hit.id : "no step uses {{today}}" };
    }
    case "write_kept": {
      const pattern = e.value ? new RegExp(e.value) : undefined;
      const hit = actions.find(
        (a) => `${a.channel}.${a.action}` === e.action && (!pattern || pattern.test(JSON.stringify(a.args))),
      );
      return { expectation: e, ok: Boolean(hit), detail: hit ? hit.id : `no ${e.action} like that` };
    }
    case "no_text_only_target": {
      // A target replay can score: a role, a name, attributes or a selector. Text, near and label alone it can't.
      const weak = actions.filter(
        (a) =>
          a.target &&
          !a.target.role &&
          !a.target.name &&
          Object.keys(a.target.attrs ?? {}).length === 0 &&
          a.target.fallbacks.length === 0,
      );
      return { expectation: e, ok: weak.length === 0, detail: weak.map((a) => a.id).join(", ") || "none" };
    }
    case "trigger": {
      const when = triggerOf(skill).when;
      return { expectation: e, ok: when.some((w) => w.type === e.type), detail: when.map((w) => w.type).join(", ") };
    }
    case "max_questions":
      return { expectation: e, ok: asked.length <= e.n, detail: `${asked.length} asked` };
    case "not_asked": {
      const pattern = new RegExp(e.pattern, "i");
      const hit = asked.find((q) => pattern.test(q));
      return { expectation: e, ok: !hit, detail: hit ?? "not asked" };
    }
  }
}
