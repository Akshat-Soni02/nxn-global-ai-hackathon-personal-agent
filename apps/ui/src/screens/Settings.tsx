// Settings and health (docs/design.md, "The app", screen 5): the Shadow account (sign in, usage against the free
// tier), connected apps, a connection check, the three consents, Chrome's connection, where things are on this Mac,
// and the memory Shadow keeps (view and forget). A developer's own Token Factory key can still be pasted (folded away).
// Everything here is a call to the daemon; the window holds no secret: the key field is write-only.
import type { Consent } from "@shadow/daemon/src/types.ts";
import { useEffect, useState } from "react";
import { useQuery, useSession } from "../api.ts";
import { Action, Loading } from "../components.tsx";
import { ago } from "../format.ts";

interface AccountView {
  apiUrl?: string;
  signedIn: boolean;
  email?: string;
  pending?: { userCode: string; url: string; expiresAt: number };
  error?: string;
}
interface Usage {
  day: { llmMicroUsd: number; toolCalls: number; llmCalls: number };
  month: { llmMicroUsd: number; toolCalls: number; llmCalls: number };
  limits: {
    llmMicroUsdPerDay: number;
    llmMicroUsdPerMonth: number;
    toolCallsPerDay: number;
    toolCallsPerMonth: number;
  } | null;
}
interface ConnectedApps {
  toolkits: { slug: string; name: string }[];
  connections: { id: string; toolkit: string; status: string; created?: string }[];
  declined: string[];
}
interface SettingsView {
  consent: Consent;
  key: { present: boolean; source: "account" | "keychain" | "env" | "none" };
  account: AccountView;
  models: Record<string, string>;
  dataDir: string;
  logDir: string;
  bundle?: string;
  chrome: { manifest: string; installed: boolean };
}
interface ModelCheck {
  ok: boolean;
  reachable: number;
  profiles: { name: string; model: string; listed: boolean }[];
  answer?: string;
  error?: string;
  ms: number;
}
interface MemoryEntry {
  id: string;
  kind: string;
  text: string;
  skillId?: string;
  createdAt: number;
}

export function Settings() {
  const session = useSession();
  // While the browser is open for signing in, look again every two seconds.
  const [watching, setWatching] = useState(false);
  const settings = useQuery<SettingsView>("settings", {}, { everyMs: watching ? 2000 : undefined });
  const memory = useQuery<MemoryEntry[]>("memory");
  const [key, setKey] = useState("");
  const [check, setCheck] = useState<ModelCheck>();
  const pending = settings.data?.account.pending;
  useEffect(() => setWatching(Boolean(pending)), [pending]);
  if (!settings.data) return <Loading error={settings.error} />;
  const s = settings.data;
  const consent = (patch: Partial<Consent>) =>
    session.call("setConsent", { consent: { ...s.consent, ...patch } }).then(() => settings.reload());
  const runCheck = async () => setCheck(await session.call<ModelCheck>("checkModel"));
  const hasService = Boolean(s.account.apiUrl);

  return (
    <>
      <header className="page-header">
        <h1>Settings</h1>
        <p className="muted">
          Your account, the apps Shadow may use for you, what it may capture, and what it remembers.
        </p>
      </header>

      {hasService ? (
        <section className="section">
          <h2>Account</h2>
          {s.account.signedIn ? (
            <>
              <p className="muted small">
                Signed in as <strong>{s.account.email ?? "you"}</strong>. AI calls go through Shadow's service, which
                adds its own Nebius key; your recordings and workflows stay on this Mac.
              </p>
              <div className="answers">
                <Action run={runCheck}>Check the connection</Action>
                <Action kind="danger" run={() => session.call("signOut").then(() => settings.reload())}>
                  Sign out
                </Action>
              </div>
              <UsageView />
            </>
          ) : pending ? (
            <>
              <p>
                Finish signing in in your browser. The page should show{" "}
                <code className="strong">{pending.userCode}</code>.
              </p>
              <p className="muted small">
                No page opened? <a href={pending.url}>Open it here</a>.
              </p>
            </>
          ) : (
            <>
              <p className="muted small">
                Sign in to use Shadow's AI and connect your apps. No API key needed: the free tier covers everyday use.
              </p>
              {s.account.error ? <p className="error">{s.account.error}</p> : null}
              <div className="answers">
                <Action kind="primary" run={() => session.call("signIn").then(() => settings.reload())}>
                  Sign in
                </Action>
              </div>
            </>
          )}
        </section>
      ) : null}

      {hasService && s.account.signedIn ? <ConnectedAppsView /> : null}

      <section className="section">
        <h2>Model</h2>
        <p className="muted small">
          {s.key.source === "env"
            ? "A key from the repo's .env is in use (development: no service, no caps)."
            : s.key.source === "account"
              ? "Through your Shadow account."
              : s.key.source === "keychain"
                ? "Your own Token Factory key, from the macOS Keychain."
                : hasService
                  ? "Sign in above to use the models."
                  : "No key yet. Make one at tokenfactory.nebius.com and paste it below: it goes to your Keychain, never into a file."}
        </p>
        {s.key.present && s.key.source !== "account" ? (
          <div className="answers">
            <Action run={runCheck}>Check the connection</Action>
          </div>
        ) : null}
        <details open={!hasService && !s.key.present}>
          <summary className="muted small">Use your own Token Factory key (developers)</summary>
          <form
            className="answers"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={key}
              placeholder={
                s.key.source === "keychain" ? "Paste a new key to replace it" : "Paste your Token Factory key"
              }
              onChange={(e) => setKey(e.target.value)}
            />
            <Action
              run={async () => {
                await session.call("setApiKey", { key });
                setKey("");
                settings.reload();
                await runCheck();
              }}
            >
              Save and check
            </Action>
          </form>
          <p className="muted small">
            Used only when you're not signed in. It goes to your Keychain, never into a file.
          </p>
        </details>
        {check ? (
          <p className={check.ok ? "ok-text" : "error"}>
            {check.ok
              ? `Connected to Nemotron: ${check.reachable} models reachable, answered "${check.answer}" in ${check.ms} ms.`
              : `Not connected: ${
                  check.error ??
                  check.profiles
                    .filter((p) => !p.listed)
                    .map((p) => `${p.model} is not reachable with this key`)
                    .join("; ")
                }`}
          </p>
        ) : null}
        {Object.keys(s.models).length > 0 ? (
          <table className="table compact">
            <tbody>
              {Object.entries(s.models).map(([name, model]) => (
                <tr key={name}>
                  <td className="strong">{name}</td>
                  <td>
                    <code>{model}</code>
                  </td>
                  <td className="muted small">
                    {name === "fast"
                      ? "LLM steps on every run"
                      : name === "smart"
                        ? "the design agent and the repair agent"
                        : "describing masked pictures, only with your consent"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="section">
        <h2>While recording</h2>
        <fieldset className="consent">
          <label>
            <input type="checkbox" checked={s.consent.screen} onChange={(e) => consent({ screen: e.target.checked })} />{" "}
            Take a picture of the window at each step. Only the words read from it on this Mac, with private ones
            masked, leave it.
          </label>
          <label>
            <input
              type="checkbox"
              checked={s.consent.microphone}
              onChange={(e) => consent({ microphone: e.target.checked })}
            />{" "}
            Record my voice while I explain. It becomes text on this Mac; only the text is sent.
          </label>
          <label className={s.consent.screen ? undefined : "muted"}>
            <input
              type="checkbox"
              disabled={!s.consent.screen}
              checked={s.consent.screen && s.consent.pictures}
              onChange={(e) => consent({ pictures: e.target.checked })}
            />{" "}
            Let the model see the masked pictures too, once, when the words are not enough (the design agent and the
            repair agent). Private lines and secret fields are blacked out first.
          </label>
        </fieldset>
        <p className="muted small">The Record form shows the same switches, and remembers what you chose last.</p>
      </section>

      <section className="section">
        <h2>Chrome</h2>
        <p className="muted small">
          {s.chrome.installed
            ? "Chrome knows how to reach Shadow."
            : "Chrome does not know how to reach Shadow yet: connect it, then load the extension."}
        </p>
        <div className="answers">
          <Action run={() => session.call("setupChrome").then(() => settings.reload())}>
            {s.chrome.installed ? "Connect Chrome again" : "Connect Chrome"}
          </Action>
        </div>
        <p className="muted small">
          The extension folder:{" "}
          <code>{s.bundle ? `${s.bundle}/Contents/Resources/extension` : "apps/extension/dist"}</code>. In Chrome:
          chrome://extensions → Developer mode → Load unpacked → that folder → Allow access to file URLs.
        </p>
      </section>

      <section className="section">
        <h2>Memory</h2>
        <p className="muted small">
          What Shadow remembers from your answers and from repairs: facts about you and your sites. Never secrets.
        </p>
        {memory.data && memory.data.length > 0 ? (
          <table className="table compact">
            <tbody>
              {memory.data.map((m) => (
                <tr key={m.id}>
                  <td className="muted small">{m.kind.replace(/_/g, " ")}</td>
                  <td>{m.text}</td>
                  <td className="muted small">{m.skillId ?? ""}</td>
                  <td className="muted small">{ago(m.createdAt)}</td>
                  <td className="right">
                    <Action kind="danger" run={() => session.call("forget", { id: m.id }).then(() => memory.reload())}>
                      Forget
                    </Action>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Nothing remembered yet.</p>
        )}
      </section>

      <section className="section">
        <h2>On this Mac</h2>
        <table className="table compact">
          <tbody>
            <tr>
              <td className="muted small">Data</td>
              <td>
                <code>{s.dataDir}</code>
              </td>
            </tr>
            <tr>
              <td className="muted small">Logs</td>
              <td>
                <code>{s.logDir}</code>
              </td>
            </tr>
            {s.bundle ? (
              <tr>
                <td className="muted small">App</td>
                <td>
                  <code>{s.bundle}</code>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}

const dollars = (micro: number) => `$${(micro / 1_000_000).toFixed(micro < 10_000 ? 4 : 2)}`;

function Meter({
  label,
  used,
  limit,
  show,
}: {
  label: string;
  used: number;
  limit?: number;
  show: (n: number) => string;
}) {
  const share = limit ? Math.min(1, used / limit) : 0;
  return (
    <tr>
      <td className="muted small">{label}</td>
      <td>
        {show(used)}
        {limit ? <span className="muted small"> of {show(limit)}</span> : null}
      </td>
      <td style={{ width: "40%" }}>{limit ? <meter className="meter" min={0} max={1} value={share} /> : null}</td>
    </tr>
  );
}

// Today's and this month's use, against the free tier (or no caps, for a developer account).
function UsageView() {
  const usage = useQuery<Usage>("accountUsage");
  if (!usage.data) return usage.error ? <p className="error">{usage.error}</p> : null;
  const { day, month, limits } = usage.data;
  const n = (v: number) => String(v);
  return (
    <>
      <h3>Usage</h3>
      {limits ? null : <p className="muted small">No caps on this account; use is still counted.</p>}
      <table className="table compact">
        <tbody>
          <Meter label="AI today" used={day.llmMicroUsd} limit={limits?.llmMicroUsdPerDay} show={dollars} />
          <Meter label="AI this month" used={month.llmMicroUsd} limit={limits?.llmMicroUsdPerMonth} show={dollars} />
          <Meter label="App calls today" used={day.toolCalls} limit={limits?.toolCallsPerDay} show={n} />
          <Meter label="App calls this month" used={month.toolCalls} limit={limits?.toolCallsPerMonth} show={n} />
        </tbody>
      </table>
    </>
  );
}

// Apps Shadow may use for you through Composio: a workflow step can then write to them directly ("add a row"),
// instead of clicking through their pages.
function ConnectedAppsView() {
  const session = useSession();
  // After "Connect", the app's sign-in page is open in the browser: look again until it shows up (five minutes at most).
  const [waiting, setWaiting] = useState<string>();
  const every = { everyMs: waiting ? 3000 : undefined };
  const apps = useQuery<ConnectedApps>("connectedApps", {}, every);
  const tools = useQuery<{ name: string; toolkit?: string }[]>("appTools", {}, every);
  useEffect(() => {
    if (!waiting) return;
    const stop = setTimeout(() => setWaiting(undefined), 5 * 60_000);
    return () => clearTimeout(stop);
  }, [waiting]);
  const connectedNow = apps.data?.connections.some((c) => c.toolkit === waiting && c.status === "ACTIVE");
  useEffect(() => {
    if (connectedNow) setWaiting(undefined);
  }, [connectedNow]);
  if (!apps.data) return <Loading error={apps.error} />;
  const active = (slug: string) => apps.data?.connections.find((c) => c.toolkit === slug && c.status === "ACTIVE");
  return (
    <section className="section">
      <h2>Connected apps</h2>
      <p className="muted small">
        Connect an app once, and a workflow can read or write it directly. Steps that change something still ask you
        first. Composio keeps the sign-in to each app; disconnect here at any time.
      </p>
      <table className="table compact">
        <tbody>
          {apps.data.toolkits.map((kit) => {
            const conn = active(kit.slug);
            const count = (tools.data ?? []).filter((t) => t.toolkit === kit.slug).length;
            return (
              <tr key={kit.slug}>
                <td className="strong">{kit.name}</td>
                <td className="muted small">
                  {conn
                    ? `Connected${count ? `: ${count} actions` : ""}`
                    : waiting === kit.slug
                      ? "Finish in your browser…"
                      : "Not connected"}
                  {apps.data?.declined.includes(kit.slug) ? (
                    <>
                      {" · not offered when you record "}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => session.call("offerAppAgain", { toolkit: kit.slug }).then(() => apps.reload())}
                      >
                        offer it again
                      </button>
                    </>
                  ) : null}
                </td>
                <td className="right">
                  {conn ? (
                    <Action
                      kind="danger"
                      run={() => session.call("disconnectApp", { id: conn.id }).then(() => apps.reload())}
                    >
                      Disconnect
                    </Action>
                  ) : (
                    <Action
                      run={async () => {
                        await session.call("connectApp", { toolkit: kit.slug });
                        setWaiting(kit.slug);
                      }}
                    >
                      Connect
                    </Action>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
