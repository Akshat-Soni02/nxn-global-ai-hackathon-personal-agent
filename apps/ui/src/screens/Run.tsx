// One run: how it went step by step (its log, runs/<id>.jsonl, across all its legs), what repair did, and what it
// waits for.
import type { Skill } from "@shadow/core";
import type { InboxItem, RunRow, WorkflowSummary } from "@shadow/daemon/src/types.ts";
import type { RunLogEvent } from "@shadow/player";
import { useQuery, useSession } from "../api.ts";
import { Action, Loading, StatusChip } from "../components.tsx";
import { duration, money, when } from "../format.ts";
import { blocksIn, type Group, groupsOf, intentsOf, kindText, type Logged, lineOf, sectionsOf } from "../runlog.ts";

interface Episode {
  failure: string;
  outcome: string;
  transcript: unknown[];
}
// One turn's events in a repair transcript (packages/agent: AgentEvent), as much as this page reads of them.
interface AgentEvent {
  type: "reply" | "call" | "result" | "refused" | "invalid" | "protocol" | "end";
  turn: number;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  reason?: string;
  error?: string;
  outcome?: { kind: string; budget?: string; error?: string; value?: Record<string, unknown> };
}

export function Run({ id }: { id: string }) {
  const session = useSession();
  const { data, error } = useQuery<{ run: RunRow; events: Logged[]; repairs: Episode[] } | null>("run", { id });
  const inbox = useQuery<InboxItem[]>("inbox", { open: true });
  const workflows = useQuery<WorkflowSummary[]>("workflows");
  if (data === null) return <p className="error">No run {id}.</p>;
  if (!data) return <Loading error={error} />;
  const { run, events, repairs } = data;
  const waitingFor = inbox.data?.filter((i) => i.runId === run.id) ?? [];

  return (
    <>
      <header className="page-header">
        <div className="title-row">
          <h1>
            <a href={`#/workflows/${run.skillId}`}>
              {workflows.data?.find((w) => w.id === run.skillId)?.name ?? run.skillId}
            </a>{" "}
            <span className="muted">v{run.version}</span>
          </h1>
          <StatusChip status={run.status} />
        </div>
        <p className="muted small">
          Started {when(run.startedAt)}
          {run.endedAt ? ` · took ${duration(run.endedAt - run.startedAt)}` : ""}
          {run.costUsd > 0 ? ` · model ${money(run.costUsd)}` : ""}
          {run.repaired ? " · repaired during the run" : ""}
        </p>
        {run.error && run.status !== "succeeded" ? <p className="error">{run.error}</p> : null}
      </header>

      {run.status === "running" ? (
        <div className="banner">
          <div>
            <strong>Running</strong>
            <div className="muted small">Stop ends it at the next step; the step in progress is let go.</div>
          </div>
          <Action kind="danger" confirm="Stop this run?" run={() => session.call("cancel", { runId: run.id })}>
            Stop run
          </Action>
        </div>
      ) : null}

      {run.status === "waiting" ? (
        <div className="banner">
          <div>
            <strong>Waiting for you</strong>
            {waitingFor.map((i) => (
              <div key={i.id}>
                <a href={`#/inbox`}>{i.title}</a>
              </div>
            ))}
          </div>
          <Action kind="danger" confirm="Cancel this run?" run={() => session.call("cancel", { runId: run.id })}>
            Cancel run
          </Action>
        </div>
      ) : null}

      <section className="section">
        <h2>Steps</h2>
        {events.length === 0 ? (
          <p className="muted">Nothing logged yet.</p>
        ) : (
          <Timeline events={events} skillId={run.skillId} version={run.version} />
        )}
      </section>

      {repairs.length > 0 ? (
        <section className="section">
          <h2>Repairs</h2>
          <p className="muted small">
            What Shadow did when a step failed: what it looked at, what it changed and tried, and what it decided.
          </p>
          {repairs.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: episodes are only ever appended, never reordered
            <details key={`${r.failure}-${i}`} className="episode" open={i === repairs.length - 1}>
              <summary>
                <code>{r.failure}</code> · {OUTCOME[r.outcome] ?? r.outcome}
              </summary>
              <RepairSteps transcript={r.transcript as AgentEvent[]} />
              <details className="episode-raw">
                <summary className="muted small">Full transcript</summary>
                <pre>{JSON.stringify(r.transcript, null, 1)}</pre>
              </details>
            </details>
          ))}
        </section>
      ) : null}
    </>
  );
}

// The log a step at a time (runlog.ts): each step's lines under its name and what it does, a line between steps.
function Timeline({ events, skillId, version }: { events: Logged[]; skillId: string; version: number }) {
  const workflow = useQuery<{ latest: Skill } | null>("workflow", { id: skillId });
  // The steps' intents, when the run was on the version shown (an older version's steps may differ).
  const latest = workflow.data?.latest;
  const same = latest && latest.version === version;
  const intents = same ? intentsOf(latest.steps) : new Map<string, string>();
  // By block (R7.1): a block's steps under its title and how it went, folded when it went well.
  const sections = sectionsOf(groupsOf(events), same ? blocksIn(latest.steps) : new Map());
  const STATE = { done: "done", failed: "failed", waiting: "waiting for you", skipped: "skipped", running: "running" };
  return (
    <ol className="timeline">
      {sections.map((s, si) =>
        s.block ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a run's log is only ever appended, never reordered
          <li key={`${s.block.id}-${si}`} className={`block-section block-${s.state}`}>
            <details open={s.state !== "done" && s.state !== "skipped"}>
              <summary>
                <strong>{s.block.title}</strong> <span className="muted small">· {STATE[s.state]}</span>
              </summary>
              <ol className="timeline">
                {s.groups.map((g, gi) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a run's log is only ever appended, never reordered
                  <StepLog key={`${g.step ?? "run"}-${gi}`} group={g} intent={intents.get(g.id ?? "")} />
                ))}
              </ol>
            </details>
          </li>
        ) : (
          s.groups.map((g, gi) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a run's log is only ever appended, never reordered
            <StepLog key={`${g.step ?? "run"}-${si}-${gi}`} group={g} intent={intents.get(g.id ?? "")} />
          ))
        ),
      )}
    </ol>
  );
}

// One step's lines under its name and what it does.
function StepLog({ group: g, intent }: { group: Group; intent?: string }) {
  return (
    <li className="step-group">
      {g.step ? (
        <div className="step-head">
          <code>{g.step}</code> {intent ?? ""}
          {kindText(g.kind) ? <span className="muted small"> · {kindText(g.kind)}</span> : null}
        </div>
      ) : null}
      <ol className="step-events">
        {g.events.map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a run's log is only ever appended, never reordered
          <li key={`${e.at}-${i}`} className={`event ${tone(e)}`}>
            <span className="event-time">{new Date(e.at).toLocaleTimeString()}</span>
            <span className="event-text">{lineOf(e, g.kind)}</span>
          </li>
        ))}
      </ol>
    </li>
  );
}

function tone(e: RunLogEvent): string {
  if (e.type === "step.result") return e.result.ok ? "ok" : "bad";
  if (e.type === "repair") return e.outcome === "commit" ? "ok" : "wait";
  if (e.type === "run.end") return e.status === "succeeded" ? "ok" : e.status === "waiting" ? "wait" : "bad";
  return "quiet";
}

// ---- What repair did, in plain words ----------------------------------------------------------------------------

const OUTCOME: Record<string, string> = {
  commit: "fixed it and saved a new version",
  resolve: "decided nothing in the workflow needed changing",
  escalate: "couldn't fix it safely and handed it to you",
};

// Each tool call as a sentence, with what came back: what repair looked at, changed, tried and decided.
function RepairSteps({ transcript }: { transcript: AgentEvent[] }) {
  const rows: { key: string; text: string; detail?: string; tone: string }[] = [];
  transcript.forEach((e, i) => {
    const key = `${e.turn}-${i}`;
    if (e.type === "call" && e.tool) rows.push({ key, text: toolSentence(e.tool, e.input ?? {}), tone: "" });
    else if (e.type === "result" && e.tool) {
      const last = rows.at(-1);
      const summary = resultSummary(e.tool, e.output ?? "");
      if (last) {
        last.detail = summary.text;
        last.tone = summary.tone;
      }
    } else if (e.type === "refused") rows.push({ key, text: `Not allowed: ${e.reason ?? ""}`, tone: "warn" });
    else if (e.type === "invalid")
      rows.push({ key, text: `A call that didn't work: ${clip(e.error ?? "", 160)}`, tone: "warn" });
    else if (e.type === "end" && e.outcome) rows.push({ key, text: endSentence(e.outcome), tone: "end" });
  });
  return (
    <ol className="repair-steps">
      {rows.map((r) => (
        <li key={r.key} className={r.tone}>
          {r.text}
          {r.detail ? <div className="muted small">{r.detail}</div> : null}
        </li>
      ))}
    </ol>
  );
}

function toolSentence(tool: string, input: Record<string, unknown>): string {
  const s = (key: string) => String(input[key] ?? "");
  switch (tool) {
    case "failure_report":
      return "Read the failure report again";
    case "page_outline":
      return "Looked at the page";
    case "find":
      return `Searched the page for "${s("text")}"${input.role ? ` (${s("role")})` : ""}`;
    case "inspect":
      return `Inspected element ${s("ref")}`;
    case "workflow":
      return input.step ? `Read step ${s("step")}` : "Read the workflow";
    case "wait":
      return `Waited ${Math.round(Number(input.ms ?? 0) / 1000)} s for the page`;
    case "click_safe":
      return `Clicked ${s("ref")} to look (it only changes the view)`;
    case "press":
      return `Pressed ${s("key")}`;
    case "scroll":
      return input.ref ? `Scrolled to ${s("ref")}` : `Scrolled ${s("direction") || "down"}`;
    case "go_back":
      return "Went back a page";
    case "navigate":
      return `Opened ${s("url")}`;
    case "retarget":
      return `Pointed step ${s("step")} at element ${s("ref")}`;
    case "edit": {
      const edits = (input.edits as { op?: string; step?: string; field?: string }[] | undefined) ?? [];
      return `Changed the workflow: ${edits.map((e) => [e.op, e.step, e.field].filter(Boolean).join(" ")).join("; ")}`;
    }
    case "try_steps":
      return `Tried the fix on the page, from ${s("from") || "the failed step"}${input.count ? `, ${s("count")} step(s)` : ""}`;
    case "describe_screen":
      return `Asked what is on screen: "${s("question")}"`;
    case "recall":
      return `Looked in its notes for "${s("query")}"`;
    case "note":
      return `Saved a note for next time: "${s("fact")}"`;
    case "resolve":
      return `Decided: ${s("class").replace(/_/g, " ")}. ${s("reason")}`;
    case "commit":
      return `Saved the fix: ${s("summary")}`;
    case "escalate":
      return `Handed it to you: ${s("reason")}${input.what_to_show ? ` (show it: ${s("what_to_show")})` : ""}`;
    default:
      return tool;
  }
}

function resultSummary(tool: string, output: string): { text: string; tone: string } {
  if (tool === "try_steps") {
    try {
      const r = JSON.parse(output) as { ok?: boolean; error?: string; evidence?: string };
      if (r.ok && r.evidence && !r.evidence.startsWith("none"))
        return { text: `It worked: ${r.evidence}`, tone: "good" };
      if (r.ok) return { text: "It ran, but that isn't proof yet", tone: "" };
      return { text: `It didn't work: ${clip(r.error ?? "", 200)}`, tone: "warn" };
    } catch {
      return { text: clip(output, 200), tone: "" };
    }
  }
  if (/^(Refused|Not applied|Not committed)/.test(output)) return { text: clip(output, 200), tone: "warn" };
  return { text: clip(output.replace(/<\/?untrusted_data>/g, "").trim(), 160), tone: "" };
}

function endSentence(outcome: NonNullable<AgentEvent["outcome"]>): string {
  if (outcome.kind === "finished") return "Finished.";
  if (outcome.kind === "out_of_budget") return `Stopped: it ran out of ${outcome.budget ?? "budget"}.`;
  if (outcome.kind === "aborted") return "Stopped by you.";
  return `Stopped: ${outcome.error ?? outcome.kind}.`;
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}…`);
