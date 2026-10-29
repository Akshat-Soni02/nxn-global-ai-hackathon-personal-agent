// Connected apps, behind one interface so the MCP endpoint and the routes don't know Composio: composio.ts for real,
// fake.ts (a toy Google Sheet) for tests and local runs without a Composio key.

export interface ToolInfo {
  // The name the MCP client calls, e.g. GOOGLESHEETS_BATCH_UPDATE.
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // The toolkit (app) it belongs to, e.g. googlesheets.
  toolkit: string;
  // From the provider's hints. Neither set: treated as changing things (needs approval in a workflow).
  readOnly: boolean;
  destructive: boolean;
}

export interface Connection {
  id: string;
  toolkit: string;
  // ACTIVE once the user finished signing in; INITIATED while the sign-in page is open; others are failures.
  status: string;
  created?: string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

// An app a user may connect, as the Apps screen shows it.
export interface Toolkit {
  slug: string;
  name: string;
  logo?: string;
  description?: string;
  categories?: string[];
  // How many actions it offers (Composio's count).
  actions?: number;
  // Connecting asks for the user's own key for the app (N13), not a sign-in page.
  key?: boolean;
}

// What connecting an app with the user's own key asks for (keyFields): its API key, sometimes its address too.
export interface KeyField {
  name: string;
  label: string;
  description?: string;
  // Typed hidden, like a password.
  secret: boolean;
  required: boolean;
  default?: string;
}

export interface ToolProvider {
  // Every app a user may connect.
  toolkits(): Promise<Toolkit[]>;
  connections(uid: string): Promise<Connection[]>;
  // Starts connecting an app; the user finishes at `redirectUrl` in their browser. An app that needs the user's own
  // key is connected with `fields` at once, and has no `redirectUrl`.
  connect(
    uid: string,
    toolkit: string,
    callbackUrl?: string,
    fields?: Record<string, string>,
  ): Promise<{ id: string; redirectUrl?: string }>;
  // What connecting an app that needs the user's own key asks for.
  keyFields(toolkit: string): Promise<KeyField[]>;
  // Only the user's own connection; false when it isn't theirs or doesn't exist.
  disconnect(uid: string, connectionId: string): Promise<boolean>;
  // The tools of the apps this user connected (ACTIVE only).
  tools(uid: string): Promise<ToolInfo[]>;
  execute(uid: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
}

export class ToolError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ToolError";
  }
}
