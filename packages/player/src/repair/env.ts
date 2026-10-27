// What repair works with. The daemon (and `pnpm replay`) connect it to the extension, Shadow.app, memory and
// the run's channels; tests connect it to fakes. Repair never imports any of those itself.
import type { Availability } from "@shadow/core";
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
  // A masked picture of the page or window as it is now, described by the vision model (describe_screen). Present
  // only when the user allowed pictures to be sent; the daemon masks the picture before it leaves the Mac.
  describeScreen?(question: string): Promise<string>;
  // What the recording showed at a step (skills/<id>/recorded.json): what it looked like and what was said then.
  recorded?(stepId: string): string | undefined;
  // What is connected and allowed right now, for the briefing.
  available?: Availability;
  // One connected app tool's arguments (app_tool), so a step that uses it isn't written from a guess. Present only when an
  // app is connected.
  appTool?(name: string): string;
}
