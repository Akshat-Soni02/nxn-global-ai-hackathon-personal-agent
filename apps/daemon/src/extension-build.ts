// Which build of the extension Chrome is running (C25). Every build said 0.0.0, so a Chrome still running an old copy
// (Chrome keeps the old worker script until the extension is reloaded, whatever was rebuilt) looked like a fresh one:
// pictures went missing and fixes seemed not to work. The build script now writes an id into the bundle and beside it
// (dist/build.json); the extension says it in its hello ("0.0.0+<id>"), and the daemon compares.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The id of the extension built in this checkout, if there is one (none in Shadow.app or a store install).
export function builtExtension(dist: string): string | undefined {
  const file = join(dist, "build.json");
  if (!existsSync(file)) return undefined;
  try {
    const build = (JSON.parse(readFileSync(file, "utf8")) as { build?: unknown }).build;
    return typeof build === "string" ? build : undefined;
  } catch {
    return undefined;
  }
}

// Whether the copy in Chrome (its hello's version) is not the one built here.
export function staleExtension(version: string | undefined, built: string | undefined): boolean {
  if (!built) return false;
  return version?.split("+")[1] !== built;
}
