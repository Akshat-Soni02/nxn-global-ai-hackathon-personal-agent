// The splice: a recorded element description becomes a step's target. Code does this, never the model, so a
// selector can't come back with one character changed (a wrong selector fails silently at replay).
import type { ElementDescriptor, Locator } from "@taskplayer/core";

export function toLocator(d: ElementDescriptor): Locator {
  // Inside a shadow root, selectors and attributes only work from that root, and the player's matcher looks them up
  // from the document (DOM.querySelectorAll does not enter shadow roots). There they could never match, yet they
  // would still count against the score, so the locator keeps only role, name and text, which Chrome's
  // accessibility tree exposes across shadow roots. The trace keeps the full description.
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
