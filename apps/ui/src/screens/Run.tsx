// One run: how it went step by step (its log, runs/<id>.jsonl, across all its legs), what repair did, and what it
// waits for.
import type { InboxItem, RunRow, WorkflowSummary } from "@shadow/daemon/src/types.ts";
import type { RunLogEvent } from "@shadow/player";
import { useQuery, useSession } from "../api.ts";
import { Action, Loading, StatusChip } from "../components.tsx";
import { duration, money, when } from "../format.ts";

type Logged = RunLogEvent & { at: number };
interface Episode {
  failure: string;
  outcome: string;
  transcript: unknown[];
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
        <a href="#/runs" className="muted small">
          Runs
        </a>
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
        {events.length === 0 ? <p className="muted">Nothing logged yet.</p> : <Timeline events={events} />}
      </section>

      {repairs.length > 0 ? (
        <section className="section">
          <h2>Repairs</h2>
          {repairs.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: episodes are only ever appended, never reordered
            <details key={`${r.failure}-${i}`} className="episode">
              <summary>
                <code>{r.failure}</code> · {r.outcome} · {r.transcript.length} turn(s)
              </summary>
              <pre>{JSON.stringify(r.transcript, null, 1)}</pre>
            </details>
          ))}
        </section>
      ) : null}
    </>
  );
}

function Timeline({ events }: { events: Logged[] }) {
  // A step's start is implied by its result; the rest is shown as it happened.
  const shown = events.filter((e) => e.type !== "step.start" && e.type !== "loop.item");
  return (
    <ol className="timeline">
      {shown.map((e, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a run's log is only ever appended, never reordered
        <li key={`${e.at}-${i}`} className={`event ${tone(e)}`}>
          <span className="event-time">{new Date(e.at).toLocaleTimeString()}</span>
          <span className="event-text">{describe(e)}</span>
        </li>
      ))}
    </ol>
  );
}

function tone(e: RunLogEvent): string {
  if (e.type === "step.result") return e.result.ok ? "ok" : "bad";
  if (e.type === "repair") return e.outcome === "commit" ? "ok" : "wait";
  if (e.type === "run.end") return e.status === "succeeded" ? "ok" : e.status === "waiting" ? "wait" : "bad";
  return "quiet";
}

function describe(e: RunLogEvent): string {
  switch (e.type) {
    case "run.start":
      return e.resumedAt ? `Went on at ${e.resumedAt}` : `Started v${e.version}`;
    case "step.result": {
      const r = e.result;
      const match = r.matchScore !== undefined ? ` · match ${r.matchScore}` : "";
      const attempt = e.attempt > 1 ? ` · try ${e.attempt}` : "";
      return `${r.ok ? "✓" : "✗"} ${e.path} · ${duration(e.ms)}${match}${attempt}${r.ok ? "" : ` · ${r.error ?? "failed"}`}`;
    }
    case "step.approval":
      return `${e.path}: ${e.approved ? "approved" : "denied"}`;
    case "step.ask":
      return `${e.path}: asked "${e.question}", answered ${JSON.stringify(e.answer)}`;
    case "step.skipped":
      return `– ${e.path} skipped (${e.reason})`;
    case "loop.start":
      return `↻ ${e.path}: ${e.items} item(s)`;
    case "loop.item_failed":
      return `↷ ${e.path}[${e.index}] skipped: ${e.error}`;
    case "branch":
      return `⑂ ${e.path}: ${e.took === "steps" ? "the condition held" : "otherwise"}`;
    case "repair":
      return e.outcome === "commit"
        ? `⚒ ${e.path} repaired (${e.by}), saved as v${e.version}: ${e.summary}`
        : `⚒ ${e.path} ${e.outcome} (${e.class}): ${e.summary}`;
    case "run.end":
      return e.status === "waiting"
        ? `Waiting for you at ${e.failedStep}`
        : `Ended: ${e.status}${e.failedStep && e.status !== "succeeded" ? ` at ${e.failedStep}` : ""}${e.error ? ` · ${e.error}` : ""}`;
    default:
      return (e as { type: string }).type;
  }
}
