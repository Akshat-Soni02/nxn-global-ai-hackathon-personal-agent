// CSV, for data that apps draw instead of putting in the page (a Google Sheet's cells live on a canvas). Shared by
// the recorder (context for a copy) and the player (web.extract { source: "google_sheet" }); no dependencies.

// RFC 4180: quoted fields may hold commas, newlines and doubled quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Rows as objects keyed by the header row (the first row).
export function rowsOf(text: string): Record<string, string>[] {
  const [header = [], ...body] = parseCsv(text);
  return body
    .filter((cells) => cells.some((c) => c.trim() !== ""))
    .map((cells) => Object.fromEntries(header.map((name, i) => [name.trim(), (cells[i] ?? "").trim()])));
}

// The CSV export of the Google Sheet tab a URL shows: /spreadsheets/d/<id>/... with #gid=<tab> or ?gid=<tab>.
export function sheetExportUrl(url: string): string | undefined {
  const match = /^(https?:\/\/[^/]+)\/spreadsheets\/d\/([^/?#]+)/.exec(url);
  if (!match) return undefined;
  const gid = /[#?&]gid=(\d+)/.exec(url)?.[1] ?? "0";
  return `${match[1]}/spreadsheets/d/${match[2]}/export?format=csv&gid=${gid}`;
}
