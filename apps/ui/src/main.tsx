// Shadow's window (docs/design.md, "The app"): the inbox, workflows and runs, over the daemon's API. It holds no state
// of its own: every screen is fetched from the daemon and fetched again when the daemon reports a change.
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { call, SessionContext, takeToken, useEvents, useQuery } from "./api.ts";
import { money } from "./format.ts";
import { Inbox } from "./screens/Inbox.tsx";
import { Record } from "./screens/Record.tsx";
import { Run } from "./screens/Run.tsx";
import { Runs } from "./screens/Runs.tsx";
import { Settings } from "./screens/Settings.tsx";
import { Workflow } from "./screens/Workflow.tsx";
import { Workflows } from "./screens/Workflows.tsx";

// "#/runs/<id>" → ["runs", "<id>"]. A link with the token ("#token=…&to=/runs/<id>", how the app opens a notification's
// item) routes to its `to` until App has taken the token out of the address.
function readRoute(): string[] {
  let hash = location.hash.replace(/^#/, "");
  if (hash.startsWith("token=")) hash = new URLSearchParams(hash).get("to") ?? "/inbox";
  return hash.replace(/^\//, "").split("/").filter(Boolean);
}

function useRoute(): string[] {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

function App() {
  const [token, setToken] = useState(takeToken);
  // The app opens items in a window that is already showing ("#token=…&to=…"), and a restarted daemon has a new token.
  useEffect(() => {
    const onChange = () => {
      if (location.hash.startsWith("#token=")) setToken(takeToken());
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const { tick, connected } = useEvents(token);
  const session = useMemo(
    () => (token ? { token, tick, call: <T,>(m: string, p?: object) => call<T>(token, m, p) } : undefined),
    [token, tick],
  );
  if (!session) {
    return (
      <main className="locked">
        <h1>Shadow</h1>
        <p>Open this window from Shadow in the menu bar, or with the link the daemon prints when it starts.</p>
      </main>
    );
  }
  return (
    <SessionContext.Provider value={session}>
      <Shell connected={connected} />
    </SessionContext.Provider>
  );
}

function Shell({ connected }: { connected: boolean }) {
  // "#/record/again/<id>": the Record screen prefilled from a workflow, to record it again.
  const [screen = "inbox", id, sub] = useRoute();
  const inbox = useQuery<unknown[]>("inbox", { open: true });
  const waiting = inbox.data?.length ?? 0;
  useEffect(() => {
    document.title = waiting > 0 ? `Shadow (${waiting})` : "Shadow";
  }, [waiting]);

  const nav = [
    { to: "inbox", label: "Inbox", badge: waiting },
    { to: "workflows", label: "Workflows" },
    { to: "runs", label: "Runs" },
    { to: "record", label: "Record" },
    { to: "settings", label: "Settings" },
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Shadow</div>
        <nav>
          {nav.map((n) => (
            <a key={n.to} href={`#/${n.to}`} className={screen === n.to ? "active" : undefined}>
              <span>{n.label}</span>
              {n.badge ? <span className="badge">{n.badge}</span> : null}
            </a>
          ))}
        </nav>
        <Health connected={connected} />
      </aside>
      <main className="content">
        {screen === "inbox" && <Inbox />}
        {screen === "workflows" && !id && <Workflows />}
        {screen === "workflows" && id && <Workflow id={id} />}
        {screen === "runs" && !id && <Runs />}
        {screen === "runs" && id && <Run id={id} />}
        {screen === "record" && <Record again={id === "again" ? sub : undefined} />}
        {screen === "settings" && <Settings />}
      </main>
    </div>
  );
}

interface HealthInfo {
  extensions?: number;
  macApp?: { connected: boolean; trusted: boolean };
  model?: string;
  waitingForYou?: number;
  running?: string[];
}

function Health({ connected }: { connected: boolean }) {
  // Chrome and the app connect without an event: look again now and then.
  const { data } = useQuery<HealthInfo>("health", {}, { everyMs: 10_000 });
  const usage = useQuery<{ todayUsd: number }>("usage");
  const rows = [
    { label: "Shadow", ok: connected, text: connected ? "running" : "not reachable" },
    {
      label: "Chrome",
      ok: (data?.extensions ?? 0) > 0,
      text: (data?.extensions ?? 0) > 0 ? "connected" : "not connected",
    },
    {
      label: "Mac apps",
      ok: data?.macApp?.connected === true && data.macApp.trusted,
      text: !data?.macApp?.connected ? "app not running" : data.macApp.trusted ? "allowed" : "not allowed yet",
    },
    {
      label: "Model",
      ok: data?.model === "configured",
      text: data?.model === "configured" ? "Nemotron" : "no API key",
    },
  ];
  return (
    <section className="health" aria-label="Health">
      {rows.map((r) => (
        <div key={r.label} className="health-row">
          <span className={`dot ${r.ok ? "ok" : "bad"}`} />
          <span className="health-label">{r.label}</span>
          <span className="health-text">{r.text}</span>
        </div>
      ))}
      {usage.data && usage.data.todayUsd > 0 ? (
        <div className="health-row muted">Model use today: {money(usage.data.todayUsd)}</div>
      ) : null}
    </section>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
