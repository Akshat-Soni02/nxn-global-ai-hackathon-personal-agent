// "+" in the editor (reports/plan-oct26-workflow-revamp.md, R4): add a step of a kind, with a short form for what it
// needs. The form makes the step itself and the daemon inserts it into the draft as any edit (checked like the agent's:
// a step that can't run, or a value nothing saves yet, is refused with the reason). Loops and ifs hold steps, so they
// are made by wrapping steps already there (the step's panel), not added empty here.
import type { Skill } from "@shadow/core";
import { walkSteps } from "@shadow/core";
import { useState } from "react";
import type { At } from "./WorkflowTree.tsx";

export type Kind = "open" | "click" | "type" | "read" | "ai" | "files" | "app";
// A step as an insert edit takes it: the daemon gives it an id and checks it.
export type NewStep = Record<string, unknown>;

const KINDS: { kind: Kind; title: string; about: string }[] = [
  { kind: "open", title: "Open a page", about: "Go to an address in the browser" },
  { kind: "click", title: "Click on a page", about: "A button or link, by its words" },
  { kind: "type", title: "Type on a page", about: "Into a box, by its label" },
  { kind: "read", title: "Read from a page", about: "The page, or one part of it, saved for later steps" },
  { kind: "ai", title: "AI step", about: "Work something out from what earlier steps read" },
  { kind: "files", title: "Find files", about: "In a folder on your Mac" },
  { kind: "app", title: "App action", about: "Something a connected app does directly" },
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

// The step a form makes, or why it can't yet.
export function stepOf(kind: Kind, f: Record<string, string>): NewStep | string {
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
      let args: unknown;
      try {
        args = JSON.parse(text("arguments") || "{}");
      } catch {
        return 'its values are JSON: { "name": "value" }';
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

export function AddNode({
  at,
  skill,
  tools = [],
  add,
  close,
}: {
  at: At;
  skill: Skill;
  tools?: { name: string; description: string }[];
  add(step: NewStep): Promise<unknown>;
  close(): void;
}) {
  const [kind, setKind] = useState<Kind>();
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
  const submit = async () => {
    if (!kind) return;
    const step = stepOf(kind, form);
    if (typeof step === "string") return setProblem(step);
    setProblem(undefined);
    try {
      await add(step);
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
            {KINDS.filter((k) => k.kind !== "app" || tools.length > 0).map((k) => (
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
              {field("arguments", "Its values (JSON)", '{ "spreadsheet_id": "…" }', true)}
              {field("save_as", "Save its answer as (optional)")}
            </>
          ) : null}
          {problem ? <p className="error">{problem}</p> : null}
          <div className="row">
            <button type="button" className="button" onClick={() => setKind(undefined)}>
              Back
            </button>
            <button type="submit" className="button primary">
              Add
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
