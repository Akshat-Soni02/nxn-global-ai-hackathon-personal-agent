// The only thing the web executor needs: send one Chrome DevTools Protocol command to the tab being driven.
// In the extension this wraps chrome.debugger.sendCommand; in dev/tests it is a WebSocket to a debug-port Chrome.
export interface Cdp {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export interface RemoteObject {
  objectId?: string;
  value?: unknown;
}

// Runs `fn` (a function declaration as a string, `this` = the element) inside the page and returns its JSON result.
export async function callOn<T>(cdp: Cdp, backendNodeId: number, fn: string, ...args: unknown[]): Promise<T> {
  const { object } = await cdp.send<{ object: RemoteObject }>("DOM.resolveNode", { backendNodeId });
  const { result, exceptionDetails } = await cdp.send<{ result: RemoteObject; exceptionDetails?: { text: string } }>(
    "Runtime.callFunctionOn",
    {
      objectId: object.objectId,
      functionDeclaration: fn,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    },
  );
  if (exceptionDetails) throw new Error(`page script failed: ${exceptionDetails.text}`);
  return result.value as T;
}

// Evaluates an expression in the page; throws while the page is between documents (callers poll).
export async function evaluate<T>(cdp: Cdp, expression: string): Promise<T> {
  const { result, exceptionDetails } = await cdp.send<{ result: RemoteObject; exceptionDetails?: { text: string } }>(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
  );
  if (exceptionDetails) throw new Error(`page expression failed: ${exceptionDetails.text}`);
  return result.value as T;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pollUntil<T>(
  attempt: () => Promise<T | undefined>,
  timeoutMs: number,
  intervalMs = 200,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await attempt();
      if (value !== undefined) return value;
    } catch (error) {
      // A call Chrome never answered is not a page in between documents: stop and say so (classify.ts: environment).
      // Swallowed here, a hung match ended as "target not found", was classed drift, and went to the fuzzy retarget.
      if (error instanceof CdpTimeout) throw error;
      // The page may be navigating; try again.
    }
    if (Date.now() >= deadline) return undefined;
    await sleep(intervalMs);
  }
}

export class CdpTimeout extends Error {}

// Navigating, printing and taking a picture may take longer than a query.
const LONG = /^Page\.(navigate|captureScreenshot|printToPDF)$/;

// Every DevTools call gets a limit. Without one, a call Chrome never answered held a step until the daemon gave up
// (35-50 s, seen in three real runs: reports/oct19-two-recordings.md §5). Accessibility queries hung for a page in a
// window behind another one, so a hung accessibility query brings the automation window forward (onSlow) and is tried
// once more.
export function withTimeouts(
  cdp: Cdp,
  options: { ms?: number; longMs?: number; onSlow?: () => Promise<void> } = {},
): Cdp {
  const ms = options.ms ?? 15_000;
  const longMs = options.longMs ?? 30_000;
  const once = <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
    const limit = LONG.test(method) ? longMs : ms;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new CdpTimeout(`Chrome did not answer ${method} in ${Math.round(limit / 1000)} s`)),
        limit,
      );
    });
    return Promise.race([cdp.send<T>(method, params), timeout]).finally(() => clearTimeout(timer));
  };
  return {
    async send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
      try {
        return await once<T>(method, params);
      } catch (error) {
        if (!(error instanceof CdpTimeout) || !method.startsWith("Accessibility.") || !options.onSlow) throw error;
        await options.onSlow();
        return once<T>(method, params);
      }
    },
  };
}
