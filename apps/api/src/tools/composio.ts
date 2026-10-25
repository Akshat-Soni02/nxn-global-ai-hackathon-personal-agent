// Connected apps through Composio (@composio/core 0.27). Each Shadow user is one Composio user id (their uid); their
// connected accounts hold the app's OAuth tokens, kept and refreshed by Composio. Shadow's Composio key never leaves
// this service.
//
// Connecting uses connectedAccounts.link(): initiate() (and toolkits.authorize(), which calls it) was retired for
// Composio-managed OAuth in 2026. The auth config for a toolkit is the project's first one, or a Composio-managed one
// created on first use.
//
// Tool hints: Composio tags tools readOnlyHint / createHint / updateHint / destructiveHint; a tool with none is
// treated as changing things.
import { Composio } from "@composio/core";
import type { Connection, ToolInfo, ToolProvider, ToolResult } from "./provider.ts";
import { ToolError } from "./provider.ts";

const NAMES: Record<string, string> = {
  googlesheets: "Google Sheets",
  gmail: "Gmail",
  googledrive: "Google Drive",
  googlecalendar: "Google Calendar",
  googledocs: "Google Docs",
  slack: "Slack",
  notion: "Notion",
  github: "GitHub",
  linear: "Linear",
  trello: "Trello",
};

// Tool lists change rarely; one list per toolkit is kept this long.
const TOOLS_TTL_MS = 10 * 60 * 1000;

export function composioTools(apiKey: string, allowed: string[]): ToolProvider {
  const composio = new Composio({ apiKey });
  const authConfigs = new Map<string, string>();
  const toolCache = new Map<string, { at: number; tools: ToolInfo[] }>();

  async function authConfigFor(toolkit: string): Promise<string> {
    const known = authConfigs.get(toolkit);
    if (known) return known;
    const list = await composio.authConfigs.list({ toolkit });
    let id = list.items[0]?.id;
    if (!id) {
      const created = await composio.authConfigs.create(toolkit, {
        type: "use_composio_managed_auth",
        name: `${NAMES[toolkit] ?? toolkit} (Shadow)`,
      });
      id = created.id;
    }
    authConfigs.set(toolkit, id);
    return id;
  }

  async function connections(uid: string): Promise<Connection[]> {
    const res = await composio.connectedAccounts.list({ userIds: [uid] });
    return res.items
      .filter((a) => !a.isDisabled)
      .map((a) => ({ id: a.id, toolkit: a.toolkit.slug.toLowerCase(), status: a.status, created: a.createdAt }));
  }

  async function toolkitTools(toolkit: string): Promise<ToolInfo[]> {
    const cached = toolCache.get(toolkit);
    if (cached && Date.now() - cached.at < TOOLS_TTL_MS) return cached.tools;
    // A limit fetches the whole toolkit, not only the ones Composio marks important.
    const raw = await composio.tools.getRawComposioTools({ toolkits: [toolkit], limit: 500 });
    const tools = raw
      .filter((t) => !t.isDeprecated)
      .map((t): ToolInfo => {
        const tags = new Set(t.tags ?? []);
        return {
          name: t.slug,
          title: t.name,
          description: t.description ?? t.name,
          inputSchema: (t.inputParameters as Record<string, unknown> | undefined) ?? { type: "object", properties: {} },
          toolkit,
          readOnly: tags.has("readOnlyHint"),
          destructive: tags.has("destructiveHint"),
        };
      });
    toolCache.set(toolkit, { at: Date.now(), tools });
    return tools;
  }

  return {
    async toolkits() {
      return allowed.map((slug) => ({ slug, name: NAMES[slug] ?? slug }));
    },
    connections,
    async connect(uid, toolkit, callbackUrl) {
      if (!allowed.includes(toolkit)) throw new ToolError(`${toolkit} can't be connected`, 400);
      const request = await composio.connectedAccounts.link(uid, await authConfigFor(toolkit), {
        ...(callbackUrl ? { callbackUrl } : {}),
        // Connecting again (another account, or after it expired) is allowed; the newest is used.
        allowMultiple: true,
      });
      if (!request.redirectUrl) throw new ToolError(`Composio gave no sign-in link for ${toolkit}`, 502);
      return { id: request.id, redirectUrl: request.redirectUrl };
    },
    async disconnect(uid, connectionId) {
      const mine = await connections(uid);
      if (!mine.some((c) => c.id === connectionId)) return false;
      await composio.connectedAccounts.delete(connectionId);
      return true;
    },
    async tools(uid) {
      const active = new Set(
        (await connections(uid))
          .filter((c) => c.status === "ACTIVE" && allowed.includes(c.toolkit))
          .map((c) => c.toolkit),
      );
      return (await Promise.all([...active].map(toolkitTools))).flat();
    },
    async execute(uid, tool, args, signal): Promise<ToolResult> {
      try {
        const res = await composio.tools.execute(
          tool,
          // The newest version of each tool. Pin versions with COMPOSIO_TOOLKIT_VERSION_<TOOLKIT> if one breaks.
          { userId: uid, arguments: args, dangerouslySkipVersionCheck: true },
          signal ? { signal } : undefined,
        );
        return res.successful ? { ok: true, data: res.data } : { ok: false, error: res.error ?? "the tool failed" };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
  };
}
