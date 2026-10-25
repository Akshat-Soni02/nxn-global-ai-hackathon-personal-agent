// A design agent with a script, for tests and the no-model eval: stage 1 gets a task model, the plan call gets the
// planned calls (none by default), the build episode gets the scripted calls in order, then done. Nothing here calls a
// model.
import type { FakeReply } from "@shadow/llm";
import { PLAN, UNDERSTAND } from "./prompt.ts";

const QUIET = { outcome: "the task, as recorded", cadence: { kind: "manual" } };

export function scriptedDesigner(build: FakeReply[] = [], task: object = QUIET, plan: FakeReply | object[] = []) {
  const script = [...build];
  // When the script runs out, the agent sends its last done again (as a real one does after a refusal), so the rules it
  // said it built stay said; with none scripted, a done that builds nothing.
  let lastDone: FakeReply = {
    toolCalls: [{ name: "done", arguments: { summary: "as recorded (scripted)", rules: [] } }],
  };
  return (body: Record<string, unknown>): FakeReply => {
    // Stage 1 is the call whose system prompt is UNDERSTAND (whatever the protocol): the task model, as JSON.
    const system = (body.messages as { content?: unknown }[] | undefined)?.[0]?.content;
    if (typeof system === "string" && system.startsWith(UNDERSTAND.slice(0, 40))) return JSON.stringify(task);
    // The plan call: its calls ({ tool, input }), or a reply as given (a failure); none, and the episode builds alone.
    if (typeof system === "string" && system.startsWith(PLAN.slice(0, 60)))
      return Array.isArray(plan) ? JSON.stringify({ calls: plan }) : plan;
    const next = script.shift();
    if (!next) return lastDone;
    if (typeof next === "object" && next.toolCalls?.some((c) => c.name === "done")) lastDone = next;
    return next;
  };
}
