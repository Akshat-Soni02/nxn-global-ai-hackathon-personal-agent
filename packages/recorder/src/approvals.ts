// Approval, set by code once a recording has become a workflow (docs/design.md, "3. Understand"): every step that
// sends, submits, pays, publishes or deletes, and every step that matches one of the user's Never entries, waits for
// the user's OK. No model decides this, and nothing later turns it off (core/guard.ts keeps repair from doing so).
import { isAction, isOutward, neverMatch, type Skill, walkSteps } from "@shadow/core";

// readOnlyTools: connected apps' tools whose hints say they only read (mcp-tools.ts in the daemon); an mcp step
// calling one of them doesn't need approval. Every other mcp step does.
export function requireApprovals(
  skill: Skill,
  options: { readOnlyTools?: ReadonlySet<string> } = {},
): { skill: Skill; added: string[] } {
  const copy = structuredClone(skill);
  const added: string[] = [];
  for (const { step } of walkSteps(copy.steps)) {
    if (!isAction(step) || step.requires_approval) continue;
    // An upload only hands a file to the page; the click that sends it is the step that needs approval.
    const readOnlyTool = step.channel === "mcp" && options.readOnlyTools?.has(String(step.args.tool));
    const outward = isOutward(step) && !(step.channel === "web" && step.action === "upload") && !readOnlyTool;
    if (outward || neverMatch(step, copy.description.never)) {
      step.requires_approval = true;
      added.push(step.id);
    }
  }
  return { skill: copy, added };
}
