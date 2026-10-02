// Bundles the extension into dist/. Load dist/ via chrome://extensions -> "Load unpacked".
import { copyFileSync, mkdirSync } from "node:fs";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });
copyFileSync("manifest.json", "dist/manifest.json");

const common = { outdir: "dist", bundle: true, target: "chrome120", sourcemap: true, logLevel: "info" };
// The service worker is declared "type": "module"; content scripts must be classic scripts, so they are IIFEs.
const contexts = await Promise.all([
  esbuild.context({ ...common, entryPoints: { background: "src/background.ts" }, format: "esm" }),
  esbuild.context({ ...common, entryPoints: { content: "src/content.ts" }, format: "iife" }),
]);

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
