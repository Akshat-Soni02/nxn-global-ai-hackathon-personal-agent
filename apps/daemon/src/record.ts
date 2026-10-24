// Record, daemon side. While recording: every event goes to the session's trace file, web events from the extension
// and file events from the folder watcher alike. After stop: trace -> normalise -> the plain step list (code, no
// model) -> the evidence package -> design agent v2 (understand, build, test in the automation window, ask once,
// the finish gate) -> what an unattended Frequency needs -> approvals (code) -> skills/<id>/vN.json. Without a model
// the plain step list is saved; if the agent stops early, its last valid draft is. The recording's folder is kept for a day (recording-store.ts), so a failed or poor result
// can be redone with `compile <session>` until then.
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { type Effect, isAction, type Skill, type Step, type TraceEvent, triggerOf, walkSteps } from "@shadow/core";
import { type Llm, UsageMeter } from "@shadow/llm";
import type { MemoryStore } from "@shadow/memory";
import {
  answerFromEvidence,
  applyAnswer,
  buildEvidence,
  changesSummary,
  compile,
  type DesignV2Options,
  type DesignV2Outcome,
  describeChanges,
  designV2,
  drill,
  type Evidence,
  effectsOf,
  normaliseAll,
  type Prompter,
  pagesOf,
  progressLine,
  type Question,
  recordedFolders,
  recordedPages,
  requireApprovals,
  reviewOf,
  type TestReport,
  tabsOf,
} from "@shadow/recorder";
import type { ScreenDescriber } from "./describe.ts";
import { writeEvidence } from "./evidence.ts";
import { type FsChange, watchFiles } from "./fs-watch.ts";
import { goLiveProblems } from "./lifecycle.ts";
import { type LocateOptions, locateFiles } from "./locate-file.ts";
import { maskTermsOf, readForm, readNotes, recordingDir } from "./recording-store.ts";
import { writeReview } from "./review-store.ts";
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
  design?: Pick<DesignV2Options, "budget" | "protocol">;
  // Masked pictures described by the vision model (describe.ts): the steps' captions in the evidence. Used only when
  // this recording's form allowed pictures.
  describer?: ScreenDescriber;
  // The design agent's safe test run in the automation window (main.ts binds the daemon's rehearse). Without it, the
  // workflow is saved untested and the review says so.
  // `recorded`: the steps whose control is the one recorded, unchanged (only their links are followed).
  rehearse?: (
    skill: Skill,
    effects: Map<string, Effect>,
    onLine: (line: string) => void,
    recorded: Set<string>,
    // The final check: make the files for real, then put them in the Trash (twice: run it again too).
    final?: { twice: boolean },
  ) => Promise<TestReport>;
  // Plain-language lines for the Record screen as the work goes on.
  progress?: (line: string) => void;
  // Whether Shadow.app is running and may use Accessibility: without it, nothing outside Chrome was recorded.
  mac?: () => { connected: boolean; trusted: boolean };
}

// What the review says about the recording itself, before what was built from it (checkpoint 6: 50 s of voice became
// 0 words, Accessibility was off, and a PDF appeared that nothing recorded made; none of it was said). The 0 words were
// the microphone's: 50 s of flat noise at -49 dB, the input at 27%; the transcriber read a spoken clip word for word.
export function noticesOf(facts: {
  microphone: boolean;
  words: number;
  mac?: { connected: boolean; trusted: boolean };
  unmade: string[];
}): string[] {
  const outside = "what you did outside Chrome (Mac apps, save and print dialogs) wasn't recorded";
  return [
    ...(facts.microphone && facts.words === 0
      ? [
          "The microphone was on, but no words came through: nothing you said was used. Check System Settings → Sound → Input (the microphone you speak into, its level well up)",
        ]
      : []),
    ...(facts.mac && !facts.mac.connected ? [`Shadow.app wasn't running: ${outside}`] : []),
    ...(facts.mac?.connected && !facts.mac.trusted
      ? [
          `Accessibility is off for Shadow.app: ${outside}. Turn it on in System Settings → Privacy & Security → Accessibility`,
        ]
      : []),
    ...facts.unmade.map((f) => `A file appeared that the recording doesn't show being made: ${f}`),
  ];
}

export async function finishRecording(
  sessionId: string,
  options: FinishOptions,
): Promise<{ path: string; skill: Skill; design?: DesignV2Outcome } | undefined> {
  const { dataDir, log } = options;
  // The feed's lines are kept for the review's "How this was made" too.
  const made: string[] = [];
  const progress = (line: string) => {
    made.push(line);
    options.progress?.(line);
  };
  // Pages never see a file's path; find each picked or dropped file on disk so the skill knows where they live.
  const raw = readTrace(dataDir, sessionId);
  const trace = options.locate ? await locateFiles(raw, options.locate) : raw;
  const { steps, noise } = normaliseAll(trace);
  log(`trace ${sessionId}: ${trace.length} event(s) -> ${steps.length} step(s), ${noise.length} left out`);
  progress(`Read ${trace.length} actions as ${steps.length} steps`);
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
  for (const warning of compiled.warnings) log(warning);
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
    const answer = answerFromEvidence(q, { goal: form?.description.goal ?? "", said });
    if (!answer) return true;
    const applied = applyAnswer(skill, q, answer.answer);
    if (!applied.ok) return true;
    skill = applied.skill;
    log(`answered from what you said ("${answer.quote}"): ${q.text} → ${answer.answer}`);
    return false;
  });
  // One meter for the whole design: the pictures' captions and the agent share its $0.25 (spec, "Budget").
  const meter = options.meter?.child() ?? new UsageMeter();
  // The evidence package (spec 2.14): what code understood, kept in the recording's folder for the design agent.
  let evidence: Evidence | undefined;
  try {
    evidence =
      (await writeEvidence({
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
        meter,
        log,
      })) ??
      buildEvidence({
        trace,
        steps,
        noise,
        skill,
        idsByStep: compiled.base.idsByStep,
        goal: recorded?.goal ?? "",
        switches: {
          screen: recorded?.consent.screen ?? false,
          voice: recorded?.consent.microphone ?? false,
          pictures: recorded?.consent.pictures ?? false,
        },
        said: said.map(({ at, until, text }) => ({ at, ...(until !== undefined ? { until } : {}), text })),
        pictures: [],
        maskTerms: maskTermsOf(recorded),
      });
  } catch (error) {
    // Without evidence the design can't run, and the plain list is saved: a recording is never lost.
    log("evidence couldn't be built:", (error as Error).message);
  }

  // Design agent v2: the plain list -> the workflow meant. It asks its questions in one batch.
  let design: DesignV2Outcome | undefined;
  if (llm && evidence) {
    log("the design agent is reading the recording...");
    const effects = effectsOf(steps, compiled.base.idsByStep);
    const rehearse = options.rehearse;
    design = await designV2({
      llm,
      skill,
      questions,
      evidence,
      facts: { pages: recordedPages(steps), folders: recordedFolders(steps, skill), whenFixed: form?.whenFixed },
      pages: pagesOf(steps, compiled.base.idsByStep, tabsOf(trace, steps).tabs),
      memory: options.memory,
      prompter: options.prompter,
      // The Never and private words: every tool result the agent reads is masked with them.
      maskTerms: maskTermsOf(recorded),
      unattended: unattendedGaps,
      test: rehearse
        ? (draft) => rehearse(draft, effects, (line) => log(line), unchangedControls(plain, draft))
        : undefined,
      verify: rehearse
        ? (draft, twice) => rehearse(draft, effects, (line) => log(line), unchangedControls(plain, draft), { twice })
        : undefined,
      meter,
      onProgress: progress,
      onEvent: (event) => {
        const line = progressLine(event);
        if (line) progress(line);
      },
      ...options.design,
    });
    const cost = `$${design.usage.costUsd.toFixed(4)}, ${design.usage.calls} calls`;
    log(`design agent: ${design.kind === "designed" ? design.summary : design.reason} (${cost})`);
    // The workflow's id and name are the daemon's (a new id per recording, or the workflow recorded again), never the
    // model's: a model-chosen id once saved a recording as the next version of another workflow.
    skill = { ...design.skill, id: skill.id, name: skill.name };
    // v2 asked its questions in its own batch; any it never reached (it stopped first) go to the drill below.
    questions = design.pending;
    await remember(options.memory, skill.id, design.answered);
    keepDesign(dataDir, sessionId, design);
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
  progress(`Saved ${saved.skill.name}`);
  if (design) {
    const notices = noticesOf({
      microphone: recorded?.consent.microphone ?? false,
      words: said.length,
      mac: options.mac?.(),
      unmade: evidence?.unmade ?? [],
    });
    writeReview(dataDir, reviewOf(design, saved.skill, made, notices));
  }
  return { ...saved, design };
}

// The steps whose control is still the one recorded: the test run follows a link only there (a link the agent added,
// or a control it changed, is only outlined).
function unchangedControls(recorded: Skill, draft: Skill): Set<string> {
  const target = (step: Step) => JSON.stringify(isAction(step) ? step.target : undefined);
  const was = new Map([...walkSteps(recorded.steps)].map(({ step }) => [step.id, target(step)]));
  return new Set(
    [...walkSteps(draft.steps)].filter(({ step }) => was.get(step.id) === target(step)).map(({ step }) => step.id),
  );
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

// What the design did, stage by stage, kept with the recording (and deleted with it): the task model, the decisions,
// the changes with their whys, the test report, what was asked, the gaps, and the whole transcript.
function keepDesign(dataDir: string, sessionId: string, design: DesignV2Outcome): void {
  const dir = recordingDir(dataDir, sessionId);
  if (!existsSync(dir)) return;
  const { skill: _skill, ...kept } = design;
  writeFileSync(join(dir, "design.json"), `${JSON.stringify(kept, null, 2)}\n`, { mode: 0o600 });
}
