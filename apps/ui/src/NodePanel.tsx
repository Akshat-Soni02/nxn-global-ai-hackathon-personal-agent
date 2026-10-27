// A node's details, beside the tree on a workflow's page (reports/plan-oct26-workflow-revamp.md, R3.3). The node
// itself shows only its name; here is what it does in plain words (Details) and, for finding out why something didn't
// work, its steps as they run: ids, actions, controls and values (Debug).
import { isAction, type Step, stepTitle, walkSteps } from "@shadow/core";
import { useState } from "react";
import { conditionText, words } from "./WorkflowTree.tsx";

type Body = Exclude<Step, { type: "trigger" }>;

export function NodePanel({ step, close, problems = [] }: { step: Body; close(): void; problems?: string[] }) {
  const [tab, setTab] = useState<"details" | "debug">("details");
  const toCheck =
    problems.length > 0 ? (
      <ul className="node-problems" aria-label="To check">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    ) : null;
  return (
    <div className="inspector-body">
      <div className="inspector-head">
        <strong>{stepTitle(step)}</strong>
        <button type="button" className="inspector-close" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      <div className="tabs" role="tablist">
        {(["details", "debug"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`tab${tab === t ? " on" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "details" ? "Details" : "Debug"}
          </button>
        ))}
      </div>
      {toCheck}
      {tab === "details" ? <Details step={step} /> : <Debug step={step} />}
    </div>
  );
}

function Details({ step }: { step: Body }) {
  const lines: [string, string][] = [];
  if (step.type === "llm") {
    lines.push(["Asks the AI", step.instruction]);
    lines.push(["Reads", step.inputs.map((i) => words(i.replace(/[{}]/g, ""))).join(", ") || "nothing"]);
    lines.push(["Makes", words(step.output.name)]);
  } else if (step.type === "control" && step.kind === "loop") {
    lines.push(["Repeats", `for each ${words(step.item.name)} in ${words(step.over.replace(/[{}]/g, ""))}`]);
    if (step.first) lines.push(["Only", `the first ${step.first}`]);
    lines.push(["At most", `${step.max_items} times`]);
  } else if (step.type === "control" && step.kind === "branch") {
    lines.push(["When", conditionText(step.if)]);
  } else if (isAction(step) && step.output) {
    lines.push(["Makes", words(step.output.name)]);
  }
  if (step.requires_approval) lines.push(["Before it runs", "asks you first"]);
  if (step.ask) lines.push(["Asks you", step.ask.question]);
  const inner = step.type === "control" ? step.steps : [];
  return (
    <>
      {lines.length > 0 ? (
        <dl className="facts">
          {lines.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {inner.length > 0 ? (
        <div>
          <p className="muted small">{step.type === "control" && step.kind === "group" ? "Its steps" : "Inside"}</p>
          <ol className="node-steps">
            {inner.map((s) => (
              <li key={s.id}>
                {stepTitle(s)}
                {s.type !== "trigger" && s.requires_approval ? <span className="muted"> · asks you first</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </>
  );
}

// Each step as it runs: its id (what the run log and the questions name), its action, its control and its values.
function Debug({ step }: { step: Body }) {
  return (
    <ol className="node-debug">
      {[...walkSteps([step])].map(({ step: s }) => {
        const what =
          s.type === "action"
            ? `${s.channel}.${s.action}`
            : s.type === "control"
              ? s.kind === "group"
                ? "block"
                : s.kind
              : s.type;
        const data = s.type === "action" ? { target: s.target, args: s.args, wait: s.wait, check: s.check } : undefined;
        return (
          <li key={s.id}>
            <div>
              <code>{s.id}</code> <span className="muted">{what}</span>
            </div>
            <div className="small">{s.intent}</div>
            {data ? <pre className="node-json">{JSON.stringify(data, null, 1)}</pre> : null}
          </li>
        );
      })}
    </ol>
  );
}
