// Everything shadow-api keeps, behind one interface: Firestore on Cloud Run (firestore.ts), memory for tests and quick
// local runs. Layout (docs/cloud-architecture.md, "Quotas"):
//   users/{uid}                          email, plan, developer, limits (an override), created
//   devices/{deviceId}                   uid, refresh hash, name, created, lastSeen
//   deviceCodes/{deviceCode}             userCode, status, uid, expires
//   usage/{uid}/days/{yyyy-mm-dd}        model spend and tool calls that day (used and reserved)
//   usage/{uid}/months/{yyyy-mm}         the same for the month
import type { Limits } from "./config.ts";

export interface User {
  uid: string;
  email?: string;
  plan: "free";
  // No caps (usage still recorded). Set in the console or by scripts/admin, never by the app.
  developer?: boolean;
  // Per-user limits that replace the plan's.
  limits?: Partial<Limits>;
  created: number;
}

export interface Device {
  id: string;
  uid: string;
  refreshHash: string;
  name?: string;
  created: number;
  lastSeen: number;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  status: "pending" | "approved";
  uid?: string;
  deviceName?: string;
  expires: number;
}

export interface UsagePeriod {
  llmMicroUsd: number;
  llmReservedMicroUsd: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  toolReserved: number;
}

export type QuotaKind = "llm" | "tool";

// A held reservation, settled once the call is done.
export interface Ticket {
  uid: string;
  day: string;
  month: string;
  kind: QuotaKind;
  // micro-USD for llm, calls for tool.
  amount: number;
}

export type Reservation =
  | { ok: true; ticket: Ticket }
  | { ok: false; scope: "day" | "month"; used: number; limit: number; resetsAt: string };

export interface Actual {
  microUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  // Tool calls: whether to count it (a call refused before it reached the app is not counted).
  counted?: boolean;
}

export interface Store {
  getUser(uid: string): Promise<User | undefined>;
  // Creates the user on first sign-in; later only the email is refreshed.
  ensureUser(uid: string, email: string | undefined, now: number): Promise<User>;

  putDevice(device: Device): Promise<void>;
  getDevice(id: string): Promise<Device | undefined>;
  touchDevice(id: string, now: number): Promise<void>;
  deleteDevice(id: string): Promise<void>;

  putCode(code: DeviceCode): Promise<void>;
  getCode(deviceCode: string): Promise<DeviceCode | undefined>;
  findCode(userCode: string): Promise<DeviceCode | undefined>;
  approveCode(deviceCode: string, uid: string): Promise<void>;
  deleteCode(deviceCode: string): Promise<void>;

  // limits undefined: no caps (developer, or QUOTAS=off), but the reservation is still recorded.
  reserve(uid: string, kind: QuotaKind, amount: number, limits: Limits | undefined, now: number): Promise<Reservation>;
  settle(ticket: Ticket, actual: Actual): Promise<void>;
  usage(uid: string, now: number): Promise<{ day: UsagePeriod; month: UsagePeriod; dayKey: string; monthKey: string }>;
}

export const EMPTY_USAGE: UsagePeriod = {
  llmMicroUsd: 0,
  llmReservedMicroUsd: 0,
  llmCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
  toolReserved: 0,
};

// Periods are UTC days and months.
export function periodKeys(now: number): { day: string; month: string } {
  const iso = new Date(now).toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

export function resetTimes(now: number): { day: string; month: string } {
  const d = new Date(now);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const month = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { day: new Date(day).toISOString(), month: new Date(month).toISOString() };
}

// The quota check shared by both stores: would `amount` more fit in the day and the month, counting what is still
// reserved by calls in flight?
export function checkQuota(
  kind: QuotaKind,
  amount: number,
  day: UsagePeriod,
  month: UsagePeriod,
  limits: Limits | undefined,
  now: number,
): Reservation | undefined {
  if (!limits) return undefined;
  const taken = (p: UsagePeriod) =>
    kind === "llm" ? p.llmMicroUsd + p.llmReservedMicroUsd : p.toolCalls + p.toolReserved;
  const [dayLimit, monthLimit] =
    kind === "llm"
      ? [limits.llmMicroUsdPerDay, limits.llmMicroUsdPerMonth]
      : [limits.toolCallsPerDay, limits.toolCallsPerMonth];
  const resets = resetTimes(now);
  if (taken(month) + amount > monthLimit)
    return { ok: false, scope: "month", used: taken(month), limit: monthLimit, resetsAt: resets.month };
  if (taken(day) + amount > dayLimit)
    return { ok: false, scope: "day", used: taken(day), limit: dayLimit, resetsAt: resets.day };
  return undefined;
}

// What settling changes in a period: the reservation is released, the actual use added.
export function settleDelta(ticket: Ticket, actual: Actual): Partial<UsagePeriod> {
  if (ticket.kind === "llm") {
    return {
      llmReservedMicroUsd: -ticket.amount,
      llmMicroUsd: Math.max(0, Math.round(actual.microUsd ?? 0)),
      llmCalls: 1,
      inputTokens: actual.inputTokens ?? 0,
      outputTokens: actual.outputTokens ?? 0,
    };
  }
  return { toolReserved: -ticket.amount, toolCalls: actual.counted === false ? 0 : ticket.amount };
}

export function memoryStore(): Store {
  const users = new Map<string, User>();
  const devices = new Map<string, Device>();
  const codes = new Map<string, DeviceCode>();
  const periods = new Map<string, UsagePeriod>();
  const period = (key: string) => {
    let p = periods.get(key);
    if (!p) {
      p = { ...EMPTY_USAGE };
      periods.set(key, p);
    }
    return p;
  };
  const add = (p: UsagePeriod, delta: Partial<UsagePeriod>) => {
    for (const [k, v] of Object.entries(delta)) p[k as keyof UsagePeriod] += v ?? 0;
  };
  return {
    async getUser(uid) {
      return users.get(uid);
    },
    async ensureUser(uid, email, now) {
      const existing = users.get(uid);
      const user: User = existing
        ? { ...existing, email: email ?? existing.email }
        : { uid, email, plan: "free", created: now };
      users.set(uid, user);
      return user;
    },
    async putDevice(device) {
      devices.set(device.id, { ...device });
    },
    async getDevice(id) {
      return devices.get(id);
    },
    async touchDevice(id, now) {
      const d = devices.get(id);
      if (d) d.lastSeen = now;
    },
    async deleteDevice(id) {
      devices.delete(id);
    },
    async putCode(code) {
      codes.set(code.deviceCode, { ...code });
    },
    async getCode(deviceCode) {
      return codes.get(deviceCode);
    },
    async findCode(userCode) {
      return [...codes.values()].find((c) => c.userCode === userCode);
    },
    async approveCode(deviceCode, uid) {
      const c = codes.get(deviceCode);
      if (c) Object.assign(c, { status: "approved", uid });
    },
    async deleteCode(deviceCode) {
      codes.delete(deviceCode);
    },
    async reserve(uid, kind, amount, limits, now) {
      const { day, month } = periodKeys(now);
      const d = period(`${uid}/d/${day}`);
      const m = period(`${uid}/m/${month}`);
      const refused = checkQuota(kind, amount, d, m, limits, now);
      if (refused) return refused;
      const delta = kind === "llm" ? { llmReservedMicroUsd: amount } : { toolReserved: amount };
      add(d, delta);
      add(m, delta);
      return { ok: true, ticket: { uid, day, month, kind, amount } };
    },
    async settle(ticket, actual) {
      const delta = settleDelta(ticket, actual);
      add(period(`${ticket.uid}/d/${ticket.day}`), delta);
      add(period(`${ticket.uid}/m/${ticket.month}`), delta);
    },
    async usage(uid, now) {
      const { day, month } = periodKeys(now);
      return {
        day: { ...period(`${uid}/d/${day}`) },
        month: { ...period(`${uid}/m/${month}`) },
        dayKey: day,
        monthKey: month,
      };
    },
  };
}
