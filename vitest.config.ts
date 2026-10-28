import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "apps/website/{app,components}/**/*.test.ts",
      "skills/**/*.test.ts",
    ],
  },
});
