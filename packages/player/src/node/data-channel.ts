// The data channel: rules over values earlier steps saved (rows read from a sheet or table, extracted text).
//   data.pick  a rule, written once when the skill was made. No model call; the same answer on every run.
// Anything that needs judgement or reading text is an llm step instead (llm-step.ts).
import type { ChannelExecutor, StepResult } from "../types.ts";
import { rowsOf } from "../web/csv.ts";

const fail = (error: string): StepResult => ({ ok: false, error });

export function dataChannel(): ChannelExecutor {
  return async (step) => {
    if (step.action === "pick") return pick(step.args);
    return { ok: false, error: `data.${step.action} is not supported` };
  };
}

// data.pick: the `column` of the row whose cells equal every value in `where`. Dates compare as dates, so a rule
// written as {{today}} (YYYY-MM-DD) matches a sheet that shows 10/3/2026.
export function pick(args: Record<string, unknown>): StepResult {
  const rows = typeof args.from === "string" ? rowsOf(args.from) : (args.from as Record<string, unknown>[] | undefined);
  if (!Array.isArray(rows)) return fail("data.pick needs rows in `from` (from an extract step's save_as)");
  const where = (args.where ?? {}) as Record<string, unknown>;
  const cell = (row: Record<string, unknown>, column: string) => {
    const key = Object.keys(row).find((k) => k.trim().toLowerCase() === column.trim().toLowerCase());
    return key === undefined ? undefined : String(row[key] ?? "");
  };
  const found = rows.filter((row) =>
    Object.entries(where).every(([column, wanted]) => same(cell(row, column), String(wanted))),
  );
  const row = args.pick === "last" ? found.at(-1) : found[0];
  const conditions = Object.entries(where)
    .map(([c, v]) => `${c} = ${v}`)
    .join(" and ");
  if (!row) return fail(`no row where ${conditions || "(no conditions)"}`);
  if (typeof args.column !== "string") return { ok: true, value: row };
  const value = cell(row, args.column);
  return value === undefined ? fail(`no column ${args.column}`) : { ok: true, value };
}

function same(actual: string | undefined, wanted: string): boolean {
  if (actual === undefined) return false;
  if (actual.trim().toLowerCase() === wanted.trim().toLowerCase()) return true;
  const a = asDates(actual);
  const w = asDates(wanted);
  return a.some((d) => w.includes(d));
}

// The ISO dates a cell could mean. 10/3/2026 is October 3 in the US and 10 March elsewhere: both are kept.
function asDates(text: string): string[] {
  const t = text.trim();
  const pad = (n: string | number) => String(n).padStart(2, "0");
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return [`${iso[1]}-${pad(iso[2] ?? "")}-${pad(iso[3] ?? "")}`];
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t);
  if (slash) {
    const [a = "", b = "", y = ""] = slash.slice(1);
    return [`${y}-${pad(a)}-${pad(b)}`, `${y}-${pad(b)}-${pad(a)}`];
  }
  const parsed = /[a-z]/i.test(t) ? new Date(t) : undefined;
  return parsed && !Number.isNaN(parsed.getTime())
    ? [`${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`]
    : [];
}
