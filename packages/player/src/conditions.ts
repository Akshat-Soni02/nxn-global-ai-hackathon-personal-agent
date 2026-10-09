// Branch conditions: { left, op, right } comparisons, combined with all / any / not. References in left and right are
// resolved first, keeping their types. Values read from pages and models are often text, so numbers written as text
// ("1,234") compare as numbers and ISO dates compare as dates.
import type { Comparison, Condition } from "@taskplayer/core";
import { resolveTemplates } from "./template.ts";

export function evaluate(condition: Condition, vars: Record<string, unknown>, now = new Date()): boolean {
  if ("all" in condition) return condition.all.every((c) => evaluate(c, vars, now));
  if ("any" in condition) return condition.any.some((c) => evaluate(c, vars, now));
  if ("not" in condition) return !evaluate(condition.not, vars, now);
  return compare(condition, vars, now);
}

function compare(c: Comparison, vars: Record<string, unknown>, now: Date): boolean {
  // exists / not_exists: a reference with no value yet counts as missing, not as an error.
  if (c.op === "exists" || c.op === "not_exists") {
    let value: unknown;
    try {
      value = resolveTemplates(c.left, { vars }, now);
    } catch {
      value = undefined;
    }
    const present =
      value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
    return c.op === "exists" ? present : !present;
  }
  const left = resolveTemplates(c.left, { vars }, now);
  const right = resolveTemplates(c.right, { vars }, now);
  switch (c.op) {
    case "equals":
      return same(left, right);
    case "not_equals":
      return !same(left, right);
    case "contains":
      if (Array.isArray(left)) return left.some((item) => same(item, right));
      if (typeof left === "string") return left.toLowerCase().includes(String(right ?? "").toLowerCase());
      throw new Error(`contains needs text or a list on the left, got ${describe(left)}`);
    case "greater_than":
    case "less_than": {
      const [a, b] = orderable(left, right);
      return c.op === "greater_than" ? a > b : a < b;
    }
  }
}

const number = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || !/\d/.test(v)) return undefined;
  const cleaned = v.replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return cleaned && Number.isFinite(n) ? n : undefined;
};
const isoDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") {
    const [x, y] = [number(a), number(b)];
    if (x !== undefined && y !== undefined) return x === y;
  }
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  return JSON.stringify(a) === JSON.stringify(b);
}

function orderable(a: unknown, b: unknown): [number, number] | [string, string] {
  if (isoDate(a) && isoDate(b)) return [String(a).slice(0, 10), String(b).slice(0, 10)];
  const [x, y] = [number(a), number(b)];
  if (x !== undefined && y !== undefined) return [x, y];
  throw new Error(`cannot compare ${describe(a)} with ${describe(b)}: use numbers or YYYY-MM-DD dates`);
}

const describe = (v: unknown) => (v === undefined ? "nothing" : JSON.stringify(v).slice(0, 60));
