import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Cdp, CdpTimeout, pollUntil, withTimeouts } from "./cdp.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const never: Cdp = { send: () => new Promise(() => {}) };

describe("withTimeouts", () => {
  it("passes answers through", async () => {
    const cdp = withTimeouts({ send: async <T>() => ({ ok: 1 }) as T });
    await expect(cdp.send("DOM.getDocument")).resolves.toEqual({ ok: 1 });
  });

  it("gives up on a call Chrome never answers, saying which call", async () => {
    const cdp = withTimeouts(never, { ms: 15_000 });
    const sent = cdp.send("Runtime.evaluate").catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(sent).resolves.toBe("Chrome did not answer Runtime.evaluate in 15 s");
  });

  it("waits longer for navigation", async () => {
    const cdp = withTimeouts(never, { ms: 15_000, longMs: 30_000 });
    let done = false;
    const sent = cdp.send("Page.navigate").catch(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    await sent;
    expect(done).toBe(true);
  });

  it("lets a timeout through polling, so a hung match says Chrome hung instead of 'target not found'", async () => {
    const polled = pollUntil(async () => {
      throw new CdpTimeout("Chrome did not answer Accessibility.queryAXTree in 15 s");
    }, 10_000);
    await expect(polled).rejects.toThrow("Chrome did not answer");
  });

  it("brings the window forward once and retries an accessibility query that hung", async () => {
    let calls = 0;
    let forward = 0;
    const cdp = withTimeouts(
      {
        send: <T>() => {
          calls++;
          return calls === 1 ? new Promise<T>(() => {}) : Promise.resolve({ nodes: [] } as T);
        },
      },
      {
        ms: 15_000,
        onSlow: async () => {
          forward++;
        },
      },
    );
    const sent = cdp.send("Accessibility.queryAXTree");
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(sent).resolves.toEqual({ nodes: [] });
    expect([calls, forward]).toEqual([2, 1]);
  });
});
