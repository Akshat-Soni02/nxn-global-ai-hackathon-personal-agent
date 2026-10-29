// The splice: a recorded element description becomes a step's target. Code does this, never the model, so a
// selector can't come back with one character changed (a wrong selector fails silently at replay).
import type { ElementDescriptor, Locator } from "@shadow/core";

export function toLocator(d: ElementDescriptor): Locator {
  // Inside a shadow root, selectors and attributes only mean something from that root: a path recorded there is short
  // ("div > button") and the matcher tries the page first, where it would find the page's own elements. So the
  // locator keeps only role, name and text, which Chrome's accessibility tree exposes across shadow roots (since N3
  // the matcher also searches inside shadow roots on a miss). The trace keeps the full description.
  const inShadow = Boolean(d.shadowPath?.length);
  const locator: Locator = {
    fallbacks: inShadow ? [] : [d.selectors?.css, d.selectors?.xpath].filter((s): s is string => Boolean(s)),
  };
  if (d.role) locator.role = d.role;
  if (d.name) locator.name = d.name;
  if (d.label && d.label !== d.name) locator.label = d.label;
  if (d.text && d.text !== d.name) locator.text = d.text;
  if (d.near) locator.near = d.near;
  if (!inShadow && d.attrs && Object.keys(d.attrs).length > 0) locator.attrs = d.attrs;
  if (d.framePath?.length) locator.framePath = d.framePath;
  // Dropped on purpose: tag and url (context, not identity), shadowPath (not in the Locator yet) and crop: run.step
  // ships the whole skill to the extension under a 1 MB message cap (framing.ts).
  return locator;
}
