// The player's url_matches is a part of the address (location.href includes it), never a pattern. The model sometimes
// writes a regex ("https://www\.ycombinator\.com/jobs", "/issues/\d+$"): no address contains that text, so a run on
// the right page failed its check and went to repair (Oct 20, YC replay). A regex is turned back into its longest
// plain part; a plain part is kept as it is.
import { type Check, type Skill, walkSteps } from "@shadow/core";

const LOOKS_LIKE_REGEX = /\\|^\^|\$$|\.\*|\.\+/;
// What stands for "anything here" in a regex: the plain parts are around it.
const WILDCARD = /\.\*\??|\.\+\??|\\[dDwWsS][+*?]?|\[[^\]]*\][+*?]?|\([^)]*\)[+*?]?/;

export function plainUrlPart(value: string): string {
  if (!LOOKS_LIKE_REGEX.test(value)) return value;
  const pieces = value
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .split(WILDCARD)
    .map((piece) => piece.replace(/\\(.)/g, "$1"));
  const longest = pieces.reduce((a, b) => (b.length > a.length ? b : a), "");
  return longest || value;
}

const plain = (check: Check): Check =>
  check.url_matches === undefined ? check : { ...check, url_matches: plainUrlPart(check.url_matches) };

// Every url check of a workflow, nested steps and the whole task's checks too. The workflow given is not changed.
export function plainChecks(skill: Skill): Skill {
  const copy = structuredClone(skill);
  for (const { step } of walkSteps(copy.steps)) {
    if ("check" in step && step.check) step.check = plain(step.check);
  }
  copy.success = copy.success.map(plain);
  return copy;
}
