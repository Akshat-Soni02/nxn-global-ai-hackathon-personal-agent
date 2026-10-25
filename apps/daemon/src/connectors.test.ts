import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Account } from "./account.ts";
import { CONNECTED, daemonConnectors, declinedApps, KEEP_CLICKING, setDeclined } from "./connectors.ts";
import type { Question } from "./types.ts";

const chance = { toolkit: "googlesheets", name: "Google Sheets", why: "w", steps: ["s3"], ids: {} };

function world() {
  const dataDir = mkdtempSync(join(tmpdir(), "connectors-"));
  const active: string[] = [];
  const account = {
    view: () => ({ signedIn: true, apiUrl: "http://api.test" }),
    call: async () => ({ connections: active.map((toolkit) => ({ toolkit, status: "ACTIVE" })) }),
  } as unknown as Account;
  const asked: Question[] = [];
  const pending = new Map<string, (a: string) => void>();
  const answer = (id: string, a: string) => {
    pending.get(id)?.(a);
    pending.delete(id);
  };
  const connectors = daemonConnectors({
    dataDir,
    account,
    tools: () => undefined,
    ask: (question, onItem) => {
      asked.push(question);
      const id = `i${asked.length}`;
      const answered = new Promise<string>((resolve) => pending.set(id, resolve));
      onItem(id);
      return answered;
    },
    answer,
    every: 5,
  });
  return { dataDir, connectors, asked, answer, connect: (t: string) => active.push(t) };
}

describe("the question with the connect button", () => {
  it("is answered by the daemon once the app is connected in the browser", async () => {
    const w = world();
    const offered = w.connectors.offer(chance);
    expect(w.asked[0]).toMatchObject({
      title: "Use Google Sheets directly?",
      connect: { toolkit: "googlesheets", name: "Google Sheets" },
      options: [KEEP_CLICKING],
      freeText: false,
    });
    setTimeout(() => w.connect("googlesheets"), 20);
    expect(await offered).toBe("connected");
    expect(await w.connectors.status()).toEqual({ connected: ["googlesheets"], declined: [] });
  });

  it("keep clicking: classic, and the app is remembered as declined", async () => {
    const w = world();
    const offered = w.connectors.offer(chance);
    w.answer("i1", KEEP_CLICKING);
    expect(await offered).toBe("classic");
    w.connectors.decline("googlesheets");
    expect(declinedApps(w.dataDir)).toEqual(["googlesheets"]);
    expect(setDeclined(w.dataDir, "googlesheets", false)).toEqual([]);
    expect(CONNECTED).toBe("connected");
  });
});
