// A workflow drawn as a tree. The start is the root, at the top, with when it runs and its settings. Every step is a
// node joined to the next by a line. A loop is a node whose own steps are drawn inside it, as a smaller tree. An "if"
// is a fork: its arms sit side by side and join again below; a chain of "else if" shows as one fork with three or more
// arms. Actions and AI steps are the leaves. Used on a workflow's page and next to a question about a draft (`highlight`
// marks the step the question is about), and in the editor, where a click on a step picks it for the panel beside the
// tree. A tree wider than its space is scaled down to fit, to no less than FLOOR; past that it scrolls sideways.
// A node shows what a person would say the step does (reports/plan-oct26-workflow-revamp.md, R3): an icon for its kind,
// its title in plain words (never an id, a channel or an address), and at most one quiet line. A block is one node; its
// steps are in the details panel (`blocks: "fold"`), or drawn inside it where they are edited one by one (`"open"`).
import { type Step, stepTitle } from "@shadow/core";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { describe } from "./frequency.ts";

type Body = Exclude<Step, { type: "trigger" }>;
// Where a step goes, as an insert edit takes it.
export type At =
  | { before: string }
  | { after: string }
  | { into: string; arm?: "steps" | "else"; at?: "start" | "end" };
type Branch = Extract<Step, { type: "control"; kind: "branch" }>;

// How nodes are marked: the step a question is about (`highlight`) and the step picked (`selected`); with `onSelect`,
// a click on a step picks it.
// `problems`: what the review says is wrong, by node: a badge on it (R3.5).
type Marks = {
  highlight?: string;
  selected?: string;
  onSelect?(id: string): void;
  blocks?: "fold" | "open";
  problems?: Map<string, string[]>;
  // A test from the page (R4.6): the steps that worked get a ✓.
  passed?: Set<string>;
  // In the editor: a "+" after each step adds one there (R4).
  onAdd?(at: At): void;
};

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
  // The step a question is about is brought to the middle, sideways only: the page itself must not jump on load. Once
  // the tree has its scale (`fit`), and again whenever that changes.
  useEffect(() => {
    const space = canvas.current;
    const node = marks.highlight ? space?.querySelector(".asked") : undefined;
    if (!fit || !space || !node || space.scrollWidth <= space.clientWidth) return;
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
          {start && marks.onAdd ? <Plus at={{ after: start.id }} marks={marks} /> : null}
          <Steps steps={body} marks={marks} />
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
  // A block: one node with its name; its steps drawn inside it only where they are edited one by one.
  if (step.type === "control" && step.kind === "group" && marks.blocks !== "open") {
    const n = step.steps.length;
    return (
      <div className={`wf-node wf-leaf wf-block${state(step.id, marks)}`}>
        <Face kind="block" step={step} sub={`${n} step${n === 1 ? "" : "s"}`} marks={marks} />
      </div>
    );
  }
  if (step.type === "control" && step.kind === "group") {
    return (
      <div className={`wf-node wf-loop${state(step.id, marks)}`}>
        <Face
          kind="block"
          step={step}
          sub={`${step.steps.length} step${step.steps.length === 1 ? "" : "s"}`}
          marks={marks}
        />
        <div className="wf-inside">
          <div className="wf-seq">
            <Steps steps={step.steps} marks={marks} />
          </div>
        </div>
      </div>
    );
  }
  if (step.type === "control") {
    return (
      <div className={`wf-node wf-loop${state(step.id, marks)}`}>
        <Face
          kind="for each"
          step={step}
          sub={`each ${words(step.item.name)} in ${words(step.over.replace(/[{}]/g, ""))}`}
          marks={marks}
        />
        <div className="wf-inside">
          {step.steps.length > 0 ? (
            <div className="wf-seq">
              <Steps steps={step.steps} marks={marks} />
            </div>
          ) : marks.onAdd ? (
            <Plus at={{ into: step.id }} marks={marks} />
          ) : (
            <div className="wf-empty">nothing yet</div>
          )}
        </div>
        <div className="wf-repeat">repeats for each {step.item.name}</div>
      </div>
    );
  }
  // A leaf: one thing done (an action) or worked out (an AI step).
  const app = step.type === "action" && step.channel === "mcp" ? appStep(String(step.args.tool ?? "")) : undefined;
  const kind = step.type === "llm" ? "ai" : app ? "app" : step.channel;
  // One quiet line: what it makes, or which app does it. The rest is in the details panel.
  const detail =
    step.type === "llm"
      ? `→ ${words(step.output.name)}`
      : app
        ? `${app.app} · ${app.does}`
        : step.output
          ? `→ ${words(step.output.name)}`
          : "";
  return (
    <div className={`wf-node wf-leaf${step.type === "llm" ? " wf-ai" : ""}${state(step.id, marks)}`}>
      <Face kind={kind} step={step} sub={detail} marks={marks} />
    </div>
  );
}

// A list of steps, with a "+" after each where steps are added (the editor, R4).
function Steps({ steps, marks }: { steps: Step[]; marks: Marks }) {
  return (
    <>
      {steps.map((s) => (
        <Fragment key={s.id}>
          <Node step={s} marks={marks} />
          {marks.onAdd && s.type !== "trigger" ? <Plus at={{ after: s.id }} marks={marks} /> : null}
        </Fragment>
      ))}
    </>
  );
}

function Plus({ at, marks }: { at: At; marks: Marks }) {
  const add = marks.onAdd;
  if (!add) return null;
  const where = "after" in at ? `after ${at.after}` : "into" in at ? `in ${at.into}` : "here";
  return (
    <button type="button" className="wf-plus" aria-label={`Add a step ${where}`} onClick={() => add(at)}>
      +
    </button>
  );
}

// An "if" and its arms: the steps when it holds, any "else if" further down the chain, and "otherwise". An "else if"
// is a step of its own (the only step of the "otherwise" before it), so its label can be picked like a node.
function Fork({ step, marks }: { step: Branch; marks: Marks }) {
  // `into`: where a step added to the empty arm goes.
  const arms: { key: string; label: string; branch?: Branch; steps: Step[]; into?: At }[] = [
    { key: step.id, label: "yes", steps: step.steps, into: { into: step.id } },
  ];
  let rest = step.else;
  let last = step;
  while (rest.length === 1 && rest[0]?.type === "control" && rest[0].kind === "branch") {
    const next: Branch = rest[0];
    arms.push({
      key: next.id,
      label: `else if ${conditionText(next.if)}`,
      branch: next,
      steps: next.steps,
      into: { into: next.id },
    });
    last = next;
    rest = next.else;
  }
  arms.push({ key: `${step.id}-otherwise`, label: "otherwise", steps: rest, into: { into: last.id, arm: "else" } });
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
                <Steps steps={arm.steps} marks={marks} />
              ) : marks.onAdd && arm.into ? (
                <Plus at={arm.into} marks={marks} />
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
        <KindIcon kind={kind} />
        <span className="wf-title">{stepTitle(step)}</span>
        {marks.passed?.has(step.id) && !marks.problems?.get(step.id)?.length ? (
          <span className="wf-pass" title="It worked in the test">
            ✓<span className="visually-hidden"> worked in the test</span>
          </span>
        ) : null}
        {marks.problems?.get(step.id)?.length ? (
          <span className="wf-badge" title={marks.problems.get(step.id)?.join("\n")}>
            {marks.problems.get(step.id)?.length}
            <span className="visually-hidden"> to check</span>
          </span>
        ) : null}
      </span>
      {sub || step.requires_approval || step.ask ? (
        <span className="wf-sub">
          {[sub, step.requires_approval ? "asks you first" : "", step.ask ? "asks you a question" : ""]
            .filter(Boolean)
            .join(" · ")}
        </span>
      ) : null}
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

// A variable's name in words: "top_jobs" → "top jobs".
export const words = (name: string) => name.replace(/[_-]+/g, " ").trim();

// What kind of step a node is, as an icon (its name for screen readers and on hover).
const KIND_NAMES: Record<string, string> = {
  web: "In the browser",
  ax: "In a Mac app",
  fs: "Files",
  script: "Script",
  data: "Data",
  ai: "AI",
  app: "Connected app",
  block: "Several steps",
  "for each": "For each",
  if: "If",
};
const KIND_PATHS: Record<string, string> = {
  web: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z",
  ax: "M4 5h16v11H4zM9 20h6M12 16v4",
  fs: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  ai: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z",
  app: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  block: "M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 17l9 5 9-5",
  "for each": "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4",
  if: "M6 3v6a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6M18 3v6",
  script: "M8 9l-4 3 4 3M16 9l4 3-4 3",
  data: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6",
};
function KindIcon({ kind }: { kind: string }) {
  const name = KIND_NAMES[kind] ?? kind;
  return (
    <svg className="wf-icon" viewBox="0 0 24 24" role="img" aria-label={name}>
      <title>{name}</title>
      <path d={KIND_PATHS[kind] ?? KIND_PATHS.block} />
    </svg>
  );
}

// A connected app's tool in plain words: GOOGLESHEETS_BATCH_UPDATE is Google Sheets, "batch update".
const APP_NAMES: Record<string, string> = {
  GOOGLESHEETS: "Google Sheets",
  GOOGLEDOCS: "Google Docs",
  GOOGLEDRIVE: "Google Drive",
  GOOGLECALENDAR: "Google Calendar",
  GMAIL: "Gmail",
  SLACK: "Slack",
  NOTION: "Notion",
  GITHUB: "GitHub",
};
export function appStep(tool: string): { app: string; does: string } {
  const [prefix = "", ...rest] = tool.split("_");
  const known = APP_NAMES[prefix.toUpperCase()];
  return {
    app: known ?? "app",
    does: (known ? rest : [prefix, ...rest]).join(" ").toLowerCase() || "a tool",
  };
}

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
