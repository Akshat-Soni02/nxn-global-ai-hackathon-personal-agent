// Apps (docs/cloud-architecture.md, "Connecting an app"): every app Shadow can use directly, through Composio. Connect
// one and a workflow reads or writes it without clicking through its pages. Connected apps come first, each with Check
// (does it work, the way a run uses it) and what it can do; then the whole catalogue, searchable.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useSession } from "../api.ts";
import { Action, Loading } from "../components.tsx";
import { appStep } from "../WorkflowTree.tsx";

interface Toolkit {
  slug: string;
  name: string;
  logo?: string;
  description?: string;
  categories?: string[];
  actions?: number;
}
interface ConnectedApps {
  toolkits: Toolkit[];
  connections: { id: string; toolkit: string; status: string; created?: string }[];
  declined: string[];
}
interface AppTool {
  name: string;
  description: string;
  toolkit?: string;
  readOnly: boolean;
  destructive: boolean;
}
interface AppCheck {
  ok: boolean;
  actions?: number;
  reads?: number;
  error?: string;
  ms: number;
}
interface Account {
  apiUrl?: string;
  signedIn: boolean;
  pending?: { userCode: string };
}

// The catalogue shows this many at a time.
const PAGE = 48;

export function Apps() {
  const session = useSession();
  const settings = useQuery<{ account: Account }>("settings", {}, { everyMs: 3000 });
  const account = settings.data?.account;
  if (!settings.data) return <Loading error={settings.error} />;
  return (
    <>
      <header className="page-header">
        <h1>Apps</h1>
        <p className="muted">Connect an app once; your workflows can then read and write it directly.</p>
      </header>
      {!account?.apiUrl ? (
        <p className="muted">Apps need Shadow's service, which this build doesn't have (SHADOW_API_URL).</p>
      ) : !account.signedIn ? (
        <div className="answers">
          <Action kind="primary" run={() => session.call("signIn")}>
            {account.pending ? `Finish signing in (code ${account.pending.userCode})` : "Sign in to connect apps"}
          </Action>
        </div>
      ) : (
        <Catalogue />
      )}
    </>
  );
}

function Catalogue() {
  const session = useSession();
  // After Connect, the app's sign-in page is open in the browser: look again until it shows up (five minutes at most).
  const [waiting, setWaiting] = useState<string>();
  const every = { everyMs: waiting ? 3000 : undefined };
  const apps = useQuery<ConnectedApps>("connectedApps", {}, every);
  const tools = useQuery<AppTool[]>("appTools", {}, every);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>();
  const [shown, setShown] = useState(PAGE);
  useEffect(() => {
    if (!waiting) return;
    const stop = setTimeout(() => setWaiting(undefined), 5 * 60_000);
    return () => clearTimeout(stop);
  }, [waiting]);
  const connectedNow = apps.data?.connections.some((c) => c.toolkit === waiting && c.status === "ACTIVE");
  useEffect(() => {
    if (connectedNow) setWaiting(undefined);
  }, [connectedNow]);

  const kits = apps.data?.toolkits ?? [];
  const categories = useMemo(() => {
    const count = new Map<string, number>();
    for (const k of kits) for (const c of k.categories ?? []) count.set(c, (count.get(c) ?? 0) + 1);
    return [...count]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([c]) => c);
  }, [kits]);
  if (!apps.data) return <Loading error={apps.error} />;

  const status = (slug: string) => {
    const mine = apps.data?.connections.filter((c) => c.toolkit === slug) ?? [];
    return mine.find((c) => c.status === "ACTIVE") ?? mine[0];
  };
  const connected = kits.filter((k) => status(k.slug)?.status === "ACTIVE");
  const words = query.trim().toLowerCase();
  const rest = kits.filter(
    (k) =>
      status(k.slug)?.status !== "ACTIVE" &&
      (!category || k.categories?.includes(category)) &&
      (!words || `${k.name} ${k.slug} ${k.description ?? ""}`.toLowerCase().includes(words)),
  );
  const connect = async (slug: string) => {
    await session.call("connectApp", { toolkit: slug });
    setWaiting(slug);
  };

  return (
    <>
      <section className="section">
        <h2>Connected</h2>
        {connected.length === 0 ? (
          <p className="muted">None yet. Pick one below.</p>
        ) : (
          <div className="app-grid">
            {connected.map((kit) => (
              <ConnectedCard
                key={kit.slug}
                kit={kit}
                connection={status(kit.slug)}
                actions={(tools.data ?? []).filter((t) => t.toolkit === kit.slug)}
                declined={apps.data?.declined.includes(kit.slug) ?? false}
                onChange={() => {
                  apps.reload();
                  tools.reload();
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>All apps</h2>
        <div className="app-filters">
          <input
            className="input"
            type="search"
            placeholder={`Search ${kits.length} apps`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
          />
          <div className="chips">
            <button type="button" className={`chip${category ? "" : " on"}`} onClick={() => setCategory(undefined)}>
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`chip${category === c ? " on" : ""}`}
                onClick={() => {
                  setCategory(category === c ? undefined : c);
                  setShown(PAGE);
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        {rest.length === 0 ? <p className="muted">No app matches.</p> : null}
        <div className="app-grid">
          {rest.slice(0, shown).map((kit) => {
            const stale = status(kit.slug);
            return (
              <article key={kit.slug} className="app-card">
                <AppHead kit={kit} />
                {kit.description ? <p className="app-desc">{kit.description}</p> : null}
                <div className="app-foot">
                  {waiting === kit.slug ? (
                    <span className="muted small">Finish in your browser…</span>
                  ) : stale ? (
                    <span className="error small">Needs connecting again</span>
                  ) : (
                    <span />
                  )}
                  <Action kind={stale ? "primary" : "secondary"} run={() => connect(kit.slug)}>
                    {stale ? "Reconnect" : "Connect"}
                  </Action>
                </div>
              </article>
            );
          })}
        </div>
        {rest.length > shown ? (
          <div className="answers">
            <Action run={async () => setShown(shown + PAGE)}>Show more ({rest.length - shown})</Action>
          </div>
        ) : null}
      </section>
    </>
  );
}

function AppHead({ kit }: { kit: Toolkit }) {
  return (
    <div className="app-head">
      {kit.logo ? <img className="app-logo" src={kit.logo} alt="" /> : <span className="app-logo blank" />}
      <div>
        <div className="strong">{kit.name}</div>
        {kit.actions ? <div className="muted small">{kit.actions} actions</div> : null}
      </div>
    </div>
  );
}

function ConnectedCard({
  kit,
  connection,
  actions,
  declined,
  onChange,
}: {
  kit: Toolkit;
  connection?: { id: string };
  actions: AppTool[];
  declined: boolean;
  onChange: () => void;
}) {
  const session = useSession();
  const [check, setCheck] = useState<AppCheck>();
  const [open, setOpen] = useState(false);
  const reads = actions.filter((t) => t.readOnly && !t.destructive);
  return (
    <article className="app-card connected">
      <AppHead kit={kit} />
      {check ? (
        <p className={check.ok ? "ok-text small" : "error small"}>
          {check.ok ? `Works: ${check.actions} actions reached in ${check.ms} ms` : `Doesn't work: ${check.error}`}
        </p>
      ) : (
        <p className="muted small">
          {actions.length} actions · {reads.length} only read; the rest ask you first
        </p>
      )}
      {declined ? (
        <p className="muted small">
          Not offered when you record.{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => session.call("offerAppAgain", { toolkit: kit.slug }).then(onChange)}
          >
            Offer it again
          </button>
        </p>
      ) : null}
      <div className="app-foot">
        <button type="button" className="link-button" onClick={() => setOpen(!open)} disabled={actions.length === 0}>
          {open ? "Hide" : "What it can do"}
        </button>
        <span className="app-buttons">
          <Action run={async () => setCheck(await session.call<AppCheck>("checkApp", { toolkit: kit.slug }))}>
            Check
          </Action>
          {connection ? (
            <Action
              kind="danger"
              confirm={`Disconnect ${kit.name}? Workflows that use it will stop at that step.`}
              run={() => session.call("disconnectApp", { id: connection.id }).then(onChange)}
            >
              Disconnect
            </Action>
          ) : null}
        </span>
      </div>
      {open ? (
        <ul className="app-actions">
          {actions.map((t) => (
            <li key={t.name}>
              <strong>{appStep(t.name).does}</strong>{" "}
              <span className="muted small">{t.readOnly && !t.destructive ? "reads" : "asks first"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
