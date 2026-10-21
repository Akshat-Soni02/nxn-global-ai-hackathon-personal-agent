// A picture cropped around a click (spec 2.13), with macOS's sips: the vision model sees what was clicked and what is
// around it. On any error the whole picture is used. Click points are CSS pixels; pictures are device pixels.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Point } from "@shadow/core";

export type Run = (cmd: string, args: string[]) => Promise<{ stdout: string }>;
const run = promisify(execFile) as unknown as Run;
export const CROP = { w: 900, h: 600 };

export async function cropAround(path: string, point: Point, out: string, exec: Run = run): Promise<string> {
  try {
    const { stdout } = await exec("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
    const width = Number(/pixelWidth: (\d+)/.exec(stdout)?.[1]);
    const height = Number(/pixelHeight: (\d+)/.exec(stdout)?.[1]);
    if (!width || !height) return path;
    const w = Math.min(CROP.w, width);
    const h = Math.min(CROP.h, height);
    const x = Math.round(Math.min(Math.max(point.x * point.dpr - w / 2, 0), width - w));
    const y = Math.round(Math.min(Math.max(point.y * point.dpr - h / 2, 0), height - h));
    await exec("sips", ["-c", String(h), String(w), "--cropOffset", String(y), String(x), path, "--out", out]);
    return out;
  } catch {
    return path;
  }
}
