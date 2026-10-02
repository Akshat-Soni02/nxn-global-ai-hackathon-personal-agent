// Page checks (url_matches, text_visible, element_visible), polled until they hold or time runs out.
// file_exists is checked by the daemon, not here.
import type { Check } from "@taskplayer/core";
import { type Cdp, evaluate, pollUntil } from "./cdp.ts";
import { match } from "./match.ts";

export async function pageCheckHolds(cdp: Cdp, check: Check): Promise<boolean> {
  if (check.url_matches !== undefined) {
    const href = await evaluate<string>(cdp, "location.href");
    if (!href.includes(check.url_matches)) return false;
  }
  if (check.text_visible !== undefined) {
    const expr = `!!document.body && document.body.innerText.includes(${JSON.stringify(check.text_visible)})`;
    if (!(await evaluate<boolean>(cdp, expr))) return false;
  }
  if (check.element_visible !== undefined) {
    const outcome = await match(cdp, check.element_visible);
    if (outcome.status !== "found") return false;
    const quads = await cdp
      .send<{ quads: number[][] }>("DOM.getContentQuads", { backendNodeId: outcome.best.backendNodeId })
      .catch(() => ({ quads: [] }));
    if (quads.quads.length === 0) return false;
  }
  return true;
}

export function pagePart(check: Check | undefined): Check | undefined {
  if (!check) return undefined;
  const { file_exists: _ignored, ...page } = check;
  return Object.keys(page).length > 0 ? page : undefined;
}

// Waits for a check; returns true as soon as it holds.
export async function waitForCheck(cdp: Cdp, check: Check, timeoutMs: number): Promise<boolean> {
  return (await pollUntil(async () => ((await pageCheckHolds(cdp, check)) ? true : undefined), timeoutMs)) === true;
}
