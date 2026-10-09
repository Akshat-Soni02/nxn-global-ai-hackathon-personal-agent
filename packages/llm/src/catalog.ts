// The models we use on Nebius Token Factory and the profiles callers pick. Prices are US dollars per 1M tokens, from
// Token Factory's catalog (Oct 8, 2026); they and each profile's model can be overridden in config.

export interface ModelInfo {
  id: string;
  priceIn: number;
  priceOut: number;
  // What the model accepts. Checked before a request is sent, and confirmed with a real key by `pnpm llm:check`.
  vision: boolean;
  jsonSchema: boolean;
  tools: boolean;
  // Nemotron reasons by default; chat_template_kwargs.enable_thinking turns it on or off per call.
  thinkingControl: boolean;
  contextTokens: number;
}

export const CATALOG: Record<string, ModelInfo> = {
  "nvidia/Nemotron-3_5-Lightning": {
    id: "nvidia/Nemotron-3_5-Lightning",
    priceIn: 0.06,
    priceOut: 0.24,
    vision: false,
    jsonSchema: true,
    tools: true,
    thinkingControl: true,
    contextTokens: 1_000_000,
  },
  "nvidia/nemotron-3-super-120b-a12b": {
    id: "nvidia/nemotron-3-super-120b-a12b",
    priceIn: 0.3,
    priceOut: 0.9,
    vision: false,
    jsonSchema: true,
    tools: true,
    thinkingControl: true,
    contextTokens: 256_000,
  },
  "zai-org/GLM-5.3-Flash": {
    id: "zai-org/GLM-5.3-Flash",
    priceIn: 0.15,
    priceOut: 0.5,
    vision: true,
    jsonSchema: true,
    tools: false,
    thinkingControl: false,
    contextTokens: 1_000_000,
  },
};

export type ProfileName = "fast" | "smart" | "vision";
export const PROFILE_NAMES: readonly ProfileName[] = ["fast", "smart", "vision"];

// A model with its defaults. `thinking` only matters for models with thinking control; reasoning shares maxTokens
// with the answer, so a profile that thinks gets more room.
export interface Profile {
  model: string;
  thinking: boolean;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}

export const DEFAULT_PROFILES: Record<ProfileName, Profile> = {
  // llm steps on every run: cheap, quick, no reasoning.
  fast: {
    model: "nvidia/Nemotron-3_5-Lightning",
    thinking: false,
    maxTokens: 2_048,
    temperature: 0,
    timeoutMs: 60_000,
  },
  // The repair agent and the design agent: a small thinking budget.
  smart: {
    model: "nvidia/nemotron-3-super-120b-a12b",
    thinking: true,
    maxTokens: 8_192,
    temperature: 0,
    timeoutMs: 180_000,
  },
  // Describing redacted screenshots.
  vision: { model: "zai-org/GLM-5.3-Flash", thinking: false, maxTokens: 2_048, temperature: 0, timeoutMs: 90_000 },
};

export function costOf(model: ModelInfo | undefined, input: number, output: number): number {
  if (!model) return 0;
  return (input * model.priceIn + output * model.priceOut) / 1_000_000;
}
