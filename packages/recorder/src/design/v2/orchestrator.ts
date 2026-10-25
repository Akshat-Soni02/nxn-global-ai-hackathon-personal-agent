// Design agent v2 (spec, Phase 3): the stages that turn a recording's plain list into the workflow the user meant, on
// one budget (≤ $0.25, pictures' captions included; no cap on calls, but STUCK ends one that goes nowhere):
//   1 understand    one structured call: the evidence → the task model (understand.ts)
//   2 plan, build   one call plans every change and code makes them; then the tools (tools.ts), several calls a turn,
//                   repair what the plan left; code's proposals are accepted by id
//   3–4 test, fix   the safe test run inside the same episode (the test tool, and once before done)
//   5 ask           code's open questions and the agent's, in one batch: only what the evidence can't answer
//   6 apply         a short episode with the answers, tested again if it changed
//   7 finish gate   bound into done (gate.ts): refused twice at most, then saved with what is left listed
// A recording is never lost: no task model, a used-up budget, an error or a stop keeps the last valid draft (else the
// plain list, with the answers code found in what was said already in it).
import { type AgentEvent, type Protocol, runAgent } from "@shadow/agent";
import { applyEdits, type EditInput, isAction, isLlm, isLoop, Skill, type StepInput, walkSteps } from "@shadow/core";
import { type Llm, type Usage, UsageMeter } from "@shadow/llm";
import type { MemoryStore } from "@shadow/memory";
import { z } from "zod";
import { requireApprovals } from "../../approvals.ts";
import type { Question } from "../../compile.ts";
import { applyAnswer, type Prompter } from "../../drill.ts";
import { type Evidence, evidenceText, evidenceView } from "../../evidence/evidence.ts";
import { maskText } from "../../mask.ts";
import { plainChecks } from "../../plain-checks.ts";
import { skeletonOf, skillInput } from "../../skeleton.ts";
import { DESIGN_V2_BUDGET, remaining } from "./budget.ts";
import { appsSection, type ConnectorChance, type Connectors, readOnlyTools, type UsableApp } from "./connectors.ts";
import type { DoneReport, TaskModel, TestReport } from "./contracts.ts";
import { gate, lostWork, runProblems, unmadeProblems } from "./gate.ts";
import { outlineOf } from "./outline.ts";
import { BUILD, BUILD_FILE, PLAN, PLAN_FILE } from "./prompt.ts";
import { askBatch, batchOf, openCodeQuestions } from "./questions.ts";
import { type ChangeNote, changeNotes, type RecordingFacts } from "./rules.ts";
import { newSession, type QueuedQuestion, type SessionV2 } from "./session.ts";
import { type DesignMode, designToolsV2, isHowTo, isTimeOfDay, workflowFile } from "./tools.ts";
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
  // The final check: the same run, with the files the workflow makes made for real, then put in the Trash (twice: it
  // runs again, and a second run should make nothing new).
  verify?: (skill: Skill, twice: boolean) => Promise<TestReport>;
  // Connected apps (connectors.ts): where the recording worked inside an app Shadow can use directly, and the daemon's
  // side (ask with the connect button, the app's tools). Without connectors nothing is offered: the classic design.
  chances?: ConnectorChance[];
  connectors?: Connectors;
  // The design's meter: the pictures' captions are already on it.
  meter?: UsageMeter;
  budget?: { costUsd: number; calls: number };
  protocol?: Protocol;
  // How the agent edits (tools.ts): "file", the workflow as JSON it reads, writes and edits; "verbs" (the default),
  // one tool per kind of change.
  mode?: DesignMode;
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
  // Why the saved workflow can't do the task yet (a file the recording shows that no step makes): the review says so
  // instead of offering "Looks right" (checkpoint 6).
  cantRun?: string[];
  // The final check: what it made (then put in the Trash), and how it ended.
  checked?: TestReport;
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

// The workflow as saved: url checks as the player reads them, and approval wherever a step acts outward (a connected
// app's tool that only reads doesn't ask).
const finalOf = (draft: Skill, apps: UsableApp[] = []) =>
  requireApprovals(plainChecks(withFields(draft)), { readOnlyTools: readOnlyTools(apps) }).skill;

// Before planning: the apps the user wants used directly. Already connected: used. Said no before: not asked. Else
// asked once, with the button to connect; "classic" is remembered so it isn't asked again.
export async function usableApps(
  chances: ConnectorChance[],
  connectors: Connectors,
  say: (line: string) => void,
): Promise<{ apps: UsableApp[]; asked: { question: string; answer: string }[] }> {
  const apps: UsableApp[] = [];
  const asked: { question: string; answer: string }[] = [];
  if (chances.length === 0) return { apps, asked };
  const status = await connectors.status();
  for (const chance of chances) {
    if (status.declined.includes(chance.toolkit)) continue;
    let use = status.connected.includes(chance.toolkit);
    if (!use) {
      say(`Asking whether to use ${chance.name} directly`);
      const answer = await connectors.offer(chance);
      asked.push({ question: `Use ${chance.name} directly?`, answer });
      if (answer === "classic") connectors.decline(chance.toolkit);
      use = answer === "connected";
    }
    if (!use) continue;
    const tools = await connectors.tools(chance.toolkit).catch(() => []);
    if (tools.length > 0) apps.push({ ...chance, tools });
  }
  return { apps, asked };
}

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

// A workflow that makes a file of its own (a page saved as PDF, a copy, a download it then finds: D, 24 Oct): the
// final check runs it for real.
export const makesFiles = (skill: Skill) =>
  [...walkSteps(skill.steps)].some(
    ({ step }) =>
      isAction(step) &&
      (step.action === "save_pdf" ||
        (step.channel === "fs" && step.action === "copy") ||
        (step.channel === "fs" && step.action === "find" && step.args.since_run_start === true)),
  );
// The file the final check made, against the one the recording made, the same day (D, 24 Oct: the check saved "24 Oct -
// Main Page.pdf" where the recording saved "24 Oct - Battle of Schliengen.pdf", and called it done). A day later the
// data may differ, so only the same day is judged. " (1)" is code's, for a name taken.
export function otherFile(made: string[], recorded: string[]): string | undefined {
  const plain = (name: string) => name.replace(/ \(\d+\)(\.[^.]+)$/, "$1");
  if (made.length === 0 || recorded.length === 0) return undefined;
  return made.some((m) => recorded.includes(plain(m)))
    ? undefined
    : `it made "${made.join('", "')}" where the recording made "${recorded.join('", "')}" the same day: it saved something else`;
}
// The names the recording's own steps gave the files they made (no {{…}}: the plain list's).
const recordedFiles = (skill: Skill) =>
  [...walkSteps(skill.steps)].flatMap(({ step }) => {
    if (!isAction(step)) return [];
    const name =
      step.action === "save_pdf"
        ? step.args.name
        : step.channel === "fs" && /^(copy|move|rename)$/.test(step.action)
          ? step.args.to
          : undefined;
    const base = typeof name === "string" && !name.includes("{{") ? name.split("/").at(-1) : undefined;
    return base ? [base] : [];
  });

// A rule that says not to do the same again: the final check runs twice to see it hold.
const REPEATS = /\b(skip|already|only (the )?new|not (again|twice)|don'?t repeat|duplicates?)\b/i;

// With no cap on calls (Rushil, 23 Oct), what ends a design that isn't getting anywhere: this many changes in a row that
// were refused, malformed, or changed nothing (checkpoints 5–6: D re-added one read 10 times, changed one step 15 times
// to no effect, and sent 6 malformed calls in a row).
export const STUCK = 5;

// Whether a tool's result moved the workflow on: true (a change made), false (refused, or nothing changed), or undefined
// (a look, a test, a question: neither).
export function progressOf(output: string): boolean | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.replace(/^\s*<untrusted_data>\s*|\s*<\/untrusted_data>\s*$/g, ""));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const o = parsed as { ok?: unknown; refused?: unknown; note?: unknown };
  if (o.ok === false || o.refused !== undefined) return false;
  if (o.ok === true) return !String(o.note ?? "").startsWith("nothing changed");
  return undefined;
}

// Plan, then apply (step 5): what a plan may hold (looking, testing and finishing are the episode's), and the reply
// that holds it. Asked as plain JSON and checked here: strict decoding can't hold "any tool's input". Each tool checks
// its own input, as in the episode.
const PLANNED = new Set([
  "accept",
  "reject",
  "remove",
  "restore",
  "add",
  "change",
  "move",
  "loop",
  "branch",
  "ai_step",
  "trigger",
  "input",
  "ask",
]);
// In file mode a plan is the proposals' decisions, the workflow written whole, and the questions.
const PLANNED_FILE = new Set(["accept", "reject", "restore", "write_workflow", "edit_workflow", "ask"]);
// Checked call by call: one call of another shape costs that call, never the plan (A's re-test, 24 Oct: no call made).
const PlanCall = z.object({ tool: z.string(), input: z.record(z.string(), z.unknown()).default({}) });
const PlanReply = z.object({ calls: z.array(z.unknown()) });

const cadenceText = (task: TaskModel) =>
  task.cadence.kind === "manual" ? "when you start it" : (task.cadence.quote ?? task.cadence.kind);

export async function designV2(options: DesignV2Options): Promise<DesignV2Outcome> {
  const meter = options.meter ?? new UsageMeter();
  const budget = options.budget ?? DESIGN_V2_BUDGET;
  const say = options.onProgress ?? (() => {});
  const mode = options.mode ?? "verbs";
  const system = mode === "file" ? BUILD_FILE : BUILD;
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
  let checked: TestReport | undefined;
  let firstMessage: string | undefined;

  const unmade = (options.evidence as { unmade?: string[] } | undefined)?.unmade ?? [];
  const outcome = (
    extra: { kind: "designed"; summary?: string } | { kind: "kept"; reason: string },
  ): DesignV2Outcome => ({
    ...extra,
    ...(unmadeProblems(session.draft, unmade).length > 0 ? { cantRun: unmadeProblems(session.draft, unmade) } : {}),
    skill: finalOf(session.draft, session.apps),
    ...(checked ? { checked } : {}),
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
    system,
    ...(firstMessage ? { firstMessage } : {}),
    plain: options.skill,
    transcript,
    usage: meter.usage,
  });
  // What it reached is kept, unless it had lost work the user showed or has steps the runner can't run that the
  // recording didn't (the gate never saw it; Checkpoint 4: C kept reads with no control): then the plain list.
  // What makes a draft worse than the recording: your work lost, or steps that can't run (the recording's own aside).
  const worse = () => {
    const recorded = new Set(runProblems(finalOf(options.skill)));
    const broken = runProblems(finalOf(session.draft, session.apps)).filter((p) => !recorded.has(p));
    if (lostWork(options.skill, session.draft, session.whys).length > 0) return "had lost work you showed";
    return broken.length > 0 ? `has steps that can't run (${broken[0]})` : undefined;
  };
  const kept = (reason: string) => {
    let why = reason;
    const bad = worse();
    if (bad) {
      session.draft = options.skill;
      why = `${reason}; what it reached ${bad}, so the recorded steps were kept`;
    }
    // Its own questions it never got to ask are listed in the review, never lost.
    if (!reachedQuestions) skipped.push(...session.questions.map((q) => q.text));
    say(`Kept what it reached: ${why}`);
    return outcome({ kind: "kept", reason: why });
  };

  // One episode of the agent loop on what is left of the budget: build/test/fix, or putting the answers in. With no cap
  // on calls, it also ends when the agent stops getting anywhere (STUCK changes in a row went nowhere): those calls and
  // what they got are kept, for a fresh start that shows them.
  let nowhere: string[] = [];
  const episode = async (message: string): Promise<string | undefined> => {
    const left = remaining(meter, budget);
    if (left.calls === 0 || left.costUsd === 0) return "its budget was used up";
    const stop = new AbortController();
    const forward = () => stop.abort();
    options.signal?.addEventListener("abort", forward, { once: true });
    let stuck = 0;
    let sent = "";
    nowhere = [];
    const run = await runAgent<DoneReport>({
      llm: options.llm,
      profile: "smart",
      system,
      task: message,
      tools: designToolsV2(session, { mode }),
      callsPerTurn: 8,
      budget: { turns: left.calls, costUsd: left.costUsd, liveActions: 0 },
      protocol: options.protocol,
      meter,
      signal: stop.signal,
      onEvent: (event) => {
        transcript.push(event);
        options.onEvent?.(event);
        if (event.type === "call") sent = `${event.tool} ${JSON.stringify(event.input)}`;
        const moved = event.type === "invalid" ? false : event.type === "result" ? progressOf(event.output) : undefined;
        if (moved === true) {
          stuck = 0;
          nowhere = [];
        }
        if (moved === false) {
          nowhere.push(
            event.type === "invalid"
              ? `${event.tool ?? "?"} ${event.input ?? ""} → ${event.error}`
              : `${sent} → ${(event as { output: string }).output}`,
          );
          if (++stuck >= STUCK) stop.abort();
        }
      },
    }).finally(() => options.signal?.removeEventListener("abort", forward));
    if (stuck >= STUCK && !options.signal?.aborted)
      return `it stopped getting anywhere: ${STUCK} changes in a row were refused or changed nothing`;
    const o = run.outcome;
    if (o.kind === "finished") return undefined;
    if (o.kind === "out_of_budget") return `it ran out of ${o.budget}`;
    return o.kind === "error" ? `it failed: ${o.error}` : "it was stopped";
  };

  // One call writes every change it will make; code makes them in order, through the same tools (and guardrails) as
  // the episode; the episode then starts from what each did, so it repairs instead of building one change per reply
  // (checkpoints 5–6: 17 of 18 designs sent one). No plan, or a failed call: the episode builds as before.
  const plan = async (message: string): Promise<string[] | undefined> => {
    const tools = new Map(
      designToolsV2(session, { mode })
        .filter((t) => (mode === "file" ? PLANNED_FILE : PLANNED).has(t.name))
        .map((t) => [t.name, t]),
    );
    const catalogue = [...tools.values()].map(
      (t) =>
        `- ${t.name}: ${t.description}\n  input: ${JSON.stringify(z.toJSONSchema(t.input as z.ZodType, { io: "input" }))}`,
    );
    let calls: z.infer<typeof PlanCall>[];
    try {
      const reply = await options.llm.generate({
        profile: "smart",
        system: mode === "file" ? PLAN_FILE : PLAN,
        // A whole workflow, after reasoning over the whole recording: the largest reply the design asks for.
        maxTokens: 32_768,
        user: [message, "", "# The tools a plan can use", ...catalogue].join("\n"),
        json: true,
        meter,
        signal: options.signal,
      });
      // Kept in design.json, so a plan that made nothing can be read (the transcript's first reply).
      transcript.push({ type: "reply", turn: 0, thought: reply.text.slice(0, 4_000), costUsd: reply.costUsd, ms: 0 });
      const parsed = PlanReply.safeParse(reply.value);
      calls = (parsed.success ? parsed.data.calls : []).slice(0, 60).flatMap((c) => {
        const call = PlanCall.safeParse(c);
        return call.success ? [call.data] : [];
      });
    } catch (error) {
      transcript.push({ type: "invalid", turn: 0, error: `the plan call failed: ${(error as Error).message}` });
      return undefined;
    }
    if (calls.length === 0) return undefined;
    say(`Planned ${calls.length} change(s): making them`);
    const emit = (event: AgentEvent) => {
      transcript.push(event);
      options.onEvent?.(event);
    };
    const lines: string[] = [];
    // A plan can't know the ids code gives the steps it adds, so it names them its own way ("after": "open_hn"; A, 24
    // Oct: every later call of its plan failed so): a place naming no step is after the step its last change made.
    const ids = () => new Set([...walkSteps(session.draft.steps)].map(({ step }) => step.id));
    let last: string | undefined;
    for (const [i, call] of calls.entries()) {
      const sent = JSON.stringify(call.input);
      const t = tools.get(call.tool);
      const input: Record<string, unknown> = { ...call.input };
      const placed: string[] = [];
      for (const key of ["after", "before", "into"]) {
        const named = input[key];
        if (typeof named !== "string" || !last || named === "trigger" || ids().has(named)) continue;
        input[key] = last;
        placed.push(`${named} is no step: ${key} ${last}, the step the change before it made`);
      }
      const before = ids();
      const parsed = t?.input.safeParse(t.prepare ? t.prepare(input) : input);
      if (!t || !parsed?.success) {
        const error = !t
          ? `not made: a plan holds only ${[...tools.keys()].join(", ")}`
          : `invalid input: ${parsed?.error?.issues.map((x) => `${x.path.join(".") || "input"}: ${x.message}`).join("; ")}`;
        emit({ type: "invalid", turn: 0, tool: call.tool, error, input: sent });
        lines.push(`${i + 1}. ${call.tool} ${sent} → ${error}`);
        continue;
      }
      emit({ type: "call", turn: 0, tool: t.name, input: parsed.data });
      let output: string;
      try {
        const result = await t.run(parsed.data, { turn: 0, signal: options.signal });
        // The workflow each change returns is left out: the message shows it once, as it ended.
        const { workflow: _, ...rest } = (result.output ?? {}) as Record<string, unknown>;
        output = typeof result.output === "string" ? result.output : JSON.stringify(rest);
      } catch (error) {
        output = `${t.name} failed: ${(error as Error).message}`;
      }
      emit({ type: "result", turn: 0, tool: t.name, output, ms: 0 });
      const top = new Set(session.draft.steps.map((s) => s.id));
      last = [...ids()].filter((id) => !before.has(id) && top.has(id)).at(-1) ?? last;
      lines.push(`${i + 1}. ${t.name} ${sent}${placed.length > 0 ? ` (${placed.join("; ")})` : ""} → ${output}`);
    }
    return lines;
  };

  // A failed reply (the model service's 503, 24 Oct) ends an episode, not the design: once more, from where it got to.
  const again = async (message: string) => {
    const first = await episode(message);
    return first?.startsWith("it failed") ? episode(message) : first;
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

    // 1½: the apps the recording worked in that Shadow can use directly: asked now, since the answer changes how all of
    // it is built. A failure here (the service down) designs it the classic way.
    if (options.connectors && options.chances?.length) {
      try {
        const offered = await usableApps(options.chances, options.connectors, say);
        session.apps = offered.apps;
        for (const a of offered.asked) asked.push({ ...a, by: "code" });
        if (offered.apps.length > 0) say(`Using ${offered.apps.map((a) => a.name).join(", ")} directly`);
      } catch (error) {
        say(`Connected apps couldn't be checked (${(error as Error).message}): designing it with page steps`);
      }
    }

    // The task model's unknowns: what the evidence speaks to goes to the agent with the evidence; the rest are queued.
    const seen: string[] = [];
    for (const u of theTask.unknowns) {
      if (isTimeOfDay(u.question) || isHowTo(u.question)) continue;
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
        unmade,
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
    firstMessage = masked(buildMessage(theTask, options.evidence, session, seen, mode));
    const applied = await plan(firstMessage);
    if (applied) {
      firstMessage = masked(
        [
          buildMessage(theTask, options.evidence, session, seen, mode),
          "",
          "# Your plan, applied: each change, and what it did (the workflow above is after them)",
          ...applied,
          "",
          "Repair what was refused or invalid, build what is still missing, then test, then done.",
        ].join("\n"),
      );
    }
    let stopped = await episode(firstMessage);
    // A failed reply (Checkpoint 5: D2's 33rd turn thought past the token cap) ends an episode, not the design: once
    // more, from the workflow as it got to, on what is left of the budget.
    if (stopped?.startsWith("it failed"))
      stopped = await episode(masked(buildMessage(theTask, options.evidence, session, seen, mode)));
    // Stuck: once more from a fresh start, which shows what went nowhere (a long run of the same call feeds itself; the
    // D eval, 24 Oct, reasoned the same paragraph five times).
    if (stopped?.startsWith("it stopped getting anywhere")) {
      const went = nowhere.map((n) => `- ${n.slice(0, 400)}`);
      stopped = await episode(
        masked(
          [
            buildMessage(theTask, options.evidence, session, seen, mode),
            "",
            `# Your last ${went.length} calls went nowhere: do something different (another tool, other values), or done with why`,
            ...went,
          ].join("\n"),
        ),
      );
    }
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
        const after = await again(masked(answersMessage(answers.agent, session)));
        if (after) return kept(`it stopped while putting your answers in: ${after}`);
      }
    }
    // Finished only because the gate stopped refusing (twice): no better than a stopped design when it lost your work or
    // can't run (Checkpoint 5: live A saved three page opens, every write removed).
    if (session.gaps.length > 0 && worse()) return kept("it finished with what the finish gate had refused twice");
    // A rule you said that no step builds is a design that didn't finish, never "designed" (Oct 25: a design that
    // only accepted proposals and set the schedule was saved as designed, its summary naming steps that didn't exist).
    const unbuilt = session.gaps.filter((g) => /^rule \d+ /.test(g));
    if (unbuilt.length > 0) {
      return kept(
        `it didn't build ${unbuilt.length === 1 ? "one of your rules" : `${unbuilt.length} of your rules`} (${unbuilt
          .map((g) => /^rule \d+ ("[^"]*")/.exec(g)?.[1] ?? g)
          .join("; ")})`,
      );
    }

    // 7: the final check (Rushil, 24 Oct: keep-local changes, and remove what the tests saved). A workflow that makes a
    // file runs once for real, with only its files made, then put in the Trash; a failure goes back to the agent once.
    // A rule that says not to repeat ("skip ones already saved") runs it twice: the second run should make nothing new.
    if (options.verify && makesFiles(session.draft)) {
      const twice = theTask.rules.some((r) => REPEATS.test(r.quote));
      say("Checking it for real: the files it makes are made, then put in the Trash");
      const today = new Date();
      const sameDay =
        options.evidence.recordedOn ===
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const judged = (check: TestReport): TestReport => {
        const other =
          sameDay && !check.outcome.startsWith("failed")
            ? otherFile(check.made ?? [], recordedFiles(options.skill))
            : undefined;
        return other ? { ...check, outcome: `failed: ${other}` } : check;
      };
      checked = judged(await options.verify(finalOf(session.draft, session.apps), twice));
      if (checked.outcome.startsWith("failed")) {
        const failed = checked.steps.filter((s) => s.status === "failed").map((s) => `${s.id}: ${s.error}`);
        session.refusedDone = 0;
        const after = await again(
          masked(
            [
              `The final check ran the workflow for real (the files it makes were made, then put in the Trash), and it failed: ${failed.join("; ") || checked.outcome}. Fix it, then done again.`,
              "",
              "# The workflow now",
              outlineOf(session.draft),
            ].join("\n"),
          ),
        );
        if (after) return kept(`it stopped while fixing what the final check found: ${after}`);
        checked = judged(await options.verify(finalOf(session.draft, session.apps), twice));
      }
      if (checked.outcome.startsWith("failed")) session.gaps.push(`the final check failed: ${checked.outcome}`);
      if (twice && checked.again?.length) {
        session.gaps.push(
          `a second run made ${checked.again.join(", ")} again: the rule not to repeat doesn't hold yet`,
        );
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
function buildMessage(
  task: TaskModel,
  evidence: Evidence,
  session: SessionV2,
  seen: string[],
  mode: DesignMode,
): string {
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
    ...(mode === "file"
      ? ["# The workflow now, as read_workflow shows it", workflowFile(session.draft)]
      : ["# The workflow now", outlineOf(session.draft)]),
    "",
    "# Proposals (accept or reject each)",
    ...(proposals.length > 0 ? proposals : ["(none)"]),
    "",
    "# Left out by code (restore one if it mattered)",
    ...(left.length > 0 ? left : ["(nothing)"]),
    "",
    ...unknowns,
    ...appsSection(session.apps),
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
