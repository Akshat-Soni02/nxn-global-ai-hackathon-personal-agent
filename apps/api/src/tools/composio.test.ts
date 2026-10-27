// Composio's side of connecting an app (N13): one-click apps sign in on Composio's page; apps that need the user's own
// key are connected with it, through an auth config of Shadow's own. Composio's SDK is replaced by a recorder.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  toolkits: [] as unknown[],
  configs: [] as { id: string; authScheme?: string }[],
  calls: [] as { what: string; args: unknown[] }[],
}));

vi.mock("@composio/core", () => ({
  AuthScheme: { APIKey: (val: unknown) => ({ authScheme: "API_KEY", val }) },
  Composio: class {
    toolkits = {
      get: async () => sdk.toolkits,
      getConnectedAccountInitiationFields: async (...args: unknown[]) => {
        sdk.calls.push({ what: "fields", args });
        return [
          {
            name: "generic_api_key",
            displayName: "API Key",
            description: "Your secret key, from its dashboard.",
            required: true,
            type: "string",
            isSecret: true,
          },
          { name: "full", displayName: "Base URL", description: "", type: "string", default: "https://x.example/v1" },
        ];
      },
    };
    authConfigs = {
      list: async () => ({ items: sdk.configs }),
      create: async (...args: unknown[]) => {
        sdk.calls.push({ what: "createConfig", args });
        return { id: "ac_key" };
      },
    };
    connectedAccounts = {
      link: async (...args: unknown[]) => {
        sdk.calls.push({ what: "link", args });
        return { id: "ca_link", redirectUrl: "https://connect.example/x" };
      },
      initiate: async (...args: unknown[]) => {
        sdk.calls.push({ what: "initiate", args });
        return { id: "ca_key", status: "ACTIVE" };
      },
    };
  },
}));

const { composioTools } = await import("./composio.ts");

const kit = (slug: string, authSchemes: string[], managed: string[] = []) => ({
  slug,
  name: slug,
  authSchemes,
  composioManagedAuthSchemes: managed,
  meta: { categories: [] },
});

beforeEach(() => {
  sdk.toolkits = [
    kit("gmail", ["OAUTH2"], ["OAUTH2"]),
    kit("serpapi", ["API_KEY"]),
    kit("onlybasic", ["BASIC"]),
    kit("both", ["OAUTH2", "API_KEY"], ["OAUTH2"]),
  ];
  sdk.configs = [];
  sdk.calls = [];
});

describe("apps that need the user's own key (N13)", () => {
  it("lists them with key: true beside the one-click apps, and not apps with another kind of sign-in", async () => {
    const kits = await composioTools("k").toolkits();
    expect(kits.map((k) => [k.slug, k.key ?? false])).toEqual([
      ["gmail", false],
      ["serpapi", true],
      ["both", false],
    ]);
  });

  it("says which fields connecting asks for, as Composio names them", async () => {
    const fields = await composioTools("k").keyFields("serpapi");
    expect(fields).toEqual([
      {
        name: "generic_api_key",
        label: "API Key",
        description: "Your secret key, from its dashboard.",
        secret: true,
        required: true,
      },
      { name: "full", label: "Base URL", secret: false, required: false, default: "https://x.example/v1" },
    ]);
  });

  it("connects with the key through an auth config of Shadow's own, with no sign-in page", async () => {
    const made = await composioTools("k").connect("u1", "serpapi", undefined, { generic_api_key: "made-up" });
    expect(made).toEqual({ id: "ca_key" });
    expect(sdk.calls.find((c) => c.what === "createConfig")?.args).toEqual([
      "serpapi",
      { type: "use_custom_auth", authScheme: "API_KEY", credentials: {}, name: "serpapi (Shadow, your key)" },
    ]);
    expect(sdk.calls.find((c) => c.what === "initiate")?.args).toEqual([
      "u1",
      "ac_key",
      { config: { authScheme: "API_KEY", val: { generic_api_key: "made-up", full: "https://x.example/v1" } } },
    ]);
    expect(sdk.calls.some((c) => c.what === "link")).toBe(false);
  });

  it("reuses the project's own key config, never a one-click one, and refuses a missing key by its name", async () => {
    sdk.configs = [
      { id: "ac_oauth", authScheme: "OAUTH2" },
      { id: "ac_mine", authScheme: "API_KEY" },
    ];
    await composioTools("k").connect("u1", "serpapi", undefined, { generic_api_key: "made-up" });
    expect(sdk.calls.find((c) => c.what === "initiate")?.args[1]).toBe("ac_mine");
    expect(sdk.calls.some((c) => c.what === "createConfig")).toBe(false);
    await expect(composioTools("k").connect("u1", "serpapi")).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/API Key/),
    });
  });

  it("a one-click app still opens Composio's sign-in page", async () => {
    const made = await composioTools("k").connect("u1", "gmail");
    expect(made.redirectUrl).toBe("https://connect.example/x");
    expect(sdk.calls.some((c) => c.what === "initiate")).toBe(false);
  });
});
