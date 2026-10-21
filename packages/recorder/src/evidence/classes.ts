// What a recorded step did (spec 2.1), for the agent and the review: went somewhere, showed something, changed
// something, or read something. Noise never reaches here: normaliseAll lists it apart.
import { ACTING_ROLES, type NormalisedStep } from "../normalise.ts";

export type StepClass = "act" | "go" | "reveal" | "read";

export function classOf(step: NormalisedStep): StepClass {
  switch (step.kind) {
    case "navigate":
    case "app_open":
      return "go";
    case "copy":
      return "read";
    case "click":
    case "press": {
      if (step.navigatesTo || step.opensTab !== undefined || step.effect?.navigated) return "go";
      if (step.submits || step.checked !== undefined || step.sends || step.kind === "press") return "act";
      if (step.effect?.expanded || step.effect?.opened) return "reveal";
      const role = step.target?.role ?? "";
      if (ACTING_ROLES.has(role)) return "act";
      // An older recording kept no effect: a link went somewhere.
      if (role === "link" && !step.effect) return "go";
      return "reveal";
    }
    default:
      return "act";
  }
}
