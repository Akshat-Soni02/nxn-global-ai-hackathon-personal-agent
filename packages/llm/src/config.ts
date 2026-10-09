// Configuration for the client. Passed in by the caller: the daemon builds it from the Keychain and config.json;
// development code and scripts use configFromEnv (.env).
import { CATALOG, DEFAULT_PROFILES, type ModelInfo, PROFILE_NAMES, type Profile, type ProfileName } from "./catalog.ts";

export const TOKEN_FACTORY_URL = "https://api.tokenfactory.nebius.com/v1";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  profiles: Record<ProfileName, Profile>;
  catalog: Record<string, ModelInfo>;
}

export interface LlmSettings {
  apiKey: string;
  baseUrl?: string;
  profiles?: Partial<Record<ProfileName, Partial<Profile>>>;
  catalog?: Record<string, ModelInfo>;
}

export function llmConfig(settings: LlmSettings): LlmConfig {
  if (!settings.apiKey) throw new Error("a Token Factory API key is needed");
  const profiles = Object.fromEntries(
    PROFILE_NAMES.map((name) => [name, { ...DEFAULT_PROFILES[name], ...settings.profiles?.[name] }]),
  ) as Record<ProfileName, Profile>;
  return {
    apiKey: settings.apiKey,
    baseUrl: (settings.baseUrl || TOKEN_FACTORY_URL).replace(/\/+$/, ""),
    profiles,
    catalog: { ...CATALOG, ...settings.catalog },
  };
}

// Development only: NEBIUS_API_KEY (required), NEBIUS_BASE_URL, and TASKPLAYER_MODEL_FAST / _SMART / _VISION to swap
// a profile's model. Undefined when there is no key, so callers can run without a model.
export function configFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig | undefined {
  if (!env.NEBIUS_API_KEY) return undefined;
  const model = (name: ProfileName) => env[`TASKPLAYER_MODEL_${name.toUpperCase()}`];
  return llmConfig({
    apiKey: env.NEBIUS_API_KEY,
    baseUrl: env.NEBIUS_BASE_URL,
    profiles: Object.fromEntries(
      PROFILE_NAMES.filter((name) => model(name)).map((name) => [name, { model: model(name) }]),
    ) as LlmSettings["profiles"],
  });
}
