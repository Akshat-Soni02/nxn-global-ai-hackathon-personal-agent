// The skill format: the only contract between record and replay.
// Record writes skills, replay reads them. Changes here need sign-off from both sides.
// See "The skill format" in the design doc.
//
// Templates: any string in `args` or a check may contain
//   {{inputs.<name>}}       resolved input (a file input resolves to its absolute path, or a list of paths)
//   {{inputs.<name>.name}}  file input's base name
//   {{vars.<name>}}         value saved by an earlier step's `save_as`
//   {{today}}               local date, YYYY-MM-DD
// Paths may start with ~ and may be globs where noted. Moving or copying an empty list is a no-op.
//
// Args by action (v1):
//   web.navigate  { url }
//   web.click     {}
//   web.type      { text, clear?: boolean }            focuses the target, then inserts text
//   web.select    { option }                            visible option label
//   web.press     { key }                               e.g. "Enter", "Escape"
//   web.upload    { file }                              target is the <input type=file>; no native dialog
//   web.wait_for  {}                                    waits for `check` (or the target) within timeout_ms
//   web.extract   { all?, limit?, each?, join? }        each: per-element template using {{text}} and {{href}}
//   fs.find       { dir, glob, pick: "newest" | "all", since_run_start? }   since_run_start ignores older files
//   fs.move|copy  { from, to }                          `to` ending in "/" is a folder (created if missing)
//   fs.rename     { from, to }
//   fs.read       { path }
//   fs.write      { path, content, append? }
//   script.applescript { source }
//   script.shortcut    { name, input? }
//   script.shell       { command }                      allow-listed commands only
import { z } from "zod";

export const CHANNELS = ["web", "fs", "script", "ax", "vision"] as const;
export const Channel = z.enum(CHANNELS);
export type Channel = z.infer<typeof Channel>;

// Actions each channel supports. The recorder must only emit these; the player must implement all of them.
export const ACTIONS = {
  web: ["navigate", "click", "type", "select", "press", "upload", "wait_for", "extract"],
  fs: ["find", "move", "copy", "rename", "read", "write"],
  script: ["applescript", "shortcut", "shell"],
  ax: ["press", "set_value", "focus", "menu"],
  vision: ["click", "type"],
} as const satisfies Record<Channel, readonly string[]>;

// How a control is remembered. Never pixel coordinates.
export const Locator = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  near: z.string().optional(),
  attrs: z.record(z.string(), z.string()).optional(),
  fallbacks: z.array(z.string()).default([]),
  framePath: z.array(z.string()).optional(),
});
export type Locator = z.infer<typeof Locator>;

export const Check = z
  .object({
    url_matches: z.string(),
    text_visible: z.string(),
    element_visible: Locator,
    file_exists: z.string(),
  })
  .partial();
export type Check = z.infer<typeof Check>;

export const Input = z.object({
  type: z.enum(["string", "number", "date", "file", "secret"]),
  description: z.string().optional(),
  // Used when the run does not supply a value (e.g. trigger-fired runs and tests).
  default: z.unknown().optional(),
  // How to fill the input at run time, e.g. { dir, glob, pick: "newest" } for files.
  resolve: z.record(z.string(), z.unknown()).optional(),
});
export type Input = z.infer<typeof Input>;

export const Trigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("schedule"), cron: z.string() }),
  z.object({ type: z.literal("folder_watch"), dir: z.string(), glob: z.string().optional() }),
]);
export type Trigger = z.infer<typeof Trigger>;

export const Step = z
  .object({
    id: z.string(),
    // What this step achieves, in words. The agent fallback relies on it.
    intent: z.string(),
    channel: Channel,
    action: z.string(),
    target: Locator.optional(),
    args: z.record(z.string(), z.unknown()).default({}),
    wait: Check.optional(),
    check: Check.optional(),
    requires_approval: z.boolean().default(false),
    // Saves the step's result (found paths, extracted text, file contents) as {{vars.<save_as>}}.
    save_as: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
    // How long `wait` and `check` may take before the step fails. Player default applies when absent.
    timeout_ms: z.number().int().positive().optional(),
    on_fail: z
      .object({
        retries: z.number().int().min(0).default(0),
        fallback: z.enum(["agent", "ask"]).default("ask"),
      })
      .optional(),
  })
  .refine((s) => (ACTIONS[s.channel] as readonly string[]).includes(s.action), {
    message: "action is not supported by this channel",
    path: ["action"],
  })
  .refine((s) => s.channel !== "vision", {
    message: "vision steps are chosen by replay at run time, never written into a skill",
    path: ["channel"],
  });
export type Step = z.infer<typeof Step>;

export const Skill = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.number().int().min(1),
  intent: z.string(),
  inputs: z.record(z.string(), Input).default({}),
  triggers: z.array(Trigger).default([{ type: "manual" }]),
  steps: z.array(Step).min(1),
  success: z.array(Check).default([]),
});
export type Skill = z.infer<typeof Skill>;

export function parseSkill(data: unknown): Skill {
  return Skill.parse(data);
}
