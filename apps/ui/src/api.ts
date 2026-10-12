// The daemon's API from the window (apps/daemon/src/api.ts and http.ts). The window is served by the daemon, so calls
// go to its own origin. The token arrives in the URL's fragment (#token=…&to=/inbox): it is kept for this session and
// taken out of the address, and `to` says which screen to open (a notification opens its item).
import { createContext, useContext, useEffect, useState } from "react";

const TOKEN_KEY = "shadow.token";

export function takeToken(): string | undefined {
  const hash = location.hash.replace(/^#/, "");
  if (hash.startsWith("token=")) {
    const params = new URLSearchParams(hash);
    const token = params.get("token");
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    history.replaceState(null, "", `${location.pathname}#${params.get("to") ?? "/inbox"}`);
  }
  return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function call<T>(token: string, method: string, params: object = {}): Promise<T> {
  const res = await fetch(`/api/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = (await res.json().catch(() => ({ ok: false, error: res.statusText }))) as {
    ok: boolean;
    value?: T;
    error?: string;
  };
  if (!body.ok) throw new ApiError(body.error ?? "failed", res.status);
  return body.value as T;
}

// Every change the daemon reports (a run's step, a new inbox item) bumps `tick`, so what's on screen is fetched again.
export function useEvents(token: string | undefined): { tick: number; connected: boolean } {
  const [tick, setTick] = useState(0);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!token) return;
    const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    let pending: ReturnType<typeof setTimeout> | undefined;
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = () => {
      // A run's steps arrive in bursts: refetch once per burst.
      pending ??= setTimeout(() => {
        pending = undefined;
        setTick((t) => t + 1);
      }, 150);
    };
    return () => {
      clearTimeout(pending);
      source.close();
    };
  }, [token]);
  return { tick, connected };
}

export interface Session {
  token: string;
  tick: number;
  call<T>(method: string, params?: object): Promise<T>;
}

export const SessionContext = createContext<Session | undefined>(undefined);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("no session");
  return session;
}

// Fetches `method` now and again after every change (and every `everyMs`, for what changes without an event, like
// Chrome connecting). `data` keeps the last value while a refetch is on its way.
export function useQuery<T>(
  method: string,
  params: object = {},
  options: { everyMs?: number } = {},
): { data?: T; error?: string; reload(): void } {
  const session = useSession();
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!options.everyMs) return;
    const timer = setInterval(() => setNonce((n) => n + 1), options.everyMs);
    return () => clearInterval(timer);
  }, [options.everyMs]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on a change (tick), a reload (nonce) or new params (key)
  useEffect(() => {
    let live = true;
    session.call<T>(method, JSON.parse(key)).then(
      (data) => live && setState({ data }),
      (error: Error) => live && setState((s) => ({ ...s, error: error.message })),
    );
    return () => {
      live = false;
    };
  }, [method, key, session.tick, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}
