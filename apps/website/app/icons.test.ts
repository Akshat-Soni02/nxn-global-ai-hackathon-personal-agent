// The site's icons (docs/design-ui.md, "The mark"): the tab shows a blank globe in Safari and a dark square on a dark
// tab strip when the set is missing or the files aren't the size they claim. This reads the real files, so a manifest
// that names an icon nobody drew, or a 180 px touch icon that is really 64, fails here and not in a user's tab.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const read = (name: string) => readFileSync(join(pub, name));

// A PNG's width and height are the first two numbers of its IHDR chunk (bytes 16 to 24).
const pngSize = (name: string) => {
  const b = read(name);
  expect(b.subarray(1, 4).toString("ascii"), `${name} is a PNG`).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

// An ICO's header holds the image count; each 16-byte entry starts with width and height (0 means 256).
const icoSizes = (name: string) => {
  const b = read(name);
  expect(b.readUInt16LE(2), `${name} is an ICO`).toBe(1);
  return Array.from({ length: b.readUInt16LE(4) }, (_, i) => b[6 + i * 16] || 256).sort((a, c) => a - c);
};

describe("website icons", () => {
  it("the manifest names the site and every icon it lists exists at its stated size", () => {
    const manifest = JSON.parse(read("manifest.webmanifest").toString());
    expect(manifest.name).toBe("Shadow");
    expect(manifest.theme_color).toBe("#0b0c1a");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) {
      // Relative, so a SITE_BASE_PATH folder keeps working with no templating.
      expect(icon.src.startsWith("/"), `${icon.src} is relative`).toBe(false);
      const [w, h] = icon.sizes.split("x").map(Number);
      expect(pngSize(icon.src), icon.src).toEqual([w, h]);
    }
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  });

  it("the touch icon is 180 px and the .ico holds 16, 32 and 48", () => {
    expect(pngSize("apple-touch-icon.png")).toEqual([180, 180]);
    expect(icoSizes("favicon.ico")).toEqual([16, 32, 48]);
  });

  it("the tab icon is an SVG whose rim keeps a 1 px stroke at any size", () => {
    const svg = read("icon.svg").toString();
    expect(svg).toContain('vector-effect="non-scaling-stroke"');
    expect(svg).toContain("prefers-color-scheme: dark");
  });
});
