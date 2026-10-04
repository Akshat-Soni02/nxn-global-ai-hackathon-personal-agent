// Trace store: appends each recorded event to traces/<sessionId>.jsonl the moment it arrives.
// One JSON object per line and append-only: a crash loses at most the line being written, and the file is never
// rewritten, so a skill can be recompiled later from the same evidence (`compile <session>` in main.ts).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TraceEvent } from "@taskplayer/core";

export function tracePath(dataDir: string, sessionId: string): string {
  // The id becomes a file name, so it may only be a plain token (the daemon makes them with randomUUID).
  if (!/^[\w-]+$/.test(sessionId)) throw new Error(`invalid session id: ${sessionId}`);
  return join(dataDir, "traces", `${sessionId}.jsonl`);
}

export function appendTrace(dataDir: string, event: TraceEvent): void {
  const path = tracePath(dataDir, event.sessionId);
  mkdirSync(join(dataDir, "traces"), { recursive: true });
  // parse() also drops message-only fields such as `type`, so the file holds trace events only.
  appendFileSync(path, `${JSON.stringify(TraceEvent.parse(event))}\n`);
}

// Events in time order. A half-written last line (crash mid-write) is skipped, not fatal.
export function readTrace(dataDir: string, sessionId: string): TraceEvent[] {
  const path = tracePath(dataDir, sessionId);
  if (!existsSync(path)) return [];
  const events: TraceEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = TraceEvent.safeParse(JSON.parse(line));
      if (parsed.success) events.push(parsed.data);
    } catch {
      // incomplete line
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

export function listTraces(dataDir: string): { sessionId: string; modified: Date }[] {
  const dir = join(dataDir, "traces");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ sessionId: f.slice(0, -".jsonl".length), modified: statSync(join(dir, f)).mtime }))
    .sort((a, b) => a.modified.getTime() - b.modified.getTime());
}
