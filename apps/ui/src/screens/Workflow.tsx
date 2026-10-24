// One workflow: what it is for, its steps as a tree, its versions (who made each and why), and its runs.
import type { Skill } from "@shadow/core";
import type { Review, RunRow, WorkflowSummary } from "@shadow/daemon/src/types.ts";
import { useState } from "react";
import { useQuery, useSession } from "../api.ts";
import { Action, Loading, StateChip, StatusChip } from "../components.tsx";
import { FrequencyPicker } from "../FrequencyPicker.tsx";
import { ago, duration, money, when } from "../format.ts";
import { describe } from "../frequency.ts";
import { badgesOf, cantRunNow } from "../review.ts";
import { WorkflowTree } from "../WorkflowTree.tsx";
import { Editor } from "./Editor.tsx";

const BY = { record: "Recorded", user: "Changed by you", debug: "Repaired during a run" } as const;

export function Workflow({ id }: { id: string }) {
  const session = useSession();
  const workflow = useQuery<{ id: string; versions: number[]; latest: Skill } | null>("workflow", { id });
  const summary = useQuery<WorkflowSummary[]>("workflows");
  const runs = useQuery<RunRow[]>("runs", { skillId: id, limit: 20 });
  // What the design changed, and whether you said it looks right (Go live waits for that).
  const review = useQuery<Review | null>("review", { id });
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
  const needsLook = Boolean(review.data && !review.data.reviewed && review.data.version <= latest.version);
  const cantRun = cantRunNow(review.data, latest.version);

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
            ) : needsLook && state?.state !== "paused" ? (
              <button
                type="button"
                className="button"
                disabled
                title={cantRun[0] ? `It can't run yet: ${cantRun[0]}` : "Look at what the design changed first"}
              >
                Go live
              </button>
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

      {review.data && !review.data.reviewed ? (
        <ReviewCard
          review={review.data}
          cantRun={cantRun}
          onLooksRight={async () => {
            await session.call("looksRight", { id });
            review.reload();
          }}
        />
      ) : null}

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

// The review after a design (spec 4.3): what the recording itself missed, every change with its why, what you said and
// what was built for it, what wasn't tested, and how it was made. Go live waits for Looks right; a workflow that can't
// do the task yet has no Looks right, only what to do about it (checkpoint 6: D was offered one).
function ReviewCard({
  review,
  cantRun,
  onLooksRight,
}: {
  review: Review;
  cantRun: string[];
  onLooksRight: () => Promise<unknown>;
}) {
  const list = (title: string, items: string[]) =>
    items.length > 0 ? (
      <>
        <h3>{title}</h3>
        <ul>
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </>
    ) : null;
  return (
    <section className="section review" aria-label="What the design changed">
      <h2>Check what was built</h2>
      {review.notices?.length ? (
        <div className="review-notices">
          <strong>About the recording</strong>
          <ul>
            {review.notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p>{review.summary}</p>
      {review.cadence ? <p className="muted">Runs: {review.cadence}</p> : null}
      {review.checked ? <p className="muted">{review.checked}</p> : null}
      <ul className="review-notes">
        {badgesOf(review).map((b) => (
          <li key={`${b.step}-${b.label}`}>
            <span className={`review-badge review-badge-${b.label.toLowerCase()}`}>{b.label}</span>{" "}
            <code>{b.step}</code> {b.why ?? ""}
            {b.untested ? <span className="review-badge review-badge-untested">Not tested</span> : null}
          </li>
        ))}
      </ul>
      {list(
        "What you said → what was built",
        review.said.map((s) => `“${s.quote}” → ${s.notBuilt ? `not built: ${s.notBuilt}` : s.steps.join(", ")}`),
      )}
      {list("Not tested", review.notTested)}
      {list("Not asked (each took its default)", review.notAsked ?? [])}
      {list("Still to check", review.gaps)}
      {review.made?.length ? (
        <details>
          <summary>How this was made</summary>
          <ol>
            {keyed(review.made).map(({ key, line }) => (
              <li key={key}>{line}</li>
            ))}
          </ol>
        </details>
      ) : null}
      {cantRun.length > 0 ? (
        <div className="review-cant-run">
          <strong>Can't run yet</strong>
          <ul>
            {cantRun.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="muted small">
            Record again, showing how it is made, or Edit it to add the step that makes it. Go live waits until then.
          </div>
        </div>
      ) : (
        <Action run={onLooksRight}>Looks right</Action>
      )}
    </section>
  );
}

// The feed's lines can repeat ("Testing it in the automation window"): each is keyed by its text and how many times
// it came before.
function keyed(lines: string[]): { key: string; line: string }[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const n = (seen.get(line) ?? 0) + 1;
    seen.set(line, n);
    return { key: `${line}#${n}`, line };
  });
}
