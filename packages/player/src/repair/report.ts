// The failure report: collected before the repair agent's first turn, so it starts from evidence, not a blank page
// (docs/design.md, "The failure report"). Text, for the model; page content in it is marked as untrusted.
import { type Skill, walkSteps } from "@taskplayer/core";
import type { Failure, RunLogEvent } from "../types.ts";
import type { FoundElement, PageSignals } from "../web/inspect.ts";
import type { Classification } from "./classify.ts";
import type { RepairEnv } from "./env.ts";

export async function failureReport(
  skill: Skill,
  failure: Failure,
  classification: Classification,
  env: RepairEnv,
): Promise<string> {
  const step = failure.step;
  const lines: string[] = [
    `# Failure in "${skill.name}" (version ${skill.version})`,
    `Goal: ${skill.description.goal}`,
    skill.description.never.length > 0 ? `Never: ${skill.description.never.join("; ")}` : "",
    "",
    `Failed step ${failure.stepId} at ${failure.path}: "${step.intent}"`,
    `As run: ${JSON.stringify(stripEmpty(step))}`,
    `Error after ${failure.attempts} attempt(s): ${failure.result.error ?? "check failed"}`,
    failure.result.matchScore !== undefined ? `Best match score for its target: ${failure.result.matchScore}` : "",
    `Cheap signals say: ${classification.class} (${classification.reason})`,
  ];

  if (env.page && step.type === "action" && step.channel === "web") {
    const signals = await env.page({ op: "signals" });
    if (signals.ok) {
      const s = signals.value as PageSignals;
      lines.push(
        "",
        "# The page now",
        `URL ${s.url} · "${s.title}"${s.status ? ` · HTTP ${s.status}` : ""}${s.dialogs.length > 0 ? ` · open dialogs: ${s.dialogs.join(", ")}` : ""}`,
      );
    }
    const name = step.target?.name ?? step.target?.label ?? step.target?.text;
    if (name) {
      const found = await env.page({ op: "find", text: name, role: step.target?.role });
      const candidates = found.ok ? (found.value as FoundElement[]) : [];
      lines.push(
        `Controls named like "${name}": ${
          candidates.length === 0
            ? "none"
            : candidates
                .map(
                  (c) =>
                    `${c.ref} ${c.role} "${c.name}" (${c.score}${c.dialog ? `, in dialog "${c.dialog}"` : ""}${c.near ? `, under "${c.near}"` : ""})`,
                )
                .join("; ")
        }`,
      );
    }
    const outline = await env.page({ op: "outline", max: 120 });
    if (outline.ok) lines.push("", "<untrusted_data>", String(outline.value), "</untrusted_data>");
  }

  const log = (env.runLog ?? []).slice(-12).map(logLine).filter(Boolean);
  if (log.length > 0) lines.push("", "# The run so far (last events)", ...log);

  if (env.recall) {
    const host = hostOfSkill(skill);
    const notes = await env.recall(host ?? skill.name).catch(() => [] as string[]);
    if (notes.length > 0) lines.push("", "# Site notes from earlier runs", ...notes.map((n) => `- ${n}`));
  }

  lines.push("", "# The workflow", workflowOutline(skill, failure.stepId));
  return lines.filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
}

// One line per step, indented by nesting, the failed one marked.
export function workflowOutline(skill: Skill, failed?: string): string {
  return [...walkSteps(skill.steps)]
    .map(({ step, parents }) => {
      const pad = "  ".repeat(parents.length);
      const what =
        step.type === "action"
          ? `${step.channel}.${step.action}${step.target ? ` ${JSON.stringify(stripEmpty(step.target))}` : ""}${Object.keys(step.args).length > 0 ? ` args ${JSON.stringify(step.args)}` : ""}${step.requires_approval ? " [approval]" : ""}`
          : step.type === "control"
            ? step.kind === "loop"
              ? `loop over ${step.over} as ${step.item.name}`
              : `branch if ${JSON.stringify(step.if)}`
            : step.type;
      return `${pad}${step.id === failed ? "→ " : ""}${step.id} ${what} · ${step.intent}`;
    })
    .join("\n");
}

function logLine(e: RunLogEvent): string {
  switch (e.type) {
    case "step.result":
      return `${e.path}: ${e.result.ok ? "ok" : `failed: ${e.result.error}`}${e.result.matchScore !== undefined ? ` (match ${e.result.matchScore})` : ""}`;
    case "branch":
      return `${e.path}: took ${e.took}`;
    case "loop.item":
      return `${e.path}: item ${e.index}`;
    case "step.skipped":
      return `${e.path}: skipped (${e.reason})`;
    default:
      return "";
  }
}

const hostOfSkill = (skill: Skill): string | undefined => {
  for (const { step } of walkSteps(skill.steps)) {
    if (step.type === "action" && step.action === "navigate") {
      try {
        return new URL(String(step.args.url)).host;
      } catch {}
    }
  }
  return undefined;
};

const stripEmpty = (v: object): object =>
  Object.fromEntries(
    Object.entries(v).filter(
      ([, x]) =>
        x !== undefined &&
        !(Array.isArray(x) && x.length === 0) &&
        !(x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length === 0),
    ),
  );
