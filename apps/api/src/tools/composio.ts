// Connected apps through Composio (@composio/core 0.27). Each Shadow user is one Composio user id (their uid); their
// connected accounts hold the app's OAuth tokens, kept and refreshed by Composio. Shadow's Composio key never leaves
// this service.
//
// The catalogue is every app Composio can sign a user in to by itself (a Composio-managed auth scheme): one click to
// connect, nothing to set up. Then every app connected with the user's own API key (N13; 784 of Composio's first 1000
// on 28 Oct, against 107 one-click ones): the key goes to Composio, which keeps it for that user like an OAuth token,
// through an auth config of Shadow's own made on first use. TOOLKITS (config.ts) narrows it to a list.
//
// Connecting uses connectedAccounts.link(): initiate() (and toolkits.authorize(), which calls it) was retired for
// Composio-managed OAuth in 2026. The auth config for a toolkit is the project's first one, or a Composio-managed one
// created on first use.
//
// Tool hints: Composio tags tools readOnlyHint / createHint / updateHint / destructiveHint; a tool with none is
// treated as changing things.
//
// A failure says why (Composio's own message, and what to do for the usual ones): never a bare "something went wrong".
import { AuthScheme, Composio } from "@composio/core";
import type { Connection, KeyField, ToolInfo, Toolkit, ToolProvider, ToolResult } from "./provider.ts";
import { ToolError } from "./provider.ts";

// Tool lists change rarely; one list per toolkit is kept this long. The catalogue, longer.
const TOOLS_TTL_MS = 10 * 60 * 1000;
const CATALOGUE_TTL_MS = 60 * 60 * 1000;
const CATALOGUE_LIMIT = 1000;

// Composio's error, in words a person can act on. The SDK wraps the API's answer: its status and message are found on
// the error or its cause.
export function composioError(error: unknown, doing: string): ToolError {
  const chain: unknown[] = [];
  for (let e: unknown = error; e && chain.length < 5; e = (e as { cause?: unknown }).cause) chain.push(e);
  const status = chain.map((e) => (e as { status?: unknown }).status).find((s): s is number => typeof s === "number");
  const text = chain.map((e) => (e as Error).message ?? "").join(" ");
  if (status === 401 || /invalid api key|APIKey_InvalidAPIKey/i.test(text)) {
    return new ToolError(
      "Composio refused Shadow's key: set COMPOSIO_API_KEY to a project API key from the Composio dashboard (Settings → API Keys)",
      502,
    );
  }
  if (status === 429) return new ToolError(`Composio is busy (rate limit) while ${doing}: try again in a minute`, 503);
  const message = (chain[0] as Error | undefined)?.message ?? String(error);
  return new ToolError(`Composio couldn't ${doing}: ${message.slice(0, 300)}`, 502);
}

type Kit = { composioManagedAuthSchemes?: string[]; authSchemes?: string[] };
const oneClick = (k: Kit) => (k.composioManagedAuthSchemes?.length ?? 0) > 0;
const byKey = (k: Kit) => !oneClick(k) && (k.authSchemes ?? []).includes("API_KEY");

export function composioTools(apiKey: string, allowed?: string[]): ToolProvider {
  const composio = new Composio({ apiKey });
  const authConfigs = new Map<string, string>();
  const toolCache = new Map<string, { at: number; tools: ToolInfo[] }>();
  let catalogue: { at: number; kits: Toolkit[] } | undefined;
  // Every call to Composio goes through here, so each failure says what was being done.
  const ask = async <T>(doing: string, call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw composioError(error, doing);
    }
  };

  async function toolkits(): Promise<Toolkit[]> {
    if (catalogue && Date.now() - catalogue.at < CATALOGUE_TTL_MS) return catalogue.kits;
    const list = await ask("list its apps", () => composio.toolkits.get({ sortBy: "usage", limit: CATALOGUE_LIMIT }));
    const kits = (Array.isArray(list) ? list : [])
      // One click to connect (Composio signs the user in itself), or the user's own API key. Other kinds of sign-in
      // (a username and password, a service account) aren't listed.
      .filter((k) => (oneClick(k) || byKey(k)) && !k.isLocalToolkit)
      .filter((k) => !allowed || allowed.includes(k.slug.toLowerCase()))
      .map(
        (k): Toolkit => ({
          ...(oneClick(k) ? {} : { key: true }),
          slug: k.slug.toLowerCase(),
          name: k.name,
          ...(k.meta.logo ? { logo: k.meta.logo } : {}),
          ...(k.meta.description ? { description: k.meta.description } : {}),
          categories: (k.meta.categories ?? []).map((c) => c.name),
          ...(k.meta.toolsCount !== undefined ? { actions: k.meta.toolsCount } : {}),
        }),
      );
    catalogue = { at: Date.now(), kits };
    return kits;
  }

  async function authConfigFor(toolkit: string, name: string, byKey = false): Promise<string> {
    const known = authConfigs.get(toolkit);
    if (known) return known;
    const list = await ask(`find how to sign in to ${name}`, () => composio.authConfigs.list({ toolkit }));
    // With a key: the project's API-key config, never a one-click one (its scheme is another).
    let id = (byKey ? list.items.filter((c) => c.authScheme === "API_KEY") : list.items)[0]?.id;
    if (!id) {
      const created = await ask(`set up signing in to ${name}`, () =>
        composio.authConfigs.create(
          toolkit,
          byKey
            ? { type: "use_custom_auth", authScheme: "API_KEY", credentials: {}, name: `${name} (Shadow, your key)` }
            : { type: "use_composio_managed_auth", name: `${name} (Shadow)` },
        ),
      );
      id = created.id;
    }
    authConfigs.set(toolkit, id);
    return id;
  }

  async function connections(uid: string): Promise<Connection[]> {
    const res = await ask("list your connected apps", () => composio.connectedAccounts.list({ userIds: [uid] }));
    return res.items
      .filter((a) => !a.isDisabled)
      .map((a) => ({ id: a.id, toolkit: a.toolkit.slug.toLowerCase(), status: a.status, created: a.createdAt }));
  }

  async function toolkitTools(toolkit: string): Promise<ToolInfo[]> {
    const cached = toolCache.get(toolkit);
    if (cached && Date.now() - cached.at < TOOLS_TTL_MS) return cached.tools;
    // A limit fetches the whole toolkit, not only the ones Composio marks important.
    const raw = await ask(`list ${toolkit}'s actions`, () =>
      composio.tools.getRawComposioTools({ toolkits: [toolkit], limit: 500 }),
    );
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

  const offered = (toolkit: string) => !allowed || allowed.includes(toolkit);

  async function keyFields(toolkit: string): Promise<KeyField[]> {
    const fields = await ask(`find what connecting ${toolkit} asks for`, () =>
      composio.toolkits.getConnectedAccountInitiationFields(toolkit, "API_KEY"),
    );
    return fields
      .filter((f) => f.userVisible !== false)
      .map((f) => ({
        name: f.name,
        label: f.displayName || f.name,
        ...(f.description ? { description: f.description } : {}),
        secret: f.isSecret ?? false,
        required: f.required ?? false,
        ...(f.default ? { default: f.default } : {}),
      }));
  }

  return {
    toolkits,
    connections,
    keyFields,
    async connect(uid, toolkit, callbackUrl, given) {
      const kit = (await toolkits()).find((k) => k.slug === toolkit);
      if (!kit) throw new ToolError(`${toolkit} can't be connected from Shadow`, 400);
      if (kit.key) {
        // Only the fields the app asks for, a blank one taking its default; a required one left blank is named.
        const fields = await keyFields(toolkit);
        const values = Object.fromEntries(
          fields.flatMap((f) => {
            const value = given?.[f.name]?.trim() || f.default;
            return value ? [[f.name, value]] : [];
          }),
        );
        const blank = fields.filter((f) => f.required && !values[f.name]).map((f) => f.label);
        if (blank.length > 0) throw new ToolError(`connecting ${kit.name} needs your ${blank.join(" and ")}`, 400);
        const config = await authConfigFor(toolkit, kit.name, true);
        const made = await ask(`connect ${kit.name} with your key`, () =>
          composio.connectedAccounts.initiate(uid, config, { config: AuthScheme.APIKey(values) }),
        );
        return { id: made.id };
      }
      const config = await authConfigFor(toolkit, kit.name);
      const request = await ask(`start connecting ${kit.name}`, () =>
        composio.connectedAccounts.link(uid, config, {
          ...(callbackUrl ? { callbackUrl } : {}),
          // Connecting again (another account, or after it expired) is allowed; the newest is used.
          allowMultiple: true,
        }),
      );
      if (!request.redirectUrl) throw new ToolError(`Composio gave no sign-in link for ${kit.name}`, 502);
      return { id: request.id, redirectUrl: request.redirectUrl };
    },
    async disconnect(uid, connectionId) {
      const mine = await connections(uid);
      if (!mine.some((c) => c.id === connectionId)) return false;
      await ask("disconnect the app", () => composio.connectedAccounts.delete(connectionId));
      return true;
    },
    async tools(uid) {
      const active = new Set(
        (await connections(uid)).filter((c) => c.status === "ACTIVE" && offered(c.toolkit)).map((c) => c.toolkit),
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
        return { ok: false, error: composioError(error, `run ${tool}`).message };
      }
    },
  };
}
