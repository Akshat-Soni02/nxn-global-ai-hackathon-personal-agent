// pnpm package: everything a judge installs, as one .dmg holding Shadow.app with the daemon inside (docs/design.md,
// "Deployment"). Nothing on the user's Mac needs Node, pnpm or the repo:
//
//   dist/Shadow.app/Contents/
//     Info.plist                      name, id (com.shadow.mac), version, icon
//     MacOS/Shadow                    the Swift side (button, menu bar, window, first run, ax channel, OCR, voice)
//     Resources/node                  the Node binary this script ran with
//     Resources/daemon.js             apps/daemon and every package it uses, bundled (esbuild)
//     Resources/daemon                a launcher: sets SHADOW_BUNDLE and runs node daemon.js (launchd starts it)
//     Resources/native-host.js, native-host   the Chrome shim, bundled, and its launcher (Chrome starts it)
//     Resources/ui/                   the window's pages
//     Resources/extension/            the extension, to load into Chrome (and dist/shadow-extension.zip)
//     Resources/AppIcon.icns          the icon, drawn by the app itself (Shadow --icon)
//     Library/LaunchAgents/com.shadow.daemon.plist   registered by the app on first run (SMAppService)
//
// Then codesign (ad hoc: no developer account) and hdiutil make dist/Shadow-<version>.dmg.
// Usage: pnpm package [--skip-build]   (needs swiftc, iconutil, hdiutil: macOS with the command line tools)
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";

const repo = join(import.meta.dirname, "..");
const dist = join(repo, "dist");
const app = join(dist, "Shadow.app");
const contents = join(app, "Contents");
const resources = join(contents, "Resources");
const version =
  (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version?: string }).version ?? "0.1.0";
const run = (cmd: string, args: string[], cwd = repo) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const step = (what: string) => console.log(`\n▸ ${what}`);

if (!process.argv.includes("--skip-build")) {
  step("the window, the extension and the native host");
  run("pnpm", ["build"]);
}

step("a clean dist/Shadow.app");
rmSync(app, { recursive: true, force: true });
mkdirSync(join(contents, "MacOS"), { recursive: true });
mkdirSync(join(contents, "Library", "LaunchAgents"), { recursive: true });
mkdirSync(resources, { recursive: true });

step("the daemon and the native host, bundled into one file each");
const banner = { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" };
await esbuild.build({
  entryPoints: [join(repo, "apps/daemon/src/main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: join(resources, "daemon.js"),
  banner,
  logLevel: "info",
});
await esbuild.build({
  entryPoints: [join(repo, "apps/native-host/src/main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: join(resources, "native-host.js"),
  banner,
  logLevel: "info",
});
copyFileSync(process.execPath, join(resources, "node"));
chmodSync(join(resources, "node"), 0o755);
// Shadow's service (docs/cloud-architecture.md): SHADOW_API_URL when packaging, e.g. the Cloud Run URL. Without it the
// app asks for a Token Factory key on first run, as before.
const apiUrl = process.env.SHADOW_API_URL?.replace(/\/+$/, "") ?? "";
if (apiUrl && !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(apiUrl)) {
  throw new Error(`SHADOW_API_URL must be an https origin, got ${apiUrl}`);
}
console.log(apiUrl ? `  Shadow's service: ${apiUrl}` : "  no SHADOW_API_URL: the app will ask for a Token Factory key");
writeFileSync(
  join(resources, "daemon"),
  `#!/bin/sh
# Starts Shadow's daemon from inside the app (launchd runs this: Library/LaunchAgents/com.shadow.daemon.plist).
DIR="$(cd "$(dirname "$0")" && pwd)"
export SHADOW_BUNDLE="$(cd "$DIR/../.." && pwd)"
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
${apiUrl ? `export SHADOW_API_URL="\${SHADOW_API_URL:-${apiUrl}}"\n` : ""}exec "$DIR/node" "$DIR/daemon.js"
`,
);
writeFileSync(
  join(resources, "native-host"),
  `#!/bin/sh
# Chrome starts this for the extension (native messaging); it forwards bytes to the daemon's socket.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/node" "$DIR/native-host.js" "$@"
`,
);
chmodSync(join(resources, "daemon"), 0o755);
chmodSync(join(resources, "native-host"), 0o755);

step("the window's pages and the extension");
cpSync(join(repo, "apps/ui/dist"), join(resources, "ui"), { recursive: true });
cpSync(join(repo, "apps/extension/dist"), join(resources, "extension"), { recursive: true });
rmSync(join(dist, "shadow-extension.zip"), { force: true });
run("ditto", ["-c", "-k", "--keepParent", join(resources, "extension"), join(dist, "shadow-extension.zip")]);

step("the LaunchAgent inside the app");
writeFileSync(
  join(contents, "Library", "LaunchAgents", "com.shadow.daemon.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.shadow.daemon</string>
  <key>BundleProgram</key><string>Contents/Resources/daemon</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`,
);

step("Shadow.app (swiftc)");
const plist = readFileSync(join(repo, "apps/mac/Info.plist"), "utf8")
  .replace("<string>0.0.0</string>", `<string>${version}</string>`)
  .replace("</dict>\n</plist>", "  <key>CFBundleIconFile</key>\n  <string>AppIcon</string>\n</dict>\n</plist>");
writeFileSync(join(contents, "Info.plist"), plist);
const swift = readdirSync(join(repo, "apps/mac/Sources"))
  .filter((f) => f.endsWith(".swift"))
  .sort()
  .map((f) => join(repo, "apps/mac/Sources", f));
const frameworks = [
  "AppKit",
  "ApplicationServices",
  "Vision",
  "ScreenCaptureKit",
  "Speech",
  "AVFoundation",
  "SwiftUI",
  "ServiceManagement",
];
run("swiftc", [
  "-O",
  "-swift-version",
  "5",
  "-target",
  `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos14.0`,
  ...swift,
  "-o",
  join(contents, "MacOS", "Shadow"),
  ...frameworks.flatMap((f) => ["-framework", f]),
]);

step("the icon (drawn by the app)");
const iconset = join(dist, "AppIcon.iconset");
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
run(join(contents, "MacOS", "Shadow"), ["--icon", iconset]);
run("iconutil", ["-c", "icns", iconset, "-o", join(resources, "AppIcon.icns")]);
cpSync(join(iconset, "icon_256x256.png"), join(dist, "icon-256.png"));

step("signing (ad hoc)");
run("codesign", ["--force", "--deep", "--sign", "-", "--identifier", "com.shadow.mac", app]);

step("the disk image");
const stage = join(dist, "dmg");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(app, join(stage, "Shadow.app"), { recursive: true });
run("ln", ["-s", "/Applications", join(stage, "Applications")]);
const dmg = join(dist, `Shadow-${version}.dmg`);
rmSync(dmg, { force: true });
run("hdiutil", ["create", "-volname", "Shadow", "-srcfolder", stage, "-ov", "-format", "UDZO", "-quiet", dmg]);
rmSync(stage, { recursive: true, force: true });

console.log(`\nbuilt ${dmg}`);
console.log(`and ${join(dist, "shadow-extension.zip")}`);
console.log("The app is signed ad hoc: open it with right-click > Open the first time.");
if (!existsSync(join(resources, "AppIcon.icns"))) console.log("note: no icon was made");
