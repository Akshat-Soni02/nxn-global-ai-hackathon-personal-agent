// The design agent's test run, in the automation window (spec, "The test run in safe mode"): the workflow as a
// walk-through nobody presses, through the same path as Walk through (runSkillOn with a walk). Its log goes next to the
// recording, not with the runs: it is part of designing, not a run of the workflow. Your own windows are never used,
// and the tabs it opened are closed when it ends (the extension's endRun).
import { isAction, type Skill, walkSteps } from "@shadow/core";
import { type RecordedEffect, rehearsal, rehearsalPlan } from "@shadow/player";
import type { Daemon } from "./daemon.ts";
import { type RunHooks, runSkillOn } from "./runner.ts";

// Why the test run can't start, before it tries: the browser or the Mac app the workflow needs isn't connected. Said
// as "not run", so the gate doesn't send the agent round the fix loop and the review says "not tested". Without this,
// the runner opens Chrome, waits 30 s, and its first step fails.
export function notRunWhy(skill: Skill, connected: { extension: boolean; mac: boolean }): string | undefined {
  const channels = new Set([...walkSteps(skill.steps)].flatMap(({ step }) => (isAction(step) ? [step.channel] : [])));
  if (channels.has("web") && !connected.extension) return "Chrome is not connected to Shadow";
  if (channels.has("ax") && !connected.mac) return "Shadow.app is not running";
  return undefined;
}

export async function rehearse(
  daemon: Daemon,
  skill: Skill,
  options: {
    effects: Map<string, RecordedEffect>;
    // The steps whose control is the one recorded, unchanged: only their links are followed.
    recorded?: Set<string>;
    inputs?: Record<string, unknown>;
    hooks: Pick<RunHooks, "data" | "llm">;
    logDir: string;
    onLine?: (line: string) => void;
    signal?: AbortSignal;
  },
) {
  const r = rehearsal(skill, options.effects, options.onLine, options.recorded);
  const why = notRunWhy(skill, { extension: daemon.extensions.size > 0, mac: daemon.mac().connected });
  if (why) {
    options.onLine?.(`The test run can't start: ${why}`);
    return r.report(`not run: ${why}`);
  }
  // Before it starts: what it will do, what it will only outline, and what reading changes (an email marked read).
  const plan = rehearsalPlan(skill, options.effects, options.recorded);
  options.onLine?.(
    `Testing in the automation window: it will open and read ${plan.does.length} step(s) and only outline ${plan.outlines.length}`,
  );
  for (const warning of plan.warnings) options.onLine?.(warning);
  try {
    const outcome = await runSkillOn(
      daemon,
      skill,
      { provided: options.inputs ?? {}, signal: options.signal },
      {
        walk: r.walk,
        onHighlight: r.onHighlight,
        // Nothing that needs approval is ever done in a test run, and no one answers its questions.
        approve: async () => false,
        ask: async (ask) => (ask.kind === "confirm" ? false : ""),
        log: r.log,
        data: options.hooks.data,
        llm: options.hooks.llm,
      },
      options.logDir,
    );
    return r.report(outcome.error ? `${outcome.status}: ${outcome.error}` : outcome.status);
  } catch (error) {
    // An input the run can't fill (no default yet), Chrome not connected: said in the report, not thrown.
    return r.report(`not run: ${(error as Error).message}`);
  }
}
