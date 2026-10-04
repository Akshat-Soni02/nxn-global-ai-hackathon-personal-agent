// The trace: raw evidence of one recording, one event per line in traces/<sessionId>.jsonl.
// Written by the daemon from the extension's record.event messages and its own filesystem watcher, read by the
// recorder's normaliser. Never rewritten, so a skill can be recompiled later from the same evidence.
import { z } from "zod";
import type { ElementDescriptor } from "./descriptor.ts";

export const TRACE_EVENTS = [
  // page, from the content script
  "click",
  "type",
  "select",
  "check",
  "file",
  "drop", // files dropped onto the page from Finder
  "drag", // an element dragged to another place in the page
  "copy",
  "paste",
  "submit",
  "key",
  // browser, from the extension's background worker
  "navigate",
  "tab_open",
  "tab_close",
  "download",
  // Mac, from the daemon's filesystem watcher (FSEvents)
  "fs_create",
  "fs_move",
  "fs_rename",
] as const;
export const TraceEventKind = z.enum(TRACE_EVENTS);
export type TraceEventKind = z.infer<typeof TraceEventKind>;

export const FileInfo = z.object({
  name: z.string(),
  size: z.number(),
  type: z.string(),
  lastModified: z.number().optional(),
  path: z.string().optional(),
});
export type FileInfo = z.infer<typeof FileInfo>;

export const TraceEvent = z.object({
  id: z.string(),
  sessionId: z.string(),
  // Date.now() when it happened. Orders events across tabs, frames and the filesystem.
  at: z.number(),
  event: TraceEventKind,
  tabId: z.number().optional(),
  frameId: z.number().optional(),
  url: z.string().optional(),
  target: z.custom<ElementDescriptor>((v) => typeof v === "object" && v !== null).optional(),
  // Final typed value, chosen option, key name or copied text. Never set when secret is true.
  value: z.string().optional(),
  secret: z.boolean().optional(),
  checked: z.boolean().optional(),
  // A file chosen or dropped in a page. The page only ever sees name, size and date, never the path: the daemon
  // finds the path afterwards (locate-file.ts) and fills it in.
  file: FileInfo.optional(),
  files: z.array(FileInfo).optional(),
  // Filesystem events and finished downloads: absolute paths on this Mac.
  path: z.string().optional(),
  toPath: z.string().optional(),
  // navigate: chrome.webNavigation transitionType (typed, link, form_submit, reload, ...).
  transition: z.string().optional(),
  // tab_open: the tab that opened this one.
  openerTabId: z.number().optional(),
  // The recorded selectors resolved back to this same element when it was described.
  echo: z.boolean().optional(),
  // drag: where the element was dropped, and whether the page used HTML5 drag events (else pointer events).
  to: z.custom<ElementDescriptor>((v) => typeof v === "object" && v !== null).optional(),
  native: z.boolean().optional(),
  // click: the target had no meaning of its own (a <canvas>, or a big element with no role, name or text).
  drawn: z.boolean().optional(),
  // type: the value came from a paste; it is left out and filled from the copy ({{vars.x}}).
  pasted: z.boolean().optional(),
  // copy: context for drawn apps, e.g. a Google Sheet's header row and the copied cell's row.
  context: z.record(z.string(), z.unknown()).optional(),
});
export type TraceEvent = z.infer<typeof TraceEvent>;
