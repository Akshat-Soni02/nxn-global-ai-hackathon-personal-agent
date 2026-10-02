// Resolves {{...}} placeholders in a step before it is executed. See the template list in packages/core/src/skill.ts.
import type { RunContext } from "./types.ts";

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function lookup(ref: string, ctx: Pick<RunContext, "inputs" | "vars">, now: Date): unknown {
  if (ref === "today") return today(now);
  const [scope, name, prop, ...rest] = ref.split(".");
  if (rest.length > 0 || !name) throw new Error(`unknown placeholder {{${ref}}}`);
  const source = scope === "inputs" ? ctx.inputs : scope === "vars" ? ctx.vars : undefined;
  if (!source) throw new Error(`unknown placeholder {{${ref}}}`);
  if (!(name in source)) throw new Error(`{{${ref}}} has no value`);
  const value = source[name];
  if (prop === undefined) return value;
  if (prop === "name" && typeof value === "string") return value.split("/").pop() ?? value;
  throw new Error(`unknown placeholder {{${ref}}}`);
}

// A string that is exactly one placeholder keeps the value's type (so a list of found files stays a list).
// Placeholders inside longer strings are stringified. Strings under `keep` keys are left alone
// (extract's `each` uses {{text}}/{{href}}, filled per element by the web executor).
export function resolveTemplates<T>(
  value: T,
  ctx: Pick<RunContext, "inputs" | "vars">,
  now = new Date(),
  keep: ReadonlySet<string> = new Set(["each"]),
): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") {
      if (key && keep.has(key)) return v;
      const whole = v.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
      if (whole) return lookup(whole[1] as string, ctx, now);
      return v.replace(PLACEHOLDER, (_, ref: string) => {
        const resolved = lookup(ref, ctx, now);
        return Array.isArray(resolved) ? resolved.join(", ") : String(resolved);
      });
    }
    if (Array.isArray(v)) return v.map((item) => walk(item));
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, walk(item, k)]));
    }
    return v;
  };
  return walk(value) as T;
}
