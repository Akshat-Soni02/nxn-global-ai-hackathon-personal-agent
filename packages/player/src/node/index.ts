// Node-only parts of the player: used by the daemon, never bundled into the extension.

export { type DevChrome, launchChrome, MAC_CHROME } from "./chrome.ts";
export { dataChannel, pick } from "./data-channel.ts";
export { fsChannel } from "./fs-channel.ts";
export { checkFile, type FileRule, resolveInputs } from "./inputs.ts";
export {
  type AiLimits,
  type Ask,
  aiLimitsFromEnv,
  DEFAULT_AI_LIMITS,
  describeOutput,
  type LlmExecutor,
  llmExecutor,
  parseAnswer,
} from "./llm-step.ts";
export { expandHome, fileExists, findFiles, poll } from "./paths.ts";
export { SHELL_ALLOW_LIST, scriptChannel } from "./script-channel.ts";
