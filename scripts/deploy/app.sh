#!/usr/bin/env bash
# Builds the Mac app with Shadow's service built in and publishes it as a GitHub Release (DEPLOY.md, step 2):
# dist/Shadow-<version>.dmg and the Chrome extension's zip, plus Shadow.dmg, the name the website's button downloads
# (github.com/<repo>/releases/latest/download/Shadow.dmg). Needs macOS with Xcode's command line tools.
#
#   scripts/deploy/app.sh            the URL from scripts/deploy/api.sh (.deploy/api-url)
#   SHADOW_API_URL=https://… scripts/deploy/app.sh
#   scripts/deploy/app.sh --draft    a draft release, to check before anyone sees it
set -euo pipefail
cd "$(dirname "$0")/../.."

URL=${SHADOW_API_URL:-$(cat .deploy/api-url 2>/dev/null || true)}
[[ $URL == https://* ]] || { echo "No service URL: run scripts/deploy/api.sh first, or set SHADOW_API_URL=https://…" >&2; exit 1; }
curl -fsS "$URL/health" >/dev/null || echo "warning: $URL/health doesn't answer; the app will still be built with it"

printf '\n\033[1m▸ Packaging Shadow.app with %s\033[0m\n' "$URL"
pnpm install --frozen-lockfile
SHADOW_API_URL="$URL" pnpm package

printf '\n\033[1m▸ Publishing the release\033[0m\n'
pnpm release "$@"
