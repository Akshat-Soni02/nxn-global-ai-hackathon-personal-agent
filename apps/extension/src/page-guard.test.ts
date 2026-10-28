// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PAGE_GUARD, waitingForSaveAs } from "./page-guard.ts";

// The automation tab's guard against what would stop a run behind Chrome's own UI (A5): a print preview, a permission
// bubble. Run here in jsdom the way Chrome runs it in each page of an automation tab.
describe("the automation tab's page guard (A5)", () => {
  const guarded = () => {
    const w = window as unknown as Record<string, unknown>;
    // What a browser has and jsdom lacks, so the guard has something to replace.
    w.Notification = { requestPermission: async () => "default", permission: "default" };
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: () => {} }, configurable: true });
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => ({}) }, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { readText: async () => "secret" }, configurable: true });
    // biome-ignore lint/security/noGlobalEval: the guard is a script string Chrome evaluates in the page; run the same way
    window.eval(PAGE_GUARD);
    return w.__shadowBlocked as string[];
  };

  it("skips the page's own print (Chrome's preview would cover the run) and denies permission asks, saying which", async () => {
    const blocked = guarded();
    window.print();
    expect(
      await (
        window as unknown as { Notification: { requestPermission(): Promise<string> } }
      ).Notification.requestPermission(),
    ).toBe("denied");
    let located: unknown;
    navigator.geolocation.getCurrentPosition(
      () => {},
      (error) => {
        located = error.code;
      },
    );
    expect(located).toBe(1);
    await expect(navigator.mediaDevices.getUserMedia({ video: true })).rejects.toThrow(/denied/);
    await expect(navigator.clipboard.readText()).rejects.toThrow(/denied/);
    expect(blocked).toEqual(["print", "notifications", "location", "camera or microphone", "clipboard"]);
  });

  it("runs twice without harm (a page that reloads gets it again)", () => {
    guarded();
    // biome-ignore lint/security/noGlobalEval: as above, the page runs the string itself
    expect(() => window.eval(PAGE_GUARD)).not.toThrow();
  });
});

describe("a download held by Chrome's Save-as dialog (A5, checked live)", () => {
  it("is said, not waited behind; a download saved or still saving under its name is fine", () => {
    expect(waitingForSaveAs([{ state: "in_progress", filename: "" }])).toMatch(/asking where to save.*setting/);
    expect(waitingForSaveAs([{ state: "complete", filename: "/Users/x/Downloads/a.txt" }])).toBeUndefined();
    expect(waitingForSaveAs([{ state: "in_progress", filename: "/Users/x/Downloads/big.zip" }])).toBeUndefined();
    expect(waitingForSaveAs([])).toBeUndefined();
  });
});
