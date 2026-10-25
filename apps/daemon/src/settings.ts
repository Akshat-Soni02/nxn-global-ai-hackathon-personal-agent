// Settings and first-run setup (docs/design.md, "The app", screen 5, and "Deployment", first run): what the window's
// Settings screen and Shadow.app's first-run window call through the API. The API key goes to the Keychain
// (keychain.ts), the consents to config.json, Chrome's connection file to its NativeMessagingHosts folder, and the
// connection check does what `pnpm llm:check` does: list the models and ask the fast one for one word.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EXTENSION_ID, NATIVE_HOST_NAME } from "@shadow/core";
import { createLlm, type Llm, type LlmConfig, llmConfig } from "@shadow/llm";
import type { MemoryEntry, MemoryStore } from "@shadow/memory";
import { type Account, type AccountView, openInBrowser, type Usage } from "./account.ts";
import { readApiKey, runSecurity, type SecurityRunner, writeApiKey } from "./keychain.ts";
import type { McpTool, McpTools } from "./mcp-tools.ts";
import { type Consent, readConsent, saveConsent } from "./recording-store.ts";

// account: the signed-in Shadow account (calls through shadow-api). env: NEBIUS_API_KEY in .env (development).
// keychain: a Token Factory key pasted in Settings (before Oct 25, or a developer's own key).
export type KeySource = "account" | "keychain" | "env" | "none";

export interface SettingsView {
  consent: Consent;
  key: { present: boolean; source: KeySource };
  account: AccountView;
  // Each profile's model id, when a key is configured.
  models: Record<string, string>;
  dataDir: string;
  logDir: string;
  // The packaged app's bundle, when the daemon runs from inside it.
  bundle?: string;
  chrome: { manifest: string; installed: boolean };
}

export interface ModelCheck {
  ok: boolean;
  reachable: number;
  // Each profile: whether the key can reach its model.
  profiles: { name: string; model: string; listed: boolean }[];
  answer?: string;
  error?: string;
  ms: number;
}

// What main.ts gives the settings: where things are, the model client as it changes, and how to replace it.
export interface SettingsDeps {
  dataDir: string;
  logDir: string;
  bundle?: string;
  // The native-host launcher Chrome should start: inside the app when packaged, the data folder's in development.
  nativeHost: string;
  model: () => Llm | undefined;
  keySource: () => KeySource;
  // A new key: main.ts makes a new client from it and hands it to everything that calls the model.
  applyKey: (config: LlmConfig) => void;
  // The Shadow account and its connected apps (account.ts, mcp-tools.ts). Absent in tests that don't need them.
  account?: Account;
  tools?: () => McpTools | undefined;
  memory: MemoryStore;
  security?: SecurityRunner;
  chromeManifestDir?: string;
  openUrl?: (url: string) => void;
}

export interface AppControl {
  settings(): SettingsView;
  setApiKey(key: string): Promise<SettingsView>;
  setConsent(consent: Consent): SettingsView;
  checkModel(): Promise<ModelCheck>;
  memory(): Promise<MemoryEntry[]>;
  forget(id: string): Promise<void>;
  // Writes Chrome's native-host manifest, so the extension can reach the daemon (first run).
  setupChrome(): SettingsView;
  // The account: sign in opens the browser and answers with the code it shows; the daemon finishes in the background.
  signIn(): Promise<SettingsView>;
  signOut(): Promise<SettingsView>;
  accountUsage(): Promise<Usage>;
  // Connected apps: what can be connected, what is, and the tools they offer.
  connectedApps(): Promise<ConnectedApps>;
  // Opens the app's sign-in page (Composio's) in the browser.
  connectApp(toolkit: string): Promise<{ redirectUrl: string }>;
  disconnectApp(connectionId: string): Promise<ConnectedApps>;
  appTools(): Promise<McpTool[]>;
}

export interface ConnectedApps {
  toolkits: { slug: string; name: string }[];
  connections: { id: string; toolkit: string; status: string; created?: string }[];
}

export function createAppControl(deps: SettingsDeps): AppControl {
  const manifestDir =
    deps.chromeManifestDir ??
    join(homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
  const manifestPath = join(manifestDir, `${NATIVE_HOST_NAME}.json`);
  const settings = (): SettingsView => {
    const model = deps.model();
    return {
      consent: readConsent(deps.dataDir),
      key: { present: model !== undefined, source: deps.keySource() },
      account: deps.account?.view() ?? { signedIn: false },
      models: model
        ? Object.fromEntries(Object.entries(model.config.profiles).map(([name, p]) => [name, p.model]))
        : {},
      dataDir: deps.dataDir,
      logDir: deps.logDir,
      bundle: deps.bundle,
      chrome: { manifest: manifestPath, installed: existsSync(manifestPath) },
    };
  };
  return {
    settings,
    async setApiKey(key) {
      await writeApiKey(key, deps.security ?? runSecurity);
      deps.applyKey(llmConfig({ apiKey: key.trim(), baseUrl: process.env.NEBIUS_BASE_URL }));
      return settings();
    },
    setConsent(consent) {
      saveConsent(deps.dataDir, consent);
      return settings();
    },
    async checkModel() {
      const started = Date.now();
      const model = deps.model();
      if (!model) return { ok: false, reachable: 0, profiles: [], error: "not signed in yet", ms: 0 };
      try {
        const listed = await model.listModels();
        const profiles = Object.entries(model.config.profiles).map(([name, p]) => ({
          name,
          model: p.model,
          listed: listed.includes(p.model),
        }));
        const reply = await model.generate({
          profile: "fast",
          user: "Reply with the single word: ready",
          maxTokens: 64,
        });
        const ok = profiles.every((p) => p.listed) && /ready/i.test(reply.text);
        return { ok, reachable: listed.length, profiles, answer: reply.text.slice(0, 80), ms: Date.now() - started };
      } catch (error) {
        return { ok: false, reachable: 0, profiles: [], error: (error as Error).message, ms: Date.now() - started };
      }
    },
    memory: () => deps.memory.list(),
    forget: (id) => deps.memory.remove(id),
    setupChrome() {
      mkdirSync(manifestDir, { recursive: true });
      const manifest = {
        name: NATIVE_HOST_NAME,
        description: "Shadow bridge between the Chrome extension and the daemon",
        path: deps.nativeHost,
        type: "stdio",
        allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
      };
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      return settings();
    },
    async signIn() {
      await needAccount().signIn();
      return settings();
    },
    async signOut() {
      await needAccount().signOut();
      return settings();
    },
    accountUsage: () => needAccount().call<Usage>("GET", "/v1/usage"),
    connectedApps,
    async connectApp(toolkit) {
      const res = await needAccount().call<{ redirect_url: string }>("POST", "/v1/tools/connect", { toolkit });
      (deps.openUrl ?? openInBrowser)(res.redirect_url);
      deps.tools?.()?.invalidate();
      return { redirectUrl: res.redirect_url };
    },
    async disconnectApp(connectionId) {
      await needAccount().call("DELETE", `/v1/tools/connections/${encodeURIComponent(connectionId)}`);
      deps.tools?.()?.invalidate();
      return connectedApps();
    },
    async appTools() {
      const tools = deps.tools?.();
      if (!tools) return [];
      return tools.list(true);
    },
  };

  function needAccount(): Account {
    if (!deps.account?.view().apiUrl) throw new Error("this build of Shadow has no service to sign in to");
    return deps.account;
  }

  async function connectedApps(): Promise<ConnectedApps> {
    const account = needAccount();
    if (!account.view().signedIn) throw new Error("sign in to Shadow first");
    const [kits, conns] = await Promise.all([
      account.call<{ toolkits: ConnectedApps["toolkits"] }>("GET", "/v1/tools/toolkits"),
      account.call<{ connections: ConnectedApps["connections"] }>("GET", "/v1/tools/connections"),
    ]);
    return { toolkits: kits.toolkits, connections: conns.connections };
  }
}

// The client for the key in the Keychain, when there is one (and no .env key took precedence).
export async function llmFromKeychain(security: SecurityRunner = runSecurity): Promise<Llm | undefined> {
  const key = await readApiKey(security);
  return key ? createLlm(llmConfig({ apiKey: key, baseUrl: process.env.NEBIUS_BASE_URL })) : undefined;
}
