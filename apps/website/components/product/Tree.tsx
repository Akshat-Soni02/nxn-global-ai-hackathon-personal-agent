// Workflows drawn as the app draws them (apps/ui/src/WorkflowTree.tsx): the start on top, each step a node joined to
// the next by a line, a loop's steps inside it, an "if" forking into arms that join again below. `data-build` marks
// what the scroll story builds one by one, in document order.
import type { Case } from "../../lib/content";

function Node({ kind, title, tone, flag }: { kind: string; title: string; tone?: string; flag?: string }) {
  return (
    <div className={tone ? `node ${tone}` : "node"} data-build>
      <span className="k">{kind}</span>
      <span className="t">{title}</span>
      {flag ? <span className="flag">{flag}</span> : null}
    </div>
  );
}

// This week's numbers into the KPI sheet: four steps in a line, the last one waiting for approval. In the hero.
export function KpiTree() {
  return (
    <div className="tree" aria-hidden="true">
      <Node kind="start" title="Every Monday at 09:00" tone="start" />
      <Node kind="web" title={'Open the newest email from "Reporting Bot"'} />
      <Node kind="AI" title="Read Revenue, Signups and Churn" tone="ai" />
      <Node kind="web" title={'Open the "KPI 2026" sheet'} />
      <Node kind="web" title="Write the week in a new row" flag="approval" />
    </div>
  );
}

// Invoices into Xero: a loop, an AI step, a fork, an approval. The one the Overview's story builds.
export function InvoiceTree() {
  return (
    <div className="tree" aria-hidden="true">
      <Node kind="start" title="When a PDF lands in Invoices" tone="start" />
      <div className="loop" data-build>
        <span className="k">for each</span>
        <span className="t">new invoice</span>
        <div className="loop-inside">
          <div className="tree-seq">
            <Node kind="AI" title="Read vendor, number and amount" tone="ai" />
            <div className="fork">
              <Node kind="if" title="The vendor is new in Xero" tone="if" />
              <div className="arms" data-build>
                <div className="arm">
                  <span className="arm-label">yes</span>
                  <Node kind="web" title="Add the vendor" />
                </div>
                <div className="arm">
                  <span className="arm-label">otherwise</span>
                  <span className="empty">nothing</span>
                </div>
              </div>
            </div>
            <Node kind="web" title="Create the bill in Xero" flag="approval" />
          </div>
        </div>
        <div className="loop-foot">↻ repeats for each invoice</div>
      </div>
    </div>
  );
}

// New YC jobs into a sheet: the AI picks, a loop, a three-way fork. Shadow's own sample workflow.
export function JobsTree() {
  return (
    <div className="tree" aria-hidden="true">
      <Node kind="start" title="Every day at 09:00" tone="start" />
      <Node kind="web" title="Open the YC jobs page" />
      <Node kind="AI" title="Pick up to 5 remote or new-grad jobs" tone="ai" />
      <div className="loop">
        <span className="k">for each</span>
        <span className="t">picked job</span>
        <div className="loop-inside">
          <div className="tree-seq">
            <Node kind="web" title="Type the company" />
            <div className="fork">
              <Node kind="if" title="Which kind of role" tone="if" />
              <div className="arms">
                <div className="arm">
                  <span className="arm-label">remote</span>
                  <Node kind="web" title="Mark it Remote" />
                </div>
                <div className="arm">
                  <span className="arm-label">else if new grad</span>
                  <Node kind="web" title="Mark it New grad" />
                </div>
                <div className="arm">
                  <span className="arm-label">otherwise</span>
                  <span className="empty">nothing</span>
                </div>
              </div>
            </div>
            <Node kind="web" title="Save the row" flag="approval" />
          </div>
        </div>
        <div className="loop-foot">↻ repeats for each job</div>
      </div>
    </div>
  );
}

// A use case's steps as a short indented list: readable on a phone, the kind of each step first.
export function StepList({ steps }: { steps: Case["steps"] }) {
  return (
    <ol className="steps" aria-label="The workflow's steps">
      {steps.map((step) => (
        <li
          key={`${step.kind}-${step.text}`}
          className={step.tone ? `step ${step.tone}` : "step"}
          data-depth={step.depth ?? 0}
        >
          <span className="step-kind">{step.kind}</span>
          <span className="step-text">{step.text}</span>
          {step.flag ? <span className="step-flag">{step.flag}</span> : null}
        </li>
      ))}
    </ol>
  );
}
