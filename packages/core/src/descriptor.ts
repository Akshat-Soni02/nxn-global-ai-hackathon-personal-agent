// Element descriptor: everything we know about one control on a page.
// Record captures one per event; replay computes one per candidate and scores it against the stored Locator.
import type { Locator } from "./skill.ts";

export interface ElementDescriptor extends Locator {
  tag: string;
  url: string;
  // Ranked most to least stable; copied into Locator.fallbacks when compiling.
  selectors: { css?: string; xpath?: string };
  shadowPath?: string[];
  // Small cropped screenshot of the element, as a data URL. Optional; used by the agent fallback.
  crop?: string;
}

// TODO(core): implement describeElement(el: Element): ElementDescriptor in apps/extension (it needs the DOM).
// Both the recorder (on the clicked element) and the player (on each candidate) call it.
