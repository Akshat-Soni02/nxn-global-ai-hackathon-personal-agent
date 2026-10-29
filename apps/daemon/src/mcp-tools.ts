// Connected apps for the daemon: an MCP client to shadow-api's per-user endpoint (POST /v1/tools/mcp), which offers
// the tools of the apps the user connected (through Composio). `mcp` steps run through `call`; the design agent and
// the editor read `list`. A tool's MCP annotations decide whether a step that calls it needs approval: only a tool
// marked readOnlyHint (and not destructiveHint) runs without asking.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isAction, type Skill, walkSteps, webPages } from "@shadow/core";
import type { ChannelExecutor } from "@shadow/player";
import { APPS, appOf, documentIdOf, type UsableApp } from "@shadow/recorder";

export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  toolkit?: string;
  readOnly: boolean;
  destructive: boolean;
}

export interface McpCallResult {
  ok: boolean;
  // The tool's structured result, else its text parsed as JSON when it is JSON, else the text.
  value?: unknown;
  error?: string;
}

export interface McpTools {
  list(refresh?: boolean): Promise<McpTool[]>;
  find(name: string): Promise<McpTool | undefined>;
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal, timeoutMs?: number): Promise<McpCallResult>;
  // Connecting or disconnecting an app changes the list.
  invalidate(): void;
}

// The list is asked for again after this long, or after invalidate().
const LIST_TTL_MS = 5 * 60 * 1000;

export function mcpTools(url: string, authedFetch: typeof fetch, now: () => number = Date.now): McpTools {
  let cached: { at: number; tools: McpTool[] } | undefined;

  // The endpoint is stateless, so one short-lived client per use keeps nothing to go stale.
  async function withClient<T>(use: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ name: "shadow-daemon", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: authedFetch }));
    try {
      return await use(client);
    } finally {
      await client.close().catch(() => {});
    }
  }

  async function list(refresh = false): Promise<McpTool[]> {
    if (!refresh && cached && now() - cached.at < LIST_TTL_MS) return cached.tools;
    const tools = await withClient(async (client) => {
      const all = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : {});
        all.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      return all;
    });
    const mapped = tools.map(
      (t): McpTool => ({
        name: t.name,
        title: t.title ?? t.annotations?.title,
        description: t.description ?? "",
        inputSchema: t.inputSchema as Record<string, unknown>,
        toolkit: typeof t._meta?.toolkit === "string" ? t._meta.toolkit : undefined,
        readOnly: t.annotations?.readOnlyHint === true,
        destructive: t.annotations?.destructiveHint === true,
      }),
    );
    cached = { at: now(), tools: mapped };
    return mapped;
  }

  return {
    list,
    async find(name) {
      const hit = (await list()).find((t) => t.name === name);
      return hit ?? (await list(true)).find((t) => t.name === name);
    },
    async call(name, args, signal, timeoutMs) {
      try {
        const result = await withClient((client) =>
          client.callTool({ name, arguments: args }, undefined, {
            ...(signal ? { signal } : {}),
            ...(timeoutMs ? { timeout: timeoutMs } : {}),
          }),
        );
        const text = (Array.isArray(result.content) ? result.content : [])
          .filter((c): c is { type: "text"; text: string } => c?.type === "text")
          .map((c) => c.text)
          .join("\n");
        if (result.isError) return { ok: false, error: text || "the tool failed" };
        if (result.structuredContent !== undefined) return { ok: true, value: result.structuredContent };
        try {
          return { ok: true, value: JSON.parse(text) };
        } catch {
          return { ok: true, value: text };
        }
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
    invalidate() {
      cached = undefined;
    },
  };
}

// The tools repair's briefing lists (core's ConnectedTool). It was never given any, so it said "Connected apps: none
// (don't write mcp.call steps)" and could not switch a step to an app's tool. Signed out or the service down: none.
export async function connectedToolsOf(
  tools: McpTools | undefined,
): Promise<{ name: string; description: string; readOnly: boolean }[]> {
  return (await listedToolsOf(tools)).map((t) => ({
    name: t.name,
    description: t.description,
    readOnly: t.readOnly && !t.destructive,
  }));
}

// Every tool the connected apps offer, or none (signed out, service down). The list is cached: one call at most.
export async function listedToolsOf(tools: McpTools | undefined): Promise<McpTool[]> {
  if (!tools) return [];
  try {
    return await tools.list();
  } catch {
    return [];
  }
}

// One tool's arguments, for repair's `app_tool` look (the designer has the same): without it repair guessed them, built
// a step to find the end of a document the tool doesn't need, and ran out of turns. A wrong name gets the right ones.
export function describeAppTool(tools: McpTool[], name: string): string {
  const found = tools.find((t) => t.name === name);
  if (!found)
    return `no app tool ${name}. The tools: ${tools.map((t) => t.name).join(", ") || "none (no app connected)"}`;
  return JSON.stringify({
    name: found.name,
    description: found.description,
    reads_only: found.readOnly && !found.destructive,
    arguments: found.inputSchema,
  });
}

// The connected app that covers a page, for app-first repair (player/repair/app-first.ts): the page-to-app table's row
// for its address, with that app's tools. None when no app covers it or it isn't connected.
export function coveringApp(
  tools: McpTool[],
  url: string,
):
  | {
      name: string;
      tools: { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }[];
    }
  | undefined {
  const app = appOf(url);
  const own = app ? tools.filter((t) => t.toolkit === app.toolkit) : [];
  if (!app || own.length === 0) return undefined;
  return {
    name: app.name,
    tools: own.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      readOnly: t.readOnly && !t.destructive,
    })),
  };
}

// The connected apps a workflow's pages are in, as the design gets them (the chat box, R6.1): each with the steps that
// open its pages and the document each one opens, so the agent can write an app step's document as <id:s4>.
export function appsOfWorkflow(skill: Skill, tools: McpTool[]): UsableApp[] {
  const apps = new Map<string, UsableApp>();
  for (const { step } of walkSteps(skill.steps)) {
    if (!isAction(step) || step.channel !== "web" || step.action !== "navigate") continue;
    const url = String(step.args.url ?? "");
    const app = appOf(url);
    const own = app ? tools.filter((t) => t.toolkit === app.toolkit) : [];
    if (!app || own.length === 0) continue;
    const found = apps.get(app.toolkit) ?? {
      toolkit: app.toolkit,
      name: app.name,
      why: app.why,
      steps: [],
      ids: {},
      tools: own.map((t) => ({ ...t, toolkit: t.toolkit ?? app.toolkit })),
    };
    found.steps.push(step.id);
    const doc = documentIdOf(url);
    if (doc) found.ids[step.id] = doc;
    apps.set(app.toolkit, found);
  }
  return [...apps.values()];
}

// Whether a step calling this tool must ask first. Unknown tools ask.
export function toolNeedsApproval(tool: McpTool | undefined): boolean {
  return !tool?.readOnly || tool.destructive;
}

// The player's mcp channel: one tool call, its arguments already resolved by the player.
export function mcpChannel(tools: McpTools): ChannelExecutor {
  return async (step, ctx) => {
    const args = (step.args.arguments ?? {}) as Record<string, unknown>;
    // Stop ends the call; a step without its own limit gets 2 minutes, not the SDK's 60 s: a slow write that did
    // finish would show as failed, and a retry could write it twice.
    const result = await tools.call(String(step.args.tool), args, ctx.signal, step.timeout_ms ?? 120_000);
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
  };
}

// What a run that stopped before step 1 for want of a connected app says first. Such a stop is nobody's failure and
// costs nothing: it doesn't count toward the three failed runs that pause a workflow (service.ts autoPause).
export const NEEDS_APP = "needs an app: ";

// The app a NEEDS_APP stop says to connect ("connect Google Sheets in Apps", "connect googlesheets in Apps"), by the
// page-to-app table, so the inbox card can show its Connect button (A2).
export function appToConnect(error: string): { toolkit: string; name: string } | undefined {
  const named = /connect (.+?) in Apps/.exec(error)?.[1]?.trim().toLowerCase();
  const app = named ? APPS.find((a) => a.name.toLowerCase() === named || a.toolkit === named) : undefined;
  return app ? { toolkit: app.toolkit, name: app.name } : undefined;
}

// The first step that typed into a drawn area (a sheet's cells, `drawn`) and the app that covers the page it worked on:
// the page is the last address a step opened in its tab. Replay can't reach such a step, so only an app can do it (A2).
function drawnStep(skill: Skill): { id: string; app?: { toolkit: string; name: string }; host: string } | undefined {
  for (const { step, url } of webPages(skill.steps)) {
    if (!step.drawn) continue;
    let host = "this site";
    try {
      host = new URL(url ?? "").host || host;
    } catch {}
    return { id: step.id, app: appOf(url), host };
  }
  return undefined;
}

// Before a run: every mcp step's tool must be offered (its app connected), and a tool that changes things asks first
// even if the step was saved without approval (approval is only ever added here, never removed). Undefined tools:
// the user isn't signed in, so a workflow with mcp steps can't run. A step in a drawn area (a sheet's cells) can't run on
// the page at all: stopped here too, before any step has done anything, with what to do about it.
export async function prepareMcpSteps(
  skill: Skill,
  tools: McpTools | undefined,
): Promise<{ skill: Skill; error?: string }> {
  const drawn = drawnStep(skill);
  if (drawn) {
    const where = drawn.app ? `a drawn area of ${drawn.app.name}` : `a drawn area of ${drawn.host}`;
    const lead = `${NEEDS_APP}step ${drawn.id} works in ${where}, which replay can't reach`;
    if (!drawn.app) return { skill, error: `${lead}, and no connected app covers ${drawn.host}` };
    if (!tools)
      return {
        skill,
        error: `${lead}: sign in to Shadow in Settings, connect ${drawn.app.name} in Apps, then run it again`,
      };
    let offered: McpTool[] = [];
    try {
      offered = await tools.list(true);
    } catch {}
    return {
      skill,
      error: offered.some((t) => t.toolkit === drawn.app?.toolkit)
        ? `${lead}: this workflow should use the app's own tool, not the page (Edit it, or record it again)`
        : `${lead}: connect ${drawn.app.name} in Apps, then run it again`,
    };
  }
  const steps = [...walkSteps(skill.steps)].map(({ step }) => step).filter((s) => isAction(s) && s.channel === "mcp");
  if (steps.length === 0) return { skill };
  if (!tools)
    return { skill, error: `${NEEDS_APP}this workflow uses a connected app: sign in to Shadow in Settings first` };
  const copy = structuredClone(skill);
  let offered: McpTool[];
  try {
    offered = await tools.list(true);
  } catch (error) {
    return { skill, error: `Shadow's service could not list your connected apps: ${(error as Error).message}` };
  }
  for (const { step } of walkSteps(copy.steps)) {
    if (!isAction(step) || step.channel !== "mcp") continue;
    const name = String(step.args.tool);
    const tool = offered.find((t) => t.name === name);
    if (!tool) {
      const app = name.split("_")[0]?.toLowerCase() ?? name;
      return { skill, error: `${NEEDS_APP}step ${step.id} uses ${name}: connect ${app} in Apps first` };
    }
    if (toolNeedsApproval(tool)) step.requires_approval = true;
  }
  return { skill: copy };
}
