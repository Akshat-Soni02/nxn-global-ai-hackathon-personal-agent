// Words and numbers as the window shows them.
import type { InboxKind, RunState } from "@shadow/daemon/src/types.ts";

export function ago(at: number, now = Date.now()): string {
  const s = Math.round((now - at) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(at).toLocaleDateString();
}

export const when = (at: number) => new Date(at).toLocaleString();

export function duration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s % 60)} s`;
}

export const money = (usd: number) => (usd === 0 ? "" : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);

export const STATE: Record<RunState, { label: string; tone: "ok" | "bad" | "wait" | "busy" | "quiet" }> = {
  running: { label: "Running", tone: "busy" },
  waiting: { label: "Waiting for you", tone: "wait" },
  succeeded: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  denied: { label: "Denied", tone: "quiet" },
  nothing_to_do: { label: "Nothing to do", tone: "quiet" },
  cancelled: { label: "Cancelled", tone: "quiet" },
  interrupted: { label: "Interrupted", tone: "bad" },
  skipped: { label: "Skipped", tone: "quiet" },
};

export const KIND: Record<InboxKind, string> = {
  approval: "Approval",
  ask: "Question",
  recovery: "Needs you",
  walk: "Walk-through",
  question: "Question",
  repaired: "Repaired",
  paused: "Paused",
};
