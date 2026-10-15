// The website (docs/design-ui.md, "The website"): five static pages, exported to out/ and served from anywhere that
// serves files. SITE_BASE_PATH serves it from a folder (a GitHub project page: SITE_BASE_PATH=/<repo>); empty is the
// domain root. No server, no image optimisation, no web fonts: nothing is fetched at build time.
import type { NextConfig } from "next";

const base = process.env.SITE_BASE_PATH ?? "";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: base,
  reactStrictMode: true,
  env: { SITE_BASE_PATH: base },
};

export default config;
