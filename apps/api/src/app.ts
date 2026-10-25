// shadow-api's routes (docs/cloud-architecture.md, "shadow-api: the routes"). Every /v1 route but sign-in needs
// `Authorization: Bearer <access token>`. Dependencies come in, so tests run it with memory and fakes.
//
//   POST /v1/auth/device/start      the app asks to sign in: a device code (secret) and a user code (shown)
//   GET  /signin?code=              the browser page that signs the person in and approves the code
//   POST /v1/auth/device/approve    the page's proof (ID token, or an email with AUTH=dev) + the user code
//   POST /v1/auth/device/token      the app polls with its device code until approved: access + refresh token
//   POST /v1/auth/refresh           a new access token for a refresh token
//   POST /v1/auth/signout           forgets this device (its refresh token stops working)
//   GET  /v1/me                     who is signed in, plan, limits
//   POST /v1/llm/chat/completions   OpenAI-compatible relay to Token Factory with Shadow's key, within the quota
//   GET  /v1/llm/models             the models the relay takes
//   POST /v1/tools/mcp              the user's MCP server (Streamable HTTP, stateless)
//   GET  /v1/tools/toolkits         apps that can be connected
//   GET  /v1/tools/connections      the user's connected apps;  DELETE /v1/tools/connections/:id disconnects one
//   POST /v1/tools/connect          starts connecting an app: Composio's sign-in link
//   GET  /v1/usage                  today's and this month's use against the limits
import { CATALOG, costOf } from "@shadow/llm";
import { Hono } from "hono";
import type { Config } from "./config.ts";
import type { VerifyIdentity } from "./identity.ts";
import { handleMcp } from "./mcp.ts";
import { quota as makeQuota, type Quota } from "./quota.ts";
import { signinPage } from "./signin-page.ts";
import type { Store } from "./store.ts";
import { ACCESS_TTL_S, newRefresh, parseRefresh, randomId, signAccess, userCode, verifyAccess } from "./tokens.ts";
import { ToolError, type ToolProvider } from "./tools/provider.ts";

export interface AppDeps {
  config: Config;
  store: Store;
  verifyIdentity: VerifyIdentity;
  // Undefined: connected apps are off.
  tools?: ToolProvider;
  fetch?: typeof fetch;
  now?: () => number;
  // One JSON line per request outcome: metadata only, never prompts or tool arguments.
  log?: (entry: Record<string, unknown>) => void;
}

const CODE_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_S = 2;
// Sent with every relay call; the most a reply may use when the caller doesn't say.
const DEFAULT_MAX_TOKENS = 4096;
const LLM_TIMEOUT_MS = 180_000;

type Env = { Variables: { uid: string; deviceId: string } };

export function createApp(deps: AppDeps) {
  const { config, store } = deps;
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetch ?? fetch;
  const log = deps.log ?? ((entry) => console.log(JSON.stringify({ ...entry, at: new Date(now()).toISOString() })));
  const quota: Quota = makeQuota(store, config, now);
  const app = new Hono<Env>();

  const oauthError = (error: string, description: string) => ({ error, error_description: description });

  app.get("/healthz", (c) => c.json({ ok: true }));

  // ---- Sign-in (device flow) ------------------------------------------------------------------------------------

  app.post("/v1/auth/device/start", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { device_name?: unknown };
    const deviceCode = randomId(32);
    const code = userCode();
    await store.putCode({
      deviceCode,
      userCode: code,
      status: "pending",
      expires: now() + CODE_TTL_MS,
      ...(typeof body.device_name === "string" ? { deviceName: body.device_name.slice(0, 80) } : {}),
    });
    return c.json({
      device_code: deviceCode,
      user_code: code,
      verification_uri: `${config.publicUrl}/signin`,
      verification_uri_complete: `${config.publicUrl}/signin?code=${encodeURIComponent(code)}`,
      expires_in: CODE_TTL_MS / 1000,
      interval: POLL_INTERVAL_S,
    });
  });

  app.get("/signin", (c) => {
    const code = (c.req.query("code") ?? "").toUpperCase().slice(0, 9);
    return c.html(signinPage(config, code));
  });

  app.post("/v1/auth/device/approve", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { user_code?: string; id_token?: string; email?: string };
    const code = await store.findCode(String(body.user_code ?? "").toUpperCase());
    if (!code || code.expires < now())
      return c.json(oauthError("expired_token", "This code has expired. Start signing in again from Shadow."), 400);
    let identity: Awaited<ReturnType<VerifyIdentity>>;
    try {
      identity = await deps.verifyIdentity({ idToken: body.id_token, email: body.email });
    } catch (error) {
      return c.json(oauthError("access_denied", `Sign-in failed: ${(error as Error).message}`), 401);
    }
    await store.ensureUser(identity.uid, identity.email, now());
    await store.approveCode(code.deviceCode, identity.uid);
    log({ event: "auth.approved", uid: identity.uid });
    return c.json({ ok: true });
  });

  app.post("/v1/auth/device/token", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { device_code?: string };
    const code = body.device_code ? await store.getCode(body.device_code) : undefined;
    if (!code || code.expires < now()) return c.json(oauthError("expired_token", "Start signing in again."), 400);
    if (code.status !== "approved" || !code.uid)
      return c.json(oauthError("authorization_pending", "Waiting for you to sign in in the browser."), 400);
    const deviceId = randomId(12);
    const refresh = newRefresh(deviceId);
    await store.putDevice({
      id: deviceId,
      uid: code.uid,
      refreshHash: refresh.hash,
      created: now(),
      lastSeen: now(),
      ...(code.deviceName ? { name: code.deviceName } : {}),
    });
    await store.deleteCode(code.deviceCode);
    const user = await store.getUser(code.uid);
    log({ event: "auth.device", uid: code.uid, device: deviceId });
    return c.json({
      access_token: signAccess(config.tokenSecret, code.uid, deviceId, now()),
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh.token,
      user: { uid: code.uid, email: user?.email },
    });
  });

  app.post("/v1/auth/refresh", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { refresh_token?: string };
    const parsed = body.refresh_token ? parseRefresh(body.refresh_token) : undefined;
    const device = parsed ? await store.getDevice(parsed.deviceId) : undefined;
    if (!parsed || !device || device.refreshHash !== parsed.hash)
      return c.json(oauthError("invalid_grant", "Signed out: sign in again."), 401);
    await store.touchDevice(device.id, now());
    return c.json({
      access_token: signAccess(config.tokenSecret, device.uid, device.id, now()),
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
    });
  });

  // ---- Everything below needs an access token --------------------------------------------------------------------

  app.use("/v1/*", async (c, next) => {
    if (c.req.path.startsWith("/v1/auth/") && c.req.path !== "/v1/auth/signout") return next();
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const claims = token ? verifyAccess(config.tokenSecret, token, now()) : undefined;
    if (!claims) return c.json(oauthError("invalid_token", "Sign in to Shadow again."), 401);
    c.set("uid", claims.sub);
    c.set("deviceId", claims.dev);
    return next();
  });

  app.post("/v1/auth/signout", async (c) => {
    await store.deleteDevice(c.get("deviceId"));
    return c.json({ ok: true });
  });

  app.get("/v1/me", async (c) => {
    const uid = c.get("uid");
    const user = await store.getUser(uid);
    return c.json({
      uid,
      email: user?.email,
      plan: user?.plan ?? "free",
      developer: Boolean(user?.developer),
      limits: (await quota.limitsFor(uid)) ?? null,
      tools: Boolean(deps.tools),
    });
  });

  app.get("/v1/usage", async (c) => {
    const uid = c.get("uid");
    const usage = await store.usage(uid, now());
    return c.json({ ...usage, limits: (await quota.limitsFor(uid)) ?? null });
  });

  // ---- The model relay ----------------------------------------------------------------------------------------

  app.get("/v1/llm/models", (c) =>
    c.json({ object: "list", data: Object.keys(CATALOG).map((id) => ({ id, object: "model" })) }),
  );

  app.post("/v1/llm/chat/completions", async (c) => {
    const uid = c.get("uid");
    const body = (await c.req.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    if (!body || !Array.isArray(body.messages)) return c.json({ error: { message: "messages are needed" } }, 400);
    const model = CATALOG[String(body.model)];
    if (!model) return c.json({ error: { message: `model not offered: ${String(body.model)}` } }, 400);
    if (body.stream) return c.json({ error: { message: "streaming is not offered; send stream: false" } }, 400);
    const maxTokens = typeof body.max_tokens === "number" && body.max_tokens > 0 ? body.max_tokens : DEFAULT_MAX_TOKENS;
    const forwarded = { ...body, max_tokens: maxTokens, n: 1 };

    const estimate = Math.ceil(costOf(model, estimateInputTokens(body.messages), maxTokens) * 1_000_000);
    const held = await quota.reserve(uid, "llm", estimate);
    if (!held.ok)
      return c.json({ error: { message: held.message, type: "quota_exceeded", resets_at: held.resetsAt } }, 429);

    const started = now();
    let res: Response;
    try {
      res = await doFetch(`${config.nebius.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.nebius.apiKey}` },
        body: JSON.stringify(forwarded),
        signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(LLM_TIMEOUT_MS)]),
      });
    } catch (error) {
      await quota.settle(held.ticket, {});
      log({ event: "llm.error", uid, model: model.id, error: (error as Error).name });
      return c.json({ error: { message: "Token Factory could not be reached" } }, 502);
    }
    const text = await res.text();
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    try {
      usage = (JSON.parse(text) as { usage?: typeof usage }).usage;
    } catch {
      usage = undefined;
    }
    const input = usage?.prompt_tokens ?? 0;
    const output = usage?.completion_tokens ?? 0;
    const microUsd = costOf(model, input, output) * 1_000_000;
    await quota.settle(held.ticket, { microUsd, inputTokens: input, outputTokens: output });
    log({
      event: "llm.call",
      uid,
      model: model.id,
      status: res.status,
      input,
      output,
      microUsd: Math.round(microUsd),
      ms: now() - started,
    });
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  });

  // ---- Connected apps ------------------------------------------------------------------------------------------

  const noTools = () => ({ error: "connected apps are not set up on this server" });

  app.post("/v1/tools/mcp", async (c) => {
    if (!deps.tools) return c.json(noTools(), 503);
    return handleMcp(c.req.raw, c.get("uid"), deps.tools, quota, log);
  });
  // Stateless server: no GET stream, no sessions to end.
  app.on(["GET", "DELETE"], "/v1/tools/mcp", (c) => c.json({ error: "method not allowed" }, 405));

  app.get("/v1/tools/toolkits", async (c) => {
    if (!deps.tools) return c.json(noTools(), 503);
    return c.json({ toolkits: await deps.tools.toolkits() });
  });

  app.get("/v1/tools/connections", async (c) => {
    if (!deps.tools) return c.json(noTools(), 503);
    return c.json({ connections: await deps.tools.connections(c.get("uid")) });
  });

  app.post("/v1/tools/connect", async (c) => {
    if (!deps.tools) return c.json(noTools(), 503);
    const body = (await c.req.json().catch(() => ({}))) as { toolkit?: string; callback_url?: string };
    const toolkit = String(body.toolkit ?? "").toLowerCase();
    const allowed = await deps.tools.toolkits();
    if (!allowed.some((t) => t.slug === toolkit))
      return c.json({ error: `${toolkit || "that app"} can't be connected` }, 400);
    const started = await deps.tools.connect(c.get("uid"), toolkit, body.callback_url);
    log({ event: "tool.connect", uid: c.get("uid"), toolkit });
    return c.json({ id: started.id, redirect_url: started.redirectUrl });
  });

  app.delete("/v1/tools/connections/:id", async (c) => {
    if (!deps.tools) return c.json(noTools(), 503);
    const removed = await deps.tools.disconnect(c.get("uid"), c.req.param("id"));
    return removed ? c.json({ ok: true }) : c.json({ error: "no such connection" }, 404);
  });

  // What failed is said, in the reply as in the log: a connected app's failure (ToolError) with its own reason and
  // status ("Composio refused Shadow's key: …"), anything else with its message.
  app.onError((error, c) => {
    log({ event: "error", path: c.req.path, error: error.message });
    if (error instanceof ToolError) return c.json({ error: error.message }, error.status as 400);
    return c.json({ error: `Shadow's server failed: ${error.message.slice(0, 300)}` }, 500);
  });

  return app;
}

// A rough count for the reservation: ~4 characters a token for text, a flat amount per image. Settling uses the real
// count, so this only needs to be in the right range.
export function estimateInputTokens(messages: unknown[]): number {
  let chars = 0;
  let images = 0;
  for (const m of messages) {
    const content = (m as { content?: unknown }).content;
    if (typeof content === "string") chars += content.length;
    else if (Array.isArray(content)) {
      for (const part of content as { type?: string; text?: string }[]) {
        if (part.type === "text") chars += part.text?.length ?? 0;
        else if (part.type === "image_url") images++;
      }
    }
    const calls = (m as { tool_calls?: unknown }).tool_calls;
    if (calls) chars += JSON.stringify(calls).length;
  }
  return Math.ceil(chars / 4) + images * 1500 + 50;
}
