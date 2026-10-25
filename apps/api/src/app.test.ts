import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { createApp, estimateInputTokens } from "./app.ts";
import { type Config, configFromEnv } from "./config.ts";
import { devIdentity } from "./identity.ts";
import { memoryStore } from "./store.ts";
import { signAccess } from "./tokens.ts";
import { fakeTools } from "./tools/fake.ts";

const MODEL = "nvidia/Nemotron-3_5-Lightning";

function setup(overrides: Partial<Config> = {}) {
  const config = {
    ...configFromEnv({ NEBIUS_API_KEY: "nebius-test-key", AUTH: "dev", STORE: "memory" }),
    ...overrides,
  };
  const store = memoryStore();
  const tools = fakeTools();
  const nebiusCalls: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
  let clock = Date.parse("2026-10-25T12:00:00Z");
  const fakeNebius: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    nebiusCalls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body });
    return Response.json({
      choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    });
  };
  const logs: Record<string, unknown>[] = [];
  const app = createApp({
    config,
    store,
    verifyIdentity: devIdentity,
    tools,
    fetch: fakeNebius,
    now: () => clock,
    log: (e) => logs.push(e),
  });
  const call = (path: string, init: RequestInit & { token?: string; json?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    if (init.json !== undefined) headers.set("content-type", "application/json");
    return app.request(path, {
      ...init,
      headers,
      ...(init.json !== undefined ? { body: JSON.stringify(init.json), method: init.method ?? "POST" } : {}),
    });
  };
  async function signIn(email = "akshat@example.com") {
    const start = (await (await call("/v1/auth/device/start", { json: { device_name: "Test Mac" } })).json()) as {
      device_code: string;
      user_code: string;
    };
    await call("/v1/auth/device/approve", { json: { user_code: start.user_code, email } });
    const token = (await (
      await call("/v1/auth/device/token", { json: { device_code: start.device_code } })
    ).json()) as {
      access_token: string;
      refresh_token: string;
      user: { uid: string };
    };
    return token;
  }
  return {
    app,
    call,
    signIn,
    store,
    tools,
    config,
    nebiusCalls,
    logs,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

describe("sign-in (device flow)", () => {
  it("waits until the code is approved in the browser, then gives tokens", async () => {
    const t = setup();
    const start = (await (await t.call("/v1/auth/device/start", { json: {} })).json()) as Record<string, string>;
    expect(start.user_code).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    expect(start.verification_uri_complete).toContain(`/signin?code=${start.user_code}`);

    const pending = await t.call("/v1/auth/device/token", { json: { device_code: start.device_code } });
    expect(pending.status).toBe(400);
    expect(((await pending.json()) as { error: string }).error).toBe("authorization_pending");

    const page = await t.call(`/signin?code=${start.user_code}`);
    expect(await page.text()).toContain(start.user_code);

    const approved = await t.call("/v1/auth/device/approve", { json: { user_code: start.user_code, email: "a@b.co" } });
    expect(approved.status).toBe(200);
    const token = (await (
      await t.call("/v1/auth/device/token", { json: { device_code: start.device_code } })
    ).json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(token.access_token.split(".")).toHaveLength(3);

    const me = (await (await t.call("/v1/me", { token: token.access_token })).json()) as {
      email: string;
      plan: string;
    };
    expect(me).toMatchObject({ email: "a@b.co", plan: "free" });

    // The device code is used up.
    const again = await t.call("/v1/auth/device/token", { json: { device_code: start.device_code } });
    expect(((await again.json()) as { error: string }).error).toBe("expired_token");
  });

  it("refuses an expired code", async () => {
    const t = setup();
    const start = (await (await t.call("/v1/auth/device/start", { json: {} })).json()) as Record<string, string>;
    t.advance(11 * 60 * 1000);
    const res = await t.call("/v1/auth/device/approve", { json: { user_code: start.user_code, email: "a@b.co" } });
    expect(res.status).toBe(400);
  });

  it("refreshes, and signing out ends the refresh token", async () => {
    const t = setup();
    const { access_token, refresh_token } = await t.signIn();
    t.advance(16 * 60 * 1000);
    expect((await t.call("/v1/me", { token: access_token })).status).toBe(401);
    const refreshed = (await (await t.call("/v1/auth/refresh", { json: { refresh_token } })).json()) as {
      access_token: string;
    };
    expect((await t.call("/v1/me", { token: refreshed.access_token })).status).toBe(200);
    expect((await t.call("/v1/auth/signout", { method: "POST", token: refreshed.access_token })).status).toBe(200);
    expect((await t.call("/v1/auth/refresh", { json: { refresh_token } })).status).toBe(401);
  });

  it("rejects missing, forged and wrong-secret tokens", async () => {
    const t = setup();
    expect((await t.call("/v1/me")).status).toBe(401);
    expect((await t.call("/v1/me", { token: "a.b.c" })).status).toBe(401);
    const forged = signAccess("another-secret-that-is-long-enough-1234", "someone", "dev", t.now());
    expect((await t.call("/v1/me", { token: forged })).status).toBe(401);
  });
});

describe("the model relay", () => {
  it("forwards with Shadow's key, never the user's token, and meters the call", async () => {
    const t = setup();
    const { access_token } = await t.signIn();
    const res = await t.call("/v1/llm/chat/completions", {
      token: access_token,
      json: { model: MODEL, messages: [{ role: "user", content: "hi" }], max_tokens: 200 },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { choices: { message: { content: string } }[] }).choices[0]?.message.content).toBe(
      "hello",
    );
    expect(t.nebiusCalls).toHaveLength(1);
    expect(t.nebiusCalls[0]?.auth).toBe("Bearer nebius-test-key");
    expect(t.nebiusCalls[0]?.url).toBe("https://api.tokenfactory.nebius.com/v1/chat/completions");

    const usage = (await (await t.call("/v1/usage", { token: access_token })).json()) as {
      day: { llmMicroUsd: number; llmReservedMicroUsd: number; llmCalls: number; inputTokens: number };
    };
    // 1000 in × $0.06/M + 500 out × $0.24/M = $0.00018
    expect(usage.day).toMatchObject({ llmMicroUsd: 180, llmReservedMicroUsd: 0, llmCalls: 1, inputTokens: 1000 });
    // No prompt in the logs.
    expect(JSON.stringify(t.logs)).not.toContain('hi"');
  });

  it("refuses models outside the catalog and streaming", async () => {
    const t = setup();
    const { access_token } = await t.signIn();
    const other = await t.call("/v1/llm/chat/completions", {
      token: access_token,
      json: { model: "some/expensive-model", messages: [] },
    });
    expect(other.status).toBe(400);
    const stream = await t.call("/v1/llm/chat/completions", {
      token: access_token,
      json: { model: MODEL, messages: [], stream: true },
    });
    expect(stream.status).toBe(400);
    expect(t.nebiusCalls).toHaveLength(0);
  });

  it("stops at the daily limit with 429, and a developer has no caps", async () => {
    const t = setup();
    t.config.limits.llmMicroUsdPerDay = 1500; // the reservation for max_tokens 4096 is ~1000 micro-USD
    const { access_token, user } = await t.signIn();
    const ask = () =>
      t.call("/v1/llm/chat/completions", {
        token: access_token,
        json: { model: MODEL, messages: [{ role: "user", content: "hi" }] },
      });
    expect((await ask()).status).toBe(200); // settles at 180
    expect((await ask()).status).toBe(200); // 360
    const refused = await ask(); // 360 + ~1000 reserved still fits, so try until refused
    const statuses = [refused.status];
    for (let i = 0; i < 5 && statuses.at(-1) === 200; i++) statuses.push((await ask()).status);
    expect(statuses.at(-1)).toBe(429);
    const before = t.nebiusCalls.length;

    await t.store.ensureUser(user.uid, undefined, t.now());
    const u = await t.store.getUser(user.uid);
    if (u) u.developer = true;
    expect((await ask()).status).toBe(200);
    expect(t.nebiusCalls.length).toBe(before + 1);
  });

  it("QUOTAS=off means no caps for anyone", async () => {
    const t = setup({ quotas: false });
    t.config.limits.llmMicroUsdPerDay = 1;
    const { access_token } = await t.signIn();
    const res = await t.call("/v1/llm/chat/completions", {
      token: access_token,
      json: { model: MODEL, messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.status).toBe(200);
  });

  it("estimates input from text, tool calls and images", () => {
    expect(estimateInputTokens([{ role: "user", content: "x".repeat(400) }])).toBe(150);
    expect(
      estimateInputTokens([
        {
          role: "user",
          content: [
            { type: "text", text: "x".repeat(40) },
            { type: "image_url", image_url: { url: "" } },
          ],
        },
      ]),
    ).toBe(10 + 1500 + 50);
  });
});

describe("connected apps", () => {
  it("connects an app, lists its tools over MCP with hints, and runs one as the user", async () => {
    const t = setup();
    const { access_token, user } = await t.signIn();
    const kits = (await (await t.call("/v1/tools/toolkits", { token: access_token })).json()) as {
      toolkits: { slug: string }[];
    };
    expect(kits.toolkits.map((k) => k.slug)).toContain("googlesheets");
    const connect = await t.call("/v1/tools/connect", { token: access_token, json: { toolkit: "googlesheets" } });
    expect(((await connect.json()) as { redirect_url: string }).redirect_url).toMatch(/^https:/);

    const client = new Client({ name: "test", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL("http://api.test/v1/tools/mcp"), {
      requestInit: { headers: { authorization: `Bearer ${access_token}` } },
      fetch: async (url, init) => t.app.request(String(url), init as RequestInit),
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    const append = tools.find((x) => x.name === "GOOGLESHEETS_APPEND_VALUES");
    const read = tools.find((x) => x.name === "GOOGLESHEETS_GET_VALUES");
    expect(append?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(read?.annotations?.readOnlyHint).toBe(true);

    const result = await client.callTool({
      name: "GOOGLESHEETS_APPEND_VALUES",
      arguments: { spreadsheet_id: "s1", values: [["2026-10-25", 42]] },
    });
    expect(result.isError).toBeFalsy();
    expect(t.tools.sheet(user.uid)).toEqual([["2026-10-25", 42]]);
    await client.close();

    const usage = (await (await t.call("/v1/usage", { token: access_token })).json()) as {
      month: { toolCalls: number };
    };
    expect(usage.month.toolCalls).toBe(1);
  });

  it("a user sees only their own connections and can't remove someone else's", async () => {
    const t = setup();
    const a = await t.signIn("a@example.com");
    const b = await t.signIn("b@example.com");
    const made = (await (
      await t.call("/v1/tools/connect", { token: a.access_token, json: { toolkit: "googlesheets" } })
    ).json()) as { id: string };
    const bList = (await (await t.call("/v1/tools/connections", { token: b.access_token })).json()) as {
      connections: unknown[];
    };
    expect(bList.connections).toHaveLength(0);
    expect((await t.call(`/v1/tools/connections/${made.id}`, { method: "DELETE", token: b.access_token })).status).toBe(
      404,
    );
    expect((await t.call(`/v1/tools/connections/${made.id}`, { method: "DELETE", token: a.access_token })).status).toBe(
      200,
    );
  });

  it("a tool call over the quota is an MCP error, and the app is not called", async () => {
    const t = setup();
    t.config.limits.toolCallsPerDay = 0;
    const { access_token, user } = await t.signIn();
    await t.call("/v1/tools/connect", { token: access_token, json: { toolkit: "googlesheets" } });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://api.test/v1/tools/mcp"), {
        requestInit: { headers: { authorization: `Bearer ${access_token}` } },
        fetch: async (url, init) => t.app.request(String(url), init as RequestInit),
      }),
    );
    const result = await client.callTool({
      name: "GOOGLESHEETS_APPEND_VALUES",
      arguments: { spreadsheet_id: "s", values: [[1]] },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("used up");
    expect(t.tools.sheet(user.uid)).toEqual([]);
    await client.close();
  });

  it("without a tools provider the routes say so", async () => {
    const t = setup();
    const app = createApp({ config: t.config, store: t.store, verifyIdentity: devIdentity, log: () => {}, now: t.now });
    const { access_token } = await t.signIn();
    const res = await app.request("/v1/tools/connections", { headers: { authorization: `Bearer ${access_token}` } });
    expect(res.status).toBe(503);
  });
});

describe("config", () => {
  it("refuses dev sign-in on Cloud Run, and a short token secret", () => {
    expect(() => configFromEnv({ NEBIUS_API_KEY: "k", AUTH: "dev", K_SERVICE: "shadow-api" })).toThrow(/local/);
    expect(() => configFromEnv({ NEBIUS_API_KEY: "k", K_SERVICE: "shadow-api", TOKEN_SECRET: "short" })).toThrow(/32/);
  });
});
