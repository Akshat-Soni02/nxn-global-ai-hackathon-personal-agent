import { describe, expect, it } from "vitest";
import { z } from "zod";
import { configFromEnv, extractJson, fakeLlm, LlmError, UsageMeter } from "./index.ts";

const kpis = z.object({ revenue: z.number(), note: z.string() });

describe("requests", () => {
  it("uses the profile's model and defaults, and turns Nemotron's thinking on or off explicitly", async () => {
    const llm = fakeLlm(["ok", "ok", "ok"]);
    await llm.generate({ profile: "fast", user: "hi" });
    await llm.generate({ profile: "smart", user: "hi" });
    await llm.generate({ profile: "vision", user: "hi" });
    const [fast, smart, vision] = llm.requests;
    expect(fast).toMatchObject({
      model: "nvidia/Nemotron-3_5-Lightning",
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(smart).toMatchObject({
      model: "nvidia/nemotron-3-super-120b-a12b",
      chat_template_kwargs: { enable_thinking: true },
    });
    expect(vision?.model).toBe("zai-org/GLM-5.3-Flash");
    expect(vision).not.toHaveProperty("chat_template_kwargs"); // GLM has no thinking control
  });

  it("lets config swap a profile's model", async () => {
    const llm = fakeLlm(["ok"], { profiles: { fast: { model: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" } } });
    await llm.generate({ profile: "fast", user: "hi" });
    expect(llm.requests[0]?.model).toBe("nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B");
    expect(llm.requests[0]).not.toHaveProperty("chat_template_kwargs"); // not in the catalog: nothing assumed
  });

  it("strips reasoning from the answer, and counts tokens and cost", async () => {
    const meter = new UsageMeter();
    const run = meter.child();
    const llm = fakeLlm([{ text: "<think>hmm</think> Paris", usage: { input: 1_000_000, output: 1_000_000 } }]);
    const result = await llm.generate({ profile: "smart", user: "Capital of France?", meter: run });
    expect(result.text).toBe("Paris");
    expect(result.costUsd).toBeCloseTo(1.2); // $0.30 in + $0.90 out per 1M
    expect(run.usage).toMatchObject({ calls: 1, input: 1_000_000, output: 1_000_000 });
    expect(meter.usage.costUsd).toBeCloseTo(1.2); // the parent counts the child's calls
  });

  it("says when reasoning used up the whole budget", async () => {
    const llm = fakeLlm([{ text: "", finishReason: "length" }]);
    await expect(llm.generate({ profile: "smart", user: "x" })).rejects.toThrow(/whole token budget/);
  });
});

describe("structured output", () => {
  it("asks with json_schema, gives the schema in the prompt too, and returns the checked value", async () => {
    const llm = fakeLlm(['```json\n{"revenue": 12400, "note": "up"}\n```']);
    const result = await llm.generate({ profile: "fast", user: "Read the KPIs", schema: kpis });
    expect(result.value).toEqual({ revenue: 12400, note: "up" });
    expect(result.structuredMode).toBe("json_schema");
    const body = llm.requests[0] as {
      response_format: { type: string };
      messages: { role: string; content: string }[];
    };
    expect(body.response_format.type).toBe("json_schema");
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[0]?.content).toContain('"revenue"');
  });

  it("retries once with the problem when the reply doesn't fit, then gives up", async () => {
    const fixedOnRetry = fakeLlm(['{"revenue": "lots"}', '{"revenue": 5, "note": "ok"}']);
    expect((await fixedOnRetry.generate({ profile: "fast", user: "x", schema: kpis })).value).toEqual({
      revenue: 5,
      note: "ok",
    });
    const retry = fixedOnRetry.requests[1] as { messages: { content: string }[] };
    expect(retry.messages.at(-1)?.content).toMatch(/rejected: revenue: .*number/);

    const never = fakeLlm(["not json", "still not json"]);
    await expect(never.generate({ profile: "fast", user: "x", schema: kpis })).rejects.toThrow(
      /did not fit the schema/,
    );
  });

  it("falls back to json_object, then to the prompt alone, when a format is rejected; and remembers it", async () => {
    const llm = fakeLlm([
      { status: 400, error: "response_format json_schema is not supported" },
      { status: 400, error: "response_format json_object is not supported" },
      '{"revenue": 1, "note": "a"}',
      '{"revenue": 2, "note": "b"}',
    ]);
    const first = await llm.generate({ profile: "fast", user: "x", schema: kpis });
    expect([first.value, first.structuredMode]).toEqual([{ revenue: 1, note: "a" }, "prompt"]);
    expect(llm.requests.map((r) => (r.response_format as { type?: string } | undefined)?.type)).toEqual([
      "json_schema",
      "json_object",
      undefined,
    ]);
    await llm.generate({ profile: "fast", user: "x", schema: kpis });
    expect(llm.requests).toHaveLength(4); // the next call goes straight to the prompt-only form
  });

  it("parses any JSON object with json: true", async () => {
    const llm = fakeLlm(['Sure: {"steps": []}']);
    expect((await llm.generate({ profile: "smart", user: "x", json: true })).value).toEqual({ steps: [] });
    expect(llm.requests[0]).toMatchObject({ response_format: { type: "json_object" } });
  });
});

describe("tools", () => {
  it("sends tool definitions and returns parsed tool calls", async () => {
    const llm = fakeLlm([{ toolCalls: [{ name: "find", arguments: { text: "Upload" } }] }]);
    const result = await llm.generate({
      profile: "smart",
      user: "Find the upload button",
      tools: [
        {
          name: "find",
          description: "Find elements",
          parameters: { type: "object", properties: { text: { type: "string" } } },
        },
      ],
    });
    expect(result.toolCalls).toMatchObject([{ name: "find", arguments: { text: "Upload" } }]);
    expect(llm.requests[0]).toMatchObject({
      tool_choice: "auto",
      tools: [{ type: "function", function: { name: "find" } }],
    });
  });

  it("sends a tool conversation back in the API's shape", async () => {
    const llm = fakeLlm(["done"]);
    const call = { id: "c1", name: "find", arguments: { text: "x" }, raw: '{"text":"x"}' };
    await llm.generate({
      profile: "smart",
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "", toolCalls: [call] },
        { role: "tool", toolCallId: "c1", content: "2 matches" },
      ],
    });
    const messages = llm.requests[0]?.messages as Record<string, unknown>[];
    expect(messages[1]).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1", function: { name: "find" } }] });
    expect(messages[2]).toEqual({ role: "tool", tool_call_id: "c1", content: "2 matches" });
  });
});

describe("images", () => {
  const image = { dataUrl: "data:image/png;base64,AAAA" };

  it("refuses images without screen consent, and on a model that doesn't take them", async () => {
    const llm = fakeLlm(["ok"]);
    await expect(llm.generate({ profile: "vision", user: "describe", images: [image] })).rejects.toThrow(
      /screen consent/,
    );
    await expect(
      llm.generate({ profile: "smart", user: "describe", images: [image], imagesConsented: true }),
    ).rejects.toThrow(/does not take images/);
    expect(llm.requests).toHaveLength(0);
  });

  it("attaches images to the last user message", async () => {
    const llm = fakeLlm(["a login page"]);
    await llm.generate({ profile: "vision", user: "describe", images: [image], imagesConsented: true });
    const messages = llm.requests[0]?.messages as { content: unknown }[];
    expect(messages.at(-1)?.content).toEqual([
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: image.dataUrl } },
    ]);
  });
});

describe("reliability", () => {
  it("retries 429 and 5xx with backoff, then reports the last error", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const recovers = fakeLlm([{ status: 429 }, { status: 503 }, "ok"], {}, { sleep, backoffMs: 100 });
    expect((await recovers.generate({ profile: "fast", user: "x" })).text).toBe("ok");
    expect(waits).toEqual([100, 200]);

    const down = fakeLlm(() => ({ status: 502, error: "bad gateway" }), {}, { retries: 2 });
    await expect(down.generate({ profile: "fast", user: "x" })).rejects.toMatchObject({
      details: { status: 502, retryable: true },
    });
    expect(down.requests).toHaveLength(3);
  });

  it("does not retry a request the API refused", async () => {
    const llm = fakeLlm([{ status: 401, error: "bad key" }]);
    const error = await llm.generate({ profile: "fast", user: "x" }).catch((e: LlmError) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).details).toMatchObject({ status: 401, retryable: false });
    expect(llm.requests).toHaveLength(1);
  });
});

describe("config and helpers", () => {
  it("reads development settings from env, and none without a key", () => {
    expect(configFromEnv({})).toBeUndefined();
    const config = configFromEnv({ NEBIUS_API_KEY: "k", TASKPLAYER_MODEL_SMART: "nvidia/Nemotron-3-Ultra-550b-a55b" });
    expect(config?.baseUrl).toBe("https://api.tokenfactory.nebius.com/v1");
    expect(config?.profiles.smart.model).toBe("nvidia/Nemotron-3-Ultra-550b-a55b");
    expect(config?.profiles.fast.model).toBe("nvidia/Nemotron-3_5-Lightning");
  });

  it("finds JSON after reasoning and inside fences", () => {
    expect(extractJson('<think>{"no": 1}</think> here: ```json\n{"ok": true}\n```')).toEqual({ ok: true });
    expect(extractJson("the list: [1, 2]")).toEqual([1, 2]);
  });

  it("lists the models the key can reach", async () => {
    expect(await fakeLlm([]).listModels()).toContain("zai-org/GLM-5.3-Flash");
  });
});
