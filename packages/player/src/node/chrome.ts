// Development/test path: launch a Chrome with a remote debugging port and speak CDP over a WebSocket.
// Production replay goes through chrome.debugger in the extension instead (same Cdp interface).
// Uses its own profile directory: Chrome refuses debugging on the default profile, and it keeps tests away
// from the user's real browsing data.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { userInfo } from "node:os";
import type { Cdp } from "../web/cdp.ts";

export const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export interface DevChrome {
  cdp: Cdp;
  close(): Promise<void>;
}

class WebSocketCdp implements Cdp {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id === undefined) return; // events are not used yet
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result);
    });
    ws.addEventListener("close", () => {
      for (const w of this.pending.values()) w.reject(new Error("CDP connection closed"));
      this.pending.clear();
    });
  }

  static open(url: string): Promise<WebSocketCdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new WebSocketCdp(ws)), { once: true });
      ws.addEventListener("error", () => reject(new Error(`cannot connect to ${url}`)), { once: true });
    });
  }

  send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

function waitForDevtoolsUrl(proc: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${output}`)), timeoutMs);
    proc.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const found = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (found?.[1]) {
        clearTimeout(timer);
        resolve(found[1]);
      }
    });
    proc.once("exit", (code) => reject(new Error(`Chrome exited with ${code}:\n${output}`)));
  });
}

export async function launchChrome(options: {
  profileDir: string;
  downloadDir?: string;
  headless?: boolean;
  chromePath?: string;
}): Promise<DevChrome> {
  mkdirSync(options.profileDir, { recursive: true });
  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${options.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,800", // fixed size so pages lay out the same on every run
    // Never touch the macOS keychain: this profile has no saved passwords, and a keychain lookup can raise a
    // system "Keychain Not Found" dialog when HOME is redirected (e.g. tests using a scratch home).
    "--use-mock-keychain",
    ...(options.headless ? ["--headless=new"] : []),
    "about:blank",
  ];
  // Chrome always gets the real home directory, even if this process runs with a redirected HOME.
  const env = { ...process.env, HOME: userInfo().homedir };
  const proc = spawn(options.chromePath ?? MAC_CHROME, args, { stdio: ["ignore", "ignore", "pipe"], env });
  const browserUrl = await waitForDevtoolsUrl(proc, 15_000);
  const port = new URL(browserUrl).port;

  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
    type: string;
    webSocketDebuggerUrl: string;
  }[];
  const pageTarget = targets.find((t) => t.type === "page");
  if (!pageTarget) throw new Error("Chrome has no page target");

  const browser = await WebSocketCdp.open(browserUrl);
  if (options.downloadDir) {
    mkdirSync(options.downloadDir, { recursive: true });
    await browser.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: options.downloadDir });
  }
  const page = await WebSocketCdp.open(pageTarget.webSocketDebuggerUrl);
  for (const domain of ["Page", "DOM", "Runtime", "Accessibility"]) await page.send(`${domain}.enable`);

  return {
    cdp: page,
    async close() {
      page.close();
      await browser.send("Browser.close").catch(() => {});
      browser.close();
      if (proc.exitCode === null) proc.kill();
    },
  };
}
