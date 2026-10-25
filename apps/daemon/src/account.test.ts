// The daemon's account, model client and MCP client against the real shadow-api app (apps/api), in memory: a fake
// Token Factory, a fake Google Sheet, a fake Keychain. What a user does: sign in, record (model calls), run an mcp step.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../api/src/app.ts";
import { configFromEnv } from "../../api/src/config.ts";
import { devIdentity } from "../../api/src/identity.ts";
import { memoryStore } from "../../api/src/store.ts";
import { fakeTools } from "../../api/src/tools/fake.ts";
import { createAccount } from "./account.ts";
import type { SecurityRunner } from "./keychain.ts";
import { mcpTools, toolNeedsApproval } from "./mcp-tools.ts";
import { createAppControl } from "./settings.ts";

const API = "http://shadow-api.test";

function world() {
  const config = configFromEnv({ NEBIUS_API_KEY: "nebius-key", AUTH: "dev", STORE: "memory", PUBLIC_URL: API });
  const sheets = fakeTools();
  const seenByNebius: string[] = [];
  const app = createApp({
    config,
    store: memoryStore(),
    verifyIdentity: devIdentity,
    tools: sheets,
    log: () => {},
    fetch: async (_url, init) => {
      seenByNebius.push(new Headers(init?.headers).get("authorization") ?? "");
      return Response.json({
        choices: [{ message: { content: "ready" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      });
    },
  });
  const net: typeof fetch = async (input, init) => app.request(String(input), init as RequestInit);
  // A Keychain in memory, speaking `security`'s commands as keychain.ts sends them.
  const items = new Map<string, string>();
  const security: SecurityRunner = async (args, stdin) => {
    if (args[0] === "find-generic-password") {
      const value = items.get(args[args.indexOf("-a") + 1] ?? "");
      return value === undefined ? { stdout: "", code: 44 } : { stdout: `${value}\n`, code: 0 };
    }
    if (args[0] === "delete-generic-password") {
      items.delete(args[args.indexOf("-a") + 1] ?? "");
      return { stdout: "", code: 0 };
    }
    const m = /-a "((?:[^"\\]|\\.)*)" .*-w "((?:[^"\\]|\\.)*)"\n$/.exec(stdin ?? "");
    if (!m?.[1] || m[2] === undefined) return { stdout: "", code: 1 };
    items.set(m[1], m[2].replace(/\\(.)/g, "$1"));
    return { stdout: "", code: 0 };
  };
  return { app, net, security, items, sheets, seenByNebius };
}

async function signedIn(w: ReturnType<typeof world>) {
  let approve: Promise<unknown> = Promise.resolve();
  const opened: string[] = [];
  const account = createAccount({
    apiUrl: API,
    security: w.security,
    fetch: w.net,
    sleep: async () => {
      await approve;
    },
    openUrl: (url) => {
      opened.push(url);
      // The person signs in on the page the browser opened.
      const code = new URL(url).searchParams.get("code");
      approve = w.net(`${API}/v1/auth/device/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_code: code, email: "akshat@example.com" }),
      });
    },
  });
  const started = await account.signIn();
  expect(opened[0]).toBe(`${API}/signin?code=${started.userCode}`);
  for (let i = 0; i < 50 && !account.view().signedIn; i++) await new Promise((r) => setTimeout(r, 5));
  return account;
}

describe("the account, through shadow-api", () => {
  it("signs in with the browser, keeps the refresh token in the Keychain, and calls the model with Shadow's key", async () => {
    const w = world();
    const account = await signedIn(w);
    expect(account.view()).toMatchObject({ signedIn: true, email: "akshat@example.com" });
    expect(w.items.get("shadow-account")).toContain("refreshToken");

    const reply = await account.llm()?.generate({ profile: "fast", user: "Reply with the single word: ready" });
    expect(reply?.text).toBe("ready");
    // Token Factory saw Shadow's key, not the user's token or the placeholder.
    expect(w.seenByNebius).toEqual(["Bearer nebius-key"]);

    const usage = await account.call<{ day: { llmCalls: number } }>("GET", "/v1/usage");
    expect(usage.day.llmCalls).toBe(1);
  });

  it("a restarted daemon is still signed in, and signing out ends it", async () => {
    const w = world();
    await signedIn(w);
    const restarted = createAccount({ apiUrl: API, security: w.security, fetch: w.net });
    await restarted.load();
    expect(restarted.view().signedIn).toBe(true);
    expect((await restarted.llm()?.generate({ profile: "fast", user: "hi" }))?.text).toBe("ready");

    await restarted.signOut();
    expect(restarted.view().signedIn).toBe(false);
    expect(w.items.has("shadow-account")).toBe(false);
    expect(restarted.llm()).toBeUndefined();
  });

  it("never sends a token saved for another server", async () => {
    const w = world();
    await signedIn(w);
    const other = createAccount({ apiUrl: "https://elsewhere.test", security: w.security, fetch: w.net });
    await other.load();
    expect(other.view().signedIn).toBe(false);
  });

  it("connects Google Sheets and runs a tool over MCP, with approval from its hints", async () => {
    const w = world();
    const account = await signedIn(w);
    await account.call("POST", "/v1/tools/connect", { toolkit: "googlesheets" });
    const tools = mcpTools(`${API}/v1/tools/mcp`, account.fetch);

    const list = await tools.list();
    const append = await tools.find("GOOGLESHEETS_APPEND_VALUES");
    expect(list.map((t) => t.name)).toContain("GOOGLESHEETS_GET_VALUES");
    expect(toolNeedsApproval(append)).toBe(true);
    expect(toolNeedsApproval(await tools.find("GOOGLESHEETS_GET_VALUES"))).toBe(false);
    expect(toolNeedsApproval(undefined)).toBe(true);

    const result = await tools.call("GOOGLESHEETS_APPEND_VALUES", { spreadsheet_id: "kpi", values: [["Mon", 7]] });
    expect(result).toMatchObject({ ok: true, value: { updates: { updatedRows: 1 } } });
    const uid = JSON.parse(w.items.get("shadow-account") ?? "{}").uid as string;
    expect(w.sheets.sheet(uid)).toEqual([["Mon", 7]]);

    const bad = await tools.call("GOOGLESHEETS_APPEND_VALUES", { spreadsheet_id: "kpi", values: "nope" });
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining("list of rows") });
  });
});

describe("Settings → Connected apps → Check", () => {
  it("says whether a connected app works the way a run reaches it, without doing anything in it", async () => {
    const w = world();
    const account = await signedIn(w);
    const tools = mcpTools(`${API}/v1/tools/mcp`, account.fetch);
    const app = createAppControl({
      dataDir: mkdtempSync(join(tmpdir(), "check-")),
      logDir: "",
      nativeHost: "",
      model: () => undefined,
      keySource: () => "account",
      applyKey: () => {},
      account,
      tools: () => tools,
      memory: {} as never,
      openUrl: () => {},
    });
    expect(await app.checkApp("googlesheets")).toMatchObject({ ok: false, error: "not connected" });
    await app.connectApp("googlesheets");
    expect(await app.checkApp("googlesheets")).toMatchObject({ ok: true, actions: 2, reads: 1 });
    // Checking wrote nothing to the sheet.
    const uid = JSON.parse(w.items.get("shadow-account") ?? "{}").uid as string;
    expect(w.sheets.sheet(uid)).toEqual([]);

    await account.signOut();
    expect(await app.checkApp("googlesheets")).toMatchObject({ ok: false, error: "not signed in to Shadow" });
  });
});
