# shadow-api's container. Built from the repository root (it needs packages/llm):
#   docker build -f apps/api/Dockerfile -t shadow-api .
# or by Cloud Build with apps/api/cloudbuild.yaml. See apps/api/README.md.

FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
# Only what shadow-api needs, plus the root's build tools (esbuild, tsx).
RUN pnpm install --frozen-lockfile --filter @shadow/api... --filter shadow
RUN pnpm --filter @shadow/api build
# The bundle's two outside dependencies (firebase-admin, @composio/core), next to it.
RUN cd apps/api/dist && npm install --omit=dev --no-audit --no-fund

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist ./
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "server.mjs"]
