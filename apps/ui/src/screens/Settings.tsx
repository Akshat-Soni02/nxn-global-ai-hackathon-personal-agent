// Settings and health (docs/design.md, "The app", screen 5): the Token Factory key (to the Keychain), a connection
// check, the three consents, Chrome's connection, where things are on this Mac, and the memory Shadow keeps (view
// and forget). Everything here is a call to the daemon; the window holds no secret: the key field is write-only.
import type { Consent } from "@shadow/daemon/src/types.ts";
import { useState } from "react";
import { useQuery, useSession } from "../api.ts";
import { Action, Loading } from "../components.tsx";
import { ago } from "../format.ts";

interface SettingsView {
  consent: Consent;
  key: { present: boolean; source: "keychain" | "env" | "none" };
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
  const settings = useQuery<SettingsView>("settings");
  const memory = useQuery<MemoryEntry[]>("memory");
  const [key, setKey] = useState("");
  const [check, setCheck] = useState<ModelCheck>();
  if (!settings.data) return <Loading error={settings.error} />;
  const s = settings.data;
  const consent = (patch: Partial<Consent>) =>
    session.call("setConsent", { consent: { ...s.consent, ...patch } }).then(() => settings.reload());
  const runCheck = async () => setCheck(await session.call<ModelCheck>("checkModel"));

  return (
    <>
      <header className="page-header">
        <h1>Settings</h1>
        <p className="muted">Your model key, what Shadow may capture, and what it remembers.</p>
      </header>

      <section className="section">
        <h2>Model</h2>
        <p className="muted small">
          {s.key.present
            ? s.key.source === "env"
              ? "A key from the repo's .env is in use (development)."
              : "Your key is stored in the macOS Keychain, under Shadow's name."
            : "No key yet. Make one at tokenfactory.nebius.com and paste it here: it goes to your Keychain, never into a file."}
        </p>
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
            placeholder={s.key.present ? "Paste a new key to replace it" : "Paste your Token Factory key"}
            onChange={(e) => setKey(e.target.value)}
          />
          <Action
            kind="primary"
            run={async () => {
              await session.call("setApiKey", { key });
              setKey("");
              settings.reload();
              await runCheck();
            }}
          >
            Save and check
          </Action>
          {s.key.present ? <Action run={runCheck}>Check the connection</Action> : null}
        </form>
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
