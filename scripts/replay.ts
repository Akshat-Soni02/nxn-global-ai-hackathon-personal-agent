// Development runner: replays a skill without the extension, in a separate debug-port Chrome profile.
// Usage: pnpm replay <skill.json> [--headless] [--yes] [--no-scripts] [--no-repair] [--keep-open] [--input name=value ...]
//   --yes         approve every requires_approval step (and every outward step a repair tries)
//   --no-scripts  print script steps instead of running them
//   --no-repair   a failed step fails the run, instead of pausing for recovery
// Recovery is on by default: a failed step is classified and, for drift, repaired (the cheap ladder, then the repair
// agent when NEBIUS_API_KEY is set); a repaired version is written next to the skill file as <name>.vN.json.
// Production replay goes through the daemon and the extension; this shares the same player code.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { isAction, Skill, type Step, walkSteps } from "../packages/core/src/skill.ts";
import { configFromEnv, createLlm } from "../packages/llm/src/index.ts";
import { runSkill } from "../packages/player/src/index.ts";
import type { DevChrome } from "../packages/player/src/node/index.ts";
import {
  dataChannel,
  expandHome,
  fileExists,
  fsChannel,
  launchChrome,
  llmExecutor,
  poll,
  resolveInputs,
  scriptChannel,
} from "../packages/player/src/node/index.ts";
import { createRepairer, runWithRecovery } from "../packages/player/src/repair/index.ts";
import type { RunLogEvent } from "../packages/player/src/types.ts";
import { executeWebStep, pageOp, waitForCheck } from "../packages/player/src/web/index.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const file = argv.find((a) => !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.startsWith("--input"));
if (!file) {
  console.error(
    "usage: pnpm replay <skill.json> [--headless] [--yes] [--no-scripts] [--keep-open] [--input name=value]",
  );
  process.exit(2);
}
const provided: Record<string, string> = {};
argv.forEach((a, i) => {
  if (a === "--input") {
    const [k, ...v] = (argv[i + 1] ?? "").split("=");
    if (k) provided[k] = v.join("=");
  }
});

const skill = Skill.parse(JSON.parse(readFileSync(file, "utf8")));
try {
  process.loadEnvFile(join(import.meta.dirname, "../.env"));
} catch {
  // no .env: no model, unless the key is in the environment
}

// No model configured: llm steps fail with a clear message, data.pick still works.
const llmConfig = configFromEnv(process.env);
const model = llmConfig ? createLlm(llmConfig) : undefined;
const needsBrowser =
  [...walkSteps(skill.steps)].some(({ step }) => isAction(step) && step.channel === "web") ||
  skill.success.some((c) => c.text_visible || c.url_matches || c.element_visible);

let chrome: DevChrome | undefined;
const browser = async () => {
  chrome ??= await launchChrome({
    profileDir: expandHome(
      process.env.TASKPLAYER_CHROME_PROFILE ?? "~/Library/Application Support/TaskPlayer/dev-chrome",
    ),
    downloadDir: expandHome("~/Downloads"),
    headless: flag("--headless"),
  });
  return chrome.cdp;
};

const rl = createInterface({ input: process.stdin, output: process.stdout });
const approve = async (step: Step) => {
  if (flag("--yes")) return true;
  const answer = await rl.question(`approve ${step.id} "${step.intent}"? [y/N] `);
  return answer.trim().toLowerCase() === "y";
};

const print = (e: RunLogEvent) => {
  if (e.type === "run.start") console.log(`▶ ${e.skillId} v${e.version}`, e.inputs);
  if (e.type === "step.result") {
    const r = e.result;
    const match = r.matchScore !== undefined ? ` match ${r.matchScore} [${r.matchedBy?.join(", ") ?? ""}]` : "";
    const value = r.value !== undefined ? ` → ${JSON.stringify(r.value).slice(0, 160)}` : "";
    console.log(
      `  ${r.ok ? "✓" : "✗"} ${e.path} (try ${e.attempt}, ${e.ms} ms)${match}${value}${r.ok ? "" : `  ${r.error}`}`,
    );
  }
  if (e.type === "step.approval" && !e.approved) console.log(`  ⏹ ${e.path} denied`);
  if (e.type === "loop.start") console.log(`  ↻ ${e.path}: ${e.items} item(s)`);
  if (e.type === "loop.item_failed") console.log(`  ↷ ${e.path}[${e.index}] skipped: ${e.error}`);
  if (e.type === "branch") console.log(`  ⑂ ${e.path}: ${e.took === "steps" ? "condition holds" : "else"}`);
  if (e.type === "step.skipped") console.log(`  – ${e.path} skipped (${e.reason})`);
  if (e.type === "repair") {
    const what = e.outcome === "commit" ? `repaired (${e.by}) as v${e.version}` : `${e.outcome} (${e.class})`;
    console.log(`  ⚒ ${e.path} ${what}: ${e.summary}${e.costUsd > 0 ? ` · $${e.costUsd.toFixed(4)}` : ""}`);
  }
  if (e.type === "run.end") {
    console.log(
      `■ ${e.status} in ${e.ms} ms${e.failedStep ? ` at ${e.failedStep}` : ""}${e.error ? `: ${e.error}` : ""}`,
    );
  }
};

let status = "failed";
try {
  if (needsBrowser) await browser();
  const deps: Parameters<typeof runSkill>[1] = {
    web: async (step) => executeWebStep(await browser(), step),
    fs: fsChannel,
    script: flag("--no-scripts")
      ? async (step) => {
          console.log(`  (skipped ${step.action}: ${JSON.stringify(step.args)})`);
          return { ok: true };
        }
      : scriptChannel,
    // data.pick rules need no model; llm steps use Nemotron when NEBIUS_API_KEY is set (capped, see llm-step.ts).
    data: dataChannel(),
    llm: llmExecutor({ llm: model }),
    fileExists: (pattern, timeoutMs) => poll(() => fileExists(pattern), timeoutMs),
    webCheck: async (check, timeoutMs) => waitForCheck(await browser(), check, timeoutMs),
    approve,
    // A step's question: typed here. A yes/no question takes y or n.
    ask: async (ask) => {
      const reply = await rl.question(`${ask.question}${ask.kind === "confirm" ? " [y/N] " : " "}`);
      return ask.kind === "confirm" ? reply.trim().toLowerCase().startsWith("y") : reply;
    },
    log: print,
  };
  const inputs = await resolveInputs(skill, provided);
  const outcome = flag("--no-repair")
    ? await runSkill(skill, deps, { inputs })
    : await runWithRecovery(skill, deps, {
        inputs,
        recovery: {
          repairer: createRepairer({
            llm: model,
            onEvent: (e) => {
              if (e.type === "call") console.log(`    · ${e.tool} ${JSON.stringify(e.input).slice(0, 140)}`);
              if (e.type === "refused") console.log(`    ⊘ ${e.tool} refused: ${e.reason}`);
            },
          }),
          page: async (op) => pageOp(await browser(), op),
          saveVersion: (repaired) => {
            const path = file.replace(/(\.v\d+)?\.json$/, `.v${repaired.version}.json`);
            writeFileSync(path, `${JSON.stringify(repaired, null, 2)}\n`);
            console.log(`  saved v${repaired.version}: ${path}`);
            return repaired;
          },
          waitForUser: async (message) => {
            console.log(`  ⏸ ${message}`);
            const reply = await rl.question("  [r]etry, [s]kip (you did it by hand) or [c]ancel? ");
            return /^s/i.test(reply) ? "skip" : /^c/i.test(reply) ? "stop" : "retry";
          },
          available: () => ({ extension: true, macApp: false, screenConsent: false }),
        },
      });
  status = outcome.status;
} catch (error) {
  console.error("✗", (error as Error).message);
} finally {
  rl.close();
  if (!flag("--keep-open")) await chrome?.close();
}
process.exit(status === "succeeded" || status === "nothing_to_do" ? 0 : 1);
