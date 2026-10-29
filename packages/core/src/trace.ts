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
  "select_text", // text you selected (dragging, or a double or triple click): the selection, not a click
  "effect", // what a click or an Enter did, 700 ms later (of: the cid of that event)
  "print", // you printed the page (⌘P, File > Print): its dialog and the save panel are the browser's, not the page's
  // browser, from the extension's background worker
  "navigate",
  "tab_open",
  "tab_close",
  "tab_switch", // you brought another tab to the front (its url: the page it shows)
  "window_focus", // you brought another Chrome window to the front
  "download",
  // Mac, from the daemon's filesystem watcher (FSEvents)
  "fs_create",
  "fs_move",
  "fs_rename",
  "fs_remove", // a file vanished and appeared nowhere watched (deleted, or moved to the Trash)
  // Mac apps, from Shadow.app through the Accessibility API (apps/mac). Chrome is left to the extension.
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

// What a click or an Enter did, watched for 700 ms (apps/extension/src/effect.ts). `changed` counts what changed near
// the target beyond the page's own churn: "none" is a click that did nothing (a container, a reading click).
export const Effect = z.object({
  changed: z.enum(["none", "small", "large"]),
  navigated: z.boolean().optional(),
  expanded: z.boolean().optional(),
  opened: z.enum(["menu", "dialog", "listbox"]).optional(),
  // A field that had text before an Enter and is empty after: a chat message sent.
  emptied: z.boolean().optional(),
});
export type Effect = z.infer<typeof Effect>;

// Where the element sits in a list of same-shaped items: "the top job" is index 0 of the jobs list.
export const ListPosition = z.object({
  container: z.custom<ElementDescriptor>((v) => typeof v === "object" && v !== null),
  index: z.number().int().min(0),
  count: z.number().int().min(1),
  itemText: z.string().optional(),
  // The element by its place (N4): the list's selector, the item's place in it, the path inside the item. It finds
  // whatever item is there next time ("the top job"), where the element's own selector may name this one item.
  place: z.string().optional(),
});
export type ListPosition = z.infer<typeof ListPosition>;

// Where a click landed, in the viewport's CSS pixels, with the device pixel ratio and the element's box: evidence to
// find the words and the part of the picture around it. Never used to find the element again.
export const Point = z.object({
  x: z.number(),
  y: z.number(),
  dpr: z.number(),
  box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
});
export type Point = z.infer<typeof Point>;

// A Google Sheets cell, from the page's Name Box and formula bar (apps/extension/src/adapters/google-sheets.ts).
export const Cell = z.object({ ref: z.string(), value: z.string().optional(), sheet: z.string().optional() });
export type Cell = z.infer<typeof Cell>;

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
  // navigate: the browser's Back or Forward (webNavigation's forward_back qualifier).
  back: z.boolean().optional(),
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
  // The page's own id for an event, so a later effect can say which click it describes.
  cid: z.string().optional(),
  // effect: the cid of the click or key this is the effect of.
  of: z.string().optional(),
  effect: Effect.optional(),
  list: ListPosition.optional(),
  point: Point.optional(),
  cell: Cell.optional(),
  // copy: how it was made. button: a page's Copy button (navigator.clipboard.writeText, caught in the page's world).
  via: z.enum(["keyboard", "menu", "button"]).optional(),
  // click: with ⌘ or Ctrl, or the middle button: the link opens in a new tab.
  newTab: z.boolean().optional(),
  // click: made by the page's own code (element.click(), e.g. GitHub's g i shortcut clicking the Issues tab), not by
  // you: the browser marks it untrusted. The keys or click that caused it are the step.
  synthetic: z.boolean().optional(),
  windowId: z.number().optional(),
  // tab_open: the tab's title; preexisting: it was already open when Record was pressed.
  title: z.string().optional(),
  preexisting: z.boolean().optional(),
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
