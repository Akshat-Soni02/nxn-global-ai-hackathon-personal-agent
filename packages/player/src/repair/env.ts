// What repair works with. The daemon (and `pnpm replay`) connect it to the extension, Task Player.app, memory and
// the run's channels; tests connect it to fakes. Repair never imports any of those itself.
import type { Availability } from "@taskplayer/core";
import type { RunDeps, RunLogEvent } from "../types.ts";
import type { PageOp, PageOpResult } from "../web/inspect.ts";

export interface RepairEnv {
  runId: string;
  // The run's own channels and approvals: trying a draft runs its steps through them, on the live page.
  deps: RunDeps;
  // The browser tab the run uses. Absent when no browser is connected (then web failures can't be repaired).
  page?: (op: PageOp) => Promise<PageOpResult>;
  // The run's log so far.
  runLog?: RunLogEvent[];
  // Long-term memory: site notes and earlier fixes ("the billing portal shows a cookie banner first").
  recall?(query: string): Promise<string[]>;
  note?(fact: string): Promise<void>;
  // What is connected and allowed right now, for the briefing.
  available?: Availability;
}
