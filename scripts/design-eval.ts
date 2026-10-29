// pnpm design:eval <recording folder> [--real --yes] [--model <id>] [--apps <tools.json>] [--answers <design.json>]
// Turns one recording into a workflow exactly as Stop does (finishRecording), in a scratch data folder, and checks the
// result against the folder's expect.json: what a correct workflow does next time, in the user's words, as checks.
// Fake model by default: free, and it finishes at once, so it shows what code alone builds. --real uses the key (.env,
// else the Keychain) and is capped by the ledger, testing/design-eval-ledger.md: $10 in all for Record v2. Without
// --yes, --real only says what it would spend. --apps gives the design connected apps: their tools as the daemon lists
// them (appTools), each app connected; nothing is ever run in them (the eval has no test run). --answers answers each
// question with the user's own answer from an earlier design of the same recording (its design.json), matched by the
// words the questions share; a question with none in common takes its default.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { finishRecording } from "../apps/daemon/src/record.ts";
import { recordingDir } from "../apps/daemon/src/recording-store.ts";
import { llmFromKeychain } from "../apps/daemon/src/settings.ts";
import { tracePath } from "../apps/daemon/src/trace-store.ts";
import { configFromEnv, createLlm, fakeLlm, type Llm, UsageMeter } from "../packages/llm/src/index.ts";
import type { AppTool } from "../packages/recorder/src/design/v2/connectors.ts";
import { checkExpectations, Expectations, scriptedDesigner } from "../packages/recorder/src/index.ts";

const LEDGER = resolve(import.meta.dirname, "../testing/design-eval-ledger.md");
const CAP_USD = 10; // Rushil, 23 Oct: $10 in all (was $5)
// The most one design may cost: its budget, pictures included. Announced before a real run.
const ESTIMATE_USD = 0.25;

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const folder = argv.find(
  (a, i) => !a.startsWith("--") && !["--model", "--apps", "--answers"].includes(argv[i - 1] ?? ""),
);
if (!folder || !existsSync(join(folder, "trace.jsonl"))) {
  console.error("usage: pnpm design:eval <recording folder with trace.jsonl> [--real --yes] [--model <id>]");
  process.exit(2);
}
const name = basename(resolve(folder));

function spent(): number {
  if (!existsSync(LEDGER)) return 0;
  return [...readFileSync(LEDGER, "utf8").matchAll(/\| \$(\d+\.\d+) \|/g)].reduce((sum, m) => sum + Number(m[1]), 0);
}

async function model(): Promise<Llm> {
  if (!flag("--real")) {
    // A quiet task model, then done at once: what code alone builds.
    return fakeLlm(scriptedDesigner());
  }
  const total = spent();
  if (total + ESTIMATE_USD > CAP_USD) {
    console.error(`refused: the ledger shows $${total.toFixed(4)} of $${CAP_USD}; this run may cost $${ESTIMATE_USD}`);
    process.exit(1);
  }
  if (!flag("--yes")) {
    console.log(`would spend up to $${ESTIMATE_USD} (ledger: $${total.toFixed(4)} of $${CAP_USD}). Add --yes to run.`);
    process.exit(0);
  }
  try {
    process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
  } catch {
    // no .env: the Keychain
  }
  const modelId = option("--model");
  if (modelId) process.env.SHADOW_MODEL_SMART = modelId;
  const config = configFromEnv();
  const llm = config ? createLlm(config) : await llmFromKeychain();
  if (!llm) {
    console.error("no key: NEBIUS_API_KEY in .env, or Shadow's key in the Keychain");
    process.exit(1);
  }
  return llm;
}

const llm = await model();
const dataDir = mkdtempSync(join(tmpdir(), "design-eval-"));
const sessionId = `eval-${name}`.replace(/[^\w-]/g, "-");
// The trace: every event re-stamped with this session.
const trace = readFileSync(join(folder, "trace.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.stringify({ ...JSON.parse(line), sessionId }))
  .join("\n");
const traceFile = tracePath(dataDir, sessionId);
mkdirSync(dirname(traceFile), { recursive: true });
writeFileSync(traceFile, `${trace}\n`);
const dir = recordingDir(dataDir, sessionId);
mkdirSync(dir, { recursive: true });
for (const file of ["description.json", "screen.jsonl", "transcript.jsonl", "voice.json"]) {
  if (existsSync(join(folder, file))) copyFileSync(join(folder, file), join(dir, file));
}
if (existsSync(join(folder, "shots"))) console.log("note: pictures are not copied; the eval reads words only");

const appsFile = option("--apps");
const appTools = appsFile ? (JSON.parse(readFileSync(appsFile, "utf8")) as AppTool[]) : undefined;
const connectors = appTools && {
  status: async () => ({
    connected: [...new Set(appTools.flatMap((t) => (t.toolkit ? [t.toolkit] : [])))],
    declined: [],
  }),
  offer: async () => "connected" as const,
  decline: () => {},
  tools: async (toolkit: string) => appTools.filter((t) => t.toolkit === toolkit),
};

const answersFile = option("--answers");
const theirs = answersFile
  ? ((JSON.parse(readFileSync(answersFile, "utf8")) as { asked?: { question: string; answer: string }[] }).asked ?? [])
  : [];
const words = (t: string) => new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? []);
// Their answer to the question most like this one (two words in common at least), else the default.
const answerFor = (question: string) => {
  const wanted = words(question);
  const scored = theirs
    .map((t) => ({ answer: t.answer, score: [...words(t.question)].filter((w) => wanted.has(w)).length }))
    .sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score >= 2 ? scored[0].answer : "";
};

const asked: string[] = [];
const meter = new UsageMeter();
const saved = await finishRecording(sessionId, {
  dataDir,
  llm,
  meter,
  // The scripted designer answers with native tool calls; a real model's protocol is the client's choice.
  ...(flag("--real") ? {} : { design: { protocol: "tools" as const } }),
  log: (...a) => console.log("  ", ...a),
  ...(connectors ? { connectors } : {}),
  prompter: {
    ask: async (q) => {
      asked.push(q.text);
      const answer = answerFor(q.text);
      console.log(`   asked: ${q.text}\n   answered: ${answer || "(the default)"}`);
      return answer; // empty: the default, as a user pressing Enter
    },
  },
});
if (!saved) {
  console.error("nothing was saved");
  process.exit(1);
}

const expectations = existsSync(join(folder, "expect.json"))
  ? Expectations.parse(JSON.parse(readFileSync(join(folder, "expect.json"), "utf8")))
  : [];
const verdicts = checkExpectations(saved.skill, asked, expectations);
const cost = meter.usage.costUsd.toFixed(4);
console.log(`\n${name}: ${saved.skill.id} v${saved.skill.version}, ${asked.length} question(s), $${cost}`);
for (const v of verdicts) {
  const mark = v.ok ? "✓" : v.expectation.expectedToFail ? "⚠" : "✗";
  console.log(`${mark} ${v.expectation.kind}: ${v.expectation.why} (${v.detail})`);
}
console.log(`design.json: ${join(dir, "design.json")}`);

if (flag("--real")) {
  if (!existsSync(LEDGER)) {
    writeFileSync(
      LEDGER,
      "# Design eval ledger (real model, Record v2; $5 in all)\n\n| When | Recording | Model | Cost | Passed |\n|---|---|---|---|---|\n",
    );
  }
  const passed = verdicts.filter((v) => v.ok).length;
  const model = llm.config.profiles.smart.model;
  appendFileSync(
    LEDGER,
    `| ${new Date().toISOString()} | ${name} | ${model} | $${cost} | ${passed}/${verdicts.length} |\n`,
  );
  console.log(`ledger: $${spent().toFixed(4)} of $${CAP_USD}`);
}
