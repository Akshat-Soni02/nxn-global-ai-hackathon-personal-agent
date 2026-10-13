// The Keychain helpers, against a stand-in for `security`: the key goes in on stdin, never on the command line.
import { describe, expect, it } from "vitest";
import { deleteApiKey, readApiKey, type SecurityRunner, writeApiKey } from "./keychain.ts";

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
