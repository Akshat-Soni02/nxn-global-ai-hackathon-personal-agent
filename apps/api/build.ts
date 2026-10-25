// Bundles shadow-api into apps/api/dist/server.mjs for its container (apps/api/Dockerfile). Workspace packages and
// small dependencies go inside the bundle; firebase-admin and @composio/core stay outside (native and dynamic
// imports) and are installed into dist/ from the package.json written next to the bundle.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8")) as { dependencies: Record<string, string> };
const EXTERNAL = ["firebase-admin", "@composio/core"];

await build({
  entryPoints: [join(here, "src/main.ts")],
  outfile: join(here, "dist/server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external: EXTERNAL.flatMap((name) => [name, `${name}/*`]),
  // Some bundled CommonJS code calls require(); give ESM one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

writeFileSync(
  join(here, "dist/package.json"),
  `${JSON.stringify(
    {
      name: "shadow-api",
      private: true,
      type: "module",
      dependencies: Object.fromEntries(EXTERNAL.map((name) => [name, pkg.dependencies[name]])),
    },
    null,
    2,
  )}\n`,
);
console.log("wrote apps/api/dist/server.mjs and dist/package.json");
