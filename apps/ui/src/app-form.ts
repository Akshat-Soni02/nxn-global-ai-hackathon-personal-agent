// The App action form (R4.4): adding an app step by hand was a dropdown of tool names and a box of raw JSON
// (`{ "spreadsheet_id": "…" }`), so only the design agent did it well. Now each argument the tool takes gets its own
// field, of the kind its schema says, and an argument that names a document offers the ones the workflow works in.
import { type Skill, walkSteps } from "@shadow/core";

export type FieldKind = "text" | "number" | "yes/no" | "choice" | "rows" | "json" | "document";
export interface ArgumentField {
  name: string;
  kind: FieldKind;
  required: boolean;
  choices?: string[];
  hint?: string;
}

// An argument that names a document (spreadsheetId, spreadsheet_id, document_id, file_id).
const DOCUMENT = /(spreadsheet|document|presentation|file|doc)_?id$/i;

// The fields for a tool's arguments, the required ones first, at most 12 (the rest stay at the tool's defaults).
export function argumentFields(schema: Record<string, unknown>): ArgumentField[] {
  const props = (schema.properties ?? {}) as Record<
    string,
    { type?: unknown; enum?: unknown; items?: { type?: unknown }; description?: unknown }
  >;
  const requiredList = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const required = new Set(requiredList);
  const fields = Object.entries(props).map(([name, p]): ArgumentField => {
    const hint = typeof p.description === "string" ? p.description.split(/(?<=\.)\s/)[0]?.slice(0, 120) : undefined;
    const base = { name, required: required.has(name), ...(hint ? { hint } : {}) };
    if (Array.isArray(p.enum)) return { ...base, kind: "choice", choices: p.enum.map(String) };
    if (p.type === "string" && DOCUMENT.test(name)) return { ...base, kind: "document" };
    if (p.type === "boolean") return { ...base, kind: "yes/no" };
    if (p.type === "integer" || p.type === "number") return { ...base, kind: "number" };
    if (p.type === "array" && p.items?.type === "array") return { ...base, kind: "rows" };
    if (p.type === "array" || p.type === "object") return { ...base, kind: "json" };
    return { ...base, kind: "text" };
  });
  // Required ones first, in the schema's order, a document before them: it is what the step works in.
  const names = Object.keys(props);
  const rank = (f: ArgumentField) =>
    f.required ? (f.kind === "document" ? -1 : requiredList.indexOf(f.name)) : 1000 + names.indexOf(f.name);
  return fields.sort((a, b) => rank(a) - rank(b)).slice(0, 12);
}

// The tool's arguments from the form (each field is "arg.<name>"), or what is missing or wrong. Empty optional fields
// are left out. Rows are one per line, cells split by "|".
export function argumentsOf(fields: ArgumentField[], form: Record<string, string>): Record<string, unknown> | string {
  const args: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const field of fields) {
    const raw = form[`arg.${field.name}`] ?? "";
    if (!raw.trim()) {
      if (field.required) missing.push(field.name);
      continue;
    }
    switch (field.kind) {
      case "number": {
        const n = Number(raw.trim());
        if (!Number.isFinite(n)) return `${field.name} is a number`;
        args[field.name] = n;
        break;
      }
      case "yes/no":
        args[field.name] = /^(yes|true|on)$/i.test(raw.trim());
        break;
      case "rows":
        args[field.name] = raw
          .split("\n")
          .filter((line) => line.trim())
          // A "|" inside {{…}} is a value's format ({{today|D MMM}}), not a cell break.
          .map((line) => line.split(/\|(?![^{]*\}\})/).map((cell) => cell.trim()));
        break;
      case "json":
        try {
          args[field.name] = JSON.parse(raw);
        } catch {
          return `${field.name} is JSON: { "name": "value" } or [ … ]`;
        }
        break;
      default:
        args[field.name] = raw.trim();
    }
  }
  return missing.length > 0 ? `fill in ${missing.join(", ")}` : args;
}

// The documents the workflow works in (Google Sheets, Docs, Slides), by the step that opens each, for a document field.
export function documentsIn(skill: Skill): { id: string; label: string }[] {
  const docs: { id: string; label: string }[] = [];
  for (const { step } of walkSteps(skill.steps)) {
    if (step.type !== "action" || step.channel !== "web" || step.action !== "navigate") continue;
    const m = /docs\.google\.com\/(spreadsheets|document|presentation)\/d\/([A-Za-z0-9_-]{10,})/.exec(
      String(step.args.url ?? ""),
    );
    if (!m?.[2] || docs.some((d) => d.id === m[2])) continue;
    const what = m[1] === "spreadsheets" ? "sheet" : m[1] === "document" ? "document" : "presentation";
    const opens = `the ${what} ${step.id} opens`;
    docs.push({ id: m[2], label: step.tab ? `${step.tab} (${opens})` : opens });
  }
  return docs;
}
