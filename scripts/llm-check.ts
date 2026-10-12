// Checks the configured Token Factory models with a real key: that each profile's model is reachable, answers, honours
// json_schema structured output and makes tool calls, and that the vision model reads an image. Costs a fraction of a
// cent. It ends with which protocol the agents can use: native tool calls, or JSON actions in the reply.
// Usage: pnpm llm:check   (NEBIUS_API_KEY from .env; see .env.example)
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import {
  configFromEnv,
  createLlm,
  type JsonSchema,
  PROFILE_NAMES,
  type ProfileName,
  UsageMeter,
} from "../packages/llm/src/index.ts";

try {
  process.loadEnvFile(join(import.meta.dirname, "../.env"));
} catch {
  // no .env: the key may be in the environment
}
const config = configFromEnv(process.env);
if (!config) {
  console.error("No NEBIUS_API_KEY: put it in .env (see .env.example).");
  process.exit(2);
}
const llm = createLlm(config);
const meter = new UsageMeter();
let failures = 0;

function report(profile: ProfileName, check: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${profile.padEnd(6)} ${check.padEnd(12)} ${detail}`);
}

async function attempt(profile: ProfileName, check: string, run: () => Promise<[boolean, string]>) {
  try {
    const [ok, detail] = await run();
    report(profile, check, ok, detail);
    return ok;
  } catch (error) {
    report(profile, check, false, error instanceof Error ? error.message.slice(0, 200) : String(error));
    return false;
  }
}

console.log(`Token Factory at ${config.baseUrl}`);
const listed = await llm.listModels().catch((error: Error) => {
  console.error(`Could not list models: ${error.message}`);
  process.exit(1);
});
console.log(`${listed.length} models reachable with this key\n`);

interface Invoice {
  total: number;
  currency: string;
  due: string;
}
const invoice: JsonSchema<Invoice> = {
  jsonSchema: {
    type: "object",
    properties: { total: { type: "number" }, currency: { type: "string" }, due: { type: "string" } },
    required: ["total", "currency", "due"],
    additionalProperties: false,
  },
  check: (v) => {
    const i = v as Partial<Invoice>;
    return typeof i?.total === "number" && typeof i.currency === "string" && typeof i.due === "string"
      ? { ok: true, value: i as Invoice }
      : { ok: false, error: "needs total (number), currency and due (strings)" };
  },
};

const toolsOk: Partial<Record<ProfileName, boolean>> = {};
for (const profile of PROFILE_NAMES) {
  const { model } = config.profiles[profile];
  const info = config.catalog[model];
  console.log(
    `${profile}: ${model}${info ? ` ($${info.priceIn} in / $${info.priceOut} out per 1M)` : " (not in the catalog)"}`,
  );
  if (!listed.includes(model)) {
    report(profile, "listed", false, "this key cannot reach the model: check the id, or swap it in .env");
    continue;
  }
  await attempt(profile, "answer", async () => {
    const r = await llm.generate({ profile, user: "Reply with the single word: ready", maxTokens: 512, meter });
    return [
      /ready/i.test(r.text),
      `${r.ms} ms, ${r.usage.output} output tokens: ${JSON.stringify(r.text.slice(0, 40))}`,
    ];
  });
  await attempt(profile, "json_schema", async () => {
    const r = await llm.generate({
      profile,
      user: "The invoice total is 1,180.50 EUR, due 2026-10-31. Extract it.",
      schema: invoice,
      meter,
    });
    const right = r.value?.total === 1180.5 && r.value.due === "2026-10-31";
    return [right && r.structuredMode === "json_schema", `mode ${r.structuredMode}, ${JSON.stringify(r.value)}`];
  });
  if (info?.tools !== false) {
    toolsOk[profile] = await attempt(profile, "tool call", async () => {
      const r = await llm.generate({
        profile,
        user: "Find the Upload button on the page.",
        tools: [
          {
            name: "find",
            description: "Find elements on the page by their visible text",
            parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
          },
        ],
        toolChoice: "auto",
        meter,
      });
      const call = r.toolCalls[0];
      return [call?.name === "find", call ? `${call.name}(${call.raw})` : `no tool call, said: ${r.text.slice(0, 60)}`];
    });
  }
  if (info?.vision) {
    await attempt(profile, "image", async () => {
      const r = await llm.generate({
        profile,
        user: "What single color fills this image? One word.",
        images: [{ dataUrl: solidPng(32, [220, 30, 30]) }],
        imagesConsented: true, // a synthetic image, not a screenshot
        meter,
      });
      return [/red/i.test(r.text), JSON.stringify(r.text.slice(0, 40))];
    });
  }
  console.log();
}

// The agents' loop runs on the smart profile.
const agent: ProfileName = "smart";
console.log(
  toolsOk[agent]
    ? `Agent protocol: native tool calls (${config.profiles[agent].model}).`
    : "Agent protocol: JSON actions in the reply (the smart model made no native tool call).",
);
const spent = meter.usage;
console.log(`Spent: ${spent.calls} calls, ${spent.input + spent.output} tokens, $${spent.costUsd.toFixed(5)}`);
process.exit(failures > 0 ? 1 : 0);

// A solid-color PNG, so the vision check sends no real screen.
function solidPng(size: number, [r, g, b]: [number, number, number]): string {
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function crc32(data: Buffer): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
