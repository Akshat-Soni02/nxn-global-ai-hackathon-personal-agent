// The API's two doors: local HTTP (token, Host and Origin checks, events) and the Unix socket (api.call, api.event).
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDecoder, encode } from "@shadow/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { type Api, createApi } from "./api.ts";
import { type Daemon, startDaemon } from "./daemon.ts";
import { type HttpApi, startHttp } from "./http.ts";
import type { Service } from "./service.ts";

// Just enough of a service for the API table: what each method was called with.
function fakeService() {
  const calls: unknown[][] = [];
  const service = {
    workflows: () => [{ id: "report", name: "Weekly report", versions: [1] }],
    goLive: (id: string) => ({ state: "live", since: 1, id }),
    start: (...args: unknown[]) => {
      calls.push(["start", ...args]);
      return { id: "run-1", status: "running" };
    },
  } as unknown as Service;
  return { service, calls };
}

type Reply = { status: number; body: string };
function send(
  port: number,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new Promise<Reply>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: init.method ?? "POST", headers: init.headers },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(init.body);
  });
}

let http: HttpApi | undefined;
let daemon: Daemon | undefined;
afterEach(async () => {
  await http?.close();
  await daemon?.close();
  http = daemon = undefined;
});

describe("the API on local HTTP", () => {
  const listeners = new Set<(e: unknown) => void>();
  const subscribe = (l: (e: unknown) => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };

  it("answers a call with the token, and writes where to find it in a file only the user can read", async () => {
    const { service } = fakeService();
    const infoFile = join(mkdtempSync(join(tmpdir(), "shadow-http-")), "api.json");
    http = await startHttp({ api: createApi(service), subscribe, infoFile });
    const info = JSON.parse(readFileSync(infoFile, "utf8"));
    expect(info).toMatchObject({ port: http.port, token: http.token });
    expect(statSync(infoFile).mode & 0o777).toBe(0o600);

    const ok = await send(http.port, "/api/workflows", { headers: { authorization: `Bearer ${http.token}` } });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ ok: true, value: [{ id: "report", name: "Weekly report", versions: [1] }] });
  });

  it("refuses a request without the token, for another host, or from a web page elsewhere", async () => {
    http = await startHttp({ api: createApi(fakeService().service), subscribe });
    const auth = { authorization: `Bearer ${http.token}` };
    expect((await send(http.port, "/api/workflows")).status).toBe(401);
    expect((await send(http.port, "/api/workflows", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    // DNS rebinding: a site that resolves its own name to 127.0.0.1 still sends its own Host.
    expect((await send(http.port, "/api/workflows", { headers: { ...auth, host: "evil.example:80" } })).status).toBe(
      403,
    );
    expect(
      (await send(http.port, "/api/workflows", { headers: { ...auth, origin: "https://evil.example" } })).status,
    ).toBe(403);
    const local = await send(http.port, "/api/workflows", { headers: { ...auth, origin: "http://localhost:5173" } });
    expect(local.status).toBe(200);
  });

  it("explains bad calls, and won't start a workflow from a file path", async () => {
    const { service, calls } = fakeService();
    http = await startHttp({ api: createApi(service), subscribe });
    const auth = { authorization: `Bearer ${http.token}`, "content-type": "application/json" };
    const unknown = await send(http.port, "/api/nope", { headers: auth, body: "{}" });
    expect(unknown).toMatchObject({ status: 400, body: JSON.stringify({ ok: false, error: "no method nope" }) });
    expect((await send(http.port, "/elsewhere", { headers: auth })).status).toBe(404);
    const missing = await send(http.port, "/api/workflow", { headers: auth, body: "{}" });
    expect(JSON.parse(missing.body)).toMatchObject({ ok: false, error: expect.stringContaining("id") });
    const path = await send(http.port, "/api/start", { headers: auth, body: JSON.stringify({ id: "/tmp/x.json" }) });
    expect(JSON.parse(path.body)).toMatchObject({ ok: false, error: expect.stringContaining("a workflow id") });
    const started = await send(http.port, "/api/start", { headers: auth, body: JSON.stringify({ id: "report" }) });
    expect(JSON.parse(started.body)).toEqual({ ok: true, value: { id: "run-1", status: "running" } });
    expect(calls).toEqual([["start", "report", {}, "manual"]]);
    // Method names with capitals reach the API too.
    const live = await send(http.port, "/api/goLive", { headers: auth, body: JSON.stringify({ id: "report" }) });
    expect(JSON.parse(live.body)).toEqual({ ok: true, value: { state: "live", since: 1, id: "report" } });
  });

  it("serves the window's files without the token, and nothing outside their folder", async () => {
    const root = mkdtempSync(join(tmpdir(), "shadow-ui-"));
    const staticDir = join(root, "dist");
    mkdirSync(staticDir);
    writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Shadow</title>");
    writeFileSync(join(staticDir, "app.js"), "console.log(1)");
    writeFileSync(join(root, "secret.txt"), "nope");
    http = await startHttp({ api: createApi(fakeService().service), subscribe, staticDir });
    const page = await new Promise<{ status: number; type?: string; csp?: string; body: string }>((resolve) => {
      request({ host: "127.0.0.1", port: http?.port, path: "/", method: "GET" }, (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            type: res.headers["content-type"],
            csp: res.headers["content-security-policy"] as string,
            body,
          }),
        );
      }).end();
    });
    expect(page).toMatchObject({
      status: 200,
      type: "text/html; charset=utf-8",
      body: expect.stringContaining("Shadow"),
    });
    expect(page.csp).toContain("connect-src 'self'");
    expect((await send(http.port, "/app.js", { method: "GET" })).status).toBe(200);
    expect((await send(http.port, "/%2e%2e/secret.txt", { method: "GET" })).status).toBe(404);
    expect((await send(http.port, "/..%2fsecret.txt", { method: "GET" })).status).toBe(404);
    // The API itself still needs the token.
    expect((await send(http.port, "/api/events", { method: "GET" })).status).toBe(401);
  });

  it("streams events to a subscriber", async () => {
    http = await startHttp({ api: createApi(fakeService().service), subscribe });
    const received = await new Promise<string>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: http?.port, path: `/api/events?token=${http?.token}`, method: "GET" },
        (res) => {
          let text = "";
          res.on("data", (c) => {
            text += c;
            if (text.includes("data:")) {
              resolve(text);
              req.destroy();
            }
          });
        },
      );
      req.on("error", (e) => (e.message.includes("aborted") ? undefined : reject(e)));
      req.end();
      setTimeout(() => {
        for (const l of listeners) l({ type: "inbox", item: { id: "i1" } });
      }, 50);
    });
    expect(received).toContain('data: {"type":"inbox","item":{"id":"i1"}}');
  });
});

describe("the API on the Unix socket", () => {
  it("answers api.call and sends api.event to subscribers", async () => {
    const socketPath = join(mkdtempSync(join(tmpdir(), "shadow-sock-")), "d.sock");
    const api: Api = createApi(fakeService().service);
    daemon = await startDaemon({ socketPath, api });
    const socket = connect(socketPath);
    const got: { type: string; id: string; ok?: boolean; value?: unknown; error?: string; event?: unknown }[] = [];
    socket.on(
      "data",
      createDecoder((m) => got.push(m as (typeof got)[number])),
    );
    const until = async (n: number) => {
      for (let i = 0; i < 100 && got.length < n; i++) await new Promise((r) => setTimeout(r, 10));
    };
    socket.write(encode({ id: "c1", type: "api.call", method: "workflows" }));
    socket.write(encode({ id: "c2", type: "api.call", method: "nope" }));
    socket.write(encode({ id: "s1", type: "api.subscribe" }));
    await until(3);
    daemon.publish({ type: "run", run: { id: "run-1" } });
    await until(4);
    socket.end();
    expect(got.find((m) => m.id === "c1")).toMatchObject({ type: "api.result", ok: true, value: [{ id: "report" }] });
    expect(got.find((m) => m.id === "c2")).toMatchObject({ type: "api.result", ok: false, error: "no method nope" });
    expect(got.find((m) => m.type === "api.event")).toMatchObject({ event: { type: "run", run: { id: "run-1" } } });
  });
});
