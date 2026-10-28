#!/usr/bin/env bash
# Builds the landing site (apps/website: static pages, no server) and deploys it to Vercel (DEPLOY.md, step 3).
# The site is built here and Vercel serves the finished files, so no build settings are needed on Vercel's side.
# The first run asks you to sign in to Vercel and to name the project; later runs just redeploy.
#
#   scripts/deploy/website.sh           production
#   scripts/deploy/website.sh --preview a preview URL, to check first
set -euo pipefail
cd "$(dirname "$0")/../.."

printf '\n\033[1m▸ Building the site\033[0m\n'
pnpm install --frozen-lockfile
pnpm --filter @shadow/website build

printf '\n\033[1m▸ Deploying apps/website/out to Vercel\033[0m\n'
cd apps/website/out
if [[ ${1:-} == --preview ]]; then
  npx --yes vercel@latest deploy .
else
  npx --yes vercel@latest deploy . --prod
fi
