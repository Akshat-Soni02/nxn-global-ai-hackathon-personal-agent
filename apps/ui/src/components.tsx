// Small pieces the screens share.
import type { RunState, StateFile } from "@shadow/daemon/src/types.ts";
import { type ReactNode, useState } from "react";
import { STATE } from "./format.ts";

export function StatusChip({ status }: { status: RunState }) {
  const s = STATE[status];
  return <span className={`chip ${s.tone}`}>{s.label}</span>;
}

// A workflow's lifecycle state: live runs on its own, paused waits to be resumed, a draft only runs by hand.
export function StateChip({ state }: { state: StateFile }) {
  const [label, tone] =
    state.state === "live"
      ? ["Live", "ok"]
      : state.state === "paused"
        ? [state.auto ? "Paused by Shadow" : "Paused", "wait"]
        : ["Draft", "quiet"];
  return <span className={`chip ${tone}`}>{label}</span>;
}

// A button for an API action: disabled while it runs, its error shown under it.
export function Action({
  run,
  children,
  kind = "secondary",
  confirm,
}: {
  run: () => Promise<unknown>;
  children: ReactNode;
  kind?: "primary" | "secondary" | "danger";
  // Asks again on the button itself (no browser dialog, which the app's window doesn't show).
  confirm?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string>();
  const go = async () => {
    if (confirm && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setBusy(true);
    setError(undefined);
    try {
      await run();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="action">
      <button type="button" className={`button ${kind}${armed ? " armed" : ""}`} disabled={busy} onClick={go}>
        {armed ? confirm : children}
      </button>
      {armed ? (
        <button type="button" className="button link" onClick={() => setArmed(false)}>
          Keep it
        </button>
      ) : null}
      {error ? <span className="error">{error}</span> : null}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <p className="muted">{children}</p> : null}
    </div>
  );
}

export function Loading({ error }: { error?: string }) {
  return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
}
