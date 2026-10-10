// Classify a failure before anything is changed (docs/design.md, section 9 "Classify first"), from cheap signals and
// with no model: the step's error, the page's HTTP status and whether it looks like a login page, the channel's own
// errors. Only drift may change the workflow. What the signals can't decide is "unknown": the repair agent decides.
import type { Failure } from "../types.ts";
import type { PageSignals } from "../web/inspect.ts";

export type FailureClass = "transient" | "environment" | "nothing_to_do" | "data" | "drift";

export interface Classification {
  class: FailureClass | "unknown";
  reason: string;
  // Environment: what the user has to do before the run can go on.
  need?: string;
}

const TRANSIENT =
  /net::ERR_|navigation failed|did not finish loading|timed? ?out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|CDP connection closed|HTTP 5\d\d|\b(429|502|503|504)\b/i;

export function classify(failure: Failure, signals?: PageSignals): Classification {
  const error = failure.result.error ?? "";
  const step = failure.step;

  // The page itself first: a server error is passing; a login page needs the user.
  if (signals?.status && signals.status >= 500) {
    return { class: "transient", reason: `the site answered ${signals.status}` };
  }
  if (signals && (signals.status === 401 || signals.status === 403 || signals.loginLike)) {
    const site = hostOf(signals.url);
    return {
      class: "environment",
      reason: "the page asks to sign in",
      need: `log in to ${site} in the automation window`,
    };
  }

  // Channel errors that need something from the user.
  if (/Task Player\.app is not running/i.test(error)) {
    return { class: "environment", reason: error, need: "start Task Player.app" };
  }
  if (/accessibility|not trusted|not allowed to (control|send)/i.test(error)) {
    return { class: "environment", reason: error, need: "allow Task Player in System Settings > Privacy & Security" };
  }
  if (/extension did not connect|Chrome has no page target|cannot connect to/i.test(error)) {
    return { class: "environment", reason: error, need: "open Chrome (the Task Player extension connects on its own)" };
  }
  if (/is not installed, or did not start/i.test(error)) return { class: "environment", reason: error, need: error };
  if (/operation not permitted|EACCES|EPERM/i.test(error)) {
    return {
      class: "environment",
      reason: error,
      need: "allow Task Player to use that folder (Privacy & Security > Files and Folders)",
    };
  }
  if (TRANSIENT.test(error)) return { class: "transient", reason: error };

  // Nothing there yet: the file hasn't arrived, the inbox is empty.
  if (step.type === "action" && step.channel === "fs" && step.action === "find" && /no file matches/i.test(error)) {
    return { class: "nothing_to_do", reason: error };
  }

  // The data didn't fit: a model answer, a row that isn't there, a value of the wrong type.
  if (step.type === "llm") return { class: "data", reason: error };
  if (step.type === "action" && step.channel === "data") return { class: "data", reason: error };
  if (/should be|is not (a|an) |no row where|not a list/i.test(error)) return { class: "data", reason: error };

  // The page changed: the control isn't where the workflow expects it.
  if (step.type === "action" && (step.channel === "web" || step.channel === "ax")) {
    if (
      /target not found|ambiguous target|covered by|not visible|no menu item|precondition did not hold/i.test(error)
    ) {
      return { class: "drift", reason: error };
    }
    if (failure.result.failedCheck) return { class: "drift", reason: `its check failed: ${error}` };
  }
  return { class: "unknown", reason: error || "failed without a reason" };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the site";
  }
}
