// A workflow drawn as a tree. The start is the root, at the top, with when it runs and its settings. Every step is a
// node joined to the next by a line. A loop is a node whose own steps are drawn inside it, as a smaller tree. An "if"
// is a fork: its arms sit side by side and join again below; a chain of "else if" shows as one fork with three or more
// arms. Actions and AI steps are the leaves. Used on a workflow's page and next to a question about a draft (`highlight`
// marks the step the question is about), and in the editor, where a click on a step picks it for the panel beside the
// tree. A tree wider than its space is scaled down to fit, to no less than FLOOR; past that it scrolls sideways.
import type { Step } from "@shadow/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { describe } from "./frequency.ts";

type Body = Exclude<Step, { type: "trigger" }>;
type Branch = Extract<Step, { type: "control"; kind: "branch" }>;

// How nodes are marked: the step a question is about (`highlight`) and, in the editor, the step being changed
// (`selected`); with `onSelect`, a click on a step picks it.
type Marks = { highlight?: string; selected?: string; onSelect?(id: string): void };

// The smallest scale a tree is drawn at: below it the words get too small to read, so the tree scrolls instead.
const FLOOR = 0.75;

export function WorkflowTree({ steps, ...marks }: { steps: Step[] } & Marks) {
  const start = steps.find((s) => s.type === "trigger");
  const body = steps.filter((s): s is Body => s.type !== "trigger");
  const { canvas, tree, fit, edges } = useFit();
  // A picked step is brought into view, in case it sits past an edge.
  useEffect(() => {
    if (!marks.selected) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    canvas.current
      ?.querySelector(".picked")
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [marks.selected, canvas]);
  // The step a question is about is brought to the middle, sideways only: the page itself must not jump on load.
  useEffect(() => {
    const space = canvas.current;
    const node = marks.highlight ? space?.querySelector(".asked") : undefined;
    if (!space || !node || space.scrollWidth <= space.clientWidth) return;
    const box = space.getBoundingClientRect();
    const at = node.getBoundingClientRect();
    space.scrollLeft += at.left + at.width / 2 - (box.left + box.width / 2);
  }, [marks.highlight, canvas, fit]);
  return (
    <div ref={canvas} className={`wf-canvas${edges.left ? " more-left" : ""}${edges.right ? " more-right" : ""}`}>
      {/* The stage takes the tree's scaled size, so nothing is left empty below a tree drawn smaller. */}
      <div
        className="wf-stage"
        style={fit ? { width: fit.width * fit.scale, height: fit.height * fit.scale } : undefined}
      >
        <div
          ref={tree}
          className="wf-seq wf-fit"
          style={fit && fit.scale < 1 ? { transform: `scale(${fit.scale})` } : undefined}
        >
          {start ? <Root step={start} /> : null}
          {body.map((s) => (
            <Node key={s.id} step={s} marks={marks} />
          ))}
        </div>
      </div>
    </div>
  );
}

// The tree's own size (a transform doesn't change offsetWidth), measured again whenever the space or the tree changes,
// and the scale that fits it in the space. `edges` says on which side more of a scrolling tree is hidden.
function useFit() {
  const canvas = useRef<HTMLDivElement>(null);
  const tree = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; width: number; height: number }>();
  const [edges, setEdges] = useState({ left: false, right: false });
  useLayoutEffect(() => {
    const space = canvas.current;
    const content = tree.current;
    if (!space || !content) return;
    const look = () => {
      const left = space.scrollLeft > 1;
      const right = space.scrollLeft + space.clientWidth < space.scrollWidth - 1;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    const measure = () => {
      const style = getComputedStyle(space);
      const room = space.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      const width = content.offsetWidth;
      const height = content.offsetHeight;
      const scale = Math.max(FLOOR, Math.min(1, room / width));
      // Less than a pixel of difference on screen is not worth drawing again (and could swing back and forth).
      setFit((f) =>
        f && Math.abs(f.width - width) < 1 && Math.abs(f.height - height) < 1 && Math.abs(f.scale - scale) * width < 1
          ? f
          : { scale, width, height },
      );
      look();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(space);
    observer.observe(content);
    space.addEventListener("scroll", look, { passive: true });
    return () => {
      observer.disconnect();
      space.removeEventListener("scroll", look);
    };
  }, []);
  return { canvas, tree, fit, edges };
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

function Node({ step, marks }: { step: Step; marks: Marks }) {
  // The start is drawn once, as the root; inside loops and arms there is none.
  if (step.type === "trigger") return null;
  if (step.type === "control" && step.kind === "branch") return <Fork step={step} marks={marks} />;
  if (step.type === "control") {
    return (
      <div className={`wf-node wf-loop${state(step.id, marks)}`}>
        <Face kind="for each" step={step} sub={`${step.item.name} in ${step.over}`} marks={marks} />
        <div className="wf-inside">
          {step.steps.length > 0 ? (
            <div className="wf-seq">
              {step.steps.map((s) => (
                <Node key={s.id} step={s} marks={marks} />
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
    <div className={`wf-node wf-leaf${step.type === "llm" ? " wf-ai" : ""}${state(step.id, marks)}`}>
      <Face kind={kind} step={step} sub={detail} marks={marks} />
    </div>
  );
}

// An "if" and its arms: the steps when it holds, any "else if" further down the chain, and "otherwise". An "else if"
// is a step of its own (the only step of the "otherwise" before it), so its label can be picked like a node.
function Fork({ step, marks }: { step: Branch; marks: Marks }) {
  const arms: { key: string; label: string; branch?: Branch; steps: Step[] }[] = [
    { key: step.id, label: "yes", steps: step.steps },
  ];
  let rest = step.else;
  while (rest.length === 1 && rest[0]?.type === "control" && rest[0].kind === "branch") {
    const next: Branch = rest[0];
    arms.push({ key: next.id, label: `else if ${conditionText(next.if)}`, branch: next, steps: next.steps });
    rest = next.else;
  }
  arms.push({ key: `${step.id}-otherwise`, label: "otherwise", steps: rest });
  return (
    <div className="wf-fork">
      <div className={`wf-node wf-if${state(step.id, marks)}`}>
        <Face kind="if" step={step} sub={conditionText(step.if)} marks={marks} />
      </div>
      <div className="wf-arms">
        {arms.map((arm) => (
          <div key={arm.key} className="wf-arm">
            <ArmLabel arm={arm} marks={marks} />
            <div className="wf-seq">
              {arm.steps.length > 0 ? (
                arm.steps.map((s) => <Node key={s.id} step={s} marks={marks} />)
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

function ArmLabel({ arm, marks }: { arm: { label: string; branch?: Branch }; marks: Marks }) {
  const id = arm.branch?.id;
  const className = `wf-arm-label${id ? state(id, marks) : ""}`;
  if (!id || !marks.onSelect) return <span className={className}>{arm.label}</span>;
  const pick = marks.onSelect;
  return (
    <button type="button" className={className} aria-pressed={id === marks.selected} onClick={() => pick(id)}>
      {arm.label}
    </button>
  );
}

const state = (id: string, marks: Marks) =>
  `${id === marks.highlight ? " asked" : ""}${id === marks.selected ? " picked" : ""}`;

// A node's face: the kind of step, what it is for, its id and flags, and one line of detail. With `onSelect` it is a
// button that picks the step (spans, not divs: a button holds only inline content).
function Face({ kind, step, sub, marks }: { kind: string; step: Body; sub: string; marks: Marks }) {
  const face = (
    <>
      <span className="wf-head">
        <span className="wf-kind">{kind}</span>
        <span className="wf-title">{step.intent}</span>
        <code className="wf-id">{step.id}</code>
        {step.requires_approval ? <span className="flag">approval</span> : null}
        {step.ask ? <span className="flag">asks</span> : null}
      </span>
      <span className="wf-sub">{sub}</span>
    </>
  );
  if (!marks.onSelect) return face;
  const pick = marks.onSelect;
  return (
    <button type="button" className="wf-pick" aria-pressed={step.id === marks.selected} onClick={() => pick(step.id)}>
      {face}
    </button>
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
