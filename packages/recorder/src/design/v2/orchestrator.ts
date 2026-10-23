// Design agent v2 (spec, Phase 3): the stages that turn a recording's plain list into the workflow the user meant, on
// one budget (≤ $0.25 and ≤ 40 model calls, pictures' captions included):
//   1 understand    one structured call: the evidence → the task model (understand.ts)
//   2 build         the tools (tools.ts), several calls a turn; code's proposals are accepted by id
//   3–4 test, fix   the safe test run inside the same episode (the test tool, and once before done)
//   5 ask           code's open questions and the agent's, in one batch: only what the evidence can't answer
//   6 apply         a short episode with the answers, tested again if it changed
//   7 finish gate   bound into done (gate.ts): refused twice at most, then saved with what is left listed
// A recording is never lost: no task model, a used-up budget, an error or a stop keeps the last valid draft (else the
// plain list, with the answers code found in what was said already in it).
import { type AgentEvent, type Protocol, runAgent } from "@shadow/agent";
import { applyEdits, type EditInput, isLlm, isLoop, Skill, type StepInput, walkSteps } from "@shadow/core";
import { type Llm, type Usage, UsageMeter } from "@shadow/llm";
import type { MemoryStore } from "@shadow/memory";
import { requireApprovals } from "../../approvals.ts";
import type { Question } from "../../compile.ts";
import { applyAnswer, type Prompter } from "../../drill.ts";
import { type Evidence, evidenceText, evidenceView } from "../../evidence/evidence.ts";
import { maskText } from "../../mask.ts";
import { plainChecks } from "../../plain-checks.ts";
import { skeletonOf, skillInput } from "../../skeleton.ts";
import { DESIGN_V2_BUDGET, remaining } from "./budget.ts";
import type { DoneReport, TaskModel, TestReport } from "./contracts.ts";
import { gate, lostWork, runProblems } from "./gate.ts";
import { outlineOf } from "./outline.ts";
import { BUILD } from "./prompt.ts";
import { askBatch, batchOf, openCodeQuestions } from "./questions.ts";
import { type ChangeNote, changeNotes, type RecordingFacts } from "./rules.ts";
import { newSession, type QueuedQuestion, type SessionV2 } from "./session.ts";
import { designToolsV2 } from "./tools.ts";
import { understand } from "./understand.ts";

export interface DesignV2Options {
  llm: Llm;
  // The plain list code built, with the answers code found in what was said already in it (spec 2.10).
  skill: Skill;
  // Code's questions still open (which file, which row).
  questions: Question[];
  evidence: Evidence;
  facts: RecordingFacts;
  // Real addresses by step id and tab name (pagesOf): the agent opens pages by name.
  pages: Map<string, string>;
  memory?: Pick<MemoryStore, "search">;
  prompter: Prompter;
  // The recording's Never and private words: every tool result is masked with them (the evidence already is).
  maskTerms?: string[];
  // What an unattended run still needs (the daemon's go-live checks).
  unattended?: (skill: Skill) => string[];
  // The safe test run (the daemon's rehearse). Without it the workflow is saved untested, and the review says so.
  test?: (skill: Skill) => Promise<TestReport>;
  // The design's meter: the pictures' captions are already on it.
  meter?: UsageMeter;
  budget?: { costUsd: number; calls: number };
  protocol?: Protocol;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  // Plain-language lines for the Record screen.
  onProgress?: (line: string) => void;
}

export interface DesignV2Outcome {
  kind: "designed" | "kept";
  skill: Skill;
  summary?: string;
  // Why the plain list (or the last draft) was kept.
  reason?: string;
  task?: TaskModel;
  done?: DoneReport;
  decisions: { proposal: string; decision: "accept" | "reject"; why: string }[];
  notes: ChangeNote[];
  // What the finish gate still wanted when it was saved anyway.
  gaps: string[];
  test?: TestReport;
  asked: { question: string; answer: string; by: "code" | "agent" }[];
  // Code's questions and their answers, for memory (a lasting answer is remembered).
  answered: { question: Question; answer: string }[];
  // Code's questions it never reached (it stopped first): the drill asks them, so none is lost.
  pending: Question[];
  // Questions not asked (another one changes the same step, or past MAX_QUESTIONS): they took their defaults.
  skipped: string[];
  system: string;
  // What the agent was first told (the build message) and the plain list it started from (F16).
  firstMessage?: string;
  plain?: Skill;
  transcript: AgentEvent[];
  usage: Usage;
}

// The steps code left out, as steps the agent can put back (restore x1), each after the step that came before it.
export function droppedOf(evidence: Evidence): SessionV2["dropped"] {
  const dropped: SessionV2["dropped"] = new Map();
  for (const n of evidence.noise) {
    if (!n.step) continue;
    const parsed = Skill.safeParse(skillInput(skeletonOf([{ ...n.step, index: 0 }]).draft));
    const step = parsed.success ? parsed.data.steps.find((s) => s.type === "action") : undefined;
    if (!step) continue;
    const before = [...evidence.steps].reverse().find((s) => s.at <= n.at);
    dropped.set(n.id, { step: { ...step, id: n.id } as StepInput, why: n.why, after: before?.ids.at(-1) ?? "start" });
  }
  return dropped;
}

// The workflow as saved: url checks as the player reads them, and approval wherever a step acts outward.
const finalOf = (draft: Skill) => requireApprovals(plainChecks(withFields(draft))).skill;

// An AI step's list of open objects gets the fields its loop reads ({{story.title}}), so the run's model is asked for
// exactly those (Checkpoint 5: a bare "object" let it name them as it liked, and {{story.title}} would come out empty).
// At save, not on each edit: a field read later must not be refused for missing from fields set earlier.
export function withFields(skill: Skill): Skill {
  const steps = [...walkSteps(skill.steps)].map(({ step }) => step);
  const edits = steps.filter(isLoop).flatMap((loop): EditInput[] => {
    const ai = steps.filter(isLlm).find((a) => `{{${a.output.name}}}` === loop.over);
    const items = ai?.output.type.type === "list" ? ai.output.type.items : undefined;
    if (!ai || items?.type !== "object" || items.fields) return [];
    const read = JSON.stringify(loop.steps).matchAll(new RegExp(`\\{\\{${loop.item.name}\\.(\\w+)`, "g"));
    const names = [...new Set([...read].map((m) => m[1] as string))];
    if (names.length === 0) return [];
    const type = { type: "object", fields: Object.fromEntries(names.map((n) => [n, { type: "text" }])) };
    return [
      { op: "set", step: ai.id, field: "output", value: { ...ai.output, type: { type: "list", items: type } } },
      { op: "set", step: loop.id, field: "item", value: { ...loop.item, type } },
    ];
  });
  const typed = edits.length > 0 ? applyEdits(skill, edits) : undefined;
  return typed?.ok ? typed.skill : skill;
}

const cadenceText = (task: TaskModel) =>
  task.cadence.kind === "manual" ? "when you start it" : (task.cadence.quote ?? task.cadence.kind);

export async function designV2(options: DesignV2Options): Promise<DesignV2Outcome> {
  const meter = options.meter ?? new UsageMeter();
  const budget = options.budget ?? DESIGN_V2_BUDGET;
  const say = options.onProgress ?? (() => {});
  const transcript: AgentEvent[] = [];
  // Built from the plain list first, so even evidence that can't be read keeps the recording (below, in the try).
  const session = newSession(options.skill, options.facts, {
    // By the names the agent reads: a tab's title is masked like everything else it reads ("Inbox - ███ - Gmail").
    pages: new Map([...options.pages].map(([name, url]) => [maskText(name, options.maskTerms ?? []).text, url])),
    maskTerms: options.maskTerms ?? [],
  });
  let task: TaskModel | undefined;
  let done: DoneReport | undefined;
  const asked: DesignV2Outcome["asked"] = [];
  const answered: DesignV2Outcome["answered"] = [];
  const skipped: string[] = [];
  let reachedQuestions = false;
  let firstMessage: string | undefined;

  const outcome = (
    extra: { kind: "designed"; summary?: string } | { kind: "kept"; reason: string },
  ): DesignV2Outcome => ({
    ...extra,
    skill: finalOf(session.draft),
    task,
    done,
    decisions: [...session.decisions].map(([proposal, d]) => ({ proposal, ...d })),
    notes: changeNotes(options.skill, session.draft, session.whys, session.unverified),
    gaps: session.gaps,
    test: session.lastTest,
    asked,
    answered,
    pending: reachedQuestions ? [] : openCodeQuestions(options.questions, options.skill, session.draft),
    skipped,
    system: BUILD,
    ...(firstMessage ? { firstMessage } : {}),
    plain: options.skill,
    transcript,
    usage: meter.usage,
  });
  // What it reached is kept, unless it had lost work the user showed or has steps the runner can't run that the
  // recording didn't (the gate never saw it; Checkpoint 4: C kept reads with no control): then the plain list.
  const kept = (reason: string) => {
    let why = reason;
    const lost = lostWork(options.skill, session.draft, session.whys).length > 0;
    const recorded = new Set(runProblems(finalOf(options.skill)));
    const broken = runProblems(finalOf(session.draft)).filter((p) => !recorded.has(p));
    if (lost || broken.length > 0) {
      session.draft = options.skill;
      why = `${reason}; what it reached ${lost ? "had lost work you showed" : `has steps that can't run (${broken[0]})`}, so the recorded steps were kept`;
    }
    // Its own questions it never got to ask are listed in the review, never lost.
    if (!reachedQuestions) skipped.push(...session.questions.map((q) => q.text));
    say(`Kept what it reached: ${why}`);
    return outcome({ kind: "kept", reason: why });
  };

  // One episode of the agent loop on what is left of the budget: build/test/fix, or putting the answers in.
  const episode = async (message: string): Promise<string | undefined> => {
    const left = remaining(meter, budget);
    if (left.calls === 0 || left.costUsd === 0) return "its budget was used up";
    const run = await runAgent<DoneReport>({
      llm: options.llm,
      profile: "smart",
      system: BUILD,
      task: message,
      tools: designToolsV2(session),
      callsPerTurn: 8,
      budget: { turns: left.calls, costUsd: left.costUsd, liveActions: 0 },
      protocol: options.protocol,
      meter,
      signal: options.signal,
      onEvent: (event) => {
        transcript.push(event);
        options.onEvent?.(event);
      },
    });
    const o = run.outcome;
    if (o.kind === "finished") return undefined;
    if (o.kind === "out_of_budget") return `it ran out of ${o.budget}`;
    return o.kind === "error" ? `it failed: ${o.error}` : "it was stopped";
  };

  try {
    session.proposals = new Map(options.evidence.proposals.map((p) => [p.id, p]));
    session.dropped = droppedOf(options.evidence);
    session.evidence = evidenceView(options.evidence);
    const view = session.evidence;
    say("Understanding the task from what you did and said");
    const start = remaining(meter, budget);
    if (start.calls < 2 || start.costUsd === 0) return kept("its budget was used up before it could start");
    const memory = options.memory
      ? (await options.memory.search(options.evidence.goal, { limit: 5 })).map((m) => m.text)
      : [];
    const understood = await understand({
      llm: options.llm,
      evidence: evidenceText(options.evidence).text,
      memory,
      maskTerms: options.maskTerms ?? [],
      meter,
      signal: options.signal,
    });
    if (!understood.ok) return kept(`it couldn't understand the task: ${understood.error}`);
    const theTask = understood.task;
    task = theTask;
    say(`You said ${theTask.rules.length} rule(s); it runs ${cadenceText(theTask)}`);

    // The task model's unknowns: what the evidence speaks to goes to the agent with the evidence; the rest are queued.
    const seen: string[] = [];
    for (const u of theTask.unknowns) {
      const about = view.about(u.question);
      if (about.length > 0) {
        seen.push(
          `- ${u.question} The recording holds: <untrusted_data>${about.map((a) => `"${a}"`).join("; ")}</untrusted_data>`,
        );
        continue;
      }
      session.questions.push({
        id: `q${session.questions.length + 1}`,
        text: u.question,
        why: u.why,
        step: u.step ?? "start",
        options: u.options,
        ...(u.default ? { default: u.default } : {}),
      });
    }
    session.finish = (report) => {
      done = report;
      return gate({
        recorded: options.skill,
        workflow: session.draft,
        task: theTask,
        done: report,
        test: session.lastTest,
        appeared: view.appeared(),
        explained: session.whys,
        sinceTest: session.sinceTest,
        said: [options.evidence.goal, ...options.evidence.said.map((s) => s.text)],
        unattended: options.unattended,
      });
    };
    const test = options.test;
    if (test) {
      session.runTest = async () => {
        say("Testing it in the automation window");
        return test(session.draft);
      };
    }

    // Every message the agent reads is masked like the evidence: the outline holds recorded values (typed text, an
    // email, a Never or private word), and page names hold tab titles.
    const masked = (text: string) => maskText(text, session.maskTerms ?? []).text;
    firstMessage = masked(buildMessage(theTask, options.evidence, session, seen));
    let stopped = await episode(firstMessage);
    // A failed reply (Checkpoint 5: D2's 33rd turn thought past the token cap) ends an episode, not the design: once
    // more, from the workflow as it got to, on what is left of the budget.
    if (stopped?.startsWith("it failed"))
      stopped = await episode(masked(buildMessage(theTask, options.evidence, session, seen)));
    if (stopped) return kept(stopped);

    // 5: the questions left, in one batch.
    const code = openCodeQuestions(options.questions, options.skill, session.draft);
    const batch = batchOf(code, session.questions);
    reachedQuestions = true;
    // Code's answer goes straight in: an empty one ("You decide") is the question's default, never an empty value.
    const put = (question: Question, answer: string) => {
      const given = answer.trim() || question.default || "";
      if (!given) return;
      const applied = applyAnswer(session.draft, question, given);
      if (!applied.ok) return;
      session.draft = applied.skill;
      answered.push({ question, answer: given });
    };
    for (const question of batch.skipped.code) put(question, "");
    skipped.push(...batch.skipped.code.map((q) => q.text), ...batch.skipped.agent.map((q) => q.text));
    const count = batch.code.length + batch.agent.length;
    if (count > 0) {
      say(`${count} question${count === 1 ? "" : "s"} for you`);
      const answers = await askBatch(options.prompter, session.draft, batch.code, batch.agent);
      for (const { question, answer } of answers.code) {
        asked.push({ question: question.text, answer, by: "code" });
        put(question, answer);
      }
      for (const { question, answer } of answers.agent) asked.push({ question: question.text, answer, by: "agent" });
      // 6: the agent puts its answers in (done tests again if the workflow changed, and the gate runs again).
      if (answers.agent.length > 0) {
        session.refusedDone = 0;
        const after = await episode(masked(answersMessage(answers.agent, session)));
        if (after) return kept(`it stopped while putting your answers in: ${after}`);
      }
    }
    say(session.gaps.length > 0 ? `Done, with ${session.gaps.length} thing(s) for you to check` : "Done");
    return outcome({ kind: "designed", summary: done?.summary });
  } catch (error) {
    return kept(`it failed: ${(error as Error).message}`);
  }
}

// The build episode's first message: the task model, the workflow now, code's proposals, what code left out, what the
// recording holds about the unknowns, and the pages it can open. The full evidence went to stage 1; details on request
// (look).
function buildMessage(task: TaskModel, evidence: Evidence, session: SessionV2, seen: string[]): string {
  const proposals = evidence.proposals.map(
    (p) =>
      `${p.id} ${p.kind}: ${p.summary}${p.edits.length > 0 ? " [change ready]" : ""}${p.runnable ? "" : " [can't run yet]"}`,
  );
  const left = evidence.noise.map((n) => `${n.id} ${n.what}: ${n.why}`);
  const unknowns =
    seen.length > 0 ? ["# Unknowns the recording may answer (use it, or ask with confirm)", ...seen, ""] : [];
  return [
    "# The task model you wrote (rules by number: 0, 1, …)",
    JSON.stringify(task, null, 1),
    "",
    "# The workflow now",
    outlineOf(session.draft),
    "",
    "# Proposals (accept or reject each)",
    ...(proposals.length > 0 ? proposals : ["(none)"]),
    "",
    "# Left out by code (restore one if it mattered)",
    ...(left.length > 0 ? left : ["(nothing)"]),
    "",
    ...unknowns,
    `# Pages you can open by name: ${[...session.pages.keys()].join(", ") || "none"}`,
  ].join("\n");
}

function answersMessage(answers: { question: QueuedQuestion; answer: string }[], session: SessionV2): string {
  return [
    "The user answered your questions. Put the answers in with the tools, then done again (rules as before).",
    ...answers.map((a) => `- ${a.question.id} ${a.question.text} → ${a.answer || "(you decide: take the default)"}`),
    "",
    "# The workflow now",
    outlineOf(session.draft),
  ].join("\n");
}
