// Shadow's window (docs/design.md, "The app"): the inbox, workflows and runs, over the daemon's API. It holds no state
// of its own: every screen is fetched from the daemon and fetched again when the daemon reports a change.
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { call, SessionContext, takeToken, useEvents, useQuery } from "./api.ts";
import { money } from "./format.ts";
import { Apps } from "./screens/Apps.tsx";
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

// The sidebar folds to a strip of icons (its toggle keeps its place at the top-left either way), remembered on this
// Mac; a narrow window always shows the strip.
const FOLDED = "shadow.sidebar";

function useNarrow(): boolean {
  const query = "(max-width: 760px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setNarrow(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

function Shell({ connected }: { connected: boolean }) {
  // "#/record/again/<id>": the Record screen prefilled from a workflow, to record it again.
  const [screen = "inbox", id, sub] = useRoute();
  const inbox = useQuery<unknown[]>("inbox", { open: true });
  const waiting = inbox.data?.length ?? 0;
  useEffect(() => {
    document.title = waiting > 0 ? `Shadow (${waiting})` : "Shadow";
  }, [waiting]);
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(FOLDED) === "yes";
    } catch {
      return false;
    }
  });
  const narrow = useNarrow();
  const rail = folded || narrow;
  const fold = () => {
    setFolded(!folded);
    try {
      localStorage.setItem(FOLDED, folded ? "no" : "yes");
    } catch {
      // Not remembered, then: it still folds for now.
    }
  };

  const nav = [
    { to: "inbox", label: "Inbox", badge: waiting },
    { to: "workflows", label: "Workflows" },
    { to: "runs", label: "Runs" },
    { to: "record", label: "Record" },
    { to: "apps", label: "Apps" },
    { to: "settings", label: "Settings" },
  ] as const;
  return (
    <div className={`shell${rail ? " rail" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          {narrow ? null : (
            <button
              type="button"
              className="fold"
              aria-label={rail ? "Show the sidebar" : "Fold the sidebar"}
              aria-expanded={!rail}
              title={rail ? "Show the sidebar" : "Fold the sidebar"}
              onClick={fold}
            >
              <NavIcon name="sidebar" />
            </button>
          )}
          <span className="brand-name">
            <Mark />
            <span className="nav-label">Shadow</span>
          </span>
        </div>
        <nav>
          {nav.map((n) => (
            <a
              key={n.to}
              href={`#/${n.to}`}
              className={screen === n.to ? "active" : undefined}
              title={rail ? n.label : undefined}
              aria-label={"badge" in n && n.badge ? `${n.label}, ${n.badge} waiting` : n.label}
            >
              <NavIcon name={n.to} />
              <span className="nav-label">{n.label}</span>
              {"badge" in n && n.badge ? <span className="badge">{n.badge}</span> : null}
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
        {screen === "apps" && <Apps />}
        {screen === "settings" && <Settings />}
      </main>
    </div>
  );
}

// The sidebar's icons, drawn like the Record screen's (16 × 16, a 1.5 stroke in the text's color).
const NAV_ICONS: Record<string, ReactNode> = {
  sidebar: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <path d="M6 2.75v10.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M1.75 9.5 3.6 3.6a1 1 0 0 1 .95-.85h6.9a1 1 0 0 1 .95.85l1.85 5.9v2.75a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" />
      <path d="M1.75 9.5h3.5l1 1.75h3.5l1-1.75h3.5" />
    </>
  ),
  workflows: (
    <>
      <circle cx="4" cy="3.75" r="1.75" />
      <circle cx="4" cy="12.25" r="1.75" />
      <circle cx="12" cy="8" r="1.75" />
      <path d="M4 5.5v5M5.75 3.75c3 0 4.5 1 5.25 2.6M5.75 12.25c3 0 4.5-1 5.25-2.6" />
    </>
  ),
  runs: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.75 5.75v4.5L10.5 8z" />
    </>
  ),
  record: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <circle cx="8" cy="8" r="2.5" fill="currentColor" />
    </>
  ),
  apps: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1.25" />
      <rect x="9" y="2" width="5" height="5" rx="1.25" />
      <rect x="2" y="9" width="5" height="5" rx="1.25" />
      <path d="M11.5 9v5M9 11.5h5" />
    </>
  ),
  settings: (
    <>
      <path d="M2 4.75h1.75M7.25 4.75H14M2 11.25h6.75M12.25 11.25H14" />
      <circle cx="5.5" cy="4.75" r="1.75" />
      <circle cx="10.5" cy="11.25" r="1.75" />
    </>
  ),
};
function NavIcon({ name }: { name: string }) {
  return (
    <svg
      className="nav-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {NAV_ICONS[name]}
    </svg>
  );
}

// The mark (docs/design-ui.md): a white dot and the blue shadow it casts, on night blue.
function Mark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <title>Shadow</title>
      <rect width="64" height="64" rx="14" fill="#13142a" />
      <circle cx="36" cy="36" r="12" fill="#3a5bd9" opacity="0.85" />
      <circle cx="30" cy="30" r="12" fill="#fafaff" />
      <circle cx="30" cy="30" r="4" fill="#ef4444" />
    </svg>
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
        <div key={r.label} className="health-row" title={`${r.label}: ${r.text}`}>
          <span className={`dot ${r.ok ? "ok" : "bad"}`} />
          <span className="health-label">{r.label}</span>
          <span className="health-text">{r.text}</span>
        </div>
      ))}
      {usage.data && usage.data.todayUsd > 0 ? (
        <div className="health-row health-usage muted">Model use today: {money(usage.data.todayUsd)}</div>
      ) : null}
    </section>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
