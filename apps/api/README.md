# shadow-api

Shadow's own service on Google Cloud Run. It signs the Mac app in, relays model calls to Nebius Token Factory with
Shadow's key, gives each user one MCP endpoint with the tools of the apps they connected (through Composio), and
counts every call against the user's free tier. Everything about the user's work (recordings, workflows, runs,
memory) stays on their Mac. Design: [`docs/cloud-architecture.md`](../../docs/cloud-architecture.md).

| File | What |
| --- | --- |
| `src/app.ts` | every route (listed at the top of the file) |
| `src/config.ts` | settings from the environment |
| `src/tokens.ts` | access tokens (HS256, 15 min) and refresh tokens (stored hashed) |
| `src/store.ts`, `src/firestore.ts` | users, devices, sign-in codes, usage; in memory or Firestore |
| `src/quota.ts` | reserve before a call, settle after; developer users and `QUOTAS=off` have no caps |
| `src/identity.ts`, `src/signin-page.ts` | the browser sign-in (Identity Platform, or a plain email locally) |
| `src/mcp.ts` | the per-user MCP server (Streamable HTTP, stateless) |
| `src/tools/composio.ts`, `src/tools/fake.ts` | connected apps: Composio, or a toy Google Sheet |
| `build.ts`, `Dockerfile`, `cloudbuild.yaml` | the bundle and its container |

## Run it on your Mac

No Google Cloud needed. From the repo root, with `NEBIUS_API_KEY` and `COMPOSIO_API_KEY` in the root `.env`:

```sh
pnpm api        # STORE=memory AUTH=dev QUOTAS=off, the keys read from the root .env; answers on :8080
pnpm daemon     # in another terminal: `pnpm daemon` does not start the service
```

Then point the daemon at it: `SHADOW_API_URL=http://localhost:8080` in the root `.env`. The daemon reads that file, so
a key there serves the model calls directly, and the service serves the connected apps; leave `NEBIUS_API_KEY` empty
there to send the model calls through the service too. Settings → Sign in opens a local page that takes any email;
Apps → Connect then links a Google account through Composio. With `STORE=memory` a restart forgets the sign-in: sign
in again. Without a Composio key, `TOOLS=fake pnpm api` serves a toy sheet instead (no real app).

Check it: `curl localhost:8080/healthz` answers `{"ok":true}`.

With the Firestore emulator instead of memory: `gcloud emulators firestore start --host-port=localhost:8081`, then
`FIRESTORE_EMULATOR_HOST=localhost:8081 GOOGLE_CLOUD_PROJECT=demo-shadow AUTH=dev …` without `STORE=memory`.

| Variable | Default | What |
| --- | --- | --- |
| `NEBIUS_API_KEY` | required | the key every model call is made with |
| `NEBIUS_BASE_URL` | Token Factory | |
| `COMPOSIO_API_KEY` | unset: connected apps off | Composio project key |
| `TOKEN_SECRET` | required on Cloud Run | signs access tokens; 32+ characters |
| `PUBLIC_URL` | `http://localhost:$PORT` | the service's own URL, for the sign-in link |
| `STORE` | `firestore` | `memory` for local runs |
| `AUTH` | `firebase` | `dev`: a plain email, local only (refused on Cloud Run) |
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN` | | the sign-in page's Firebase web config (public values) |
| `GOOGLE_CLOUD_PROJECT` | | the project, for Firestore and ID tokens |
| `TOOLS` | `composio` | `fake` for the toy sheet |
| `TOOLKITS` | sheets, gmail, drive, calendar, slack, notion, github | apps a user may connect |
| `QUOTAS` | on | `off`: no caps for anyone |
| `FREE_LLM_USD_PER_DAY` / `_PER_MONTH` | 0.5 / 3 | the free tier's model spend |
| `FREE_TOOL_CALLS_PER_DAY` / `_PER_MONTH` | 100 / 1000 | the free tier's app calls |

## Deploy to Google Cloud

Once per project. Replace `shadow-hackathon` and `europe-west1` with yours; put the region near your Token Factory
endpoint, since every model call makes that hop.

**1. Project and APIs**

```sh
gcloud config set project shadow-hackathon
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com secretmanager.googleapis.com identitytoolkit.googleapis.com
```

**2. Firestore** (Native mode)

```sh
gcloud firestore databases create --location=europe-west1
```

**3. Sign-in (Identity Platform)**: in the console, Identity Platform → Enable → Providers → add **Google** and
**Email / Password**. Settings → Authorized domains: add the Cloud Run host after step 6
(`shadow-api-….run.app`). Application setup details gives `apiKey` and `authDomain` (usually
`shadow-hackathon.firebaseapp.com`): these are public, they go in env vars.

**4. Secrets**

```sh
printf %s "$NEBIUS_API_KEY"   | gcloud secrets create nebius-api-key   --data-file=-
printf %s "$COMPOSIO_API_KEY" | gcloud secrets create composio-api-key --data-file=-
openssl rand -base64 48 | tr -d '\n' | gcloud secrets create token-secret --data-file=-
```

Nebius: turn on **Zero Data Retention** for the organisation. Composio: app.composio.dev → your project → API key;
Composio-managed auth for Google Sheets and Gmail works without setting up your own OAuth app.

**5. A service account and an image repository**

```sh
gcloud iam service-accounts create shadow-api
SA=shadow-api@shadow-hackathon.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding shadow-hackathon --member=serviceAccount:$SA --role=roles/datastore.user
for s in nebius-api-key composio-api-key token-secret; do
  gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done
gcloud artifacts repositories create shadow --repository-format=docker --location=europe-west1
```

**6. Build and deploy** (from the repository root; again after every change)

```sh
gcloud builds submit --config apps/api/cloudbuild.yaml --substitutions=_REGION=europe-west1
gcloud run deploy shadow-api \
  --image=europe-west1-docker.pkg.dev/shadow-hackathon/shadow/shadow-api:latest \
  --region=europe-west1 --service-account=$SA --allow-unauthenticated \
  --min-instances=1 --max-instances=3 --memory=512Mi --timeout=300 \
  --set-secrets=NEBIUS_API_KEY=nebius-api-key:latest,COMPOSIO_API_KEY=composio-api-key:latest,TOKEN_SECRET=token-secret:latest \
  --set-env-vars=GOOGLE_CLOUD_PROJECT=shadow-hackathon,FIREBASE_API_KEY=<apiKey>,FIREBASE_AUTH_DOMAIN=<authDomain>
URL=$(gcloud run services describe shadow-api --region=europe-west1 --format='value(status.url)')
gcloud run services update shadow-api --region=europe-west1 --update-env-vars=PUBLIC_URL=$URL
curl -s $URL/healthz
```

`--allow-unauthenticated` is right: the app and the sign-in page call it from anywhere, and every `/v1` route checks
Shadow's own token. `--min-instances=1` avoids a cold start in the demo; set it to 0 afterwards.

**7. The app**: package it with the service's URL baked in, and every user signs in instead of pasting a key.

```sh
SHADOW_API_URL=$URL pnpm package
```

**8. Afterwards**

- **No caps for you:** Firestore → `users/<your uid>` → add `developer: true` (boolean). Your uid is in the
  Firestore `users` collection after you sign in once.
- **A budget alert:** Billing → Budgets & alerts, on the project.
- **Logs:** Cloud Run → shadow-api → Logs. One JSON line per call: model, tokens, cost, status. Never prompts or tool
  arguments.
- **Old sign-in codes** (`deviceCodes`) expire after 10 minutes and are refused; delete leftovers now and then.

## Tests

`pnpm vitest run apps/api` (the service with memory and fakes, and a real MCP client) and
`pnpm vitest run apps/daemon/src/account.test.ts` (the daemon's sign-in, model client and MCP client against it).
