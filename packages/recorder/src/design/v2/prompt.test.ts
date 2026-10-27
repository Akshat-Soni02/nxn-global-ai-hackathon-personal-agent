import { describe, expect, it } from "vitest";
import { BUILD_FILE } from "./prompt.ts";

describe("the file-mode prompt (B5)", () => {
  it("shows a page read in one block and written in another, the read after its own page's open", () => {
    // Oct 27, the YC jobs → sheet design: the jobs were read in the block that opened Drive, then never written to the
    // sheet. The example is what tells the agent which block a read belongs in.
    expect(BUILD_FILE).toMatch(/read in one block and written in another/);
    expect(BUILD_FILE).toMatch(
      /"Open the jobs page".*"Copy the top 5 jobs".*"Open the sheet".*"Add a row for each job"/s,
    );
    expect(BUILD_FILE).toMatch(/a read right after "Open the sheet" would read the sheet/);
  });
});
