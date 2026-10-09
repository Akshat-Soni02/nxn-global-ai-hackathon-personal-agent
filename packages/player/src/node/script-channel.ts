// script channel: AppleScript, Shortcuts, and a small allow-list of shell commands.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ActionStep as Step } from "@taskplayer/core";
import type { StepResult } from "../types.ts";

const run = promisify(execFile);
const SCRIPT_TIMEOUT_MS = 30_000;

// Shell commands a skill may run. Anything with shell metacharacters is refused outright.
export const SHELL_ALLOW_LIST = new Set(["open", "say", "echo", "date"]);

export async function scriptChannel(step: Step): Promise<StepResult> {
  const timeout = step.timeout_ms ?? SCRIPT_TIMEOUT_MS;
  const a = step.args;
  try {
    switch (step.action) {
      case "applescript": {
        const { stdout } = await run("osascript", ["-e", String(a.source ?? "")], { timeout });
        return { ok: true, value: stdout.trim() };
      }
      case "shortcut": {
        const args = ["run", String(a.name ?? "")];
        if (a.input !== undefined) args.push("--input-path", String(a.input));
        const { stdout } = await run("shortcuts", args, { timeout });
        return { ok: true, value: stdout.trim() };
      }
      case "shell": {
        const command = String(a.command ?? "").trim();
        const program = command.split(/\s+/)[0] ?? "";
        if (!SHELL_ALLOW_LIST.has(program) || /[;&|`$<>\\]/.test(command)) {
          return { ok: false, error: `shell command not allowed: ${command}` };
        }
        const { stdout } = await run("/bin/sh", ["-c", command], { timeout });
        return { ok: true, value: stdout.trim() };
      }
      default:
        return { ok: false, error: `script.${step.action} is not supported` };
    }
  } catch (error) {
    const e = error as { stderr?: string; message: string };
    return { ok: false, error: (e.stderr || e.message).trim() };
  }
}
