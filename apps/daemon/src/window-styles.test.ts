import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The window's one stylesheet (apps/ui/src/styles.css; the daemon serves the window's pages, and this folder has Node's
// types): its colour tokens (light and dark), the layout every screen uses, and the rules each
// feature added. Oct 20: a script that appended the review's badges emptied it first; nothing else would notice.
const css = readFileSync(join(import.meta.dirname, "../../ui/src/styles.css"), "utf8");

describe("the window's stylesheet", () => {
  it("keeps its tokens, dark mode, the shared layout, and each feature's rules", () => {
    expect(css).toMatch(/^:root \{/m);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)/);
    for (const rule of [".section {", ".button {", ".button.primary {", ".progress-feed {", ".review-badge-added {"]) {
      expect(css).toContain(rule);
    }
    // The review's badges have their own class: .badge is the sidebar's counts.
    expect(css.match(/^\.badge \{/gm)).toHaveLength(1);
  });
});
