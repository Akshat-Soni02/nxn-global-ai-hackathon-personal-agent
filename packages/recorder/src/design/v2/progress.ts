// The design agent's work in plain words, for the Record screen's feed (spec 4.1): what it changes, uses, asks and
// tests, the way a person watching would say it. Nothing for its own bookkeeping (looking, a call it got wrong): the
// feed is for trust, not for debugging; design.json has the whole transcript.
import type { AgentEvent } from "@shadow/agent";

const list = (steps: unknown) => (Array.isArray(steps) ? steps.join(", ") : String(steps ?? ""));

export function progressLine(event: AgentEvent): string | undefined {
  if (event.type === "end") {
    if (event.outcome.kind === "finished") return "Done";
    if (event.outcome.kind === "out_of_budget") return "Stopped at its budget: keeping what it reached";
    return undefined;
  }
  if (event.type !== "call") return undefined;
  const input = (event.input ?? {}) as Record<string, unknown>;
  const why = typeof input.why === "string" && input.why ? `: ${input.why}` : "";
  switch (event.tool) {
    case "accept":
      return `Using a pattern from the recording${why}`;
    case "reject":
      return `Not using a pattern from the recording${why}`;
    case "remove":
      return `Removing ${list(input.steps)}${why}`;
    case "restore":
      return `Putting back ${String(input.step)}${why}`;
    case "add":
      return `Adding a step: ${String((input.step as { intent?: unknown } | undefined)?.intent ?? "")}`;
    case "change":
      return `Changing ${String(input.step)}${why}`;
    case "loop":
    case "wrap_in_loop":
      return `Repeating ${list(input.steps)} for each ${String((input.item as { name?: unknown } | undefined)?.name ?? "item")}`;
    case "branch":
    case "wrap_in_branch":
      return `Doing ${list(input.steps)} only when it applies`;
    case "ai_step":
    case "add_llm_step":
      return `Adding an AI step: ${String(input.intent ?? "")}`;
    case "trigger":
      return "Setting how often it runs";
    case "ask":
    case "ask_user":
      return `A question for you: ${String(input.question ?? "")}`;
    case "move":
      return `Moving ${String(input.step)}${why}`;
    case "input":
      return `Adding a value it starts with: ${String(input.name ?? "")}`;
    case "test":
      return "Testing the workflow in the automation window";
    case "done":
    case "finish":
      return "Checking the workflow is complete";
    default:
      return undefined;
  }
}
