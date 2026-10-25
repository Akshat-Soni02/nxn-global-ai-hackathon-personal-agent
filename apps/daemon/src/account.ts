// The signed-in Shadow account (docs/cloud-architecture.md, "First run"). Signing in is the device flow: shadow-api
// gives a short code, the browser opens Shadow's sign-in page with it, and the daemon polls until the person has
// signed in, then keeps the refresh token in the Keychain. Every call to shadow-api goes through `fetch` here, which
// adds a fresh access token (15 minutes; refreshed a minute before it ends, and once more on a 401).
//
// Model calls use it through packages/llm unchanged: the base URL is shadow-api's /v1/llm and `fetch` is this one,
// which replaces the placeholder key with the access token. Connected apps use it through mcp-tools.ts.
import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { createLlm, type Llm, llmConfig } from "@shadow/llm";
import {
  deleteSecret,
  KEYCHAIN_SESSION,
  readSecret,
  runSecurity,
  type SecurityRunner,
  writeSecret,
} from "./keychain.ts";

export interface Session {
  refreshToken: string;
  uid: string;
  email?: string;
  // The service the token belongs to: a token from another server is not sent anywhere else.
  apiUrl: string;
}

export interface SignInStart {
  userCode: string;
  url: string;
  expiresAt: number;
}

export interface AccountView {
  // Undefined: this build has no service configured (SHADOW_API_URL), so only a developer key works.
  apiUrl?: string;
  signedIn: boolean;
  email?: string;
  // While signing in: the code the browser page shows, and its link.
  pending?: SignInStart;
  // Why the last sign-in stopped, when it did.
  error?: string;
}

export interface Usage {
  dayKey: string;
  monthKey: string;
  day: { llmMicroUsd: number; toolCalls: number; llmCalls: number };
  month: { llmMicroUsd: number; toolCalls: number; llmCalls: number };
  limits: {
    llmMicroUsdPerDay: number;
    llmMicroUsdPerMonth: number;
    toolCallsPerDay: number;
    toolCallsPerMonth: number;
  } | null;
}

export interface AccountDeps {
  apiUrl?: string;
  security?: SecurityRunner;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  openUrl?: (url: string) => void;
  // Signed in or out: main.ts swaps the model client.
  onChange?: (view: AccountView) => void;
  log?: (message: string) => void;
}

export interface Account {
  view(): AccountView;
  // Reads the Keychain once at start.
  load(): Promise<void>;
  // Starts signing in and opens the browser; resolves at once with the code. Polling goes on in the background.
  signIn(): Promise<SignInStart>;
  signOut(): Promise<void>;
  // fetch to shadow-api with the access token. Throws when not signed in.
  fetch: typeof fetch;
  // A model client through shadow-api, or undefined when not signed in.
  llm(): Llm | undefined;
  // GET/POST/DELETE on shadow-api, as JSON.
  call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T>;
}

const REFRESH_EARLY_MS = 60_000;
const ACCESS_TTL_FALLBACK_S = 15 * 60;

export class SignedOutError extends Error {
  constructor(message = "Not signed in to Shadow: sign in from Settings") {
    super(message);
    this.name = "SignedOutError";
  }
}

export const openInBrowser = (url: string) => {
  execFile("/usr/bin/open", [url], () => {});
};

export function createAccount(deps: AccountDeps): Account {
  const security = deps.security ?? runSecurity;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log ?? (() => {});
  const apiUrl = deps.apiUrl?.replace(/\/+$/, "");
  let session: Session | undefined;
  let access: { token: string; expires: number } | undefined;
  let refreshing: Promise<string> | undefined;
  let pending: (SignInStart & { deviceCode: string; interval: number }) | undefined;
  let error: string | undefined;
  let model: Llm | undefined;

  const view = (): AccountView => ({
    apiUrl,
    signedIn: session !== undefined,
    email: session?.email,
    pending: pending ? { userCode: pending.userCode, url: pending.url, expiresAt: pending.expiresAt } : undefined,
    error,
  });
  const changed = () => {
    model = undefined;
    deps.onChange?.(view());
  };

  async function post<T>(path: string, body: unknown, token?: string): Promise<{ status: number; body: T }> {
    if (!apiUrl) throw new Error("this build of Shadow has no service to sign in to");
    const res = await doFetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
  }

  async function saveSession(next: Session | undefined) {
    session = next;
    access = undefined;
    if (next) {
      await writeSecret(KEYCHAIN_SESSION, "Shadow: account", JSON.stringify(next), security);
    } else {
      await deleteSecret(KEYCHAIN_SESSION, security);
    }
    changed();
  }

  async function accessToken(force = false): Promise<string> {
    if (!session) throw new SignedOutError();
    if (!force && access && access.expires - REFRESH_EARLY_MS > now()) return access.token;
    refreshing ??= (async () => {
      const current = session;
      if (!current) throw new SignedOutError();
      const res = await post<{ access_token?: string; expires_in?: number; error_description?: string }>(
        "/v1/auth/refresh",
        { refresh_token: current.refreshToken },
      );
      if (res.status === 401) {
        log("account: the service ended this sign-in; sign in again");
        await saveSession(undefined);
        throw new SignedOutError(res.body.error_description);
      }
      if (!res.body.access_token) throw new Error(`Shadow's service answered ${res.status} refreshing the sign-in`);
      access = {
        token: res.body.access_token,
        expires: now() + (res.body.expires_in ?? ACCESS_TTL_FALLBACK_S) * 1000,
      };
      return access.token;
    })().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  }

  // The access token goes in place of whatever authorization the caller set (packages/llm sets a placeholder key).
  const authedFetch: typeof fetch = async (input, init) => {
    const send = async (token: string) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${token}`);
      return doFetch(input, { ...init, headers });
    };
    const res = await send(await accessToken());
    if (res.status !== 401) return res;
    return send(await accessToken(true));
  };

  async function poll(started: NonNullable<typeof pending>) {
    while (pending === started && now() < started.expiresAt) {
      await sleep(started.interval * 1000);
      if (pending !== started) return;
      let res: { status: number; body: Record<string, unknown> };
      try {
        res = await post<Record<string, unknown>>("/v1/auth/device/token", { device_code: started.deviceCode });
      } catch {
        continue; // offline for a moment: keep waiting until the code expires
      }
      if (res.body.error === "authorization_pending") continue;
      pending = undefined;
      const token = res.body as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        user?: { uid: string; email?: string };
      };
      if (!token.refresh_token || !token.user || !apiUrl) {
        error = String(res.body.error_description ?? "signing in stopped; try again");
        changed();
        return;
      }
      error = undefined;
      await saveSession({ refreshToken: token.refresh_token, uid: token.user.uid, email: token.user.email, apiUrl });
      if (token.access_token) {
        access = { token: token.access_token, expires: now() + (token.expires_in ?? ACCESS_TTL_FALLBACK_S) * 1000 };
      }
      log(`account: signed in as ${token.user.email ?? token.user.uid}`);
      return;
    }
    if (pending === started) {
      pending = undefined;
      error = "the sign-in code expired; try again";
      changed();
    }
  }

  return {
    view,
    async load() {
      const raw = await readSecret(KEYCHAIN_SESSION, security);
      if (!raw) return;
      try {
        const saved = JSON.parse(raw) as Session;
        // A token for another server (a different build) is never sent to this one.
        if (saved.refreshToken && saved.apiUrl === apiUrl) session = saved;
      } catch {
        // an unreadable entry: as if signed out
      }
    },
    async signIn() {
      const res = await post<{
        device_code?: string;
        user_code?: string;
        verification_uri_complete?: string;
        expires_in?: number;
        interval?: number;
      }>("/v1/auth/device/start", { device_name: hostname().replace(/\.local$/, "") });
      if (!res.body.device_code || !res.body.user_code || !res.body.verification_uri_complete) {
        throw new Error(`Shadow's service answered ${res.status} starting the sign-in`);
      }
      const started = {
        deviceCode: res.body.device_code,
        userCode: res.body.user_code,
        url: res.body.verification_uri_complete,
        expiresAt: now() + (res.body.expires_in ?? 600) * 1000,
        interval: res.body.interval ?? 2,
      };
      pending = started;
      error = undefined;
      changed();
      (deps.openUrl ?? openInBrowser)(started.url);
      void poll(started);
      return { userCode: started.userCode, url: started.url, expiresAt: started.expiresAt };
    },
    async signOut() {
      pending = undefined;
      if (session && access) {
        await post("/v1/auth/signout", {}, access.token).catch(() => {});
      } else if (session) {
        await accessToken()
          .then((token) => post("/v1/auth/signout", {}, token))
          .catch(() => {});
      }
      await saveSession(undefined);
    },
    fetch: authedFetch,
    llm() {
      if (!session || !apiUrl) return undefined;
      // The key is a placeholder: authedFetch puts the access token in its place.
      model ??= createLlm(llmConfig({ apiKey: "shadow-account", baseUrl: `${apiUrl}/v1/llm` }), { fetch: authedFetch });
      return model;
    },
    async call(method, path, body) {
      if (!apiUrl) throw new Error("this build of Shadow has no service");
      const res = await authedFetch(`${apiUrl}${path}`, {
        method,
        ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const parsed = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (!res.ok) {
        const message = typeof parsed.error === "string" ? parsed.error : `Shadow's service answered ${res.status}`;
        throw new Error(message);
      }
      return parsed as never;
    },
  };
}
