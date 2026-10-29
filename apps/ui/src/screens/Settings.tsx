// Settings (docs/design.md, "The app", screen 5): the account and its use, what may be captured while recording,
// Chrome, what Shadow remembers, and, folded away, the model, a developer's own key and where the files are. Connected
// apps have their own screen (Apps.tsx). Everything here is a call to the daemon; the window holds no secret: the key
// field is write-only.
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

const MODEL_USE: Record<string, string> = {
  fast: "AI steps in runs",
  smart: "designing and repairing workflows",
  vision: "describing masked pictures",
};

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
  const extensionFolder = s.bundle ? `${s.bundle}/Contents/Resources/extension` : "apps/extension/dist";

  return (
    <>
      <header className="page-header">
        <h1>Settings</h1>
      </header>

      {hasService ? (
        <section className="section">
          <h2>Account</h2>
          {s.account.signedIn ? (
            <>
              <div className="row">
                <span>
                  Signed in as <strong>{s.account.email ?? "you"}</strong>
                </span>
                <Action kind="danger" run={() => session.call("signOut").then(() => settings.reload())}>
                  Sign out
                </Action>
              </div>
              <UsageLine />
            </>
          ) : pending ? (
            <p>
              Finish signing in in your browser: the page shows <code className="strong">{pending.userCode}</code>.{" "}
              <a href={pending.url}>Open it again</a>
            </p>
          ) : (
            <>
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

      <section className="section">
        <h2>While recording</h2>
        <fieldset className="consent">
          <label>
            <input type="checkbox" checked={s.consent.screen} onChange={(e) => consent({ screen: e.target.checked })} />{" "}
            Screenshots <span className="muted small">only the words on them leave your Mac, private ones masked</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={s.consent.microphone}
              onChange={(e) => consent({ microphone: e.target.checked })}
            />{" "}
            Voice <span className="muted small">only the text leaves your Mac</span>
          </label>
          <label className={s.consent.screen ? undefined : "muted"}>
            <input
              type="checkbox"
              disabled={!s.consent.screen}
              checked={s.consent.screen && s.consent.pictures}
              onChange={(e) => consent({ pictures: e.target.checked })}
            />{" "}
            Pictures for the AI <span className="muted small">masked, only when the words aren't enough</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={s.consent.identifiers ?? false}
              onChange={(e) => consent({ identifiers: e.target.checked })}
            />{" "}
            Hide emails and ids from the AI{" "}
            <span className="muted small">
              emails, keys and long ids become ███ in what the models read; a step still uses the real ones
            </span>
          </label>
        </fieldset>
      </section>

      <section className="section">
        <h2>Chrome</h2>
        <div className="row">
          <span className={s.chrome.installed ? undefined : "error"}>
            {s.chrome.installed ? "Connected" : "Not connected"}
          </span>
          <Action run={() => session.call("setupChrome").then(() => settings.reload())}>
            {s.chrome.installed ? "Connect again" : "Connect Chrome"}
          </Action>
        </div>
        <details>
          <summary className="muted small">Loading the extension</summary>
          <p className="muted small">
            chrome://extensions → Developer mode → Load unpacked → <code>{extensionFolder}</code> → Details → Allow
            access to file URLs.
          </p>
          {/* Chrome's picker won't open Shadow.app by clicking (a package to it): ⌘⇧G takes a pasted path (Oct 29). */}
          <p className="muted small">
            Chrome's folder picker can't open Shadow.app by clicking: press ⌘⇧G in it, paste the path, press Return,
            then Select.
          </p>
          <Action run={() => navigator.clipboard.writeText(extensionFolder)}>Copy the path</Action>
        </details>
      </section>

      <section className="section">
        <h2>Memory</h2>
        {memory.data && memory.data.length > 0 ? (
          <table className="table compact">
            <tbody>
              {memory.data.map((m) => (
                <tr key={m.id}>
                  <td className="muted small">{m.kind.replace(/_/g, " ")}</td>
                  <td>{m.text}</td>
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
          <p className="muted">Nothing remembered yet. Answers you give and fixes Shadow makes are kept here.</p>
        )}
      </section>

      <details className="section advanced" open={!hasService && !s.key.present}>
        <summary>
          <h2>Advanced</h2>
        </summary>

        <h3>Model</h3>
        <div className="row">
          <span className="muted">
            {s.key.source === "env"
              ? "Your key from .env (no caps)"
              : s.key.source === "account"
                ? "Through your Shadow account"
                : s.key.source === "keychain"
                  ? "Your own key, from the Keychain"
                  : "Not set up"}
          </span>
          {s.key.present ? <Action run={runCheck}>Check</Action> : null}
        </div>
        {check ? (
          <p className={check.ok ? "ok-text" : "error"}>
            {check.ok
              ? `Works: answered in ${check.ms} ms`
              : `Doesn't work: ${
                  check.error ??
                  check.profiles
                    .filter((p) => !p.listed)
                    .map((p) => `${p.model} isn't reachable`)
                    .join("; ")
                }`}
          </p>
        ) : null}
        {Object.keys(s.models).length > 0 ? (
          <table className="table compact">
            <tbody>
              {Object.entries(s.models).map(([name, model]) => (
                <tr key={name}>
                  <td className="muted small">{MODEL_USE[name] ?? name}</td>
                  <td>
                    <code>{model}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <h3>Your own Token Factory key</h3>
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
              s.key.source === "keychain" ? "Paste a new key to replace it" : "Paste a key (kept in the Keychain)"
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
            Save
          </Action>
        </form>

        <h3>Files</h3>
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
      </details>
    </>
  );
}

const dollars = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

// This month's use in one line; against the free tier's limits when the account has them.
function UsageLine() {
  const usage = useQuery<Usage>("accountUsage");
  if (!usage.data) return usage.error ? <p className="error small">{usage.error}</p> : null;
  const { day, month, limits } = usage.data;
  const share = limits
    ? Math.max(month.llmMicroUsd / limits.llmMicroUsdPerMonth, month.toolCalls / limits.toolCallsPerMonth)
    : 0;
  return (
    <div className="usage">
      <span className="muted small">
        This month: AI {dollars(month.llmMicroUsd)}
        {limits ? ` of ${dollars(limits.llmMicroUsdPerMonth)}` : ""} · app calls {month.toolCalls}
        {limits ? ` of ${limits.toolCallsPerMonth}` : ""} · today {dollars(day.llmMicroUsd)}
        {limits ? "" : " · no limits on this account"}
      </span>
      {limits ? <meter className="meter" min={0} max={1} value={Math.min(1, share)} /> : null}
    </div>
  );
}
