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
import { readApiKey, runSecurity, type SecurityRunner, writeApiKey } from "./keychain.ts";
import { type Consent, readConsent, saveConsent } from "./recording-store.ts";

export type KeySource = "keychain" | "env" | "none";

export interface SettingsView {
  consent: Consent;
  key: { present: boolean; source: KeySource };
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
  memory: MemoryStore;
  security?: SecurityRunner;
  chromeManifestDir?: string;
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
      if (!model) return { ok: false, reachable: 0, profiles: [], error: "no API key yet", ms: 0 };
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
  };
}

// The client for the key in the Keychain, when there is one (and no .env key took precedence).
export async function llmFromKeychain(security: SecurityRunner = runSecurity): Promise<Llm | undefined> {
  const key = await readApiKey(security);
  return key ? createLlm(llmConfig({ apiKey: key, baseUrl: process.env.NEBIUS_BASE_URL })) : undefined;
}
