// Record, daemon side. While recording: every event goes to the session's trace file, web events from the extension
// and file events from the folder watcher alike. After stop: trace -> normalise -> the plain step list (code, no
// model) -> the design agent, the one AI that reads the recording: it labels the steps, makes loops, branches and
// llm steps, and asks what is unclear -> the questions code still has -> what an unattended Frequency needs ->
// approvals (code) -> skills/<id>/vN.json. Without a model the plain step list is saved; if the agent stops early,
// its last valid draft is. The recording's folder is kept for a day (recording-store.ts), so a failed or poor result
// can be redone with `compile <session>` until then.
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { type Skill, type TraceEvent, triggerOf } from "@shadow/core";
import type { Llm, UsageMeter } from "@shadow/llm";
import type { MemoryStore } from "@shadow/memory";
import {
  answerFromEvidence,
  applyAnswer,
  changesSummary,
  compile,
  type DesignOptions,
  describeChanges,
  designWorkflow,
  drill,
  type NormalisedStep,
  normaliseAll,
  type Prompter,
  type Question,
  requireApprovals,
} from "@shadow/recorder";
import type { ScreenDescriber } from "./describe.ts";
import { writeEvidence } from "./evidence.ts";
import { type FsChange, watchFiles } from "./fs-watch.ts";
import { goLiveProblems } from "./lifecycle.ts";
import { type LocateOptions, locateFiles } from "./locate-file.ts";
import { maskTermsOf, readForm, readNotes, recordingDir } from "./recording-store.ts";
import { loadSkill, newSkillId, saveSkill } from "./skill-store.ts";
import { appendTrace, readTrace } from "./trace-store.ts";

type Log = (...args: unknown[]) => void;

export interface Recording {
  sessionId: string;
  append(event: TraceEvent): void;
  // A folder opened in Finder outside the watched ones: watched for the rest of this recording. True if it is new.
  watchFolder(path: string): boolean;
  stopWatching(): void;
}

export function openRecording(
  sessionId: string,
  options: { dataDir: string; watchDirs: string[]; log: Log },
): Recording {
  const append = (event: TraceEvent) => {
    try {
      appendTrace(options.dataDir, event);
    } catch (error) {
      options.log("could not write trace event", error instanceof Error ? error.message : error);
    }
  };
  const onChange = (change: FsChange) => append({ id: randomUUID(), sessionId, ...change });
  const watch = (dirs: string[]) => watchFiles(dirs, onChange, { log: options.log, ignoreUnder: [options.dataDir] });
  const roots = [...options.watchDirs];
  const watchers = roots.length > 0 ? [watch(roots)] : [];
  const covered = (path: string) => roots.some((r) => path === r || path.startsWith(`${r}${sep}`));

  const watchFolder = (folder: string) => {
    if (watchers.length === 0 || !isAbsolute(folder) || !existsSync(folder)) return false; // file capture is off
    // On an external drive, the whole drive: a file is usually moved between two of its folders.
    const drive = /^\/Volumes\/[^/]+/.exec(folder)?.[0];
    let root = drive ?? folder;
    try {
      root = realpathSync(root);
    } catch {
      return false;
    }
    // /Volumes/Macintosh HD is your startup disk ("/"): never watched whole.
    if (root === "/" || covered(root)) return false;
    roots.push(root);
    watchers.push(watch([root]));
    options.log(`watching ${root} too (opened in Finder)`);
    return true;
  };
  const stopWatching = () => {
    for (const w of watchers) w.close();
  };
  return { sessionId, append, watchFolder, stopWatching };
}

export interface FinishOptions {
  dataDir: string;
  prompter: Prompter;
  // The model client; without one, skills are compiled by code only.
  llm?: Llm;
  memory?: MemoryStore;
  // Where to look for files the pages saw (picked or dropped). Off when absent, e.g. in tests.
  locate?: LocateOptions;
  log: Log;
  now?: () => Date;
  // Counts what the model costs (the daemon's meter).
  meter?: UsageMeter;
  // The design agent's budget, for tests.
  design?: Pick<DesignOptions, "budget" | "protocol">;
  // Masked pictures described by the vision model (describe.ts), for the design agent's describe_step_screenshot. Used only
  // when this recording's form allowed pictures.
  describer?: ScreenDescriber;
}

export async function finishRecording(
  sessionId: string,
  options: FinishOptions,
): Promise<{ path: string; skill: Skill } | undefined> {
  const { dataDir, log } = options;
  // Pages never see a file's path; find each picked or dropped file on disk so the skill knows where they live.
  const raw = readTrace(dataDir, sessionId);
  const trace = options.locate ? await locateFiles(raw, options.locate) : raw;
  const { steps, noise } = normaliseAll(trace);
  log(`trace ${sessionId}: ${trace.length} event(s) -> ${steps.length} step(s), ${noise.length} left out`);
  if (steps.length === 0) {
    log("nothing to compile");
    return undefined;
  }

  const { llm } = options;
  // The description form filled in before Record; recordings made before Oct 13 have none.
  const recorded = readForm(dataDir, sessionId);
  const form = recorded && {
    description: {
      goal: recorded.goal,
      changes: recorded.changes,
      constants: recorded.constants,
      never: recorded.never,
    },
    when: recorded.when,
    // Only the goal is asked before recording, so how often it runs is set from what was said; unless it was given:
    // a task recorded again keeps its workflow's, and a schedule or folder named up front (the API) stands.
    whenFixed: Boolean(recorded.again) || recorded.when.some((w) => w.type !== "manual"),
  };
  // Code only, no model: every action becomes a step that replays what you did (the plain step list), plus the
  // questions code knows it can't decide. The design agent is the one AI that reads it, labels it and asks.
  log("building the step list...");
  // What was seen (masked screenshot words) and said (the narration) while recording, on the recording's clock.
  const notes = readNotes(dataDir, sessionId);
  // Per-run AI steps run on the fast profile: its input price is what a question about one shows it costing.
  const fast = llm?.config.catalog[llm.config.profiles.fast.model];
  const compiled = await compile(steps, { pricePerMTok: fast?.priceIn, form });
  // compile's own note about running without a model is about its old one-call path: the agent is what uses the model now.
  for (const warning of compiled.warnings) if (!warning.startsWith("No model configured")) log(warning);
  if (!llm) log("no model configured (a key in Settings or .env): saving the plain step list");

  // A recording is a new skill with its own id, so recordings never collide; unless the form said it is the task you
  // already have, recorded again: then it becomes that workflow's next version, keeping its id, name and state.
  const existing = recorded?.again ? loadSkill(dataDir, recorded.again) : undefined;
  if (recorded?.again && !existing) log(`no workflow ${recorded.again} to record again: saving a new one`);
  let skill: Skill = existing
    ? { ...compiled.skill, id: existing.id, name: existing.name }
    : { ...compiled.skill, id: newSkillId(dataDir, compiled.skill.id) };
  let questions = compiled.questions;
  // The plain step list, before anything was decided: the history note says what changed from it.
  const plain = skill;
  // Questions the recording already answers are not asked (spec 2.10): "which file?" after "the latest invoice".
  const said = notes.filter((n) => n.kind === "said");
  questions = questions.filter((q) => {
    const found = answerFromEvidence(q, { goal: form?.description.goal ?? "", said });
    if (!found) return true;
    const applied = applyAnswer(skill, q, found.answer);
    if (!applied.ok) return true;
    skill = applied.skill;
    log(`answered from what you said ("${found.quote}"): ${q.text} → ${found.answer}`);
    return false;
  });
  // The evidence package (spec 2.14): what code understood, kept in the recording's folder for the design agent.
  await writeEvidence({
    dataDir,
    sessionId,
    trace,
    steps,
    noise,
    skill,
    idsByStep: compiled.base.idsByStep,
    form: recorded,
    notes,
    describer: options.describer,
    meter: options.meter,
    log,
  });

  // The design agent: the flat first draft -> the workflow meant. It asks its own questions (the drill).
  if (llm) {
    log("the design agent is reading the recording...");
    // A step's picture, already masked by screen.ts (shots/<event>.jpg), described: only when this recording's form
    // allowed pictures to be sent.
    const describer = options.describer;
    const describeScreen =
      describer && recorded?.consent.pictures && describer.allowed()
        ? async (step: NormalisedStep) => {
            const dir = recordingDir(dataDir, sessionId);
            // Event ids come from the extension and the app: only plain ones name a file, so no id can point outside
            // the recording's shots folder.
            const shot = step.events
              .filter((id) => /^[\w-]+$/.test(id))
              .map((id) => join(dir, "shots", `${id}.jpg`))
              .find((p) => existsSync(p));
            if (!shot) throw new Error("no picture was kept for that step");
            const did = [
              step.kind.replace(/_/g, " "),
              step.target?.name ?? step.element?.title ?? step.element?.description,
              step.value && !step.secret ? `"${step.value.slice(0, 60)}"` : undefined,
            ]
              .filter(Boolean)
              .join(" ");
            return describer.describeMasked(
              shot,
              `The user did: ${did}. Describe what is on screen and what the control they used is for.`,
              options.meter,
            );
          }
        : undefined;
    const design = await designWorkflow({
      llm,
      skill,
      questions,
      // The plain step list to label first: the agent's first move.
      base: compiled.base,
      steps,
      form,
      notes,
      maskTerms: maskTermsOf(recorded),
      memory: options.memory,
      prompter: options.prompter,
      // It may finish only once a run started by the Frequency could fill every input on its own.
      checks: unattendedGaps,
      describeScreen,
      meter: options.meter,
      ...options.design,
    });
    const cost = design.episode ? `, $${design.episode.usage.costUsd.toFixed(4)}` : "";
    if (design.kind === "designed") log(`design agent: ${design.summary} (${design.episode?.turns ?? 0} turns${cost})`);
    else log(`design agent: ${design.reason}${cost}; keeping what it reached`);
    log(`what changed: ${changesSummary(design.changes)}`);
    // The workflow's id and name are the daemon's (a new id per recording, or the workflow recorded again), never the
    // model's: label_steps names the task, and a model-chosen id saved a recording as the next version of another
    // workflow (tidy-downloads/v2 was a different recording).
    skill = { ...design.skill, id: skill.id, name: skill.name };
    questions = design.pending;
    await remember(options.memory, skill.id, design.answered);
    keepEpisode(dataDir, sessionId, design);
  }

  if (questions.length > 0) log(`${questions.length} question(s) before saving. Enter takes the default.`);
  const drilled = await drill(skill, questions, { prompter: options.prompter, memory: options.memory });
  for (const problem of drilled.problems) log("answer not applied:", problem);
  const filled = await fillForUnattended(drilled.skill, options.prompter, log);

  // Approval on every step that sends, pays or deletes, or matches the Never list: by code, whatever was answered.
  const approved = requireApprovals(filled);
  if (approved.added.length > 0) log(`approval needed before: ${approved.added.join(", ")}`);
  const at = (options.now ?? (() => new Date()))().toISOString();
  // What really changed from the recorded steps (the agent's work, the answers, the approvals): from the workflow
  // itself, never from the agent's own summary.
  const changed = changesSummary(describeChanges(plain, approved.skill));
  const noted = existing
    ? {
        ...approved.skill,
        history: [
          ...existing.history,
          {
            version: existing.version + 1,
            by: "record" as const,
            summary: `Recorded again; ${changed}`,
            at,
          },
        ],
      }
    : approved.skill.history.length
      ? approved.skill
      : {
          ...approved.skill,
          history: [
            {
              version: approved.skill.version,
              by: "record" as const,
              summary: `Recorded; ${changed}`,
              at,
            },
          ],
        };
  const saved = saveSkill(dataDir, noted);
  log(`saved ${saved.skill.id} v${saved.skill.version}: ${saved.path}`);
  return saved;
}

// A Frequency that starts runs on their own (a schedule, a folder) needs every input filled without asking: a default
// for each input that has no way to be found. Asked here; the workflow is saved either way, and going live says what
// is still missing.
// Secrets are never asked for here, nor given a default: they come from the Keychain when it runs.
export function unattendedGaps(skill: Skill): string[] {
  const inputs = triggerOf(skill).inputs;
  return goLiveProblems(skill).filter((p) => {
    const name = /^input "([^"]+)"/.exec(p)?.[1];
    return name !== undefined && inputs[name]?.type.type !== "secret";
  });
}

async function fillForUnattended(skill: Skill, prompter: Prompter, log: Log): Promise<Skill> {
  let current = skill;
  for (const [name, input] of Object.entries(triggerOf(skill).inputs)) {
    if (!unattendedGaps(current).some((p) => p.startsWith(`input "${name}"`))) continue;
    const example = typeof input.example === "string" ? input.example : undefined;
    const question: Question = {
      id: `default-${name}`,
      text: `When it runs on its own, what should "${name}"${input.description ? ` (${input.description})` : ""} be?`,
      appliesTo: `steps.start.inputs.${name}.default`,
      default: example,
    };
    const answer = (await prompter.ask(question)).trim() || example || "";
    if (!answer) continue;
    const next = structuredClone(current);
    const target = triggerOf(next).inputs[name];
    if (target)
      target.default = input.type.type === "number" && Number.isFinite(Number(answer)) ? Number(answer) : answer;
    current = next;
  }
  const left = goLiveProblems(current);
  if (left.length > 0) log(`it can't run on its own yet: ${left.join("; ")}`);
  return current;
}

// Lasting answers given to the design agent go to memory, as the drill's do.
async function remember(
  memory: MemoryStore | undefined,
  skillId: string,
  answered: { question: Question; answer: string }[],
): Promise<void> {
  for (const { question, answer } of answered) {
    if (memory && question.remember && answer) {
      await memory.add({ kind: question.remember, text: `${question.text} ${answer}`, skillId });
    }
  }
}

// What the design agent did, turn by turn, kept with the recording (and deleted with it).
function keepEpisode(dataDir: string, sessionId: string, design: Awaited<ReturnType<typeof designWorkflow>>): void {
  const dir = recordingDir(dataDir, sessionId);
  if (!existsSync(dir) || !design.episode) return;
  const { transcript, usage, turns, system } = design.episode;
  // `claimed`: what the agent said it did; `changes`: what it really changed (the two can differ).
  const result =
    design.kind === "designed"
      ? { claimed: design.summary, changes: design.changes, edits: design.edits }
      : { kept: design.reason, changes: design.changes };
  // What it was told (`system`: the whole system prompt sent, its rules included), so a poor result can be explained.
  writeFileSync(
    join(dir, "design.json"),
    `${JSON.stringify({ ...result, turns, usage, prompt: design.prompt, system, transcript }, null, 2)}
`,
    {
      mode: 0o600,
    },
  );
}
