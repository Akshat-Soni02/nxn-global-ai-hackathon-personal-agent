// The workflow as one line per step, nested: what the design agents and the drill read of a draft.
import { type Skill, type Step, triggerOf } from "@shadow/core";

// One line per step, nested: what the agent and the drill see of the draft.
export function outlineOf(skill: Skill): string {
  const lines: string[] = [];
  const trigger = triggerOf(skill);
  const when = trigger.when.map((w) => (w.type === "schedule" ? `schedule ${w.cron}` : w.type)).join(", ");
  const inputs = Object.entries(trigger.inputs)
    .map(([name, input]) => {
      const fill =
        input.default !== undefined
          ? ` = ${JSON.stringify(input.default)}`
          : input.resolve
            ? ` from ${JSON.stringify(input.resolve)}`
            : "";
      return `${name} (${typeText(input.type)})${fill}`;
    })
    .join("; ");
  lines.push(`${trigger.id}  trigger  when: ${when}${inputs ? `  inputs: ${inputs}` : ""}`);
  const walk = (steps: Step[], depth: number) => {
    for (const step of steps) {
      if (step.type === "trigger") continue;
      const pad = "  ".repeat(depth);
      const approval = step.requires_approval ? "  [approval]" : "";
      if (step.type === "action") {
        // A read of the whole page says so (Checkpoint 5: shown as on element "?", D's agent took it for a broken read
        // and re-added it 10 times); a control known only by its selector shows the selector.
        const t = step.target;
        const named = t && (t.role || t.name || t.label || t.text);
        const target = !t
          ? ""
          : named
            ? `  on ${t.role ?? "element"} "${t.name ?? t.label ?? t.text ?? "?"}"`
            : t.fallbacks.join() === "main,body"
              ? "  reads the whole page"
              : `  on ${t.fallbacks[0] ?? "?"}`;
        const args = Object.keys(step.args).length > 0 ? `  args ${clip(JSON.stringify(step.args), 160)}` : "";
        const out = step.output ? `  → ${step.output.name} (${typeText(step.output.type)})` : "";
        lines.push(
          `${pad}${step.id}  ${step.channel}.${step.action}  "${step.intent}"${target}${args}${out}${approval}`,
        );
      } else if (step.type === "llm") {
        lines.push(
          `${pad}${step.id}  llm  "${step.intent}"  reads ${step.inputs.join(", ") || "nothing"}  → ${step.output.name} (${typeText(step.output.type)})${approval}`,
        );
      } else if (step.kind === "loop") {
        lines.push(
          `${pad}${step.id}  loop "${step.intent}"  for each ${step.item.name} in ${step.over} (max ${step.max_items}, ${step.on_item_fail} on a failing item)${approval}`,
        );
        walk(step.steps, depth + 1);
      } else if (step.kind === "group") {
        lines.push(`${pad}${step.id}  block "${step.intent}"`);
        walk(step.steps, depth + 1);
      } else {
        lines.push(`${pad}${step.id}  if ${JSON.stringify(step.if)}  "${step.intent}"${approval}`);
        walk(step.steps, depth + 1);
        if (step.else.length > 0) {
          lines.push(`${pad}  else`);
          walk(step.else, depth + 1);
        }
      }
    }
  };
  walk(skill.steps, 1);
  return lines.join("\n");
}

export function typeText(type: { type: string; items?: { type: string } }): string {
  return type.type === "list" && type.items ? `list of ${type.items.type}` : type.type;
}
export const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}…`);
