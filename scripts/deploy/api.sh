#!/usr/bin/env bash
# Deploys shadow-api (apps/api) to Google Cloud Run, with its secrets in Secret Manager (DEPLOY.md, step 1).
# Safe to run again: each step checks what is already there, so a second run only rebuilds and redeploys.
#
#   PROJECT_ID=my-project scripts/deploy/api.sh            first time: it asks for the keys it needs
#   PROJECT_ID=my-project scripts/deploy/api.sh            later: rebuild and redeploy
#
# Settings (environment, or scripts/deploy/deploy.env):
#   PROJECT_ID            required: the Google Cloud project (billing on)
#   REGION                europe-west1: near Nebius Token Factory, every model call makes that hop
#   NEBIUS_API_KEY        asked for if the secret doesn't exist yet; set it to add a new version
#   COMPOSIO_API_KEY      the same (a Composio *project* API key: app.composio.dev → project → API key)
#   FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN   Identity Platform's web config (public values); asked for once
#   MIN_INSTANCES         1 (no cold start in a demo; 0 afterwards to pay nothing when idle)
# Writes the service's URL to .deploy/api-url, which scripts/deploy/app.sh builds into the Mac app.
set -euo pipefail

cd "$(dirname "$0")/../.."
[[ -f scripts/deploy/deploy.env ]] && source scripts/deploy/deploy.env

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ask() { # ask VAR "prompt" [secret]
  local var=$1 prompt=$2 secret=${3:-}
  if [[ -z "${!var:-}" ]]; then
    if [[ -n $secret ]]; then read -r -s -p "$prompt: " "${var?}"; echo; else read -r -p "$prompt: " "${var?}"; fi
  fi
  [[ -n "${!var:-}" ]] || { echo "$var is needed" >&2; exit 1; }
}

command -v gcloud >/dev/null || { echo "Install the Google Cloud CLI first: https://cloud.google.com/sdk/docs/install" >&2; exit 1; }
gcloud auth print-access-token >/dev/null 2>&1 || { echo "Sign in first: gcloud auth login" >&2; exit 1; }

ask PROJECT_ID "Google Cloud project id"
REGION=${REGION:-europe-west1}
MIN_INSTANCES=${MIN_INSTANCES:-1}
SA="shadow-api@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/shadow/shadow-api:latest"
gcloud config set project "$PROJECT_ID" >/dev/null

say "1/7 APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com secretmanager.googleapis.com identitytoolkit.googleapis.com

say "2/7 Firestore (Native mode, $REGION)"
if gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  echo "already there"
else
  gcloud firestore databases create --location="$REGION"
fi

say "3/7 Secrets in Secret Manager"
secret() { # secret NAME VALUE: create it, or add a version when a value is given
  local name=$1 value=$2
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    if [[ -n $value ]]; then printf %s "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null; echo "$name: new version"; else echo "$name: kept"; fi
  else
    printf %s "$value" | gcloud secrets create "$name" --data-file=- --replication-policy=automatic >/dev/null
    echo "$name: created"
  fi
}
gcloud secrets describe nebius-api-key >/dev/null 2>&1 || ask NEBIUS_API_KEY "Nebius Token Factory API key" secret
secret nebius-api-key "${NEBIUS_API_KEY:-}"
gcloud secrets describe composio-api-key >/dev/null 2>&1 || ask COMPOSIO_API_KEY "Composio project API key" secret
secret composio-api-key "${COMPOSIO_API_KEY:-}"
if ! gcloud secrets describe token-secret >/dev/null 2>&1; then secret token-secret "$(openssl rand -base64 48 | tr -d '\n')"; else echo "token-secret: kept"; fi

say "4/7 Service account and image repository"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || gcloud iam service-accounts create shadow-api --display-name="Shadow API"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role=roles/datastore.user --condition=None >/dev/null
for s in nebius-api-key composio-api-key token-secret; do
  gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
done
gcloud artifacts repositories describe shadow --location="$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create shadow --repository-format=docker --location="$REGION"

say "5/7 Sign-in (Identity Platform): the one part done in the console"
if [[ -z "${FIREBASE_API_KEY:-}" || -z "${FIREBASE_AUTH_DOMAIN:-}" ]]; then
  cat <<EOF
  Open https://console.cloud.google.com/customer-identity?project=$PROJECT_ID
    1. Enable Identity Platform, then Providers → Add a provider → Google → enable, save.
    2. "Application setup details" (top right) shows apiKey and authDomain: paste them below.
  (After this script, add the Cloud Run host it prints to Settings → Authorized domains.)
EOF
fi
ask FIREBASE_API_KEY "apiKey"
ask FIREBASE_AUTH_DOMAIN "authDomain (usually ${PROJECT_ID}.firebaseapp.com)"
# Kept for the next run, so it isn't asked again (public values, not secrets).
mkdir -p scripts/deploy
{
  echo "PROJECT_ID=$PROJECT_ID"
  echo "REGION=$REGION"
  echo "FIREBASE_API_KEY=$FIREBASE_API_KEY"
  echo "FIREBASE_AUTH_DOMAIN=$FIREBASE_AUTH_DOMAIN"
} >scripts/deploy/deploy.env

say "6/7 Build the image (Cloud Build)"
gcloud builds submit --config apps/api/cloudbuild.yaml --substitutions="_REGION=$REGION" .

say "7/7 Deploy to Cloud Run"
gcloud run deploy shadow-api \
  --image="$IMAGE" --region="$REGION" --service-account="$SA" --allow-unauthenticated \
  --min-instances="$MIN_INSTANCES" --max-instances=3 --memory=512Mi --timeout=300 \
  --set-secrets=NEBIUS_API_KEY=nebius-api-key:latest,COMPOSIO_API_KEY=composio-api-key:latest,TOKEN_SECRET=token-secret:latest \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=$PROJECT_ID,FIREBASE_API_KEY=$FIREBASE_API_KEY,FIREBASE_AUTH_DOMAIN=$FIREBASE_AUTH_DOMAIN"
URL=$(gcloud run services describe shadow-api --region="$REGION" --format='value(status.url)')
gcloud run services update shadow-api --region="$REGION" --update-env-vars="PUBLIC_URL=$URL" >/dev/null

mkdir -p .deploy
printf %s "$URL" >.deploy/api-url
say "Deployed: $URL"
if curl -fsS "$URL/health" >/dev/null; then echo "health: ok"; else echo "health: not answering yet (give it a minute, then: curl $URL/health)"; fi

# The sign-in page runs on the service's own host: Identity Platform must allow it (the API does what the console's
# Settings → Authorized domains does). Both forms of the Cloud Run URL, and the ones already there.
TOKEN=$(gcloud auth print-access-token)
ADMIN="https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT_ID/config"
NUMBERED="shadow-api-$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)').$REGION.run.app"
HAVE=$(curl -fsS -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT_ID" "$ADMIN" |
  tr -d ' \n' | sed -E 's/.*"authorizedDomains":\[([^]]*)\].*/\1/' | tr ',' '\n' | tr -d '"')
DOMAINS=$(printf '%s\n' $HAVE "${URL#https://}" "$NUMBERED" | sort -u | sed 's/.*/"&"/' | paste -sd, -)
curl -fsS -X PATCH -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT_ID" -H "Content-Type: application/json" \
  "$ADMIN?updateMask=authorizedDomains" -d "{\"authorizedDomains\":[$DOMAINS]}" >/dev/null &&
  echo "sign-in: ${URL#https://} is an authorized domain" ||
  echo "sign-in: add ${URL#https://} in Identity Platform → Settings → Authorized domains"
echo "Then build the app with this URL in it: scripts/deploy/app.sh"
