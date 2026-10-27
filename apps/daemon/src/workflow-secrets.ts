// A workflow's secret inputs (N2): a password field recorded as a `secret` input has no value in the workflow, so a run
// stopped with "input password has no value". Each one is typed once on the workflow's page and kept in the login
// Keychain, one item per workflow and input; a run reads it when it starts. The window is told only whether one is set,
// never its value; it never goes into a log or a prompt.
import { type Skill, triggerOf } from "@shadow/core";
import { readSecret, runSecurity, type SecurityRunner, writeSecret } from "./keychain.ts";

export const secretAccount = (skillId: string, name: string) => `secret:${skillId}:${name}`;

// The workflow's secret inputs, and whether each is set.
export async function secretStatus(
  skill: Skill,
  run: SecurityRunner = runSecurity,
): Promise<{ name: string; set: boolean }[]> {
  const names = Object.entries(triggerOf(skill).inputs)
    .filter(([, input]) => input.type.type === "secret")
    .map(([name]) => name);
  return Promise.all(
    names.map(async (name) => ({ name, set: (await readSecret(secretAccount(skill.id, name), run)) !== undefined })),
  );
}

export async function setWorkflowSecret(
  skillId: string,
  name: string,
  value: string,
  run: SecurityRunner = runSecurity,
): Promise<void> {
  if (!value.trim()) throw new Error("a secret can't be empty");
  await writeSecret(secretAccount(skillId, name), `Shadow: ${skillId} ${name}`, value, run);
}

export function readWorkflowSecret(
  skillId: string,
  name: string,
  run: SecurityRunner = runSecurity,
): Promise<string | undefined> {
  return readSecret(secretAccount(skillId, name), run);
}
