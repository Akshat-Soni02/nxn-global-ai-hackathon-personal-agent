// One workflow: what it is for, its steps as a tree, its versions (who made each and why), and its runs.
import type { Skill, Step } from "@shadow/core";
import type { RunRow, WorkflowSummary } from "@shadow/daemon/src/types.ts";
import { useState } from "react";
import { useQuery, useSession } from "../api.ts";
import { Action, Loading, StateChip, StatusChip } from "../components.tsx";
import { FrequencyPicker } from "../FrequencyPicker.tsx";
import { ago, duration, money, when } from "../format.ts";
import { describe } from "../frequency.ts";

const BY = { record: "Recorded", user: "Changed by you", debug: "Repaired during a run" } as const;

export function Workflow({ id }: { id: string }) {
  const session = useSession();
  const workflow = useQuery<{ id: string; versions: number[]; latest: Skill } | null>("workflow", { id });
  const summary = useQuery<WorkflowSummary[]>("workflows");
  const runs = useQuery<RunRow[]>("runs", { skillId: id, limit: 20 });
  const [picking, setPicking] = useState(false);
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
            {state?.state === "live" ? (
              <Action run={() => session.call("pause", { id })}>Pause</Action>
            ) : (
              <Action run={() => session.call(state?.state === "paused" ? "resume" : "goLive", { id })}>
                {state?.state === "paused" ? "Resume" : "Go live"}
              </Action>
            )}
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
            A draft: it runs only when you start it. Set its Frequency, then Go live to let it run on its own.
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

      <section className="section">
        <h2>Steps</h2>
        <ol className="tree">
          {latest.steps
            .filter((s) => s.type !== "trigger")
            .map((s) => (
              <StepRow key={s.id} step={s} />
            ))}
        </ol>
      </section>

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

function StepRow({ step }: { step: Step }) {
  if (step.type === "trigger") return null;
  const flags = (
    <>
      {step.requires_approval ? <span className="flag">approval</span> : null}
      {step.ask ? <span className="flag">asks</span> : null}
    </>
  );
  if (step.type === "control") {
    return (
      <li className="step control">
        <div className="step-line">
          <span className="step-kind">{step.kind === "loop" ? "for each" : "if"}</span>
          <span className="step-intent">{step.intent}</span>
          <code className="step-id">{step.id}</code>
          {flags}
        </div>
        <div className="muted small">
          {step.kind === "loop" ? `over ${step.over}, as {{${step.item.name}}}` : conditionText(step.if)}
        </div>
        <ol className="tree">
          {step.steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </ol>
        {step.kind === "branch" && step.else.length > 0 ? (
          <>
            <div className="step-kind else">otherwise</div>
            <ol className="tree">
              {step.else.map((s) => (
                <StepRow key={s.id} step={s} />
              ))}
            </ol>
          </>
        ) : null}
      </li>
    );
  }
  const kind = step.type === "llm" ? "model" : step.channel === "ax" ? "mac" : step.channel;
  return (
    <li className="step">
      <div className="step-line">
        <span className="step-kind">{kind}</span>
        <span className="step-intent">{step.intent}</span>
        <code className="step-id">{step.id}</code>
        {flags}
      </div>
      {step.type === "action" ? (
        <div className="muted small">
          {step.action}
          {step.target?.name ? ` · "${step.target.name}"` : ""}
        </div>
      ) : null}
    </li>
  );
}

function conditionText(condition: unknown): string {
  const c = condition as {
    left?: string;
    op?: string;
    right?: unknown;
    all?: unknown[];
    any?: unknown[];
    not?: unknown;
  };
  if (c.all) return c.all.map(conditionText).join(" and ");
  if (c.any) return c.any.map(conditionText).join(" or ");
  if (c.not) return `not (${conditionText(c.not)})`;
  return `${c.left} ${(c.op ?? "").replace(/_/g, " ")}${c.right === undefined ? "" : ` ${JSON.stringify(c.right)}`}`;
}
