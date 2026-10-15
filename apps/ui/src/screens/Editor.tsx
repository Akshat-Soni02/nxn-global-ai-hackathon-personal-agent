// The editor (docs/design.md, "6. Edit"): change any step of a workflow, toggle human approval, remove or reorder
// steps. The workflow is drawn as the same tree as on its page (WorkflowTree.tsx); the step picked in it is changed in
// the panel on the right, which stays in place while you edit, so the tree never moves under you. Every change is one
// of the edit operations the agents use, applied by the daemon to a draft beside the workflow and saved at once; the
// live version keeps running unchanged until the draft is saved as the next version. A refused change (the workflow
// could not take it: a reference that doesn't exist, a step that can't move there) is shown with the daemon's reason.
import type { EditInput, Step } from "@shadow/core";
import type { DraftView } from "@shadow/daemon/src/types.ts";
import { useEffect, useState } from "react";
import { useQuery, useSession } from "../api.ts";
import { Action, Loading } from "../components.tsx";
import { WorkflowTree } from "../WorkflowTree.tsx";

type Body = Exclude<Step, { type: "trigger" }>;

export function Editor({ id, onDone }: { id: string; onDone(): void }) {
  const session = useSession();
  const draft = useQuery<DraftView>("draft", { id });
  const [error, setError] = useState<string>();
  const [picked, setPicked] = useState<string>();
  // Escape puts the step down, as it closes a panel anywhere else on the Mac. The field being typed in loses focus
  // first, so what was typed is saved (on blur) before the panel goes.
  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setPicked(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked]);
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
  // Gone after a remove or an undo: the panel goes back to "no step picked".
  const spot = picked ? locate(d.skill.steps, picked) : undefined;

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
          Each change is kept as a draft at once; the workflow keeps running as it is until you save.
        </p>
      )}
      {d.problems.length > 0 ? <p className="error">Before it can start on its own: {d.problems.join("; ")}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="edit-layout">
        <WorkflowTree
          steps={d.skill.steps}
          selected={spot?.step.id}
          onSelect={(step) => setPicked(step === picked ? undefined : step)}
        />
        <aside className="inspector" aria-label="The picked step">
          {spot ? (
            // Keyed on the step itself: after any change (or undo) the panel starts again from what was saved.
            <EditStep key={JSON.stringify(spot.step)} {...spot} edit={edit} close={() => setPicked(undefined)} />
          ) : (
            <div className="inspector-empty">
              <span className="inspector-empty-title">No step picked</span>
              <span className="muted small">
                Click a step in the tree to change what it is for, have it wait for your approval, move it or remove it.
              </span>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

// Where a step sits: the list it is in (the workflow, a loop's steps, either side of an "if") and its place there.
function locate(steps: Step[], id: string): { step: Body; siblings: Body[]; index: number } | undefined {
  const siblings = steps.filter((s): s is Body => s.type !== "trigger");
  for (const [index, step] of siblings.entries()) {
    if (step.id === id) return { step, siblings, index };
    if (step.type === "control") {
      const inside = locate(step.steps, id) ?? (step.kind === "branch" ? locate(step.else, id) : undefined);
      if (inside) return inside;
    }
  }
  return undefined;
}

const kindOf = (step: Body): string =>
  step.type === "control"
    ? step.kind === "loop"
      ? "for each"
      : "if"
    : step.type === "llm"
      ? "AI"
      : step.channel === "ax"
        ? "mac app"
        : step.channel;

// The picked step: what it is for, whether it waits for your approval, its fields, and its place among its neighbours.
function EditStep({
  step,
  siblings,
  index,
  edit,
  close,
}: {
  step: Body;
  siblings: Body[];
  index: number;
  edit(edits: EditInput[]): Promise<void>;
  close(): void;
}) {
  const [intent, setIntent] = useState(step.intent);
  const set = (field: string, value: unknown) => edit([{ op: "set", step: step.id, field, value } as EditInput]);
  const before = siblings[index - 1];
  const after = siblings[index + 1];
  return (
    <div className="inspector-body">
      <header className="inspector-head">
        <span className="wf-kind">{kindOf(step)}</span>
        <code className="wf-id">{step.id}</code>
        <button
          type="button"
          className="inspector-close"
          aria-label="Put the step down"
          title="Close (Esc)"
          onClick={close}
        >
          ×
        </button>
      </header>
      <label className="field wide">
        <span>What it is for</span>
        <input
          className="input"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onBlur={() => intent.trim() && intent !== step.intent && set("intent", intent.trim())}
        />
      </label>
      {step.type === "action" ? (
        <p className="inspector-does">
          <span className="muted small">Does</span>
          <span>
            {step.action}
            {step.target?.name ? ` "${step.target.name}"` : ""}
          </span>
        </p>
      ) : null}
      <label className="check-row">
        <input
          type="checkbox"
          checked={step.requires_approval}
          onChange={(e) => set("requires_approval", e.target.checked)}
        />
        <span>
          Wait for my approval
          <span className="muted small">Shadow asks you before this step runs.</span>
        </span>
      </label>
      <Fields step={step} set={set} />
      <footer className="inspector-foot">
        <button
          type="button"
          className="button small"
          disabled={!before}
          onClick={() => before && edit([{ op: "move", step: step.id, to: { before: before.id } }])}
        >
          ↑ Move up
        </button>
        <button
          type="button"
          className="button small"
          disabled={!after}
          onClick={() => after && edit([{ op: "move", step: step.id, to: { after: after.id } }])}
        >
          ↓ Move down
        </button>
        <button
          type="button"
          className="button small danger"
          title={step.type === "control" ? "Remove this step and the steps inside it" : "Remove this step"}
          onClick={() => edit([{ op: "remove", step: step.id }])}
        >
          Remove
        </button>
      </footer>
    </div>
  );
}

// What each kind of step keeps as JSON, named for what it does.
const FIELD = {
  args: { label: "Values", hint: "what the step types or picks; {{name}} reads a variable" },
  inputs: { label: "Reads", hint: "the variables the AI step is given" },
  over: { label: "Repeats over", hint: "the list the steps inside run once for each item of" },
  if: { label: "Condition", hint: "when the first side runs" },
} as const;

// The step's own fields, as JSON where they are structured (args, a condition), as text where they are text.
function Fields({ step, set }: { step: Body; set(field: string, value: unknown): void }) {
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
    <>
      {step.type === "llm" ? (
        <label className="field wide">
          <span>Instruction (what the AI does with what it reads)</span>
          <textarea
            className="input"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text.trim() && text !== step.instruction && set("instruction", text.trim())}
          />
        </label>
      ) : null}
      <label className="field wide">
        <span>
          {FIELD[field].label} <span className="muted small">· {FIELD[field].hint}</span>
        </span>
        <textarea className="input mono" rows={6} value={json} onChange={(e) => setJson(e.target.value)} />
      </label>
      <div className="answers">
        <button type="button" className="button small" onClick={apply}>
          Apply
        </button>
        {bad ? <span className="error">{bad}</span> : null}
      </div>
    </>
  );
}
