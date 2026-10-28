// The chat box (R6.1): "What would you like to change?" on a workflow's page. The design agent changes the saved workflow
// from one sentence ("also skip jobs older than a week"), with the same file tools and the same checks as when it designs
// one from a recording, and no recording: the workflow itself is what it reads. What it makes goes into the editor's
// draft as ordinary edits (the daemon), so the changes show on the nodes, Undo takes them back, and nothing runs until
// you save. Before, a change meant the editor, step by step, or a new recording.
import { type AgentEvent, type Protocol, runAgent } from "@shadow/agent";
import { isAction, type Skill, walkSteps } from "@shadow/core";
import type { Llm, UsageMeter } from "@shadow/llm";
import { requireApprovals } from "../../approvals.ts";
import { appsSection, readOnlyTools, type UsableApp } from "./connectors.ts";
import type { DoneReport } from "./contracts.ts";
import { inBlocks, runProblems } from "./gate.ts";
import { FILE, withAiLimit } from "./prompt.ts";
import { newSession } from "./session.ts";
import { designToolsV2, workflowFile } from "./tools.ts";

const CHAT = `You are Shadow's design agent. The user's workflow is saved and runs; they ask for a change in a sentence.
Make what they ask, and nothing else: every other step stays as it is, with its id. The change is a draft they review
before it is saved: say plainly what you changed.
- Values that differ each run come from today's date ({{today}}), an earlier step, a list's item or an input: never fixed
  text. How many of a list is the loop's first: N; judgement (new ones, ones not done) is an AI step's.
- If what they ask can't be done with these steps, change nothing and say why in done.

${FILE}
- Finish with done: { "summary": one sentence of what you changed (or why nothing), "rules": [] }.`;

// The tools a change needs: read, write, edit, look (an app's tools), and done. No recording, no questions, no test.
const TOOLS = new Set(["read_workflow", "write_workflow", "edit_workflow", "look", "done"]);

export async function changeByChat(options: {
  skill: Skill;
  message: string;
  llm: Llm;
  // Connected apps it may use (their tools, as the design gets them).
  apps?: UsableApp[];
  meter?: UsageMeter;
  signal?: AbortSignal;
  protocol?: Protocol;
  // How often a run may ask the AI (the runner's limit): a change that makes it ask more is refused.
  aiCallsPerRun?: number;
}): Promise<{ skill: Skill; summary: string; changed: boolean; transcript: AgentEvent[] }> {
  const apps = options.apps ?? [];
  const pages = [...walkSteps(options.skill.steps)].flatMap(({ step }) =>
    isAction(step) && step.channel === "web" && step.action === "navigate" ? [String(step.args.url ?? "")] : [],
  );
  const session = newSession(options.skill, { pages, folders: [] }, { apps });
  // What it may not leave behind: a step the runner can't run that the workflow didn't already have.
  const limits = { aiCallsPerRun: options.aiCallsPerRun };
  const before = new Set(runProblems(options.skill, limits));
  session.finish = () =>
    inBlocks(
      runProblems(session.draft, limits).filter((p) => !before.has(p)),
      session.draft,
    );
  const transcript: AgentEvent[] = [];
  const run = await runAgent<DoneReport>({
    llm: options.llm,
    profile: "smart",
    system: [withAiLimit(CHAT, options.aiCallsPerRun), ...appsSection(apps)].join("\n"),
    task: `They ask: "${options.message}"\n\nThe workflow now (read_workflow shows the same):\n${workflowFile(options.skill)}`,
    tools: designToolsV2(session, { mode: "file" }).filter((t) => TOOLS.has(t.name)),
    callsPerTurn: 8,
    budget: { turns: 12, costUsd: 0.08, liveActions: 0 },
    protocol: options.protocol,
    meter: options.meter,
    signal: options.signal,
    onEvent: (event) => transcript.push(event),
  });
  const outcome = run.outcome;
  const summary =
    outcome.kind === "finished"
      ? outcome.value.summary
      : outcome.kind === "out_of_budget"
        ? `it ran out of ${outcome.budget} before it finished`
        : outcome.kind === "error"
          ? `it failed: ${outcome.error}`
          : "it was stopped";
  const made = requireApprovals(session.draft, { readOnlyTools: readOnlyTools(apps) }).skill;
  const changed = JSON.stringify(made.steps) !== JSON.stringify(options.skill.steps);
  return { skill: changed ? made : options.skill, summary, changed, transcript };
}
