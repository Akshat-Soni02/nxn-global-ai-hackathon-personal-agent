// A design agent with a script, for tests and the no-model eval: stage 1 gets a task model, the build episode gets the
// scripted calls in order, then done. Nothing here calls a model.
import type { FakeReply } from "@shadow/llm";
import { UNDERSTAND } from "./prompt.ts";

const QUIET = { outcome: "the task, as recorded", cadence: { kind: "manual" } };

export function scriptedDesigner(build: FakeReply[] = [], task: object = QUIET) {
  const script = [...build];
  return (body: Record<string, unknown>): FakeReply => {
    // Stage 1 is the call whose system prompt is UNDERSTAND (whatever the protocol): the task model, as JSON.
    const system = (body.messages as { content?: unknown }[] | undefined)?.[0]?.content;
    if (typeof system === "string" && system.startsWith(UNDERSTAND.slice(0, 40))) return JSON.stringify(task);
    return (
      script.shift() ?? { toolCalls: [{ name: "done", arguments: { summary: "as recorded (scripted)", rules: [] } }] }
    );
  };
}
