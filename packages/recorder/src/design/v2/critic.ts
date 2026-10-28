// The critic (reports/plan-oct25-agents-v3.md, §3.2 D6): one short call, after code's own checks pass, that reads the
// task model, the finished workflow and the test, and names what is still missing, specifically ("rule 1 isn't built
// by any step", "s2–s5 only reach the sheet: open it directly"). The designer gets them back at most twice; after
// that they are listed for the review and never block the save (code's checks decide that: gate.ts).
import type { Llm, UsageMeter } from "@shadow/llm";
import { z } from "zod";
import type { DoneReport, TaskModel } from "./contracts.ts";

export const CRITIC = `You check a workflow Shadow's design agent built from one recording, before the user reviews it.
You get what the task is (the task model: its outcome, how often it runs, where each value comes from next time, the
rules the user said), the workflow, what the agent says it built, and the safe test run.

Name only what is really missing or wrong, each in one sentence a designer can act on, with the step ids:
- a rule of the task model that no step builds, or builds differently from what was said;
- a value that changes each time (a date, the newest item, a list) kept as the recorded text;
- steps that only get to a page that a later step works in, when that page could be opened directly by its address;
- page steps doing work a connected app listed in the message could do directly (a sheet written by typing into
  cells), or an app write whose columns differ from the cells the recording typed each value into;
- something the test couldn't find or got wrong that the agent didn't fix or explain;
- an AI step doing what a reference does ({{x.0}} a list's first item, {{row.1}} a row's cell, {{x.field}}) or what
  a loop's first: N does, or AI steps chained so one only reshapes another's answer: each is a model call on every
  run, so the judgement belongs in one AI step given everything it needs.
A value the evidence puts in a cell of a sheet (A2, A3) shows where one row of a table landed that day: an app step
that writes the same columns to the table's next free row builds it. Never ask for the literal cell (it would write
over the sheet's earlier rows), nor for the recorded selector of one item (s4, s8): a list is read whole and an AI step
picks from it.
Never ask for extra checks, waits, AI steps or polish the user didn't ask for, and never repeat a rule the agent says
is not built with a reason. Most finished workflows have no gaps: then say none.
Reply with JSON only: {"gaps": ["…", …]} (an empty list when it is right).`;

const Reply = z.object({ gaps: z.array(z.string().min(1)).max(8).default([]) });

export interface CriticInput {
  task: TaskModel;
  workflow: string;
  done: DoneReport;
  test?: unknown;
  // The connected apps' section of the build message, when there are any.
  apps?: string;
}

export async function critique(
  llm: Llm,
  input: CriticInput,
  options: { meter?: UsageMeter; signal?: AbortSignal } = {},
): Promise<string[]> {
  try {
    const reply = await llm.generate({
      profile: "smart",
      system: CRITIC,
      maxTokens: 8_192,
      user: [
        "# The task model (rules by number)",
        JSON.stringify(input.task, null, 1),
        "",
        "# The workflow",
        input.workflow,
        "",
        "# What the agent says it built",
        JSON.stringify(input.done, null, 1),
        "",
        "# The test run",
        input.test === undefined ? "(not tested)" : JSON.stringify(input.test).slice(0, 6_000),
        ...(input.apps ? ["", input.apps] : []),
      ].join("\n"),
      json: true,
      meter: options.meter,
      signal: options.signal,
    });
    const parsed = Reply.safeParse(reply.value);
    return parsed.success ? parsed.data.gaps : [];
  } catch {
    // A critic that fails says nothing: the design is never lost or held up by it.
    return [];
  }
}
