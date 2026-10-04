// Development runner: replays a skill without the extension, in a separate debug-port Chrome profile.
// Usage: pnpm replay <skill.json> [--headless] [--yes] [--no-scripts] [--keep-open] [--input name=value ...]
//   --yes         approve every requires_approval step
//   --no-scripts  print script steps instead of running them
// Production replay goes through the daemon and the extension; this shares the same player code.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Skill, type Step } from "../packages/core/src/skill.ts";
import { chat, configFromEnv } from "../packages/llm/src/index.ts";
import { runSkill } from "../packages/player/src/index.ts";
import type { DevChrome } from "../packages/player/src/node/index.ts";
import {
  dataChannel,
  expandHome,
  fileExists,
  fsChannel,
  launchChrome,
  poll,
  resolveInputs,
  scriptChannel,
} from "../packages/player/src/node/index.ts";
import type { RunLogEvent } from "../packages/player/src/types.ts";
import { executeWebStep, waitForCheck } from "../packages/player/src/web/index.ts";

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

function askModel() {
  try {
    const config = configFromEnv(process.env);
    return (system: string, user: string) =>
      chat(config, [
        { role: "system", content: system },
        { role: "user", content: user },
      ]);
  } catch {
    return undefined; // no model configured: data.ai steps fail with a clear message, data.pick still works
  }
}
const needsBrowser =
  skill.steps.some((s) => s.channel === "web") ||
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
      `  ${r.ok ? "✓" : "✗"} ${e.stepId} (try ${e.attempt}, ${e.ms} ms)${match}${value}${r.ok ? "" : `  ${r.error}`}`,
    );
  }
  if (e.type === "step.approval" && !e.approved) console.log(`  ⏹ ${e.stepId} denied`);
  if (e.type === "run.end") console.log(`■ ${e.status} in ${e.ms} ms${e.error ? `: ${e.error}` : ""}`);
};

let status = "failed";
try {
  if (needsBrowser) await browser();
  const outcome = await runSkill(
    skill,
    {
      web: async (step) => executeWebStep(await browser(), step),
      fs: fsChannel,
      script: flag("--no-scripts")
        ? async (step) => {
            console.log(`  (skipped ${step.action}: ${JSON.stringify(step.args)})`);
            return { ok: true };
          }
        : scriptChannel,
      // data.pick rules need no model; data.ai uses Nemotron when NEBIUS_* are set (capped, see data-channel.ts).
      data: dataChannel({ ask: askModel() }),
      fileExists: (pattern, timeoutMs) => poll(() => fileExists(pattern), timeoutMs),
      webCheck: async (check, timeoutMs) => waitForCheck(await browser(), check, timeoutMs),
      approve,
      log: print,
    },
    { inputs: await resolveInputs(skill, provided) },
  );
  status = outcome.status;
} catch (error) {
  console.error("✗", (error as Error).message);
} finally {
  rl.close();
  if (!flag("--keep-open")) await chrome?.close();
}
process.exit(status === "succeeded" ? 0 : 1);
