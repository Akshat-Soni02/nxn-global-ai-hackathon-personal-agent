// "+" in the editor (reports/plan-oct26-workflow-revamp.md, R4): add a step of a kind, with a short form for what it
// needs. The form makes the step itself and the daemon inserts it into the draft as any edit (checked like the agent's:
// a step that can't run, or a value nothing saves yet, is refused with the reason). Loops and ifs hold steps, so they
// are made by wrapping steps already there (the step's panel), not added empty here.
import type { EditInput, Skill, Step } from "@shadow/core";
import { walkSteps } from "@shadow/core";
import { useState } from "react";
import { argumentFields, argumentsOf, documentsIn } from "./app-form.ts";
import type { At } from "./WorkflowTree.tsx";

export type Kind = "open" | "click" | "type" | "read" | "ai" | "files" | "app";
// A step as an insert edit takes it: the daemon gives it an id and checks it.
export type NewStep = Record<string, unknown>;

const KINDS: { kind: Kind | Marker; title: string; about: string }[] = [
  { kind: "open", title: "Open a page", about: "Go to an address in the browser" },
  { kind: "click", title: "Click on a page", about: "A button or link, by its words" },
  { kind: "type", title: "Type on a page", about: "Into a box, by its label" },
  { kind: "read", title: "Read from a page", about: "The page, or one part of it, saved for later steps" },
  { kind: "ai", title: "AI step", about: "Work something out from what earlier steps read" },
  { kind: "files", title: "Find files", about: "In a folder on your Mac" },
  { kind: "app", title: "App action", about: "Something a connected app does directly" },
  { kind: "ask", title: "Ask me", about: "A question before the next step, answered each run" },
  { kind: "approve", title: "Wait for my OK", about: "The next step waits until you approve it" },
  { kind: "show", title: "Show me", about: "Do it once in Chrome: it is recorded as a block here" },
];

// A variable's name from what a person types: "Top jobs" → "top_jobs".
const varName = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "v$1") || "value";

// What earlier steps save, offered to an AI step's "reads".
function variablesIn(skill: Skill): string[] {
  const names = new Set<string>(Object.keys(skill.steps[0]?.type === "trigger" ? skill.steps[0].inputs : {}));
  for (const { step } of walkSteps(skill.steps)) {
    if ("output" in step && step.output) names.add(step.output.name);
    if (step.type === "control" && step.kind === "loop") names.add(step.item.name);
  }
  return [...names];
}

// A connected app's tool as the daemon lists it (appTools): its schema makes the App action form's fields (R4.4).
export interface ToolInfo {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

// The step a form makes, or why it can't yet.
export function stepOf(kind: Kind, f: Record<string, string>, tools: ToolInfo[] = []): NewStep | string {
  const text = (k: string) => (f[k] ?? "").trim();
  switch (kind) {
    case "open": {
      const url = text("url");
      if (!/^https?:\/\//.test(url)) return "the address starts with https://";
      return { type: "action", intent: `Open ${url}`, channel: "web", action: "navigate", args: { url } };
    }
    case "click":
      if (!text("name")) return "say the words on the button or link";
      return {
        type: "action",
        intent: `Click “${text("name")}”`,
        channel: "web",
        action: "click",
        target: { ...(text("role") ? { role: text("role") } : {}), name: text("name"), fallbacks: [] },
        args: {},
      };
    case "type":
      if (!text("label")) return "say the box's label";
      return {
        type: "action",
        intent: `Type into “${text("label")}”`,
        channel: "web",
        action: "type",
        target: { role: "textbox", label: text("label"), fallbacks: [] },
        args: { text: f.text ?? "" },
      };
    case "read":
      if (!text("save_as")) return "name what it reads, so later steps can use it";
      return {
        type: "action",
        intent: text("css") ? `Read ${text("css")} from the page` : "Read the page",
        channel: "web",
        action: "extract",
        target: { fallbacks: text("css") ? [text("css")] : ["main", "body"] },
        args: {},
        output: { name: varName(text("save_as")), type: { type: "text" } },
      };
    case "ai": {
      if (!text("instruction")) return "say what the AI should work out";
      if (!text("save_as")) return "name what it makes";
      const reads = text("reads")
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((r) => `{{${r.replace(/[{}]/g, "")}}}`);
      const type =
        f.output === "list"
          ? { type: "list", items: { type: "text" } }
          : f.output === "yes/no"
            ? { type: "boolean" }
            : { type: f.output === "number" ? "number" : "text" };
      return {
        type: "llm",
        intent: text("instruction").slice(0, 60),
        instruction: text("instruction"),
        inputs: reads,
        output: { name: varName(text("save_as")), type },
      };
    }
    case "files":
      if (!text("dir")) return "say which folder";
      return {
        type: "action",
        intent: `Find ${text("glob") || "files"} in ${text("dir")}`,
        channel: "fs",
        action: "find",
        args: { dir: text("dir"), glob: text("glob") || "*", pick: f.pick === "all" ? "all" : "newest" },
        output: {
          name: varName(text("save_as") || "found"),
          type: f.pick === "all" ? { type: "list", items: { type: "file" } } : { type: "file" },
        },
      };
    case "app": {
      if (!text("tool")) return "pick the app's action";
      const schema = tools.find((t) => t.name === text("tool"))?.inputSchema;
      let args: unknown;
      if (schema?.properties) {
        // A field per argument (R4.4).
        const made = argumentsOf(argumentFields(schema), f);
        if (typeof made === "string") return made;
        args = made;
      } else {
        // A daemon older than the window sends no schema: the values as JSON, as before.
        try {
          args = JSON.parse(text("arguments") || "{}");
        } catch {
          return 'its values are JSON: { "name": "value" }';
        }
      }
      return {
        type: "action",
        intent: text("tool").toLowerCase().replace(/_/g, " "),
        channel: "mcp",
        action: "call",
        args: { tool: text("tool"), arguments: args },
        ...(text("save_as") ? { output: { name: varName(text("save_as")), type: { type: "object" } } } : {}),
      };
    }
  }
}

// Two more ways to build, which add no step: they set a field on the step that follows the spot (R4.2, B4). "Ask me"
// puts a question on it, answered before it runs; "Wait for my OK" makes it wait for your approval.
export type Marker = "ask" | "approve" | "show";

// The id of the step that follows a spot, if there is one: after a step is its next sibling, before is that step, and
// into a loop, a branch or a block at its start is its first step.
function stepAfter(skill: Skill, at: At): string | undefined {
  const lists = (steps: Step[]): Step[][] => [
    steps,
    ...steps.flatMap((s) =>
      s.type === "control" ? [...lists(s.steps), ...(s.kind === "branch" ? lists(s.else) : [])] : [],
    ),
  ];
  if ("before" in at) return at.before;
  if ("after" in at) {
    for (const list of lists(skill.steps)) {
      const i = list.findIndex((s) => s.id === at.after);
      if (i >= 0) return list[i + 1]?.id;
    }
    return undefined;
  }
  const parent = [...walkSteps(skill.steps)].map(({ step }) => step).find((s) => s.id === at.into);
  if (parent?.type !== "control" || at.at === "end") return undefined;
  return (at.arm === "else" && parent.kind === "branch" ? parent.else : parent.steps)[0]?.id;
}

// The edits a form makes at a spot, or why it can't yet: an insert for a step, a `set` for a question or an approval.
export function editsFor(
  kind: Kind | Marker,
  f: Record<string, string>,
  at: At,
  skill: Skill,
  tools: ToolInfo[] = [],
): EditInput[] | string {
  // Show me adds nothing here: the recording comes back as an edit of its own (the daemon).
  if (kind === "show") return "Show me starts a recording";
  if (kind !== "ask" && kind !== "approve") {
    const step = stepOf(kind, f, tools);
    return typeof step === "string" ? step : [{ op: "insert", at, step } as EditInput];
  }
  const next = stepAfter(skill, at);
  if (!next) return "there is no step after this spot to do that for: pick a spot above a step";
  if (kind === "approve") return [{ op: "set", step: next, field: "requires_approval", value: true }];
  const question = (f.question ?? "").trim();
  if (!question) return "say what to ask";
  const confirm = f.answer === "yes/no";
  return [
    {
      op: "set",
      step: next,
      field: "ask",
      value: confirm
        ? { question, kind: "confirm" }
        : { question, kind: "value", output: { name: varName(f.name || question), type: { type: "text" } } },
    },
  ];
}

export function AddNode({
  at,
  skill,
  tools = [],
  apply,
  showMe,
  close,
}: {
  at: At;
  skill: Skill;
  tools?: ToolInfo[];
  apply(edits: EditInput[]): Promise<unknown>;
  // Show me (R4.7): start a recording of one part, to come back here as a block at this spot.
  showMe?(name: string, at: At): Promise<unknown>;
  close(): void;
}) {
  const [kind, setKind] = useState<Kind | Marker>();
  const [form, setForm] = useState<Record<string, string>>({ output: "text", pick: "newest" });
  const [problem, setProblem] = useState<string>();
  const field = (name: string, label: string, hint?: string, wide = false) => (
    <label className={`field${wide ? " wide" : ""}`} htmlFor={`add-${name}`}>
      <span>{label}</span>
      {wide ? (
        <textarea
          id={`add-${name}`}
          value={form[name] ?? ""}
          onChange={(e) => setForm({ ...form, [name]: e.target.value })}
          rows={3}
        />
      ) : (
        <input
          id={`add-${name}`}
          value={form[name] ?? ""}
          onChange={(e) => setForm({ ...form, [name]: e.target.value })}
        />
      )}
      {hint ? <span className="muted small">{hint}</span> : null}
    </label>
  );
  const choose = (name: string, label: string, options: string[]) => (
    <label className="field">
      <span>{label}</span>
      <select value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
  // The App action's arguments, one field each (R4.4); a document argument offers the ones this workflow opens.
  const appFields = (tool: ToolInfo | undefined) => {
    if (!tool) return null;
    if (!tool.inputSchema?.properties)
      return field("arguments", "Its values (JSON)", '{ "spreadsheet_id": "…" }', true);
    const docs = documentsIn(skill);
    return argumentFields(tool.inputSchema).map((f) => {
      const key = `arg.${f.name}`;
      const label = `${f.name}${f.required ? "" : " (optional)"}`;
      if (f.kind === "choice" || f.kind === "yes/no")
        return (
          <label className="field" key={key}>
            <span>{label}</span>
            <select value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
              <option value="">{f.required ? "Pick one" : "(the app's default)"}</option>
              {(f.kind === "yes/no" ? ["yes", "no"] : (f.choices ?? [])).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        );
      if (f.kind === "document" && docs.length > 0)
        return (
          <label className="field" key={key}>
            <span>{label}</span>
            <select value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
              <option value="">Pick a document</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        );
      const hint =
        f.kind === "rows"
          ? "one row per line, cells split by | : {{today}} | {{job.title}}"
          : f.kind === "json"
            ? "JSON"
            : f.hint;
      return <span key={key}>{field(key, label, hint, f.kind === "rows" || f.kind === "json")}</span>;
    });
  };
  const submit = async () => {
    if (!kind) return;
    if (kind === "show") {
      const name = (form.name ?? "").trim();
      if (!name) return setProblem("say what this part does, for its block's name");
      try {
        await showMe?.(name, at);
      } catch (e) {
        setProblem((e as Error).message);
      }
      return;
    }
    const edits = editsFor(kind, form, at, skill, tools);
    if (typeof edits === "string") return setProblem(edits);
    setProblem(undefined);
    try {
      await apply(edits);
      close();
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  const where = "after" in at ? "after the step you picked" : "before" in at ? "before it" : "inside it";
  return (
    <div className="inspector-body">
      <div className="inspector-head">
        <strong>{kind ? KINDS.find((k) => k.kind === kind)?.title : "Add a step"}</strong>
        <button type="button" className="inspector-close" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      {!kind ? (
        <>
          <p className="muted small">It goes {where}.</p>
          <div className="node-kinds">
            {KINDS.filter((k) => (k.kind !== "app" || tools.length > 0) && (k.kind !== "show" || showMe)).map((k) => (
              <button key={k.kind} type="button" className="node-kind" onClick={() => setKind(k.kind)}>
                <strong>{k.title}</strong>
                <span className="muted small">{k.about}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <form
          className="node-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {kind === "open" ? field("url", "Address", "https://…") : null}
          {kind === "ask" ? (
            <>
              {field("question", "What to ask", "for example: Which month is this for?")}
              {choose("answer", "Answered with", ["a value", "yes/no"])}
              {form.answer === "yes/no" ? null : field("name", "Save the answer as", "a short name, for later steps")}
            </>
          ) : null}
          {kind === "show" ? (
            <>
              {field("name", "What does this part do?", "its block's name: Fill in the order form")}
              <p className="muted small">
                Shadow starts recording: do it once in Chrome, then press Stop. It comes back here as a block in the
                draft, to look at and save.
              </p>
            </>
          ) : null}
          {kind === "approve" ? (
            <p className="muted small">The step after this spot will wait for your OK before it runs, every time.</p>
          ) : null}
          {kind === "click" ? (
            <>
              {field("name", "The words on it", "as they read on the page: Submit, Next, the link's text")}
              {choose("role", "It is a", ["", "button", "link", "menuitem", "tab", "checkbox"])}
            </>
          ) : null}
          {kind === "type" ? (
            <>
              {field("label", "The box's label")}
              {field("text", "What to type", "{{name}} types a value an earlier step saved; {{today}} today's date")}
            </>
          ) : null}
          {kind === "read" ? (
            <>
              {field("css", "Which part (optional)", "a CSS selector such as h1; empty reads the whole page")}
              {field("save_as", "Save it as", "a name later steps use: {{its name}}")}
            </>
          ) : null}
          {kind === "ai" ? (
            <>
              {field("instruction", "What should it work out?", "e.g. the first 5 jobs in the list's order", true)}
              {field(
                "reads",
                "It reads",
                `what earlier steps saved: ${variablesIn(skill).join(", ") || "nothing yet: add a Read first"}`,
              )}
              {choose("output", "It makes", ["text", "list", "number", "yes/no"])}
              {field("save_as", "Save it as")}
            </>
          ) : null}
          {kind === "files" ? (
            <>
              {field("dir", "Folder", "~/Downloads")}
              {field("glob", "Which files", "*.pdf (empty: all)")}
              {choose("pick", "Take", ["newest", "all"])}
              {field("save_as", "Save it as", "found")}
            </>
          ) : null}
          {kind === "app" ? (
            <>
              <label className="field">
                <span>Action</span>
                <select value={form.tool ?? ""} onChange={(e) => setForm({ ...form, tool: e.target.value })}>
                  <option value="">Pick one</option>
                  {tools.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name.toLowerCase().replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              {appFields(tools.find((t) => t.name === form.tool))}
              {field("save_as", "Save its answer as (optional)")}
            </>
          ) : null}
          {problem ? <p className="error">{problem}</p> : null}
          <div className="row">
            <button type="button" className="button" onClick={() => setKind(undefined)}>
              Back
            </button>
            <button type="submit" className="button primary">
              {kind === "show" ? "Start recording" : "Add"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
