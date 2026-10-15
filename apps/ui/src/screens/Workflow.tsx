// One workflow: what it is for, its steps as a tree, its versions (who made each and why), and its runs.
import type { Skill, Step } from "@shadow/core";
import type { RunRow, WorkflowSummary } from "@shadow/daemon/src/types.ts";
import { useState } from "react";
import { useQuery, useSession } from "../api.ts";
import { Action, Loading, StateChip, StatusChip } from "../components.tsx";
import { FrequencyPicker } from "../FrequencyPicker.tsx";
import { ago, duration, money, when } from "../format.ts";
import { describe } from "../frequency.ts";
import { WorkflowTree } from "../WorkflowTree.tsx";
import { Editor } from "./Editor.tsx";

const BY = { record: "Recorded", user: "Changed by you", debug: "Repaired during a run" } as const;

export function Workflow({ id }: { id: string }) {
  const session = useSession();
  const workflow = useQuery<{ id: string; versions: number[]; latest: Skill } | null>("workflow", { id });
  const summary = useQuery<WorkflowSummary[]>("workflows");
  const runs = useQuery<RunRow[]>("runs", { skillId: id, limit: 20 });
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  if (workflow.data === null) return <p className="error">No workflow {id}.</p>;
  if (!workflow.data) return <Loading error={workflow.error} />;
  const { latest, versions } = workflow.data;
  const trigger = latest.steps.find((s) => s.type === "trigger");
  const triggers = trigger?.type === "trigger" ? trigger.when : [];
  const history = [...latest.history].reverse();
  const mine = summary.data?.find((w) => w.id === id);
  const state = mine?.state;

  return (
    <>
      <header className="page-header">
        <a href="#/workflows" className="muted small">
          Workflows
        </a>
        <div className="title-row">
          <h1>
            {latest.name} {state ? <StateChip state={state} /> : null}
          </h1>
          <span className="action">
            <a
              className="button"
              href={`#/record/again/${id}`}
              title="Do the task once more: the recording becomes the next version"
            >
              Record again
            </a>
            {editing ? null : (
              <button type="button" className="button" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {state?.state === "live" ? (
              <Action run={() => session.call("pause", { id })}>Pause</Action>
            ) : (
              <Action run={() => session.call(state?.state === "paused" ? "resume" : "goLive", { id })}>
                {state?.state === "paused" ? "Resume" : "Go live"}
              </Action>
            )}
            <Action
              run={async () => {
                const run = await session.call<{ id: string }>("walk", { id });
                location.hash = `#/runs/${run.id}`;
              }}
            >
              Walk through
            </Action>
            <Action
              kind="primary"
              run={async () => {
                const run = await session.call<{ id: string }>("start", { id });
                location.hash = `#/runs/${run.id}`;
              }}
            >
              Run now
            </Action>
          </span>
        </div>
        <p>{latest.description.goal}</p>
        <p className="muted small">
          v{latest.version}
          {mine?.nextRunAt ? ` · next run ${when(mine.nextRunAt)}` : ""}
        </p>
        {state?.state === "paused" ? (
          <div className="banner">
            <div>
              <strong>{state.auto ? "Shadow paused it" : "Paused"}</strong>
              {state.reason ? <div>{state.reason}</div> : null}
              <div className="muted small">Nothing starts on its own until you resume it. Run now still works.</div>
            </div>
          </div>
        ) : state?.state === "draft" ? (
          <p className="muted small">
            A draft: Go live when it is ready. To let it start on its own, set its Frequency first.
          </p>
        ) : null}
      </header>

      <section className="section">
        <div className="title-row">
          <h2>Frequency</h2>
          {picking ? null : (
            <button type="button" className="button" onClick={() => setPicking(true)}>
              Change
            </button>
          )}
        </div>
        {picking ? (
          <FrequencyPicker
            id={id}
            current={triggers.find((t) => t.type !== "manual") ?? triggers[0]}
            onDone={() => setPicking(false)}
          />
        ) : (
          <p>{triggers.map(describe).join(", or ")}</p>
        )}
      </section>

      {editing ? (
        <Editor
          id={id}
          onDone={() => {
            setEditing(false);
            workflow.reload();
          }}
        />
      ) : (
        <section className="section">
          <h2>Steps</h2>
          <WorkflowTree steps={latest.steps} />
        </section>
      )}

      <section className="section">
        <div className="title-row">
          <h2>Versions</h2>
          {versions.length >= 2 ? (
            <Action
              kind="danger"
              confirm={`Go back to the version before v${latest.version}?`}
              run={() => session.call("rollback", { skillId: id })}
            >
              Roll back
            </Action>
          ) : null}
        </div>
        <ul className="versions">
          {history.map((h) => (
            <li key={`${h.version}-${h.at}`} className={h.version === latest.version ? "current" : undefined}>
              <span className="version">v{h.version}</span>
              <span className="by">{BY[h.by]}</span>
              <span className="summary">{h.summary}</span>
              <span className="muted small" title={h.at}>
                {ago(Date.parse(h.at))}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small">Rolling back saves the earlier version as a new one, so nothing is lost.</p>
      </section>

      <section className="section">
        <h2>Runs</h2>
        {runs.data && runs.data.length > 0 ? (
          <table className="table compact">
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`#/runs/${r.id}`}>
                      <StatusChip status={r.status} />
                    </a>
                  </td>
                  <td title={when(r.startedAt)}>{ago(r.startedAt)}</td>
                  <td>v{r.version}</td>
                  <td>{duration(r.endedAt ? r.endedAt - r.startedAt : undefined)}</td>
                  <td>{r.repaired ? <span className="chip quiet">repaired</span> : null}</td>
                  <td className="right">{money(r.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No runs yet.</p>
        )}
      </section>
    </>
  );
}
