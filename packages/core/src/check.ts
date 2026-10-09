// The save-time check of a skill's variables: every {{…}} points to a variable that is visible at that step, its
// fields exist, a loop runs over a list, names are declared once, and a step only declares an output its action can
// produce. Run when a skill is parsed, so a saved skill never refers to something missing.
import type { ActionStep, Step } from "./skill.ts";
import { BUILT_INS, findRefs, type PathType, parseRef, sameType, typeAt, typeText, type VarType } from "./vars.ts";

type Scope = Map<string, VarType>;

export function checkVariables(steps: Step[]): string[] {
  const problems: string[] = [];
  // Names taken so far. A branch's two arms are alternatives (only one runs), so each arm is checked against the names
  // taken before the branch; afterwards both arms' names are taken. That is how both arms can produce the same
  // variable, which is what keeps it visible after the branch.
  let declared = new Set<string>();

  const declare = (scope: Scope, name: string, type: VarType, where: string) => {
    if (declared.has(name)) problems.push(`${where}: variable ${name} is already declared`);
    declared.add(name);
    scope.set(name, type);
  };

  const refs = (scope: Scope, value: unknown, where: string) => {
    for (const { at, expr } of findRefs(value)) {
      const place = at ? `${where}.${at}` : where;
      const type = refType(scope, expr);
      if (typeof type === "string" && type !== "unknown") problems.push(`${place}: {{${expr}}} ${type}`);
    }
  };

  const run = (list: Step[], scope: Scope, where: string): Scope => {
    list.forEach((step, i) => {
      const at = `${where}.${i}`;
      if (step.type === "trigger") {
        for (const [name, input] of Object.entries(step.inputs))
          declare(scope, name, input.type, `${at}.inputs.${name}`);
        return;
      }
      if (step.ask) {
        refs(scope, step.ask.question, `${at}.ask.question`);
        if (step.ask.output) declare(scope, step.ask.output.name, step.ask.output.type, `${at}.ask.output`);
      }
      if (step.type === "action") {
        refs(scope, { target: step.target, args: step.args, wait: step.wait, check: step.check }, at);
        if (step.output) {
          const problem = outputProblem(step, step.output.type);
          if (problem) problems.push(`${at}.output: ${problem}`);
          declare(scope, step.output.name, step.output.type, `${at}.output`);
        }
      } else if (step.type === "llm") {
        refs(scope, step.inputs, `${at}.inputs`);
        declare(scope, step.output.name, step.output.type, `${at}.output`);
      } else if (step.kind === "loop") {
        refs(scope, step.over, `${at}.over`);
        const over = refType(scope, stripBraces(step.over));
        if (typeof over !== "string") {
          if (over.type !== "list") problems.push(`${at}.over: ${step.over} is a ${typeText(over)}, not a list`);
          else if (!sameType(over.items, step.item.type)) {
            problems.push(
              `${at}.item: ${step.item.name} is declared as ${typeText(step.item.type)} but the list holds ${typeText(over.items)}`,
            );
          }
        }
        const inner = new Map(scope);
        declare(inner, step.item.name, step.item.type, `${at}.item`);
        run(step.steps, inner, `${at}.steps`);
      } else {
        refs(scope, step.if, `${at}.if`);
        const before = declared;
        declared = new Set(before);
        const yes = run(step.steps, new Map(scope), `${at}.steps`);
        const takenByYes = declared;
        declared = new Set(before);
        const no = run(step.else, new Map(scope), `${at}.else`);
        declared = new Set([...takenByYes, ...declared]);
        // After the branch, a variable exists only if both arms produced it, with the same type.
        for (const [name, type] of yes) {
          const other = no.get(name);
          if (!scope.has(name) && other && sameType(type, other)) scope.set(name, type);
        }
      }
    });
    return scope;
  };

  run(steps, new Map(), "steps");
  return problems;
}

const stripBraces = (s: string) => s.replace(/^\s*\{\{\s*|\s*\}\}\s*$/g, "");

// The type a reference points to, or a sentence saying why it is wrong.
function refType(scope: Scope, expr: string): PathType | string {
  const ref = parseRef(expr);
  if (!ref) return "is not a variable reference: use {{name}} or {{name.field}}";
  const root = scope.get(ref.name) ?? BUILT_INS[ref.name];
  if (!root) return `uses ${ref.name}, which is not declared by an earlier step`;
  const type = typeAt(root, ref.path);
  if (type === undefined) return `has no such field: ${ref.name} is a ${typeText(root)}`;
  return type;
}

// What each action can produce. An object type without fields stands for rows of any shape.
const TEXT: VarType = { type: "text" };
const FILE: VarType = { type: "file" };
const listOf = (items: VarType): VarType => ({ type: "list", items });

function produces(step: ActionStep): VarType[] {
  const a = step.args;
  const key = `${step.channel}.${step.action}`;
  switch (key) {
    case "web.extract":
      return a.source ? [listOf({ type: "object" })] : a.all && typeof a.each !== "string" ? [listOf(TEXT)] : [TEXT];
    case "fs.find":
      return a.pick === "all" ? [listOf(FILE)] : [FILE];
    case "fs.move":
    case "fs.copy":
      return [FILE, listOf(FILE)];
    case "fs.rename":
    case "fs.write":
      return [FILE];
    case "fs.read":
      return [TEXT];
    case "data.pick":
      return typeof a.column === "string" ? [TEXT] : [{ type: "object" }];
    case "script.applescript":
    case "script.shortcut":
    case "script.shell":
      return [TEXT];
    default:
      return [];
  }
}

// A declared output fits what the action produces when the shapes match; rows of any shape may be declared with
// their fields, and text may be declared as number, boolean or date (checked at run time).
function fits(declared: VarType, produced: VarType): boolean {
  if (produced.type === "text") return ["text", "number", "boolean", "date", "secret"].includes(declared.type);
  if (produced.type === "list") return declared.type === "list" && fits(declared.items, produced.items);
  if (produced.type === "object")
    return declared.type === "object" && (!produced.fields || sameType(declared, produced));
  return declared.type === produced.type;
}

function outputProblem(step: ActionStep, declared: VarType): string | undefined {
  const options = produces(step);
  if (options.length === 0) return `${step.channel}.${step.action} produces no value`;
  if (options.some((p) => fits(declared, p))) return undefined;
  return `${step.channel}.${step.action} produces ${options.map(typeText).join(" or ")}, not ${typeText(declared)}`;
}
