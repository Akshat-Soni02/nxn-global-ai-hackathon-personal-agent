// Starts shadow-api: on Cloud Run (PORT is set by it), or locally:
//   STORE=memory AUTH=dev TOOLS=fake QUOTAS=off NEBIUS_API_KEY=… pnpm --filter @shadow/api dev
// or with the Firestore emulator (FIRESTORE_EMULATOR_HOST=localhost:8081). See apps/api/README.md.
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { configFromEnv } from "./config.ts";
import { firestoreStore } from "./firestore.ts";
import { devIdentity, firebaseIdentity } from "./identity.ts";
import { memoryStore } from "./store.ts";
import { composioTools } from "./tools/composio.ts";
import { fakeTools } from "./tools/fake.ts";

const config = configFromEnv();
const store = config.store === "memory" ? memoryStore() : firestoreStore(config.firebase.projectId);
const tools =
  config.tools === "fake"
    ? fakeTools()
    : config.composioApiKey
      ? composioTools(config.composioApiKey, config.toolkits)
      : undefined;
const app = createApp({
  config,
  store,
  verifyIdentity: config.auth === "dev" ? devIdentity : firebaseIdentity(config.firebase.projectId),
  tools,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    JSON.stringify({
      event: "start",
      port: info.port,
      store: config.store,
      auth: config.auth,
      tools: tools ? config.tools : "off",
      quotas: config.quotas,
    }),
  );
});
