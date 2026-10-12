// Recent runs, newest first (the daemon's runs table).
import type { RunRow, WorkflowSummary } from "@shadow/daemon/src/types.ts";
import { useQuery } from "../api.ts";
import { Empty, Loading, StatusChip } from "../components.tsx";
import { ago, duration, money, when } from "../format.ts";

export function Runs() {
  const { data, error } = useQuery<RunRow[]>("runs", { limit: 100 });
  const workflows = useQuery<WorkflowSummary[]>("workflows");
  const names = new Map(workflows.data?.map((w) => [w.id, w.name]));
  if (!data) return <Loading error={error} />;
  return (
    <>
      <header className="page-header">
        <h1>Runs</h1>
      </header>
      {data.length === 0 ? (
        <Empty title="No runs yet." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Workflow</th>
              <th>Started</th>
              <th>Took</th>
              <th className="right">Model</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => (location.hash = `#/runs/${r.id}`)}>
                <td>
                  <a href={`#/runs/${r.id}`}>
                    <StatusChip status={r.status} />
                  </a>
                </td>
                <td>
                  <span className="strong">{names.get(r.skillId) ?? r.skillId}</span>{" "}
                  <span className="muted small">v{r.version}</span>
                  {r.repaired ? <span className="chip quiet">repaired</span> : null}
                  {r.trigger !== "manual" ? (
                    <span className="chip quiet">{r.trigger === "folder" ? "file appeared" : "by schedule"}</span>
                  ) : null}
                  {r.status === "skipped" && r.error ? <div className="muted small">{r.error}</div> : null}
                  {r.failedStep && r.status !== "succeeded" ? (
                    <div className="muted small">at {r.failedStep}</div>
                  ) : null}
                </td>
                <td title={when(r.startedAt)}>{ago(r.startedAt)}</td>
                <td>{duration(r.endedAt ? r.endedAt - r.startedAt : undefined)}</td>
                <td className="right">{money(r.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
