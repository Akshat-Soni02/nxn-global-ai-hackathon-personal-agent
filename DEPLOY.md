# Deploying Shadow

Three things ship, in this order. Each is one command, run from the repository root on a Mac.

| # | What | Where | Command |
| --- | --- | --- | --- |
| 1 | `shadow-api`: sign-in, the model relay (Nebius Token Factory), connected apps (Composio), quotas | Google Cloud Run, secrets in Secret Manager | `PROJECT_ID=<your project> pnpm deploy:api` |
| 2 | The Mac app (`.dmg`, with the Chrome extension inside) built with the API's URL | GitHub Releases | `pnpm deploy:app` |
| 3 | The landing site, whose Download button gets the `.dmg` from step 2 | Vercel | `pnpm deploy:site` |

Run again after a change: each step is safe to repeat. `deploy:api` rebuilds and redeploys the service; `deploy:app`
replaces the release's files for the same version (bump `version` in `package.json` for a new one); `deploy:site`
redeploys the pages.

## Before the first run

- **Google Cloud**: a project with **billing on**, and the Google Cloud CLI signed in (`gcloud auth login`). The
  script enables every API it needs.
- **Keys** (the script asks for each once and puts it in Secret Manager; nothing is written to the repository):
  - **Nebius Token Factory API key**. Turn on **Zero Data Retention** for the organisation in Token Factory.
  - **Composio project API key**: app.composio.dev → your project → Settings → API keys (a *project* key, usually
    `ak_…`; a "For You" key is refused). Composio-managed sign-in for Google Sheets and Gmail needs no OAuth app of
    your own.
- **GitHub**: the repository must be **public** for people to download the `.dmg` from its releases. Pushing works as
  usual (`git push`); the release step uses the GitHub CLI if installed, else the token git already uses.
- **Vercel**: an account. The first `deploy:site` asks you to sign in (in the browser) and to name the project.
- **macOS with Xcode's command line tools** (`xcode-select --install`) for step 2.

## 1. The service: `pnpm deploy:api`

```sh
PROJECT_ID=my-shadow-project pnpm deploy:api          # REGION=europe-west1 by default
```

It enables the APIs, creates the Firestore database, stores the Nebius and Composio keys and a generated
token-signing key in **Secret Manager**, creates the service account (Firestore and those three secrets only) and the
image repository, builds the image with Cloud Build and deploys `shadow-api` to Cloud Run with the secrets mounted.
It prints the service URL and saves it to `.deploy/api-url` for step 2.

**Two clicks in the console** (Identity Platform has no CLI for these). The script stops and tells you when:

1. https://console.cloud.google.com/customer-identity → **Enable**, then **Providers → Add a provider → Google** →
   enable → Save. Top right, **Application setup details** shows `apiKey` and `authDomain`: paste them when asked
   (they are public values, kept in `scripts/deploy/deploy.env`, which git ignores).
2. After the deploy: **Settings → Authorized domains → Add** the Cloud Run host the script prints
   (`shadow-api-….run.app`).

Check it: `curl $(cat .deploy/api-url)/healthz` answers `{"ok":true}`.

After the demo, to pay nothing while idle: `MIN_INSTANCES=0 PROJECT_ID=… pnpm deploy:api`.

## 2. The Mac app: `pnpm deploy:app`

```sh
pnpm deploy:app              # or: pnpm deploy:app --draft   to check the release before anyone sees it
```

It builds `Shadow.app` with the service's URL in it (`SHADOW_API_URL`), packs `dist/Shadow-<version>.dmg` and
`dist/shadow-extension.zip`, and publishes them as the GitHub Release `v<version>`, with `Shadow.dmg`: the stable name
the site's button downloads (`…/releases/latest/download/Shadow.dmg`).

The app is signed ad hoc (no Apple Developer ID), so macOS refuses the first double-click: people right-click →
Open once. The site's download page says so in its first step. The Chrome extension is inside the app; its setup
window walks people through loading it (Developer mode → Load unpacked), so there is no Chrome Web Store listing to
wait for.

## 3. The site: `pnpm deploy:site`

```sh
pnpm deploy:site             # or: pnpm deploy:site --preview   for a preview URL
```

It builds `apps/website` to static pages (`apps/website/out`) and deploys that folder to Vercel. Nothing to configure
on Vercel. A custom domain: Vercel → the project → Settings → Domains.

## Afterwards

- **No caps for you**: Firestore → `users/<your uid>` → add `developer: true` (boolean). Your uid appears in the
  `users` collection after you sign in once.
- **A budget alert**: Billing → Budgets & alerts, on the project.
- **Logs**: Cloud Run → `shadow-api` → Logs: one line per call (model, tokens, cost, status), never prompts or tool
  arguments.
- **A key changed**: `NEBIUS_API_KEY=… PROJECT_ID=… pnpm deploy:api` (or `COMPOSIO_API_KEY=…`) adds a new version of
  that secret and redeploys.

More on the service: [`apps/api/README.md`](apps/api/README.md) · the architecture:
[`docs/cloud-architecture.md`](docs/cloud-architecture.md).
