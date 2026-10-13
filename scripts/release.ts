// pnpm release: publishes what `pnpm package` built as a GitHub Release (docs/design.md, "Deployment"): the .dmg and
// the extension zip, tagged with the version in package.json. Needs the GitHub CLI (`gh auth login`) and a fresh
// `pnpm package` first. Usage: pnpm release [--draft] [--notes <file>]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dirname, "..");
const version =
  (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version?: string }).version ?? "0.1.0";
const dmg = join(repo, "dist", `Shadow-${version}.dmg`);
const zip = join(repo, "dist", "shadow-extension.zip");
for (const file of [dmg, zip]) {
  if (!existsSync(file)) {
    console.error(`missing ${file}: run pnpm package first`);
    process.exit(1);
  }
}
const args = process.argv.slice(2);
const notes = args.includes("--notes") ? args[args.indexOf("--notes") + 1] : undefined;
const tag = `v${version}`;
const command = [
  "release",
  "create",
  tag,
  dmg,
  zip,
  "--title",
  `Shadow ${version}`,
  ...(notes ? ["--notes-file", notes] : ["--generate-notes"]),
  ...(args.includes("--draft") ? ["--draft"] : []),
];
console.log(`gh ${command.join(" ")}`);
execFileSync("gh", command, { cwd: repo, stdio: "inherit" });
console.log(`published ${tag}: the README's download link points at the latest release.`);
