// The daemon's side of connected apps during a design (packages/recorder/src/design/v2/connectors.ts): which apps are
// connected (through the account), the question that carries the Sign in / Connect buttons, and the apps' tools.
// The question is answered by the daemon itself once the app shows up connected, so the design goes on by itself after
// the browser; "Keep clicking the page" answers it the other way, and that app isn't offered again (declined, kept in
// connectors.json; Settings → Connected apps can ask again).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConnectorChance, Connectors } from "@shadow/recorder";
import type { Account } from "./account.ts";
import type { McpTools } from "./mcp-tools.ts";
import type { Question } from "./types.ts";

export const KEEP_CLICKING = "Keep clicking the page";
export const CONNECTED = "connected";
// How often the question looks whether the app got connected in the browser.
const WATCH_MS = 3000;

const fileOf = (dataDir: string) => join(dataDir, "connectors.json");

export function declinedApps(dataDir: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(fileOf(dataDir), "utf8")) as { declined?: unknown };
    return Array.isArray(parsed.declined) ? parsed.declined.filter((d): d is string => typeof d === "string") : [];
  } catch {
    return [];
  }
}

export function setDeclined(dataDir: string, toolkit: string, declined: boolean): string[] {
  const now = new Set(declinedApps(dataDir));
  if (declined) now.add(toolkit);
  else now.delete(toolkit);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(fileOf(dataDir), `${JSON.stringify({ declined: [...now] }, null, 2)}\n`);
  return [...now];
}

export interface ConnectorDeps {
  dataDir: string;
  account: Account;
  // The MCP client as it is now (it changes when the user signs in).
  tools: () => McpTools | undefined;
  ask: (question: Question, onItem: (itemId: string) => void) => Promise<string>;
  answer: (itemId: string, answer: string) => void;
  // The recording the questions are about.
  sessionId?: () => string | undefined;
  log?: (line: string) => void;
  every?: number;
}

export function daemonConnectors(deps: ConnectorDeps): Connectors {
  const connected = async (): Promise<string[]> => {
    if (!deps.account.view().signedIn) return [];
    const res = await deps.account.call<{ connections: { toolkit: string; status: string }[] }>(
      "GET",
      "/v1/tools/connections",
    );
    return res.connections.filter((c) => c.status === "ACTIVE").map((c) => c.toolkit);
  };
  return {
    async status() {
      return { connected: await connected().catch((): string[] => []), declined: declinedApps(deps.dataDir) };
    },
    async offer(chance: ConnectorChance) {
      let timer: ReturnType<typeof setInterval> | undefined;
      let item: string | undefined;
      const answer = await deps.ask(
        {
          title: `Use ${chance.name} directly?`,
          why: `You worked in ${chance.name} by clicking its page. Shadow can do that work in ${chance.name} directly: ${chance.why}. Connect it below (sign in first if asked); the design goes on by itself once it is connected.`,
          options: [KEEP_CLICKING],
          freeText: false,
          connect: { toolkit: chance.toolkit, name: chance.name },
          step: chance.steps[0],
          sessionId: deps.sessionId?.(),
        },
        (itemId) => {
          item = itemId;
          timer = setInterval(async () => {
            const now = await connected().catch((): string[] => []);
            if (!now.includes(chance.toolkit) || !item) return;
            clearInterval(timer);
            try {
              deps.answer(item, CONNECTED);
              deps.log?.(`connectors: ${chance.toolkit} connected, the design goes on`);
            } catch {
              // answered meanwhile (Keep clicking): that answer stands
            }
          }, deps.every ?? WATCH_MS);
          timer.unref?.();
        },
      );
      clearInterval(timer);
      return answer === CONNECTED ? "connected" : "classic";
    },
    decline(toolkit) {
      setDeclined(deps.dataDir, toolkit, true);
    },
    async tools(toolkit) {
      const client = deps.tools();
      if (!client) return [];
      return (await client.list(true)).filter((t) => t.toolkit === toolkit);
    },
  };
}
