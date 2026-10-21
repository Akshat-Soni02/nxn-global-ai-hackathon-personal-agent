// Resolves {{…}} references in a step before it runs. One namespace: every variable is declared by an earlier step
// (the trigger's inputs, an output, an ask's answer, a loop's item), reached with .field and .N paths, plus the built-in
// dates: {{today}}, {{today-1}}, {{week_start}}, each with an optional format ({{today|D MMM}}, core dates.ts).
// See the reference rules at the top of packages/core/src/skill.ts.
import { dateValue, parseDateRef, parseRef, valueAt } from "@shadow/core";

const REF = /\{\{\s*([^}]+?)\s*\}\}/g;

export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function lookup(expr: string, vars: Record<string, unknown>, now: Date): unknown {
  // A workflow's own variable first: an older one may name itself week_start.
  const own = parseRef(expr);
  const date = own && own.name in vars ? undefined : parseDateRef(expr);
  if (date) return dateValue(date, now);
  const ref = parseRef(expr);
  if (!ref) throw new Error(`{{${expr}}} is not a variable reference`);
  if (!(ref.name in vars)) throw new Error(`{{${expr}}}: ${ref.name} has no value yet`);
  return valueAt(ref.name, vars[ref.name], ref.path);
}

const asText = (v: unknown): string =>
  v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

// A string that is exactly one reference keeps the value's type (a list stays a list, a number a number); references
// inside longer text become text (objects and lists as JSON). Strings under `keep` keys are left alone (extract's
// `each` uses {{text}}/{{href}}, filled per element by the web executor).
export function resolveTemplates<T>(
  value: T,
  ctx: { vars: Record<string, unknown> },
  now = new Date(),
  keep: ReadonlySet<string> = new Set(["each"]),
): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") {
      if (key && keep.has(key)) return v;
      const whole = v.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
      if (whole) return lookup(whole[1] as string, ctx.vars, now);
      return v.replace(REF, (_, expr: string) => asText(lookup(expr, ctx.vars, now)));
    }
    if (Array.isArray(v)) return v.map((item) => walk(item));
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, walk(item, k)]));
    }
    return v;
  };
  return walk(value) as T;
}
