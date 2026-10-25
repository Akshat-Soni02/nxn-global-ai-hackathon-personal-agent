// One MCP server per user, over Streamable HTTP (POST /v1/tools/mcp). Stateless: each request builds a server for the
// signed-in user, answers, and is gone, so any Cloud Run instance can take any request. tools/list gives the tools of
// the apps that user connected, with MCP annotations from the provider's hints (the daemon turns them into
// approvals); tools/call runs one as that user, counted against their tool-call quota.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Quota } from "./quota.ts";
import type { ToolProvider } from "./tools/provider.ts";

// A tool's result is sent back as JSON text; longer results are cut (the daemon keeps it as a step's output).
const MAX_RESULT_CHARS = 200_000;

export async function handleMcp(
  request: Request,
  uid: string,
  tools: ToolProvider,
  quota: Quota,
  log: (entry: Record<string, unknown>) => void,
): Promise<Response> {
  const server = new Server({ name: "shadow-tools", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await tools.tools(uid)).map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: { type: "object" as const, ...t.inputSchema },
      annotations: {
        title: t.title,
        readOnlyHint: t.readOnly,
        destructiveHint: t.destructive,
        openWorldHint: true,
      },
      _meta: { toolkit: t.toolkit },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const held = await quota.reserve(uid, "tool", 1);
    if (!held.ok) return { isError: true, content: [{ type: "text" as const, text: held.message }] };
    const started = Date.now();
    const result = await tools.execute(uid, name, args, extra.signal);
    await quota.settle(held.ticket, { counted: true });
    log({ event: "tool.call", uid, tool: name, ok: result.ok, ms: Date.now() - started });
    if (!result.ok)
      return { isError: true, content: [{ type: "text" as const, text: result.error ?? "the tool failed" }] };
    const text = JSON.stringify(result.data ?? null);
    const structured =
      result.data && typeof result.data === "object" && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined;
    return {
      content: [
        { type: "text" as const, text: text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…` : text },
      ],
      ...(structured && text.length <= MAX_RESULT_CHARS ? { structuredContent: structured } : {}),
    };
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close().catch(() => {});
  }
}
