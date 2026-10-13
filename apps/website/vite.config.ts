// The website (docs/design-ui.md, "The website"): one static page, built with Vite into dist/ and served from
// anywhere that serves files (GitHub Pages, Vercel, a folder).
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});
