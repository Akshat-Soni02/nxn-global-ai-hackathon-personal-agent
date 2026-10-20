// A workflow's review (spec 4.3), beside its versions: skills/<id>/review.json. Written when a recording is saved;
// "Looks right" marks it; Go live waits for that on the version it is about.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { skillDir } from "./skill-store.ts";
import type { Review } from "./types.ts";

const pathOf = (dataDir: string, id: string) => join(skillDir(dataDir, id), "review.json");

export function writeReview(dataDir: string, review: Review): void {
  const path = pathOf(dataDir, review.skillId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(review, null, 2)}\n`, { mode: 0o600 });
}

export function readReview(dataDir: string, id: string): Review | undefined {
  // A workflow id names a folder: only plain ones (skill-store's rule), so no id can point outside the skills folder.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return undefined;
  const path = pathOf(dataDir, id);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Review) : undefined;
}

export function markReviewed(dataDir: string, id: string): Review | undefined {
  const review = readReview(dataDir, id);
  if (!review) return undefined;
  const marked = { ...review, reviewed: true };
  writeReview(dataDir, marked);
  return marked;
}
