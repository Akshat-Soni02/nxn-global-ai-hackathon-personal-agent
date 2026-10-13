// The editor (docs/design.md, "6. Edit"): change any step of a workflow, toggle human approval, remove or reorder
// steps. Every change is one of the edit operations the agents use, applied by the daemon to a draft beside the
// workflow and saved at once; the live version keeps running unchanged until the draft is saved as the next version.
// A refused change (the workflow could not take it: a reference that doesn't exist, a step that can't move there)
// is shown with the daemon's reason.
import type { EditInput, Step } from "@shadow/core";
import type { DraftView } from "@shadow/daemon/src/types.ts";
import { useState } from "react";
import { useQuery, useSession } from "../api.ts";
import { Action, Loading } from "../components.tsx";

export function Editor({ id, onDone }: { id: string; onDone(): void }) {
  const session = useSession();
  const draft = useQuery<DraftView>("draft", { id });
  const [error, setError] = useState<string>();
  const call = async (method: string, params: object = {}) => {
    setError(undefined);
    try {
      await session.call(method, { id, ...params });
      draft.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const edit = (edits: EditInput[]) => call("editDraft", { edits });
  if (!draft.data) return <Loading error={draft.error} />;
  const d = draft.data;
  const steps = d.skill.steps.filter((s) => s.type !== "trigger");

  return (
    <section className="section editor">
      <div className="title-row">
        <h2>Edit</h2>
        <span className="action">
          <button type="button" className="button" disabled={!d.canUndo} onClick={() => call("undoDraft")}>
            Undo
          </button>
          <button type="button" className="button" disabled={!d.canRedo} onClick={() => call("redoDraft")}>
            Redo
          </button>
          <Action confirm="Drop every change?" run={() => call("discardDraft").then(onDone)}>
            Discard
          </Action>
          <Action
            kind="primary"
            run={async () => {
              await session.call("publishDraft", { id });
              onDone();
            }}
          >
            Save as v{d.latest + 1}
          </Action>
          <button type="button" className="button link" onClick={onDone}>
            Close
          </button>
        </span>
      </div>
      {d.changes.length > 0 ? (
        <p className="muted small">
          {d.changes.length} change{d.changes.length === 1 ? "" : "s"} on v{d.base}: {d.changes.join(" · ")}
        </p>
      ) : (
        <p className="muted small">
          Change any step below. Each change is kept as a draft at once; the workflow keeps running as it is until you
          save.
        </p>
      )}
      {d.problems.length > 0 ? <p className="error">Before it can start on its own: {d.problems.join("; ")}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <ol className="tree">
        {steps.map((s, i) => (
          <EditRow key={s.id} step={s} siblings={steps} index={i} edit={edit} />
        ))}
      </ol>
    </section>
  );
}

function EditRow({
  step,
  siblings,
  index,
  edit,
}: {
  step: Step;
  siblings: Step[];
  index: number;
  edit(edits: EditInput[]): Promise<void>;
}) {
  const [intent, setIntent] = useState(step.intent);
  const [more, setMore] = useState(false);
  if (step.type === "trigger") return null;
  const set = (field: string, value: unknown) => edit([{ op: "set", step: step.id, field, value } as EditInput]);
  const before = siblings[index - 1];
  const after = siblings[index + 1];
  const kind =
    step.type === "control"
      ? step.kind === "loop"
        ? "for each"
        : "if"
      : step.type === "llm"
        ? "model"
        : step.channel === "ax"
          ? "mac"
          : step.channel;

  return (
    <li className={`step edit${step.type === "control" ? " control" : ""}`}>
      <div className="step-line">
        <span className="step-kind">{kind}</span>
        <input
          className="input step-intent-input"
          value={intent}
          aria-label={`What ${step.id} is for`}
          onChange={(e) => setIntent(e.target.value)}
          onBlur={() => intent.trim() && intent !== step.intent && set("intent", intent.trim())}
        />
        <code className="step-id">{step.id}</code>
        <label className="flag toggle" title="Wait for your approval before this step runs">
          <input
            type="checkbox"
            checked={step.requires_approval}
            onChange={(e) => set("requires_approval", e.target.checked)}
          />{" "}
          approval
        </label>
        <span className="row-tools">
          <button
            type="button"
            className="button small"
            disabled={!before}
            title="Move up"
            onClick={() => before && edit([{ op: "move", step: step.id, to: { before: before.id } }])}
          >
            ↑
          </button>
          <button
            type="button"
            className="button small"
            disabled={!after}
            title="Move down"
            onClick={() => after && edit([{ op: "move", step: step.id, to: { after: after.id } }])}
          >
            ↓
          </button>
          <button type="button" className="button small" onClick={() => setMore(!more)}>
            {more ? "Less" : "More"}
          </button>
          <button
            type="button"
            className="button small danger"
            title="Remove this step"
            onClick={() => edit([{ op: "remove", step: step.id }])}
          >
            Remove
          </button>
        </span>
      </div>
      {step.type === "action" ? (
        <div className="muted small">
          {step.action}
          {step.target?.name ? ` · "${step.target.name}"` : ""}
        </div>
      ) : null}
      {more ? <Fields step={step} set={set} /> : null}
      {step.type === "control" ? (
        <>
          <ol className="tree">
            {step.steps.map((s, i) => (
              <EditRow key={s.id} step={s} siblings={step.steps} index={i} edit={edit} />
            ))}
          </ol>
          {step.kind === "branch" && step.else.length > 0 ? (
            <>
              <div className="step-kind else">otherwise</div>
              <ol className="tree">
                {step.else.map((s, i) => (
                  <EditRow key={s.id} step={s} siblings={step.else} index={i} edit={edit} />
                ))}
              </ol>
            </>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

// The step's own fields, as JSON where they are structured (args, a condition), as text where they are text.
function Fields({ step, set }: { step: Exclude<Step, { type: "trigger" }>; set(field: string, value: unknown): void }) {
  const field = step.type === "action" ? "args" : step.type === "llm" ? "inputs" : step.kind === "loop" ? "over" : "if";
  const [json, setJson] = useState(() =>
    JSON.stringify(
      step.type === "action"
        ? step.args
        : step.type === "llm"
          ? step.inputs
          : step.kind === "loop"
            ? step.over
            : step.if,
      null,
      2,
    ),
  );
  const [text, setText] = useState(step.type === "llm" ? step.instruction : "");
  const [bad, setBad] = useState<string>();
  const apply = () => {
    try {
      set(field, JSON.parse(json));
      setBad(undefined);
    } catch (e) {
      setBad(`not JSON: ${(e as Error).message}`);
    }
  };
  return (
    <div className="fields">
      {step.type === "llm" ? (
        <label className="field wide">
          <span>Instruction (what the model does with its inputs)</span>
          <textarea
            className="input"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text.trim() && text !== step.instruction && set("instruction", text.trim())}
          />
        </label>
      ) : null}
      <label className="field wide">
        <span>
          {field} (JSON){step.type === "action" ? " · the values the step uses; {{name}} reads a variable" : ""}
        </span>
        <textarea className="input mono" rows={3} value={json} onChange={(e) => setJson(e.target.value)} />
      </label>
      <div className="answers">
        <button type="button" className="button" onClick={apply}>
          Apply
        </button>
        {bad ? <span className="error">{bad}</span> : null}
      </div>
    </div>
  );
}
