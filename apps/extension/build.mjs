// Bundles the extension into dist/. Load dist/ via chrome://extensions -> "Load unpacked".
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });
copyFileSync("manifest.json", "dist/manifest.json");
// Each build's own id, in the bundle and beside it: the daemon tells an old copy still running in Chrome from this one
// (C25; the manifest version is always 0.0.0, and Chrome keeps the old worker until the extension is reloaded).
const build = Date.now().toString(36);
writeFileSync("dist/build.json", `${JSON.stringify({ build })}\n`);

const common = {
  outdir: "dist",
  bundle: true,
  target: "chrome120",
  sourcemap: true,
  logLevel: "info",
  define: { __SHADOW_BUILD__: JSON.stringify(build) },
};
// The service worker is declared "type": "module"; content scripts must be classic scripts, so they are IIFEs.
const contexts = await Promise.all([
  esbuild.context({ ...common, entryPoints: { background: "src/background.ts" }, format: "esm" }),
  esbuild.context({ ...common, entryPoints: { content: "src/content.ts" }, format: "iife" }),
  // The page-world hook that reports a page's own clipboard writes (clipboard-hook.ts).
  esbuild.context({ ...common, entryPoints: { "clipboard-hook": "src/clipboard-hook.ts" }, format: "iife" }),
]);

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
