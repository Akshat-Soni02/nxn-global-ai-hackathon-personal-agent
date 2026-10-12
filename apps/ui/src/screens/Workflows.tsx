// The workflows Shadow knows, with their latest version and last run.
import type { WorkflowSummary } from "@shadow/daemon/src/types.ts";
import { useQuery, useSession } from "../api.ts";
import { Action, Empty, Loading, StatusChip } from "../components.tsx";
import { ago, when } from "../format.ts";

export function Workflows() {
  const { data, error } = useQuery<WorkflowSummary[]>("workflows");
  const session = useSession();
  if (!data) return <Loading error={error} />;
  return (
    <>
      <header className="page-header">
        <h1>Workflows</h1>
      </header>
      {data.length === 0 ? (
        <Empty title="No workflows yet.">Press Record and do a task your usual way: Shadow turns it into one.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Workflow</th>
              <th>Version</th>
              <th>Last run</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {data.map((w) => (
              <tr key={w.id}>
                <td>
                  <a href={`#/workflows/${w.id}`} className="strong">
                    {w.name}
                  </a>
                  <div className="muted small">{w.id}</div>
                </td>
                <td>v{w.versions.at(-1)}</td>
                <td>
                  {w.lastRun ? (
                    <a href={`#/runs/${w.lastRun.id}`} className="inline">
                      <StatusChip status={w.lastRun.status} />{" "}
                      <span className="muted" title={when(w.lastRun.startedAt)}>
                        {ago(w.lastRun.startedAt)}
                      </span>
                    </a>
                  ) : (
                    <span className="muted">never</span>
                  )}
                </td>
                <td className="right">
                  <Action
                    run={async () => {
                      const run = await session.call<{ id: string }>("start", { id: w.id });
                      location.hash = `#/runs/${run.id}`;
                    }}
                  >
                    Run now
                  </Action>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
