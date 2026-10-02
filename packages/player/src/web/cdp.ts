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
    } catch {
      // The page may be navigating; try again.
    }
    if (Date.now() >= deadline) return undefined;
    await sleep(intervalMs);
  }
}
