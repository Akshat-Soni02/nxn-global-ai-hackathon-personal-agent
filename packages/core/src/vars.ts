// Variables: the fixed set of types, references like {{invoice.amount}}, and checking values against types.
// Shared by the save-time check (check.ts) and the player, so both read references the same way.
import { z } from "zod";

export const SCALAR_TYPES = ["text", "number", "boolean", "date", "file", "secret"] as const;
export type ScalarTypeName = (typeof SCALAR_TYPES)[number];

// One way to write a type. An object without `fields` is open: any fields, of unknown type (rows read from a sheet).
export type VarType =
  | { type: ScalarTypeName }
  | { type: "list"; items: VarType }
  | { type: "object"; fields?: Record<string, VarType> };

export const VarType: z.ZodType<VarType> = z.lazy(() =>
  z.union([
    z.object({ type: z.enum(SCALAR_TYPES) }).strict(),
    z.object({ type: z.literal("list"), items: VarType }).strict(),
    z.object({ type: z.literal("object"), fields: z.record(z.string(), VarType).optional() }).strict(),
  ]),
) as z.ZodType<VarType>;

// A file value is an object, so {{file.path}} and {{file.name}} are ordinary fields.
export const FILE_FIELDS: Record<string, VarType> = {
  path: { type: "text" },
  name: { type: "text" },
  size: { type: "number" },
  modified: { type: "text" },
};
export interface FileValue {
  path: string;
  name: string;
  size: number;
  modified: string;
}

export const BUILT_INS: Record<string, VarType> = { today: { type: "date" }, week_start: { type: "date" } };
// week_start came later than today: a workflow saved before may declare its own (the design doc's KPI example), and
// its own wins, so only today is reserved.
const RESERVED = new Set(["today"]);

// A variable name: what a trigger input, a step's output, an ask's output and a loop's item declare.
export const VarName = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .refine((n) => !RESERVED.has(n), { message: "reserved name" });

export const typeText = (t: VarType): string =>
  t.type === "list"
    ? `list of ${typeText(t.items)}`
    : t.type === "object"
      ? t.fields
        ? `{ ${Object.entries(t.fields)
            .map(([k, f]) => `${k}: ${typeText(f)}`)
            .join(", ")} }`
        : "object"
      : t.type;

export const sameType = (a: VarType, b: VarType): boolean =>
  JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const sortKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
        )
      : v;

// ---- References -------------------------------------------------------------------------------------------------

export interface Ref {
  // The text between the braces, e.g. "invoice.amount".
  expr: string;
  name: string;
  path: string[];
}

const REF = /\{\{\s*([^}]+?)\s*\}\}/g;
const SEGMENT = /^(?:[a-z][a-z0-9_]*|[A-Za-z_][A-Za-z0-9_ -]*|\d+)$/;

export function parseRef(expr: string): Ref | undefined {
  const [name, ...path] = expr.split(".");
  if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) return undefined;
  if (path.some((p) => !SEGMENT.test(p))) return undefined;
  return { expr, name, path };
}

// Every {{…}} inside a value, with where it was found. Strings under `skip` keys are left out (extract's `each`
// is filled per element with {{text}} and {{href}}, not from variables).
export function findRefs(
  value: unknown,
  at = "",
  skip: ReadonlySet<string> = new Set(["each"]),
): { at: string; expr: string }[] {
  if (typeof value === "string") return [...value.matchAll(REF)].map((m) => ({ at, expr: m[1] as string }));
  if (Array.isArray(value)) return value.flatMap((v, i) => findRefs(v, at ? `${at}.${i}` : `${i}`, skip));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => (skip.has(k) ? [] : findRefs(v, at ? `${at}.${k}` : k, skip)));
  }
  return [];
}

// The type at a path inside a type; undefined when the path does not exist. `unknown` stands for "could be anything"
// (inside an open object).
export type PathType = VarType | "unknown";
export function typeAt(type: PathType, path: string[]): PathType | undefined {
  let t: PathType = type;
  for (const segment of path) {
    if (t === "unknown") return "unknown";
    if (t.type === "list") {
      if (!/^\d+$/.test(segment)) return undefined;
      t = t.items;
    } else if (t.type === "object") {
      if (!t.fields) return "unknown";
      const f: VarType | undefined = t.fields[segment];
      if (!f) return undefined;
      t = f;
    } else if (t.type === "file") {
      const f: VarType | undefined = FILE_FIELDS[segment];
      if (!f) return undefined;
      t = f;
    } else {
      return undefined;
    }
  }
  return t;
}

// The value at a path inside a value. Throws a message that names the missing piece.
export function valueAt(name: string, value: unknown, path: string[]): unknown {
  let v = value;
  let where = name;
  for (const segment of path) {
    if (Array.isArray(v) && /^\d+$/.test(segment)) {
      if (Number(segment) >= v.length) throw new Error(`${where} has no item ${segment} (it has ${v.length})`);
      v = v[Number(segment)];
    } else if (v && typeof v === "object" && !Array.isArray(v) && segment in v) {
      v = (v as Record<string, unknown>)[segment];
    } else {
      throw new Error(`${where} has no field ${segment}`);
    }
    where = `${where}.${segment}`;
  }
  return v;
}

// ---- Values -----------------------------------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// The number in a piece of text, or undefined. Only text holding exactly one number counts ("Rs. 500", "$1,234.50",
// "142 points"); the old way of dropping every character that wasn't a digit, dot or minus turned "3 of 5" into 35 and
// "Rs. 500" into 0.5. A number touching a letter ("12k", "A1"), a comma that isn't a thousands group ("1.234,56",
// "1,23") or a second number (a date, "2.0.1") has more than one reading, so it has none: the run fails and says so.
export function numberFrom(text: string): number | undefined {
  const found = [...text.matchAll(/[-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)/g)];
  const [only] = found;
  if (found.length !== 1 || !only) return undefined;
  const at = only.index ?? 0;
  if (/[A-Za-z]/.test(text[at - 1] ?? "") || /[A-Za-z]/.test(text[at + only[0].length] ?? "")) return undefined;
  const digits = only[0].replace(/^[-+]/, "");
  if (digits.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(digits)) return undefined;
  const n = Number(only[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

// A value made to fit a type, or undefined when it cannot. Text that means a number or a yes/no is converted
// ("1,234" → 1234), so values read from pages and models can be checked against the declared type.
export function fitValue(type: VarType, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  switch (type.type) {
    case "text":
    case "secret":
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : undefined;
    case "number": {
      if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
      return typeof value === "string" ? numberFrom(value) : undefined;
    }
    case "boolean":
      if (typeof value === "boolean") return value;
      return typeof value === "string"
        ? /^(true|yes)$/i.test(value.trim())
          ? true
          : /^(false|no)$/i.test(value.trim())
            ? false
            : undefined
        : undefined;
    case "date": {
      const text = String(value).trim();
      return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : undefined;
    }
    case "file": {
      if (typeof value === "string" && value) {
        return { path: value, name: value.split("/").pop() ?? value, size: 0, modified: "" } satisfies FileValue;
      }
      if (isRecord(value) && typeof value.path === "string") {
        return {
          path: value.path,
          name: typeof value.name === "string" ? value.name : (value.path.split("/").pop() ?? value.path),
          size: typeof value.size === "number" ? value.size : 0,
          modified: typeof value.modified === "string" ? value.modified : "",
        } satisfies FileValue;
      }
      return undefined;
    }
    case "list": {
      if (!Array.isArray(value)) return undefined;
      const items = value.map((item) => fitValue(type.items, item));
      return items.every((i) => i !== undefined) ? items : undefined;
    }
    case "object": {
      if (!isRecord(value)) return undefined;
      if (!type.fields) return value;
      const out: Record<string, unknown> = {};
      for (const [name, field] of Object.entries(type.fields)) {
        const fitted = fitValue(field, value[name]);
        if (fitted === undefined) return undefined;
        out[name] = fitted;
      }
      return out;
    }
  }
}

// A type as JSON Schema, for asking a model for a value of it (structured output). Objects are closed and every
// field required, as strict structured output wants; fitValue still checks and converts the answer.
export function jsonSchemaOf(type: VarType): Record<string, unknown> {
  switch (type.type) {
    case "text":
    case "secret":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "date":
      return { type: "string", description: "a date as YYYY-MM-DD" };
    case "file":
      return jsonSchemaOf({ type: "object", fields: { path: { type: "text" } } });
    case "list":
      return { type: "array", items: jsonSchemaOf(type.items) };
    case "object": {
      if (!type.fields) return { type: "object" };
      const fields = Object.entries(type.fields);
      return {
        type: "object",
        properties: Object.fromEntries(fields.map(([name, field]) => [name, jsonSchemaOf(field)])),
        required: fields.map(([name]) => name),
        additionalProperties: false,
      };
    }
  }
}

// A path where a value used as a file is expected: a file value's path, or a plain string.
export function pathOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.path === "string") return value.path;
  return undefined;
}
