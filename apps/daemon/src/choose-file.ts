// Which file a run uses, settled in the daemon terminal before the first step runs, so a wrong file never leaves a
// task half done. Two ways in:
//   - with the command: run <skill> photo=~/Desktop/new.jpeg (or just the path, when the skill takes one file);
//   - asked here, unless you chose a fixed rule when you stopped recording (resolve.ask === false). Enter takes the
//     suggestion, the newest file like the recorded one; or type a path, or drag a file in from Finder.
// Every file is checked first (checkFile): it must exist, not be empty, and be a kind the step takes. A wrong answer
// is explained and asked again; a wrong file given with the command stops the run at once.

import type { Skill } from "@taskplayer/core";
import { checkFile, expandHome, type FileRule, findFiles } from "@taskplayer/player/node";
import type { Question } from "@taskplayer/recorder";

export async function chooseFiles(
  skill: Skill,
  provided: Record<string, unknown>,
  ask: (question: Question) => Promise<string>,
  log: (...args: unknown[]) => void,
): Promise<void> {
  for (const [name, input] of Object.entries(skill.inputs)) {
    if (input.type !== "file") continue;
    const rule = (input.resolve ?? {}) as FileRule;
    if (name in provided) {
      const given = provided[name];
      const paths = (Array.isArray(given) ? given : [given]).map((p) => cleanPath(String(p)));
      for (const path of paths) {
        const why = checkFile(path, rule);
        if (why) throw new Error(`${name}: ${why}`);
      }
      provided[name] = Array.isArray(given) ? paths : paths[0];
      continue;
    }
    if (rule.pick === "all" && rule.dir && rule.glob) {
      // "All of them": files the step can't take are left where they are, and you're told which.
      for (const path of await findFiles(rule.dir, rule.glob).catch(() => [])) {
        const why = checkFile(path, rule);
        if (why) log(`skipping: ${why}`);
      }
    }
    if (rule.ask === false || rule.pick === "all") continue;
    const suggestion =
      rule.dir && rule.glob
        ? (await findFiles(rule.dir, rule.glob).catch(() => [])).find((path) => !checkFile(path, rule))
        : undefined;
    const use = skill.steps.find((s) => JSON.stringify(s.args).includes(`{{inputs.${name}`))?.intent;
    for (let tries = 0; tries < 3 && !(name in provided); tries++) {
      const typed = await ask({
        id: `run-file-${name}`,
        text:
          `${use ?? input.description ?? name}: which file? Type its path or drag it here from Finder` +
          ` (next time you can give it with the command: run ${skill.id} ${name}=<path>)`,
        default: suggestion,
      });
      const path = cleanPath(typed) || suggestion;
      const why = path ? checkFile(path, rule) : "no file like the recorded one is there: type or drag one";
      if (why) log(why);
      else provided[name] = path;
    }
    if (!(name in provided)) throw new Error(`no file chosen for ${name}`);
  }
}

// What the run command gave: name=value pairs, or just a path when the skill takes one file (run <skill> <path>).
export function givenInputs(skill: Skill, args: string[]): Record<string, unknown> {
  const given: Record<string, unknown> = {};
  const files = Object.keys(skill.inputs).filter((name) => skill.inputs[name]?.type === "file");
  for (const arg of args) {
    const named = /^([A-Za-z_][\w-]*)=(.*)$/s.exec(arg);
    if (named?.[1]) {
      if (!(named[1] in skill.inputs))
        throw new Error(
          `${skill.id} has no input ${named[1]} (it has: ${Object.keys(skill.inputs).join(", ") || "none"})`,
        );
      given[named[1]] = named[2] ?? "";
    } else if (files.length === 1 && files[0]) given[files[0]] = arg;
    else if (files.length === 0) throw new Error(`${skill.id} takes no file, so ${arg} has nowhere to go`);
    else
      throw new Error(
        `${skill.id} takes ${files.length} files: say which, as ${files.map((f) => `${f}=<path>`).join(" ")}`,
      );
  }
  return given;
}

// One command line split into words as a shell would: quotes and backslashes keep spaces inside a word, so a path
// dragged in from Finder (Terminal types My\ Photo.jpeg) stays one word.
export function splitArgs(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === "\\" && quote === '"' && i + 1 < line.length) word += line.charAt(++i);
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (c === "\\" && i + 1 < line.length) {
      word += line.charAt(++i);
      started = true;
    } else if (/\s/.test(c)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += c;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}

// A path as typed or dropped into a terminal: Terminal escapes spaces ("My\ Photo.jpeg"), others quote the path.
export function cleanPath(typed: string): string {
  let path = typed.trim();
  const quoted = /^(['"])(.*)\1$/.exec(path);
  path = quoted ? (quoted[2] ?? "") : path.replace(/\\(.)/g, "$1");
  return path ? expandHome(path) : "";
}
