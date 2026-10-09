// The capability briefing: what a workflow can do, generated from this package's code, so an agent's picture of the
// player changes when the code does. It opens every agent episode (repair, design): the kinds of step, the actions
// per channel with their args and outputs, variables and references, the edit operations, and what is available
// right now (extension connected, Task Player.app running, consents given).
import { EDIT_DOCS, STEP_FIELDS } from "./edit.ts";
import { ACTIONS, CHANNELS } from "./skill.ts";
import { SCALAR_TYPES } from "./vars.ts";

export interface ActionDoc {
  args: string;
  // The variable the step may declare as its `output`, when it produces one.
  output?: string;
}

// Every action a workflow may use (vision steps are chosen by the player at run time, never written).
export const ACTION_DOCS: Record<string, ActionDoc> = {
  "web.navigate": { args: "{ url }" },
  "web.click": { args: "{}" },
  "web.type": { args: "{ text, clear?: boolean }  focuses the target, then types key by key" },
  "web.select": { args: "{ option }  the visible option label" },
  "web.press": { args: '{ key }  e.g. "Enter", "Escape"' },
  "web.upload": {
    args: "{ file }  target: the <input type=file>, the control that opens it, or a drop zone; no native dialog",
  },
  "web.drag": { args: "{ to: Locator }  drags the target onto `to`" },
  "web.wait_for": { args: "{}  waits for `check` (or the target) within timeout_ms" },
  "web.extract": {
    args: '{ all?, limit?, each?, join? } (each: a template per element with {{text}} and {{href}}), or { source: "google_sheet" | "table" } for rows',
    output: "text; list of text with all (and no each); list of object for a source",
  },
  "fs.find": {
    args: '{ dir, glob, pick: "newest" | "all", since_run_start? }',
    output: "file; list of file with pick: all",
  },
  "fs.move": { args: '{ from, to }  `to` ending in "/" is a folder', output: "file or list of file" },
  "fs.copy": { args: '{ from, to }  `to` ending in "/" is a folder', output: "file or list of file" },
  "fs.rename": { args: "{ from, to }", output: "file" },
  "fs.read": { args: "{ path }", output: "text" },
  "fs.write": { args: "{ path, content, append? }", output: "file" },
  "script.applescript": { args: "{ source }", output: "text" },
  "script.shortcut": { args: "{ name, input? }", output: "text" },
  "script.shell": { args: "{ command }  allow-listed commands only", output: "text" },
  "data.pick": {
    args: '{ from, where: { Column: value }, column?, pick?: "first" | "last" }  a rule over rows, no model',
    output: "text with column; object (the row) without",
  },
  "ax.open": { args: "{ app, name? }  launches or brings forward a Mac app (bundle id)" },
  "ax.press": { args: '{ button?: "right" }  presses the target' },
  "ax.set_value": { args: "{ text }" },
  "ax.focus": { args: "{}" },
  "ax.menu": { args: '{ app, path: string[] }  e.g. ["File", "Export As…"]' },
  "ax.key": { args: '{ app, key, modifiers?: ("cmd" | "shift" | "option" | "ctrl")[] }' },
};

export interface Availability {
  extension?: boolean;
  macApp?: boolean;
  screenConsent?: boolean;
}

export interface BriefingOptions {
  // What is connected and allowed right now; omitted, the section is left out.
  available?: Availability;
  // Include the edit operations (agents that change a workflow).
  edits?: boolean;
}

export function briefing(options: BriefingOptions = {}): string {
  const out: string[] = [];
  out.push(
    "# What a workflow can do",
    "",
    "A workflow is a tree of steps. steps[0] is the trigger. Every step has an id, an intent (what it is for),",
    "requires_approval, and an optional ask ({ question, kind: value | confirm, output }).",
    "",
    "## Steps",
    "- trigger: when it runs (manual, schedule { cron }, folder_watch { dir, glob? }) and its typed inputs.",
    "- action: { channel, action, target?: Locator, args, wait?: Check, check?: Check, output?, timeout_ms?, on_fail? }.",
    "  Deterministic: one thing done in the browser, a Mac app, files or a script.",
    "- llm: { instruction, inputs: [references], output } transforms data into one typed value. Never drives the UI;",
    "  sees only its inputs; can't produce files or secrets.",
    '- loop (type: control, kind: loop): { over: "{{list}}", item: { name, type }, max_items, on_item_fail: stop | skip, steps }.',
    "- branch (type: control, kind: branch): { if: Condition, steps, else }. Condition: { left, op, right? } with op",
    "  equals | not_equals | contains | greater_than | less_than | exists | not_exists, or { all | any: [..] }, { not }.",
    "",
    "Locator (never coordinates): { role?, name?, label?, text?, near?, attrs?, fallbacks?, framePath? }.",
    "Check: { url_matches?, text_visible?, element_visible?: Locator, file_exists? }.",
    "",
    "## Actions",
  );
  for (const channel of CHANNELS) {
    if (channel === "vision") continue;
    for (const action of ACTIONS[channel]) {
      const doc = ACTION_DOCS[`${channel}.${action}`];
      if (!doc) continue;
      out.push(`- ${channel}.${action} ${doc.args}${doc.output ? `  → output: ${doc.output}` : ""}`);
    }
  }
  out.push(
    "Actions on ax are Mac apps through Accessibility: target role is the AX role, name the title or description.",
    "",
    "## Variables",
    `Types: ${SCALAR_TYPES.join(", ")} (file is { path, name, size, modified }), list { items }, object { fields? }.`,
    "Every value a step reads is a variable declared, with its type, by an earlier step: the trigger's inputs, an",
    "action's or llm step's output { name, type }, an ask's output, or a loop's item (visible only inside the loop).",
    "Names are unique. After a branch, a variable is visible only if both arms produce it with the same type.",
    "References: {{name}}, {{name.field}}, {{name.0}}; {{today}} is built in (YYYY-MM-DD). A string that is exactly",
    "one reference keeps the value's type; inside longer text it becomes text.",
  );
  if (options.edits) {
    out.push(
      "",
      "## Edit operations",
      "Position: { before: id } | { after: id } | { into: id, arm?: steps | else, at?: start | end }.",
    );
    for (const doc of Object.values(EDIT_DOCS)) out.push(`- ${doc}`);
    out.push("Fields `set` may change:");
    for (const [kind, fields] of Object.entries(STEP_FIELDS)) out.push(`- ${kind}: ${fields.join(", ")}`);
    out.push("Every edit is checked: the workflow must still parse and every reference must resolve.");
  }
  if (options.available) {
    const a = options.available;
    const yes = (on: boolean | undefined, what: string, off: string) => `- ${what}: ${on ? "yes" : `no (${off})`}`;
    out.push(
      "",
      "## Available now",
      yes(a.extension, "Chrome extension connected", "web steps can't run or be tried"),
      yes(a.macApp, "Task Player.app running", "ax steps can't run or be tried"),
      yes(a.screenConsent, "Screen consent", "no screenshots may be described"),
    );
  }
  return out.join("\n");
}
