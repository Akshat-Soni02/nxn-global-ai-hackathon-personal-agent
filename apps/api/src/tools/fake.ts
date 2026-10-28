// A toy connected app for tests and for running shadow-api locally without Composio (TOOLS=fake): one Google Sheet
// per user, kept in memory, with a read tool and an append tool shaped like Composio's. Connecting finishes at once.
// "Weather" is connected with the user's own key (N13), and has no tools.
import { type Connection, type KeyField, ToolError, type ToolInfo, type ToolProvider } from "./provider.ts";

const WEATHER_KEY: KeyField[] = [
  { name: "api_key", label: "API Key", description: "Your Weather key (fake)", secret: true, required: true },
];

const TOOLS: ToolInfo[] = [
  {
    name: "GOOGLESHEETS_GET_VALUES",
    title: "Read rows",
    description: "Reads the rows of a sheet (fake: one sheet per user, kept in memory).",
    inputSchema: {
      type: "object",
      properties: { spreadsheet_id: { type: "string" }, range: { type: "string" } },
      required: ["spreadsheet_id"],
    },
    toolkit: "googlesheets",
    readOnly: true,
    destructive: false,
  },
  {
    name: "GOOGLESHEETS_APPEND_VALUES",
    title: "Append rows",
    description: "Appends rows to a sheet (fake: one sheet per user, kept in memory).",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        range: { type: "string" },
        values: { type: "array", items: { type: "array", items: {} } },
      },
      required: ["spreadsheet_id", "values"],
    },
    toolkit: "googlesheets",
    readOnly: false,
    destructive: false,
  },
];

export function fakeTools(): ToolProvider & { sheet(uid: string): unknown[][] } {
  const connections = new Map<string, Connection[]>();
  const sheets = new Map<string, unknown[][]>();
  let next = 1;
  const sheet = (uid: string) => {
    let rows = sheets.get(uid);
    if (!rows) {
      rows = [];
      sheets.set(uid, rows);
    }
    return rows;
  };
  const connected = (uid: string) =>
    new Set((connections.get(uid) ?? []).filter((c) => c.status === "ACTIVE").map((c) => c.toolkit));
  return {
    sheet,
    async toolkits() {
      return [
        { slug: "googlesheets", name: "Google Sheets (fake)" },
        { slug: "weather", name: "Weather (fake)", key: true },
      ];
    },
    async keyFields(toolkit) {
      return toolkit === "weather" ? WEATHER_KEY : [];
    },
    async connections(uid) {
      return connections.get(uid) ?? [];
    },
    async connect(uid, toolkit, _callback, fields) {
      if (toolkit === "weather" && !fields?.api_key?.trim())
        throw new ToolError("connecting Weather (fake) needs your API Key", 400);
      const id = `fake_conn_${next++}`;
      connections.set(uid, [...(connections.get(uid) ?? []), { id, toolkit, status: "ACTIVE" }]);
      return toolkit === "weather"
        ? { id }
        : { id, redirectUrl: `https://example.invalid/connected?toolkit=${toolkit}` };
    },
    async disconnect(uid, connectionId) {
      const list = connections.get(uid) ?? [];
      if (!list.some((c) => c.id === connectionId)) return false;
      connections.set(
        uid,
        list.filter((c) => c.id !== connectionId),
      );
      return true;
    },
    async tools(uid) {
      const apps = connected(uid);
      return TOOLS.filter((t) => apps.has(t.toolkit));
    },
    async execute(uid, tool, args) {
      if (!connected(uid).has("googlesheets")) return { ok: false, error: "Google Sheets is not connected" };
      if (tool === "GOOGLESHEETS_GET_VALUES") return { ok: true, data: { values: sheet(uid) } };
      if (tool === "GOOGLESHEETS_APPEND_VALUES") {
        const values = args.values;
        if (!Array.isArray(values) || !values.every(Array.isArray))
          return { ok: false, error: "values must be a list of rows" };
        sheet(uid).push(...(values as unknown[][]));
        return { ok: true, data: { updates: { updatedRows: values.length } } };
      }
      return { ok: false, error: `no such tool: ${tool}` };
    },
  };
}
