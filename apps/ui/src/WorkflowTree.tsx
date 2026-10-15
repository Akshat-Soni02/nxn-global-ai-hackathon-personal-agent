// A workflow drawn as a tree. The start is the root, at the top, with when it runs and its settings. Every step is a
// node joined to the next by a line. A loop is a node whose own steps are drawn inside it, as a smaller tree. An "if"
// is a fork: its arms sit side by side and join again below; a chain of "else if" shows as one fork with three or more
// arms. Actions and AI steps are the leaves. Used on a workflow's page and next to a question about a draft (`highlight`
// marks the step the question is about).
import type { Step } from "@shadow/core";
import { describe } from "./frequency.ts";

type Body = Exclude<Step, { type: "trigger" }>;
type Branch = Extract<Step, { type: "control"; kind: "branch" }>;

export function WorkflowTree({ steps, highlight }: { steps: Step[]; highlight?: string }) {
  const start = steps.find((s) => s.type === "trigger");
  const body = steps.filter((s): s is Body => s.type !== "trigger");
  return (
    <div className="wf-canvas">
      <div className="wf-seq">
        {start ? <Root step={start} /> : null}
        {body.map((s) => (
          <Node key={s.id} step={s} highlight={highlight} />
        ))}
      </div>
    </div>
  );
}

function Root({ step }: { step: Step }) {
  if (step.type !== "trigger") return null;
  const when = step.when.map(describe).join(", ") || "only when you start it";
  const inputs = Object.entries(step.inputs);
  return (
    <div className="wf-node wf-root">
      <div className="wf-head">
        <span className="wf-kind">start</span>
        <span className="wf-title">{when.charAt(0).toUpperCase() + when.slice(1)}</span>
      </div>
      {inputs.length > 0 ? (
        <div className="wf-chips">
          {inputs.map(([name, input]) => (
            <span key={name} className="wf-chip" title={input.description}>
              {name}
              {input.default !== undefined ? ` = ${short(input.default)}` : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Node({ step, highlight }: { step: Step; highlight?: string }) {
  // The start is drawn once, as the root; inside loops and arms there is none.
  if (step.type === "trigger") return null;
  const asked = step.id === highlight ? " asked" : "";
  if (step.type === "control" && step.kind === "branch") return <Fork step={step} highlight={highlight} />;
  if (step.type === "control") {
    return (
      <div className={`wf-node wf-loop${asked}`}>
        <Head kind="for each" title={step.intent} step={step} />
        <div className="wf-sub">
          {step.item.name} in {step.over}
        </div>
        <div className="wf-inside">
          {step.steps.length > 0 ? (
            <div className="wf-seq">
              {step.steps.map((s) => (
                <Node key={s.id} step={s} highlight={highlight} />
              ))}
            </div>
          ) : (
            <div className="wf-empty">nothing yet</div>
          )}
        </div>
        <div className="wf-repeat">repeats for each {step.item.name}</div>
      </div>
    );
  }
  // A leaf: one thing done (an action) or worked out (an AI step).
  const kind = step.type === "llm" ? "AI" : (KIND[step.channel] ?? step.channel);
  const detail =
    step.type === "llm"
      ? `reads ${step.inputs.join(", ") || "nothing"} → ${step.output.name}`
      : `${step.action}${step.target?.name ? ` "${step.target.name}"` : ""}${step.output ? ` → ${step.output.name}` : ""}`;
  return (
    <div className={`wf-node wf-leaf${step.type === "llm" ? " wf-ai" : ""}${asked}`}>
      <Head kind={kind} title={step.intent} step={step} />
      <div className="wf-sub">{detail}</div>
    </div>
  );
}

// An "if" and its arms: the steps when it holds, any "else if" further down the chain, and "otherwise".
function Fork({ step, highlight }: { step: Branch; highlight?: string }) {
  const arms: { id: string; label: string; steps: Step[] }[] = [{ id: step.id, label: "yes", steps: step.steps }];
  let rest = step.else;
  while (rest.length === 1 && rest[0]?.type === "control" && rest[0].kind === "branch") {
    const next: Branch = rest[0];
    arms.push({ id: next.id, label: `else if ${conditionText(next.if)}`, steps: next.steps });
    rest = next.else;
  }
  arms.push({ id: `${step.id}-otherwise`, label: "otherwise", steps: rest });
  return (
    <div className="wf-fork">
      <div className={`wf-node wf-if${step.id === highlight ? " asked" : ""}`}>
        <Head kind="if" title={step.intent} step={step} />
        <div className="wf-sub">{conditionText(step.if)}</div>
      </div>
      <div className="wf-arms">
        {arms.map((arm) => (
          <div key={arm.id} className="wf-arm">
            <span className={`wf-arm-label${arm.id === highlight ? " asked" : ""}`}>{arm.label}</span>
            <div className="wf-seq">
              {arm.steps.length > 0 ? (
                arm.steps.map((s) => <Node key={s.id} step={s} highlight={highlight} />)
              ) : (
                <div className="wf-empty">nothing</div>
              )}
            </div>
            <span className="wf-arm-end" />
            <span className="wf-arm-foot" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Head({ kind, title, step }: { kind: string; title: string; step: Body }) {
  return (
    <div className="wf-head">
      <span className="wf-kind">{kind}</span>
      <span className="wf-title">{title}</span>
      <code className="wf-id">{step.id}</code>
      {step.requires_approval ? <span className="flag">approval</span> : null}
      {step.ask ? <span className="flag">asks</span> : null}
    </div>
  );
}

const KIND: Record<string, string> = { web: "web", ax: "mac app", fs: "files", script: "script", data: "data" };

const short = (value: unknown): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
};

export function conditionText(condition: unknown): string {
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
