// The design agent's test run, in the automation window (spec, "The test run in safe mode"): the workflow as a
// walk-through nobody presses, through the same path as Walk through (runSkillOn with a walk). Its log goes next to the
// recording, not with the runs: it is part of designing, not a run of the workflow. Your own windows are never used,
// and the tabs it opened are closed when it ends (the extension's endRun).
//
// The final check (local: true) also makes the files the workflow makes, for real, so the design sees them; each is put
// in the Trash after it (Rushil, 24 Oct: "keep-local changes", and "remove the tests saved").
import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { isAction, type Skill, walkSteps } from "@shadow/core";
import { type RecordedEffect, type Rehearsal, rehearsal, rehearsalPlan } from "@shadow/player";
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

type Report = ReturnType<Rehearsal["report"]>;
const MAKING = new Set(["web.save_pdf", "fs.copy", "fs.move", "fs.rename"]);

// The files a final check made: what its file-making steps that ran handed back.
export function madeBy(skill: Skill, report: { steps: { id: string; status: string; value?: unknown }[] }): string[] {
  const making = new Set(
    [...walkSteps(skill.steps)].flatMap(({ step }) =>
      isAction(step) && MAKING.has(`${step.channel}.${step.action}`) ? [step.id] : [],
    ),
  );
  return report.steps.flatMap((s) => {
    const path = (s.value as { path?: unknown } | undefined)?.path;
    return s.status === "done" && making.has(s.id) && typeof path === "string" ? [path] : [];
  });
}

// Each file still there goes to the Trash (a name taken there gets " (n)"), so nothing the check made is left in your
// folders, and nothing is lost if it shouldn't have gone. The ones moved, by their paths.
export function toTrash(paths: string[], trash = join(homedir(), ".Trash")): string[] {
  const moved: string[] = [];
  for (const path of new Set(paths)) {
    if (!existsSync(path)) continue; // a later step moved or renamed it: that path is the one left
    const ext = extname(path);
    const stem = basename(path, ext);
    let target = join(trash, basename(path));
    for (let n = 1; existsSync(target); n++) target = join(trash, `${stem} (${n})${ext}`);
    try {
      renameSync(path, target);
      moved.push(path);
    } catch {
      // Left where it is: the review lists only what was removed.
    }
  }
  return moved;
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
    // The final check: make the files for real, then put them in the Trash. twice: run it again, to see a rule like
    // "skip ones already saved" hold (the second run should make nothing new).
    local?: boolean;
    twice?: boolean;
  },
) {
  const local = options.local ?? false;
  const once = async (): Promise<Report> => {
    const r = rehearsal(skill, options.effects, options.onLine, options.recorded, local);
    const why = notRunWhy(skill, { extension: daemon.extensions.size > 0, mac: daemon.mac().connected });
    if (why) {
      options.onLine?.(`The test run can't start: ${why}`);
      return r.report(`not run: ${why}`);
    }
    // Before it starts: what it will do, what it will only outline, and what reading changes (an email marked read).
    const plan = rehearsalPlan(skill, options.effects, options.recorded, local);
    options.onLine?.(
      `${local ? "Checking it for real" : "Testing in the automation window"}: it will do ${plan.does.length} step(s) and only outline ${plan.outlines.length}`,
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
  };
  const first = await once();
  if (!local) return first;
  const made = madeBy(skill, first);
  const second = options.twice ? await once() : undefined;
  const again = second ? madeBy(skill, second) : undefined;
  const removed = toTrash([...made, ...(again ?? [])]);
  if (removed.length > 0)
    options.onLine?.(`Put in the Trash what the check made: ${removed.map((p) => basename(p)).join(", ")}`);
  return {
    ...first,
    made: removed.map((p) => basename(p)),
    ...(again ? { again: again.map((p) => basename(p)) } : {}),
  };
}
