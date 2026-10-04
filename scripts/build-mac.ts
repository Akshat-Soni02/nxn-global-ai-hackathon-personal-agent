// Builds apps/mac into "Task Player.app" (the desktop button, the Mac-app recorder and the ax channel).
// Needs the Xcode command line tools (swiftc): `xcode-select --install` if `swiftc --version` fails.
// Signed ad hoc (no developer account). macOS remembers the Accessibility permission for that exact signature, so the
// app is rebuilt only when its sources change: otherwise you would have to allow it again after every build.
// Usage: pnpm setup:mac [--force]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "../apps/mac");
const sources = readdirSync(join(dir, "Sources"))
  .filter((f) => f.endsWith(".swift"))
  .sort()
  .map((f) => join(dir, "Sources", f));
const app = join(dir, "build", "Task Player.app");
const stamp = join(dir, "build", "sources.sha256");

const hash = createHash("sha256");
for (const file of [...sources, join(dir, "Info.plist")]) hash.update(readFileSync(file));
const digest = hash.digest("hex");

const upToDate = existsSync(app) && existsSync(stamp) && readFileSync(stamp, "utf8") === digest;
if (upToDate && !process.argv.includes("--force")) {
  console.log(`${app} is up to date (kept as is, so macOS keeps its Accessibility permission).`);
  process.exit(0);
}

rmSync(app, { recursive: true, force: true });
mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
copyFileSync(join(dir, "Info.plist"), join(app, "Contents", "Info.plist"));
execFileSync(
  "swiftc",
  [
    "-O",
    "-swift-version",
    "5",
    // The newest Swift defaults to the newest macOS; the app needs macOS 14 (LSMinimumSystemVersion in Info.plist).
    "-target",
    `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos14.0`,
    ...sources,
    "-o",
    join(app, "Contents", "MacOS", "TaskPlayer"),
    "-framework",
    "AppKit",
    "-framework",
    "ApplicationServices",
  ],
  { stdio: "inherit" },
);
execFileSync("codesign", ["--force", "--sign", "-", "--identifier", "com.taskplayer.mac", app], { stdio: "inherit" });
writeFileSync(stamp, digest);

console.log(`built ${app}`);
console.log("The daemon starts it (pnpm daemon). The first time, right-click its floating button > Allow Mac apps.");
console.log("After a rebuild, macOS asks again: turn Task Player off and on in Privacy & Security > Accessibility.");
