// Serves fixtures/pages on http://localhost:5173 so skills can be replayed against known pages.
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(import.meta.dirname, "../fixtures/pages");
const port = Number(process.env.PORT ?? 5173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

// The fake Google Sheet's export (fixtures/pages/spreadsheets/d/FAKE): rows dated yesterday, today and tomorrow in the
// US style Sheets shows (10/3/2026), so a "today's row" rule can be tested on any day.
function fakeSheetCsv() {
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  };
  return `Date,Client,Amount\n${day(-1)},Acme,"1,180"\n${day(0)},Globex,"1,234"\n${day(1)},Initech,990\n`;
}

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
  if (path === "/spreadsheets/d/FAKE/export") {
    res.writeHead(200, { "content-type": "text/csv; charset=utf-8" }).end(fakeSheetCsv());
    return;
  }
  const file = join(root, path === "/" ? "index.html" : path);
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`fixtures on http://localhost:${port}`));
