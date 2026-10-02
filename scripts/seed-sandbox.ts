// Creates ~/TaskPlayerTest with the folders and harmless sample files the skills in skills/real expect.
// Safe to re-run: it only adds files. Usage: pnpm seed:sandbox [--reset]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(homedir(), "TaskPlayerTest");
if (process.argv.includes("--reset")) rmSync(root, { recursive: true, force: true });

for (const dir of ["upload/done", "inbox", "downloads", "digests", "sorted"]) {
  mkdirSync(join(root, dir), { recursive: true });
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");

// upload-test-file sends this to a PUBLIC test server, so it must stay harmless.
writeFileSync(
  join(root, "upload", `taskplayer-test-${stamp}.txt`),
  "Task Player replay test upload. Safe to delete.\n",
);

// sort-inbox: one file of each kind.
const minimalPdf =
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
writeFileSync(join(root, "inbox", `receipt-${stamp}.pdf`), minimalPdf);
writeFileSync(join(root, "inbox", `photo-${stamp}.png`), onePixelPng);
writeFileSync(join(root, "inbox", `note-${stamp}.txt`), "Sample note for sort-inbox.\n");

console.log(`sandbox ready at ${root}`);
