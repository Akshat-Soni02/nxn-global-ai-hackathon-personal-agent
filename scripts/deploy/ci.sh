#!/usr/bin/env bash
# Continuous deploy for shadow-api (DEPLOY.md, "Continuous deploy"): a Cloud Build trigger on pushes to main that touch
# apps/api, packages/ or the lockfile, running apps/api/cloudbuild.deploy.yaml on Cloud Build's default machine (free
# tier: 2,500 build-minutes a month). Run once, after scripts/deploy/api.sh; safe to run again.
#
#   PROJECT_ID=my-project scripts/deploy/ci.sh
#
# One step is yours, in the browser: authorizing Cloud Build's GitHub app on the repository (the script prints the
# link and waits).
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ -f scripts/deploy/deploy.env ]] && source scripts/deploy/deploy.env
: "${PROJECT_ID:?set PROJECT_ID}"
REGION=${REGION:-europe-west1}
BRANCH=${BRANCH:-main}
say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

REMOTE=$(git remote get-url origin)
SLUG=$(sed -E 's#.*github\.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#' <<<"$REMOTE")
NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
CI_SA="shadow-ci@${PROJECT_ID}.iam.gserviceaccount.com"
API_SA="shadow-api@${PROJECT_ID}.iam.gserviceaccount.com"
CONNECTION=shadow-github
REPO=shadow

say "1/4 The service account builds run as"
gcloud iam service-accounts describe "$CI_SA" --project="$PROJECT_ID" >/dev/null 2>&1 ||
  gcloud iam service-accounts create shadow-ci --project="$PROJECT_ID" --display-name="Shadow CI (Cloud Build)"
for role in roles/run.admin roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$CI_SA" --role="$role" --condition=None >/dev/null
done
# It deploys a service that runs as shadow-api, so it may act as that account (and no other).
gcloud iam service-accounts add-iam-policy-binding "$API_SA" --project="$PROJECT_ID" \
  --member="serviceAccount:$CI_SA" --role=roles/iam.serviceAccountUser >/dev/null
# Cloud Build keeps the GitHub connection's token in Secret Manager.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-${NUMBER}@gcp-sa-cloudbuild.iam.gserviceaccount.com" \
  --role=roles/secretmanager.admin --condition=None >/dev/null

say "2/4 The GitHub connection"
if ! gcloud builds connections describe "$CONNECTION" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud builds connections create github "$CONNECTION" --region="$REGION" --project="$PROJECT_ID"
fi
while true; do
  STAGE=$(gcloud builds connections describe "$CONNECTION" --region="$REGION" --project="$PROJECT_ID" \
    --format='value(installationState.stage)')
  [[ $STAGE == COMPLETE ]] && break
  URI=$(gcloud builds connections describe "$CONNECTION" --region="$REGION" --project="$PROJECT_ID" \
    --format='value(installationState.actionUri)')
  echo "Waiting for you ($STAGE): open this link, sign in to GitHub, and install the app on $SLUG:"
  echo "  $URI"
  sleep 20
done
echo "connected"

say "3/4 The repository $SLUG"
gcloud builds repositories describe "$REPO" --connection="$CONNECTION" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1 ||
  gcloud builds repositories create "$REPO" --remote-uri="https://github.com/${SLUG}.git" \
    --connection="$CONNECTION" --region="$REGION" --project="$PROJECT_ID"

say "4/4 The trigger: push to $BRANCH → build and deploy shadow-api"
if gcloud builds triggers describe shadow-api-deploy --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "already there"
else
  gcloud builds triggers create github --name=shadow-api-deploy --region="$REGION" --project="$PROJECT_ID" \
    --repository="projects/$PROJECT_ID/locations/$REGION/connections/$CONNECTION/repositories/$REPO" \
    --branch-pattern="^${BRANCH}\$" --build-config=apps/api/cloudbuild.deploy.yaml \
    --included-files='apps/api/**,packages/**,pnpm-lock.yaml,package.json' \
    --service-account="projects/$PROJECT_ID/serviceAccounts/$CI_SA" \
    --description="shadow-api: build and deploy on push to $BRANCH"
fi
cat <<EOF

Done. Every push to $BRANCH that touches the service rebuilds and redeploys it. Run it now without a push:
  gcloud builds triggers run shadow-api-deploy --region=$REGION --branch=$BRANCH --project=$PROJECT_ID
Builds: https://console.cloud.google.com/cloud-build/builds;region=$REGION?project=$PROJECT_ID
EOF
