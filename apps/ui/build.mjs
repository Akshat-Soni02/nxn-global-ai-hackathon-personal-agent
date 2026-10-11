// Bundles the window (docs/design.md, "The app") into dist/: index.html, app.js, styles.css. The daemon serves dist/
// at http://127.0.0.1:<port>/ (apps/daemon/src/http.ts); Shadow.app shows it in its window.
import { copyFileSync, mkdirSync } from "node:fs";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });
const copyStatic = () => {
  copyFileSync("src/index.html", "dist/index.html");
  copyFileSync("src/styles.css", "dist/styles.css");
};
copyStatic();

const ctx = await esbuild.context({
  entryPoints: { app: "src/main.tsx" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  // WKWebView on macOS 14 is Safari 17.
  target: ["safari17", "chrome120"],
  jsx: "automatic",
  minify: !watch,
  sourcemap: watch,
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  logLevel: "info",
  plugins: [{ name: "static", setup: (build) => build.onEnd(copyStatic) }],
});

if (watch) await ctx.watch();
else {
  await ctx.rebuild();
  await ctx.dispose();
}
