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
  pages: (url: URL) => boolean;
}

export const APPS: App[] = [
  {
    toolkit: "googlesheets",
    name: "Google Sheets",
    why: "it writes and reads cells directly, so it keeps working when the sheet's layout or size changes",
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
    if (!WORK.has(classOf(step))) return;
    const app = appOf(step.url);
    const id = idsByStep[i]?.[0];
    if (!app || !id) return;
    const chance = found.get(app.toolkit) ?? { toolkit: app.toolkit, name: app.name, why: app.why, steps: [], ids: {} };
    chance.steps.push(id);
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

// At most this many tools of one app are listed in the build message (Gmail and Sheets have 40–60); the rest by look.
export const LISTED_TOOLS = 40;

// The build message's section about the connected apps.
export function appsSection(apps: UsableApp[]): string[] {
  if (apps.length === 0) return [];
  const lines = ["# Connected apps: use them directly (an app step) instead of clicking through their pages"];
  for (const app of apps) {
    lines.push(`## ${app.name} (the recording worked in it at ${app.steps.join(", ")})`);
    const docs = Object.keys(app.ids);
    if (docs.length > 0)
      lines.push(
        `The document each step worked in, as you write its id in arguments: ${docs.map((s) => `<id:${s}>`).join(", ")} (code puts the real id in)`,
      );
    for (const tool of app.tools.slice(0, LISTED_TOOLS)) {
      const line = tool.description.split("\n")[0]?.slice(0, 160) ?? "";
      lines.push(`- ${tool.name}${tool.readOnly ? " (reads only)" : ""}: ${line}`);
    }
    if (app.tools.length > LISTED_TOOLS)
      lines.push(`- …${app.tools.length - LISTED_TOOLS} more: look { app_tool: "…" }`);
  }
  lines.push(
    'Add one with add { do: "app", tool, arguments: {…}, intent, save_as? }; look { app_tool } gives a tool\'s arguments first.',
  );
  return [...lines, ""];
}

export const readOnlyTools = (apps: UsableApp[]): Set<string> =>
  new Set(apps.flatMap((a) => a.tools.filter((t) => t.readOnly && !t.destructive).map((t) => t.name)));

// What a tool's arguments must hold (its schema's `required`), missing from what the agent sent.
export function missingArguments(tool: AppTool, args: Record<string, unknown>): string[] {
  const required = Array.isArray(tool.inputSchema.required) ? (tool.inputSchema.required as string[]) : [];
  return required.filter((k) => args[k] === undefined || args[k] === "");
}
