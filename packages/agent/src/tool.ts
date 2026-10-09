// A tool an agent can call. Tools are written against interfaces (look at the page, act on it, run steps), and the
// caller connects them to the extension, Task Player.app, memory and the skill store, so agents also run in tests.
import type { z } from "zod";

//   look      read-only: the failure report, a page outline, the workflow
//   probe     acts on the live page, safely (open a menu, dismiss a banner); counts as a live action
//   edit      changes the draft workflow
//   try       runs the draft on the live page; counts as a live action
//   finish    ends the episode with its outcome
//   remember  writes to long-term memory
export type ToolKind = "look" | "probe" | "edit" | "try" | "finish" | "remember";

export interface ToolContext {
  turn: number;
  signal?: AbortSignal;
}

export interface ToolResult<F = unknown> {
  // What the model reads back; objects are shown as JSON.
  output: unknown;
  // Content from a page, a file or an app. Shown to the model marked as data, never as instructions.
  untrusted?: boolean;
  // A finish tool ends the episode with this. A finish tool that leaves it out has refused to finish (its output
  // says why) and the episode goes on.
  finish?: F;
  // Actions on the live page this call took. Default: 1 for probe and try tools, 0 for the others.
  liveActions?: number;
}

export interface Tool<I = unknown, F = unknown> {
  name: string;
  kind: ToolKind;
  description: string;
  // Checked before the tool runs; a bad input goes back to the model as an error.
  input: z.ZodType<I, unknown>;
  run(input: I, ctx: ToolContext): ToolResult<F> | Promise<ToolResult<F>>;
}

// Keeps a tool's input type tied to its schema.
export function tool<I, F = unknown>(definition: Tool<I, F>): Tool<I, F> {
  return definition;
}

// Any tool, whatever its input. A list of tools mixes input types; each checks its own.
// biome-ignore lint/suspicious/noExplicitAny: tools in one list take different inputs
export type AnyTool<F = unknown> = Tool<any, F>;
