import { describe, expect, it } from "vitest";
import { cropAround } from "./crop.ts";

describe("cropping a picture around a click", () => {
  it("cuts 900 × 600 pixels around the point, kept inside the picture", async () => {
    const calls: string[][] = [];
    const exec = async (_cmd: string, args: string[]) => {
      calls.push(args);
      return { stdout: args[0] === "-g" ? "  pixelWidth: 2800\n  pixelHeight: 1626\n" : "" };
    };
    const out = await cropAround(
      "/s/a.jpg",
      { x: 238, y: 90, dpr: 2, box: { x: 0, y: 0, w: 1, h: 1 } },
      "/tmp/c.jpg",
      exec,
    );
    expect(out).toBe("/tmp/c.jpg");
    expect(calls[1]).toEqual(["-c", "600", "900", "--cropOffset", "0", "26", "/s/a.jpg", "--out", "/tmp/c.jpg"]);
  });

  it("uses the whole picture when cropping fails", async () => {
    const exec = async () => {
      throw new Error("no sips");
    };
    expect(
      await cropAround("/s/a.jpg", { x: 1, y: 1, dpr: 1, box: { x: 0, y: 0, w: 1, h: 1 } }, "/tmp/c.jpg", exec),
    ).toBe("/s/a.jpg");
  });
});
