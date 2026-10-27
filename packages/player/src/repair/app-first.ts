// App-first repair (A3): a page step that fails on a page a connected app covers (a sheet's cells, a document) is moved
// to that app's own tool. Code finds the app and builds the step; the model answers one narrow question, which tool
// with which arguments. Four live repair runs (27 Oct) showed the agent can write the right app step but doesn't
// reliably choose to (one run looked at the page nine times and handed over): here it isn't the model's choice.
import { applyEdits, type EditInput, findStep, isAction, repairCheck, type Skill, webPages } from "@shadow/core";
import type { Llm, UsageMeter } from "@shadow/llm";
import type { Failure } from "../types.ts";

// The connected app that covers a page, with its tools as the daemon lists them.
export interface CoveringApp {
  name: string;
  tools: { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }[];
}

const QUESTION = `A step of a saved workflow failed on a web page that a connected app covers. Choose the one tool of that
app that does the step's work directly, and its arguments.
- Use only the argument names in the tool's schema, and give every required one.
- Keep {{…}} values exactly as the step writes them: code fills them in when it runs.
- A document's id is in the page's address (between /d/ and /edit).
Reply with JSON only: {"tool": "NAME", "arguments": { … }}, or {"tool": null} when no listed tool does this work.`;

// The tools worth showing for this step: writes first, never one that deletes or clears.
const WRITES = /APPEND|UPDATE|WRITE|INSERT|ADD|CREATE|SEND|REPLY|POST|UPSERT/;
const RISKY = /DELETE|CLEAR|REMOVE|TRASH|EMPTY|DROP/;

export async function appFirst(
  skill: Skill,
  failure: Failure,
  appFor: (url: string) => CoveringApp | undefined,
  llm: Llm,
  options: { meter?: UsageMeter; signal?: AbortSignal } = {},
): Promise<{ draft: Skill; summary: string; edits: EditInput[] } | undefined> {
  const original = findStep(skill, failure.stepId);
  // A step that saves a value is left to the agent: the app's answer has another shape than what later steps read.
  if (!original || !isAction(original) || original.channel !== "web" || original.output) return undefined;
  const url = [...webPages(skill.steps)].find(({ step }) => step.id === original.id)?.url;
  const app = url ? appFor(url) : undefined;
  if (!app || app.tools.length === 0) return undefined;
  const tools = [...app.tools]
    .filter((t) => !RISKY.test(t.name))
    .sort((a, b) => Number(WRITES.test(b.name)) - Number(WRITES.test(a.name)))
    .slice(0, 12);

  let reply: unknown;
  try {
    const answer = await llm.generate({
      profile: "smart",
      system: QUESTION,
      maxTokens: 2_000,
      json: true,
      meter: options.meter,
      signal: options.signal,
      user: JSON.stringify(
        {
          step: { id: original.id, intent: original.intent, action: original.action, values: original.args },
          page: url,
          values_it_can_use: Object.keys(failure.vars).map((name) => `{{${name}}}`),
          error: failure.result.error,
          app: app.name,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description.slice(0, 200),
            arguments: t.inputSchema,
          })),
        },
        null,
        1,
      ),
    });
    reply = answer.value;
  } catch {
    // A failed question costs the run nothing more: the agent takes it from here.
    return undefined;
  }
  const chosen = reply as { tool?: unknown; arguments?: unknown } | undefined;
  const tool = tools.find((t) => t.name === chosen?.tool);
  if (!tool || !chosen?.arguments || typeof chosen.arguments !== "object" || Array.isArray(chosen.arguments))
    return undefined;
  const args = fitted(tool.inputSchema, chosen.arguments as Record<string, unknown>);
  if (!args) return undefined;

  const step = {
    id: original.id,
    type: "action",
    intent: `${original.intent} (in ${app.name})`,
    channel: "mcp",
    action: "call",
    requires_approval: !tool.readOnly,
    args: { tool: tool.name, arguments: args },
  };
  const edits: EditInput[] = [{ op: "replace", step: original.id, with: step as never }];
  const result = applyEdits(skill, edits);
  if (!result.ok || repairCheck(skill, result.skill).never.length > 0) return undefined;
  return {
    draft: result.skill,
    summary: `${original.id} can't be done on the page: done in ${app.name} directly with ${tool.name}`,
    edits,
  };
}

// The arguments in the schema's own spelling (spreadsheet_id for spreadsheetId), a single row as the list of rows, and
// every required one present; undefined when they can't run.
function fitted(schema: Record<string, unknown>, given: Record<string, unknown>): Record<string, unknown> | undefined {
  const props = (schema.properties ?? {}) as Record<string, { type?: unknown; items?: { type?: unknown } }>;
  const names = Object.keys(props);
  const flat = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(given)) {
    const name = key in props ? key : names.find((n) => flat(n) === flat(key) && !(n in given));
    if (!name) {
      if (names.length > 0) return undefined;
      args[key] = value;
      continue;
    }
    const rows = props[name]?.type === "array" && props[name]?.items?.type === "array";
    args[name] = rows && Array.isArray(value) && value.length > 0 && !value.some(Array.isArray) ? [value] : value;
  }
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  return required.every((k) => args[k] !== undefined && args[k] !== "") ? args : undefined;
}
