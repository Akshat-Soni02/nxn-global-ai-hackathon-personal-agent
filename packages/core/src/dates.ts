// Dates built into templates (spec 2.11): {{today}}, {{today-1}}, {{today+7}}, {{week_start}} (this week's Monday),
// each with an optional format after a bar: {{today|D MMM}} is "20 Oct". Text in brackets is kept as it is:
// {{week_start|[w/c] D MMM}} is "w/c 19 Oct". Without a format a date is YYYY-MM-DD, as {{today}} always was.
// Tokens: YYYY YY MMMM MMM MM M DD D dddd ddd (English names).
export interface DateRef {
  base: "today" | "week_start";
  offset: number;
  format?: string;
}

const DATE_REF = /^(today|week_start)\s*(?:([+-])\s*(\d{1,3}))?\s*(?:\|\s*(.+?))?\s*$/;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TOKEN = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd/g;
const pad = (n: number) => String(n).padStart(2, "0");

export function parseDateRef(expr: string): DateRef | undefined {
  const m = DATE_REF.exec(expr.trim());
  if (!m) return undefined;
  const offset = m[2] ? Number(m[3]) * (m[2] === "-" ? -1 : 1) : 0;
  return { base: m[1] as DateRef["base"], offset, ...(m[4] ? { format: m[4] } : {}) };
}

export function formatDate(d: Date, format: string): string {
  return format.replace(TOKEN, (token: string, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case "YYYY":
        return String(d.getFullYear());
      case "YY":
        return String(d.getFullYear()).slice(-2);
      case "MMMM":
        return MONTHS[d.getMonth()] ?? "";
      case "MMM":
        return (MONTHS[d.getMonth()] ?? "").slice(0, 3);
      case "MM":
        return pad(d.getMonth() + 1);
      case "M":
        return String(d.getMonth() + 1);
      case "DD":
        return pad(d.getDate());
      case "D":
        return String(d.getDate());
      case "dddd":
        return DAYS[d.getDay()] ?? "";
      default:
        return (DAYS[d.getDay()] ?? "").slice(0, 3);
    }
  });
}

// The run's local day (or its week's Monday), moved by the offset in days.
export function dateOf(ref: DateRef, now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (ref.base === "week_start") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setDate(d.getDate() + ref.offset);
  return d;
}

export function dateValue(ref: DateRef, now: Date): string {
  return formatDate(dateOf(ref, now), ref.format ?? "YYYY-MM-DD");
}
