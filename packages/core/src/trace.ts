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
  // Mac apps, from Task Player.app through the Accessibility API (apps/mac). Chrome is left to the extension.
  "app_activate", // you switched to an app
  "app_click", // a control pressed, described by its AX element
  "app_type", // a text field's final value (characters are never recorded one by one)
  "app_key", // a shortcut (Cmd+S), Return, Escape or an arrow key
  "app_menu", // a menu bar item chosen, e.g. File > Export As…
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

// A control in a Mac app, as the Accessibility API describes it. Read when you click or type; never coordinates.
export const AxElement = z.object({
  app: z.string(), // bundle id, e.g. com.apple.TextEdit
  appName: z.string().optional(),
  window: z.string().optional(), // the window's title
  role: z.string(), // AXButton, AXTextField, AXCheckBox, AXPopUpButton, AXMenuItem, AXRow, ...
  subrole: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  label: z.string().optional(), // text of the element that labels it (AXTitleUIElement)
  near: z.string().optional(), // the nearest text before it, for fields with no label of their own
  identifier: z.string().optional(), // AXIdentifier, set by the app's developer: the most stable signal
  placeholder: z.string().optional(),
  // From the window down: "AXWindow", "AXGroup", "AXTextField[2]" (the third text field among its siblings).
  path: z.array(z.string()).optional(),
});
export type AxElement = z.infer<typeof AxElement>;

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
  // file: the input's accept attribute ("image/*,.pdf"), the kinds of file the page takes.
  accept: z.string().optional(),
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
  // Mac apps (app_*): the app, the element, the menu path, the shortcut's modifiers, which mouse button.
  app: z.object({ id: z.string(), name: z.string().optional() }).optional(),
  element: AxElement.optional(),
  menu: z.array(z.string()).optional(),
  modifiers: z.array(z.enum(["cmd", "shift", "option", "ctrl"])).optional(),
  button: z.enum(["left", "right"]).optional(),
  // app_type: the value was too long to keep (a whole document); the skill asks for it instead.
  long: z.boolean().optional(),
});
export type TraceEvent = z.infer<typeof TraceEvent>;
