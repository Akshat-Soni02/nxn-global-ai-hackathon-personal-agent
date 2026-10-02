// Browser-safe parts of the player: bundled into the extension, also usable from Node with a WebSocket Cdp.
export type { Cdp } from "./cdp.ts";
export { pageCheckHolds, waitForCheck } from "./checks.ts";
export { DEFAULT_WEB_TIMEOUT_MS, executeWebStep } from "./executor.ts";
export { equivalentRoles, match, nameSimilarity } from "./match.ts";
