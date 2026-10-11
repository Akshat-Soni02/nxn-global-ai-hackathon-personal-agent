// The API on local HTTP, for the app's window (docs/design.md, "The daemon as a service"). Only this Mac can reach it,
// and any web page open in the user's browser can also send requests to 127.0.0.1, so every request must:
// - carry the token made at each start (written to api.json, readable only by the user): `Authorization: Bearer`,
//   or `?token=` for the event stream, which EventSource can't add headers to;
// - name this server in Host (127.0.0.1 or localhost with our port), which stops DNS rebinding;
// - come from no Origin, a local one (http://127.0.0.1 or http://localhost, any port: the window in development),
//   or one listed in allowedOrigins (the app's window).
//
//   POST /api/<method>   JSON params in, { ok, value } or { ok: false, error } out (api.ts has the methods)
//   GET  /api/events     server-sent events: runs, steps and inbox changes as they happen
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Api } from "./api.ts";

const MAX_BODY = 1_000_000;
const HEARTBEAT_MS = 15_000;

export interface HttpApi {
  port: number;
  token: string;
  close(): Promise<void>;
}

export async function startHttp(options: {
  api: Api;
  subscribe(listener: (event: unknown) => void): () => void;
  // Where to write { port, token, pid } for the app (mode 0600). Omitted in tests.
  infoFile?: string;
  port?: number;
  allowedOrigins?: string[];
  log?: (...args: unknown[]) => void;
}): Promise<HttpApi> {
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(token);
  let port = 0;

  const authorized = (req: IncomingMessage, url: URL) => {
    const header = req.headers.authorization;
    const given = header?.startsWith("Bearer ")
      ? header.slice(7)
      : req.method === "GET"
        ? url.searchParams.get("token")
        : null;
    if (!given) return false;
    const buffer = Buffer.from(given);
    return buffer.length === expected.length && timingSafeEqual(buffer, expected);
  };
  const localOrigin = (origin: string) => {
    try {
      const u = new URL(origin);
      return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
    } catch {
      return false;
    }
  };
  const originAllowed = (origin: string | undefined) =>
    origin === undefined || localOrigin(origin) || (options.allowedOrigins ?? []).includes(origin);
  const hostAllowed = (host: string | undefined) => host === `127.0.0.1:${port}` || host === `localhost:${port}`;

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const origin = req.headers.origin;
    if (!hostAllowed(req.headers.host)) return json(res, 403, { ok: false, error: "wrong host" });
    if (!originAllowed(origin)) return json(res, 403, { ok: false, error: "origin not allowed" });
    if (origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-max-age": "600",
      });
      return res.end();
    }
    if (!authorized(req, url)) return json(res, 401, { ok: false, error: "missing or wrong token" });

    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      const unsubscribe = options.subscribe((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
      const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return;
    }

    const method = /^\/api\/([a-z]+)$/.exec(url.pathname)?.[1];
    if (req.method !== "POST" || !method) return json(res, 404, { ok: false, error: "not found" });
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        json(res, 413, { ok: false, error: "request too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (res.headersSent) return;
      let params: unknown;
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        params = text ? JSON.parse(text) : {};
      } catch {
        return json(res, 400, { ok: false, error: "the body is not JSON" });
      }
      options.api.call(method, params).then(
        (value) => json(res, 200, { ok: true, value: value ?? null }),
        (error: Error) => json(res, 400, { ok: false, error: error.message }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;
  if (options.infoFile) {
    writeFileSync(options.infoFile, `${JSON.stringify({ port, token, pid: process.pid })}\n`, { mode: 0o600 });
    chmodSync(options.infoFile, 0o600); // an existing file keeps its mode on write
  }
  options.log?.(`API on http://127.0.0.1:${port}`);

  return {
    port,
    token,
    close: () =>
      new Promise((resolve) => {
        if (options.infoFile) rmSync(options.infoFile, { force: true });
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
