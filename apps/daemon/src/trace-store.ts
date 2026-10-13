// Trace store: appends each recorded event to the recording's folder (recordings/<sessionId>/trace.jsonl) the moment
// it arrives. One JSON object per line and append-only: a crash loses at most the line being written, and the file is
// never rewritten, so a skill can be recompiled from the same evidence (`compile <session>` in main.ts) until the
// folder is deleted (recording-store.ts, 24 hours). Recordings made before Oct 13 are one file each in traces/; they
// are still read, and left as they are.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { TraceEvent } from "@shadow/core";
import { recordingDir } from "./recording-store.ts";

export function tracePath(dataDir: string, sessionId: string): string {
  // The id becomes a file name, so it may only be a plain token (the daemon makes them with randomUUID).
  if (!/^[\w-]+$/.test(sessionId)) throw new Error(`invalid session id: ${sessionId}`);
  const legacy = join(dataDir, "traces", `${sessionId}.jsonl`);
  return existsSync(legacy) ? legacy : join(recordingDir(dataDir, sessionId), "trace.jsonl");
}

export function appendTrace(dataDir: string, event: TraceEvent): void {
  const path = tracePath(dataDir, event.sessionId);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // parse() also drops message-only fields such as `type`, so the file holds trace events only.
  appendFileSync(path, `${JSON.stringify(TraceEvent.parse(event))}\n`, { mode: 0o600 });
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

// Every recording that can still be compiled: the folders, and the older single files.
export function listTraces(dataDir: string): { sessionId: string; modified: Date }[] {
  const found: { sessionId: string; modified: Date }[] = [];
  const recordings = join(dataDir, "recordings");
  if (existsSync(recordings)) {
    for (const name of readdirSync(recordings)) {
      const file = join(recordings, name, "trace.jsonl");
      if (existsSync(file)) found.push({ sessionId: name, modified: statSync(file).mtime });
    }
  }
  const legacy = join(dataDir, "traces");
  if (existsSync(legacy)) {
    for (const f of readdirSync(legacy).filter((f) => f.endsWith(".jsonl"))) {
      found.push({ sessionId: f.slice(0, -".jsonl".length), modified: statSync(join(legacy, f)).mtime });
    }
  }
  return found.sort((a, b) => a.modified.getTime() - b.modified.getTime());
}
