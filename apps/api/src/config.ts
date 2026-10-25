// shadow-api's settings, all from the environment. On Cloud Run the secrets (NEBIUS_API_KEY, COMPOSIO_API_KEY,
// TOKEN_SECRET) come from Secret Manager as env vars; locally from apps/api/.env or the shell.
// See docs/cloud-architecture.md and apps/api/README.md.
import { TOKEN_FACTORY_URL } from "@shadow/llm";

export interface Limits {
  // Model spend, in millionths of a US dollar (integers keep Firestore increments exact).
  llmMicroUsdPerDay: number;
  llmMicroUsdPerMonth: number;
  // Connected-app tool calls.
  toolCallsPerDay: number;
  toolCallsPerMonth: number;
}

export interface Config {
  port: number;
  // Where the service is reached from outside, for the sign-in link (https://shadow-api-….run.app).
  publicUrl: string;
  nebius: { apiKey: string; baseUrl: string };
  // Unset: connected apps are off (the tools routes answer 503).
  composioApiKey?: string;
  // Toolkits a user may connect, by Composio slug (TOOLKITS=googlesheets,gmail). Unset: every app Composio can sign a
  // user in to by itself.
  toolkits?: string[];
  // Signs access tokens (HMAC-SHA256). At least 32 characters.
  tokenSecret: string;
  // "firestore" on Cloud Run (and with the emulator); "memory" for tests and a quick local run.
  store: "firestore" | "memory";
  // "firebase": Identity Platform ID tokens. "dev": the sign-in page takes an email and trusts it; refused on Cloud Run.
  auth: "firebase" | "dev";
  // For the sign-in page's Firebase JS (public values, not secrets).
  firebase: { apiKey?: string; authDomain?: string; projectId?: string };
  // false: no caps for anyone (local development with the emulator). Usage is still recorded.
  quotas: boolean;
  limits: Limits;
  // "composio" or "fake" (a toy Google Sheets for local runs and tests).
  tools: "composio" | "fake";
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): Config {
  const onCloudRun = Boolean(env.K_SERVICE);
  const port = Number(env.PORT ?? 8080);
  const auth = env.AUTH === "dev" ? "dev" : "firebase";
  if (auth === "dev" && onCloudRun) throw new Error("AUTH=dev is for local runs only, never on Cloud Run");
  const tokenSecret = env.TOKEN_SECRET ?? (onCloudRun ? "" : "dev-only-token-secret-not-for-production!!");
  if (tokenSecret.length < 32) throw new Error("TOKEN_SECRET must be at least 32 characters");
  if (!env.NEBIUS_API_KEY) throw new Error("NEBIUS_API_KEY is needed: the key every model call is made with");
  const micro = (name: string, usd: number) => Math.round(Number(env[name] ?? usd) * 1_000_000);
  const int = (name: string, n: number) => Math.round(Number(env[name] ?? n));
  return {
    port,
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ""),
    nebius: { apiKey: env.NEBIUS_API_KEY, baseUrl: (env.NEBIUS_BASE_URL || TOKEN_FACTORY_URL).replace(/\/+$/, "") },
    composioApiKey: env.COMPOSIO_API_KEY || undefined,
    ...(env.TOOLKITS ? { toolkits: env.TOOLKITS.split(",").map((s) => s.trim().toLowerCase()) } : {}),
    tokenSecret,
    store: env.STORE === "memory" ? "memory" : "firestore",
    auth,
    firebase: {
      apiKey: env.FIREBASE_API_KEY,
      authDomain: env.FIREBASE_AUTH_DOMAIN,
      projectId: env.GOOGLE_CLOUD_PROJECT ?? env.FIREBASE_PROJECT_ID,
    },
    quotas: env.QUOTAS !== "off",
    // The free tier. A recording's design is ~$0.02-0.05, a run with llm steps ~$0.001, a repair a few cents.
    limits: {
      llmMicroUsdPerDay: micro("FREE_LLM_USD_PER_DAY", 0.5),
      llmMicroUsdPerMonth: micro("FREE_LLM_USD_PER_MONTH", 3),
      toolCallsPerDay: int("FREE_TOOL_CALLS_PER_DAY", 100),
      toolCallsPerMonth: int("FREE_TOOL_CALLS_PER_MONTH", 1000),
    },
    tools: env.TOOLS === "fake" ? "fake" : "composio",
  };
}
