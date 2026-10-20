// Stage 1 of design agent v2 (spec, Phase 3): one structured call that reads the evidence and writes the task model
// before anything changes. The schema is checked by code: the client retries once with its errors, and this asks once
// more (two retries in all). Without a task model there is no design: the orchestrator keeps the plain list.
import type { Llm, UsageMeter } from "@shadow/llm";
import { TaskModel } from "./contracts.ts";
import { UNDERSTAND } from "./prompt.ts";

export async function understand(options: {
  llm: Llm;
  // The evidence package's text (evidenceText): masked, with page text inside <untrusted_data>.
  evidence: string;
  // What memory holds about this task (earlier answers, facts about the user).
  memory?: string[];
  meter?: UsageMeter;
  signal?: AbortSignal;
}): Promise<{ ok: true; task: TaskModel } | { ok: false; error: string }> {
  const remembered = options.memory?.length
    ? ["", "What memory holds about this task:", ...options.memory.map((m) => `- ${m}`)]
    : [];
  const user = [options.evidence, ...remembered].join("\n");
  let error = "no reply";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await options.llm.generate({
        profile: "smart",
        system: UNDERSTAND,
        user,
        schema: TaskModel,
        schemaName: "task_model",
        meter: options.meter,
        signal: options.signal,
      });
      if (reply.value) return { ok: true, task: reply.value };
      error = "the reply wasn't a task model";
    } catch (e) {
      error = (e as Error).message;
      if (options.signal?.aborted) break;
    }
  }
  return { ok: false, error };
}
