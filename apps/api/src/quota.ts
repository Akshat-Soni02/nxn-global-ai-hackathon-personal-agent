// Quotas, checked by the service before every model or tool call: reserve what the call may cost, make the call,
// settle with what it really cost. The caps live only here and in Firestore, so editing the app can't change them.
// No caps for a user marked `developer`, or for everyone with QUOTAS=off; their use is still recorded.
import type { Config, Limits } from "./config.ts";
import type { Actual, QuotaKind, Store, Ticket } from "./store.ts";

export type Held =
  | { ok: true; ticket: Ticket }
  | { ok: false; message: string; scope: "day" | "month"; resetsAt: string };

export interface Quota {
  reserve(uid: string, kind: QuotaKind, amount: number): Promise<Held>;
  settle(ticket: Ticket, actual: Actual): Promise<void>;
  limitsFor(uid: string): Promise<Limits | undefined>;
}

export function quota(store: Store, config: Config, now: () => number = Date.now): Quota {
  async function limitsFor(uid: string): Promise<Limits | undefined> {
    if (!config.quotas) return undefined;
    const user = await store.getUser(uid);
    if (user?.developer) return undefined;
    return { ...config.limits, ...user?.limits };
  }
  return {
    limitsFor,
    async reserve(uid, kind, amount) {
      const result = await store.reserve(uid, kind, Math.max(1, Math.round(amount)), await limitsFor(uid), now());
      if (result.ok) return result;
      const what = kind === "llm" ? "AI" : "connected-app";
      const when = result.scope === "day" ? "tomorrow" : "next month";
      return {
        ok: false,
        scope: result.scope,
        resetsAt: result.resetsAt,
        message: `Your free ${what} use for this ${result.scope} is used up; it starts again ${when} (${result.resetsAt}).`,
      };
    },
    settle(ticket, actual) {
      return store.settle(ticket, actual);
    },
  };
}
