// Connected apps during a design (reports/review-oct25-record-mcp.md, §1). Code, not the model, sees where a recording
// worked inside an app Shadow can reach directly (Google Sheets, Gmail…: by the pages its steps acted in) and asks the
// user once, before planning, whether to use that app directly. The question carries the button to sign in and connect
// (the daemon's `offer`); finishing in the browser answers it. Yes: the agent gets that app's tools and builds app steps
// ({ channel: "mcp" }) instead of the clicks into its page. No: it builds the classic way, and the app isn't offered again.
import { classOf, type StepClass } from "../../evidence/classes.ts";
import type { NormalisedStep } from "../../normalise.ts";

// An app a workflow can use directly, by the pages it lives on. The toolkit is Composio's slug.
export interface App {
  toolkit: string;
  name: string;
  // Why using it directly is better than clicking: said in the question.
  why: string;
  // How the app's tools want things written, told to the design agent with its tools (28 Oct: the YC design looked up
  // the sheet's tab names and asked an AI step for the first, where a range with no tab name is the first tab).
  notes?: string;
  pages: (url: URL) => boolean;
}

export const APPS: App[] = [
  {
    toolkit: "googlesheets",
    name: "Google Sheets",
    why: "it writes and reads cells directly, so it keeps working when the sheet's layout or size changes",
    notes:
      'a range with no tab name ("A:C") is the first tab, so no step is needed to learn tab names; rows read come back as lists of cells ([["Acme (S21)", "Engineer"]]) and are written the same way, one list per row',
    pages: (u) => u.hostname === "docs.google.com" && u.pathname.startsWith("/spreadsheets"),
  },
  {
    toolkit: "googledocs",
    name: "Google Docs",
    why: "it writes into the document directly, without clicking through the editor",
    pages: (u) => u.hostname === "docs.google.com" && u.pathname.startsWith("/document"),
  },
  {
    toolkit: "gmail",
    name: "Gmail",
    why: "it reads, sends and labels emails directly, so it doesn't depend on the inbox's layout",
    pages: (u) => u.hostname === "mail.google.com",
  },
  {
    toolkit: "googledrive",
    name: "Google Drive",
    why: "it finds, uploads and moves files directly",
    pages: (u) => u.hostname === "drive.google.com",
  },
  {
    toolkit: "googlecalendar",
    name: "Google Calendar",
    why: "it reads and makes events directly",
    pages: (u) => u.hostname === "calendar.google.com",
  },
  {
    toolkit: "slack",
    name: "Slack",
    why: "it posts and reads messages directly",
    pages: (u) => u.hostname === "app.slack.com" || u.hostname.endsWith(".slack.com"),
  },
  {
    toolkit: "notion",
    name: "Notion",
    why: "it writes pages and database rows directly",
    pages: (u) => u.hostname === "www.notion.so" || u.hostname === "notion.so" || u.hostname.endsWith(".notion.site"),
  },
  {
    toolkit: "github",
    name: "GitHub",
    why: "it reads and writes issues and pull requests directly",
    pages: (u) => u.hostname === "github.com",
  },
];

export function appOf(url: string | undefined): App | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  return APPS.find((app) => app.pages(parsed));
}

// Where an app could do the recording's work: the steps (by draft id) that acted inside it. Only work counts: typing,
// pasting, pressing or sending (`act`) and copying (`read`). Getting somewhere never does (Oct 25: clicking Drive's
// "Recent" and opening a file from it offered Drive for a task that only worked in a sheet).
export interface ConnectorChance {
  toolkit: string;
  name: string;
  why: string;
  steps: string[];
  // The document each step worked in, by step id (a sheet's or a doc's id, read from its address by code): the agent
  // reads masked addresses, so it writes "<id:s4>" and code puts the real id in.
  ids: Record<string, string>;
  // What the recording did there: wrote (typed, pasted, sent) and/or read (copied). Picks the tools worth listing.
  work?: { writes: boolean; reads: boolean };
}

const WORK = new Set<StepClass>(["act", "read"]);

// A document's id in its address: docs.google.com/spreadsheets/d/<id>/…, /document/d/<id>/…
export function documentIdOf(url: string | undefined): string | undefined {
  return url
    ? /docs\.google\.com\/(?:spreadsheets|document|presentation)\/d\/([A-Za-z0-9_-]{10,})/.exec(url)?.[1]
    : undefined;
}

export function connectorChances(steps: NormalisedStep[], idsByStep: string[][]): ConnectorChance[] {
  const found = new Map<string, ConnectorChance>();
  steps.forEach((step, i) => {
    const kind = classOf(step);
    if (!WORK.has(kind)) return;
    const app = appOf(step.url);
    const id = idsByStep[i]?.[0];
    if (!app || !id) return;
    const chance = found.get(app.toolkit) ?? {
      toolkit: app.toolkit,
      name: app.name,
      why: app.why,
      steps: [],
      ids: {},
      work: { writes: false, reads: false },
    };
    chance.steps.push(id);
    if (chance.work) {
      if (kind === "act") chance.work.writes = true;
      else chance.work.reads = true;
    }
    const doc = documentIdOf(step.url);
    if (doc) chance.ids[id] = doc;
    found.set(app.toolkit, chance);
  });
  return [...found.values()];
}

// "<id:s4>" anywhere in an app step's arguments → the id of the document s4 worked in. Unknown names are an error.
export function withIds(
  value: unknown,
  apps: UsableApp[],
): { ok: true; value: unknown } | { ok: false; error: string } {
  const ids = Object.assign({}, ...apps.map((a) => a.ids)) as Record<string, string>;
  let error: string | undefined;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      return v.replace(/<id:([^>]+)>/g, (whole, name: string) => {
        const real = ids[name.trim()];
        if (!real)
          error = `${whole}: no document id for ${name}. Known: ${
            Object.keys(ids)
              .map((k) => `<id:${k}>`)
              .join(", ") || "none"
          }`;
        return real ?? whole;
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(value);
  return error ? { ok: false, error } : { ok: true, value: out };
}

// One tool of a connected app, as the agent is shown it.
export interface AppTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  toolkit?: string;
  readOnly: boolean;
  destructive: boolean;
}

// What the daemon gives the design for connected apps. Absent: no service, nothing is offered (classic design).
export interface Connectors {
  // Which apps are connected now, and which the user said not to use.
  status(): Promise<{ connected: string[]; declined: string[] }>;
  // Asks the user, with the button to sign in and connect; resolves once they connected it, or chose to keep clicking.
  offer(chance: ConnectorChance): Promise<"connected" | "classic">;
  // The user kept clicking: not offered again (Settings can undo it).
  decline(toolkit: string): void;
  // The tools of a connected app.
  tools(toolkit: string): Promise<AppTool[]>;
}

// A connected app the design uses, with its tools and the recorded steps it can replace.
export interface UsableApp extends ConnectorChance {
  tools: AppTool[];
}

// At most this many tools of one app are listed in the build message (Gmail and Sheets have 40–60 and Drive 80); the
// rest by look. Oct 25: all of them, a 160-character line each, made a 27 k-character message the agent never read, so
// the list was cut to 8, which hid the tool a task needed (the Sheets one for a cell). 40 lines of about 100 characters
// keep the message small and the list wide.
export const LISTED_TOOLS = 40;

const WRITES = /APPEND|UPDATE|WRITE|INSERT|ADD|CREATE|SEND|REPLY|POST|UPSERT/;
const READS = /GET|READ|LOOKUP|SEARCH|FIND|LIST|FETCH|VALUES/;
const RISKY = /DELETE|CLEAR|REMOVE|TRASH|EMPTY|DROP/;

// The tools that fit what the recording did there: writes favour append / update, reads favour get / search; never a
// tool that deletes or clears unless nothing else fits. Plain names first (a toolkit's main tools are its short ones).
export function shortlist(app: Pick<UsableApp, "tools" | "work">, n = LISTED_TOOLS): AppTool[] {
  const writes = app.work?.writes ?? true;
  const reads = app.work?.reads ?? true;
  const score = (t: AppTool) =>
    (writes && WRITES.test(t.name) ? 3 : 0) +
    (reads && READS.test(t.name) ? 2 : 0) +
    (t.readOnly && reads ? 1 : 0) -
    (RISKY.test(t.name) || t.destructive ? 5 : 0) -
    t.name.length / 100;
  return [...app.tools].sort((a, b) => score(b) - score(a)).slice(0, n);
}

// The build message's section about the connected apps.
export function appsSection(apps: UsableApp[]): string[] {
  if (apps.length === 0) return [];
  const lines = ["# Connected apps: use them directly (an app step) instead of clicking through their pages"];
  for (const app of apps) {
    lines.push(`## ${app.name} (the recording worked in it at ${app.steps.join(", ")})`);
    // What the app's own rules are (its row in APPS): how its ranges and rows are written.
    const notes = APPS.find((a) => a.toolkit === app.toolkit)?.notes;
    if (notes) lines.push(`How it works: ${notes}`);
    // One line per document, by the first step that worked in it (s9…s33 all in one sheet are one document).
    const docs = new Map<string, string>();
    for (const [step, doc] of Object.entries(app.ids)) if (!docs.has(doc)) docs.set(doc, step);
    if (docs.size > 0)
      lines.push(
        `The document${docs.size > 1 ? "s" : ""} it worked in, as you write the id in arguments: ${[...docs.values()].map((s) => `<id:${s}>`).join(", ")} (code puts the real id in)`,
      );
    const listed = shortlist(app);
    for (const tool of listed) {
      const line = tool.description.split("\n")[0]?.slice(0, 100) ?? "";
      lines.push(`- ${tool.name}${tool.readOnly ? " (reads only)" : ""}: ${line}`);
    }
    if (app.tools.length > listed.length)
      lines.push(`- …${app.tools.length - listed.length} more: look { app_tools: "${app.toolkit}" } lists them all`);
  }
  lines.push(
    'Add one with add { do: "app", tool, arguments: {…}, intent, save_as? }; look { app_tool } gives a tool\'s arguments first.',
  );
  return [...lines, ""];
}

export const readOnlyTools = (apps: UsableApp[]): Set<string> =>
  new Set(apps.flatMap((a) => a.tools.filter((t) => t.readOnly && !t.destructive).map((t) => t.name)));

// What the agent sent, in the spelling and shape the tool's schema uses. Code settles what code can (28 Oct, the YC
// design: spreadsheet_id for the tool that says spreadsheetId, a row where a list of rows goes; refused five times, it
// gave up): a name that differs only in case or underscores is the tool's own, a single row becomes the list of rows,
// and an argument the tool doesn't have is named with the ones it does.
export function fitArguments(
  tool: AppTool,
  given: Record<string, unknown>,
): { args: Record<string, unknown>; notes: string[]; problems: string[] } {
  const props = (tool.inputSchema.properties ?? {}) as Record<string, { type?: unknown; items?: { type?: unknown } }>;
  const names = Object.keys(props);
  if (names.length === 0 || tool.inputSchema.additionalProperties === true)
    return { args: given, notes: [], problems: [] };
  const flat = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  const args: Record<string, unknown> = {};
  const notes: string[] = [];
  const problems: string[] = [];
  for (const [key, value] of Object.entries(given)) {
    let name = key;
    if (!(key in props)) {
      const same = names.find((n) => flat(n) === flat(key) && !(n in given));
      if (!same) {
        problems.push(`${key} is not an argument of ${tool.name}: its arguments are ${names.join(", ")}`);
        continue;
      }
      name = same;
      notes.push(`${key} is ${same} in ${tool.name}`);
    }
    const rows = props[name]?.type === "array" && props[name]?.items?.type === "array";
    // Rows are a list of rows of cells: one row is wrapped, and rows wrapped once too often are unwrapped (28 Oct, YC →
    // Sheet: [[[date, company, role]]] would have put a list into one cell).
    const tooDeep = (v: unknown[]) => v.every((r) => Array.isArray(r) && r.length > 0 && r.every(Array.isArray));
    if (rows && Array.isArray(value) && value.length > 0 && !value.some(Array.isArray)) {
      args[name] = [value];
      notes.push(`${name}: one row made the list of rows ${tool.name} takes`);
    } else if (rows && Array.isArray(value) && value.length > 0 && tooDeep(value)) {
      args[name] = value.flat(1);
      notes.push(`${name}: rows inside one list too many, made the list of rows ${tool.name} takes`);
    } else args[name] = value;
  }
  return { args, notes, problems };
}

// Rows a tool takes (a list of lists) given a {{list}} whose items are objects, not lists: said at the write, not found at
// the first run (28 Oct, the YC design made its rows an AI step's list of objects). `lists` is each declared list's item
// type, by variable name.
export function rowProblems(
  tool: AppTool,
  args: Record<string, unknown>,
  lists: ReadonlyMap<string, unknown>,
): string[] {
  const props = (tool.inputSchema.properties ?? {}) as Record<string, { type?: unknown; items?: { type?: unknown } }>;
  return Object.entries(args).flatMap(([key, value]) => {
    const wantsRows = props[key]?.type === "array" && props[key]?.items?.type === "array";
    const name = wantsRows && typeof value === "string" ? /^\{\{\s*([\w]+)\s*\}\}$/.exec(value)?.[1] : undefined;
    const item = name ? (lists.get(name) as { type?: string } | undefined) : undefined;
    return name && item && item.type !== "list"
      ? [
          `${key} takes rows (a list of lists) but {{${name}}} is a list of ${item.type ?? "object"}s: make the step that makes it give "list of list" (output: { name: "${name}", type: "list of list" }), one list of cells for each row`,
        ]
      : [];
  });
}

// A missing argument as the agent is told it: its name and what it takes, from the schema (28 Oct: valueInputOption was
// missing three times; the message named it and not that it is one of RAW, USER_ENTERED).
export function describeArgument(tool: AppTool, name: string): string {
  const prop = (
    (tool.inputSchema.properties ?? {}) as Record<
      string,
      { type?: unknown; enum?: unknown; items?: { type?: unknown } }
    >
  )[name];
  if (Array.isArray(prop?.enum)) return `${name} (one of ${prop.enum.join(", ")})`;
  if (prop?.type === "array" && prop.items?.type === "array") return `${name} (a list of rows: [[…], […]])`;
  return typeof prop?.type === "string" ? `${name} (${prop.type})` : name;
}

// What a tool's arguments must hold (its schema's `required`), missing from what the agent sent.
export function missingArguments(tool: AppTool, args: Record<string, unknown>): string[] {
  const required = Array.isArray(tool.inputSchema.required) ? (tool.inputSchema.required as string[]) : [];
  return required.filter((k) => args[k] === undefined || args[k] === "");
}
