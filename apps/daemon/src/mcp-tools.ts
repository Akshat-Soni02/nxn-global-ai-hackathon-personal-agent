// Connected apps for the daemon: an MCP client to shadow-api's per-user endpoint (POST /v1/tools/mcp), which offers
// the tools of the apps the user connected (through Composio). `mcp` steps run through `call`; the design agent and
// the editor read `list`. A tool's MCP annotations decide whether a step that calls it needs approval: only a tool
// marked readOnlyHint (and not destructiveHint) runs without asking.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isAction, type Skill, walkSteps } from "@shadow/core";
import type { ChannelExecutor } from "@shadow/player";

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
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult>;
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
    async call(name, args, signal) {
      try {
        const result = await withClient((client) =>
          client.callTool({ name, arguments: args }, undefined, signal ? { signal } : undefined),
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

// Whether a step calling this tool must ask first. Unknown tools ask.
export function toolNeedsApproval(tool: McpTool | undefined): boolean {
  return !tool || !tool.readOnly || tool.destructive;
}

// The player's mcp channel: one tool call, its arguments already resolved by the player.
export function mcpChannel(tools: McpTools): ChannelExecutor {
  return async (step) => {
    const args = (step.args.arguments ?? {}) as Record<string, unknown>;
    const result = await tools.call(String(step.args.tool), args);
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
  };
}

// Before a run: every mcp step's tool must be offered (its app connected), and a tool that changes things asks first
// even if the step was saved without approval (approval is only ever added here, never removed). Undefined tools:
// the user isn't signed in, so a workflow with mcp steps can't run.
export async function prepareMcpSteps(
  skill: Skill,
  tools: McpTools | undefined,
): Promise<{ skill: Skill; error?: string }> {
  const steps = [...walkSteps(skill.steps)].map(({ step }) => step).filter((s) => isAction(s) && s.channel === "mcp");
  if (steps.length === 0) return { skill };
  if (!tools) return { skill, error: "this workflow uses a connected app: sign in to Shadow in Settings first" };
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
      return { skill, error: `step ${step.id} uses ${name}: connect ${app} in Settings → Connected apps first` };
    }
    if (toolNeedsApproval(tool)) step.requires_approval = true;
  }
  return { skill: copy };
}
