// The workflows Shadow knows: whether each runs on its own (live, paused, draft), when, and how it last went.
import type { WorkflowSummary } from "@shadow/daemon/src/types.ts";
import { useQuery, useSession } from "../api.ts";
import { Action, Empty, Loading, StateChip, StatusChip } from "../components.tsx";
import { ago, when } from "../format.ts";
import { describe } from "../frequency.ts";

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
              <th>Runs</th>
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
                  </a>{" "}
                  <StateChip state={w.state} />
                  <div className="muted small">
                    {w.id} · v{w.versions.at(-1)}
                  </div>
                </td>
                <td>
                  {w.when.map(describe).join(", or ")}
                  {w.nextRunAt ? (
                    <div className="muted small" title={when(w.nextRunAt)}>
                      next {when(w.nextRunAt)}
                    </div>
                  ) : null}
                </td>
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
