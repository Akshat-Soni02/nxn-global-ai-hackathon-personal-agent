// Re-downloads the real pages the skills in skills/real target into fixtures/snapshots,
// so `pnpm test` can check locators against current markup. Usage: pnpm snapshot:pages
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const PAGES: Record<string, string> = {
  "the-internet-upload.html": "https://the-internet.herokuapp.com/upload",
  "selenium-download.html": "https://www.selenium.dev/selenium/web/downloads/download.html",
  "selenium-web-form.html": "https://www.selenium.dev/selenium/web/web-form.html",
  "hacker-news.html": "https://news.ycombinator.com/",
};

const dir = join(import.meta.dirname, "../fixtures/snapshots");
for (const [file, url] of Object.entries(PAGES)) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (TaskPlayer snapshot)" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  writeFileSync(join(dir, file), await res.text());
  console.log("saved", file);
}
