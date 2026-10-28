// The Keychain helpers, against a stand-in for `security`: the key goes in on stdin, never on the command line.

import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { deleteApiKey, readApiKey, type SecurityRunner, writeApiKey } from "./keychain.ts";
import { readWorkflowSecret, secretStatus, setWorkflowSecret } from "./workflow-secrets.ts";

function fake(stored?: string) {
  const calls: { args: string[]; stdin?: string }[] = [];
  let key = stored;
  const run: SecurityRunner = async (args, stdin) => {
    calls.push({ args, stdin });
    if (args[0] === "find-generic-password") return key ? { stdout: `${key}\n`, code: 0 } : { stdout: "", code: 44 };
    if (args[0] === "-i") {
      key = /-w "([^"]+)"/.exec(stdin ?? "")?.[1];
      return { stdout: "", code: 0 };
    }
    if (args[0] === "delete-generic-password") {
      key = undefined;
      return { stdout: "", code: 0 };
    }
    return { stdout: "", code: 1 };
  };
  return { run, calls, current: () => key };
}

describe("the API key in the Keychain", () => {
  it("reads nothing when there is no key, and the key when there is one", async () => {
    expect(await readApiKey(fake().run)).toBeUndefined();
    expect(await readApiKey(fake("sk-test-123").run)).toBe("sk-test-123");
  });

  it("writes the key through security's stdin, never its arguments", async () => {
    const k = fake();
    await writeApiKey("  sk-new-456 ", k.run);
    expect(k.current()).toBe("sk-new-456");
    const write = k.calls.find((c) => c.args[0] === "-i");
    expect(write?.args).toEqual(["-i"]);
    expect(write?.stdin).toContain('-s "com.shadow.mac" -a "token-factory"');
    expect(k.calls.every((c) => !c.args.join(" ").includes("sk-new-456"))).toBe(true);
  });

  it("refuses an empty or spaced key, and deletes", async () => {
    const k = fake("sk-old");
    await expect(writeApiKey("", k.run)).rejects.toThrow(/API key/);
    await expect(writeApiKey("two words", k.run)).rejects.toThrow(/API key/);
    await deleteApiKey(k.run);
    expect(k.current()).toBeUndefined();
  });
});

describe("a workflow's secret inputs in the Keychain (N2)", () => {
  // One item per workflow and input; the value goes in on stdin, and is never read back to the window.
  const byAccount = () => {
    const items = new Map<string, string>();
    const run: SecurityRunner = async (args, stdin) => {
      if (args[0] === "find-generic-password") {
        const account = args[args.indexOf("-a") + 1] ?? "";
        const v = items.get(account);
        return v ? { stdout: `${v}\n`, code: 0 } : { stdout: "", code: 44 };
      }
      if (args[0] === "-i") {
        const account = /-a "([^"]+)"/.exec(stdin ?? "")?.[1] ?? "";
        items.set(account, /-w "([^"]+)"/.exec(stdin ?? "")?.[1] ?? "");
        return { stdout: "", code: 0 };
      }
      return { stdout: "", code: 1 };
    };
    return { run, items };
  };
  const skill = Skill.parse({
    id: "payroll",
    name: "Payroll",
    version: 1,
    description: { goal: "g" },
    steps: [
      {
        id: "start",
        type: "trigger",
        intent: "by hand",
        inputs: { password: { type: { type: "secret" } }, month: { type: { type: "text" }, default: "Oct" } },
      },
      {
        id: "s1",
        type: "action",
        intent: "x",
        channel: "fs",
        action: "write",
        args: { path: "~/x", content: "{{password}}" },
      },
    ],
  });

  it("says which secrets are set (never their values), keeps one per workflow and input, and reads it for a run", async () => {
    const { run, items } = byAccount();
    expect(await secretStatus(skill, run)).toEqual([{ name: "password", set: false }]);
    await setWorkflowSecret("payroll", "password", "hunter2", run);
    expect([...items.keys()]).toEqual(["secret:payroll:password"]);
    expect(await secretStatus(skill, run)).toEqual([{ name: "password", set: true }]);
    expect(await readWorkflowSecret("payroll", "password", run)).toBe("hunter2");
    await expect(setWorkflowSecret("payroll", "password", "  ", run)).rejects.toThrow(/empty/);
  });
});
