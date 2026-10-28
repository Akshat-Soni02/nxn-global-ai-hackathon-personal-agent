#!/usr/bin/env python3
"""Draws the site's raster icons into ../public from the mark's geometry (docs/design-ui.md, "The mark").

Run by hand when the mark changes (python3 apps/website/scripts/icons.py, needs Pillow); the outputs are committed, so
a build never needs Python. Geometry is public/mark.svg's, in a 64-unit box:
  night rounded square (r 14.3) with a vertical gradient #242642 -> #0d0d17,
  blue shadow (36,36) r12, blurred 3, at 90%, white dot (30,30) r12, red record dot (30,30) r4.1.

Each size is drawn on its own (never scaled down from a bigger one) so the 1 px rim stays one pixel wide: on a dark
tab strip the night square is ~1.2:1 against the tab, and the rim is what makes it read.
"""

import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

PUBLIC = Path(__file__).resolve().parent.parent / "public"
SS = 8  # supersampling: draw 8x, then shrink, for clean edges at 16 px

TOP, BOTTOM = (0x24, 0x26, 0x42), (0x0D, 0x0D, 0x17)
BLUE, WHITE, RED = (0x3A, 0x5B, 0xD9), (0xFA, 0xFA, 0xFF), (0xEF, 0x44, 0x44)
RIM = (0x7F, 0x86, 0xB8)  # about 5.4:1 against the night band, same token as the nav's --mark-rim


def draw(size: int, rounded: bool = True, rim_px: float = 0) -> Image.Image:
    """The mark at `size` px. rounded=False is full-bleed (iOS and maskable icons are cut by the system)."""
    w = size * SS
    u = w / 64  # one mark unit in drawing pixels

    # Night gradient: Pillow's linear_gradient is black (top) to white (bottom); white takes BOTTOM.
    ramp = Image.linear_gradient("L").resize((w, w), Image.BILINEAR)
    img = Image.composite(Image.new("RGB", (w, w), BOTTOM), Image.new("RGB", (w, w), TOP), ramp).convert("RGBA")

    # The blue shadow is blurred on its own layer so it spreads past its circle, as the SVG filter does.
    shadow = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse(
        [(36 - 12) * u, (36 - 12) * u, (36 + 12) * u, (36 + 12) * u], fill=(*BLUE, round(255 * 0.9))
    )
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(3 * u)))

    dots = ImageDraw.Draw(img)
    for r, colour in ((12, WHITE), (4.1, RED)):
        dots.ellipse([(30 - r) * u, (30 - r) * u, (30 + r) * u, (30 + r) * u], fill=colour)

    if rim_px:
        # Inset by half the stroke so the whole line is inside the square, like the SVG's inset rect.
        edge = rim_px * SS
        ring = Image.new("RGBA", (w, w), (0, 0, 0, 0))
        ImageDraw.Draw(ring).rounded_rectangle(
            [edge / 2, edge / 2, w - edge / 2 - 1, w - edge / 2 - 1],
            radius=14.3 * u - edge / 2,
            outline=(*RIM, round(255 * 0.6)),
            width=round(edge),
        )
        img.alpha_composite(ring)

    if rounded:
        mask = Image.new("L", (w, w), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, w - 1], radius=14.3 * u, fill=255)
        img.putalpha(mask)
    else:
        img = img.convert("RGB")
    return img.resize((size, size), Image.LANCZOS)


def png_bytes(img: Image.Image) -> bytes:
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue()


def write_ico(path: Path, sizes: list[int]) -> None:
    """An .ico of PNG frames, each drawn at its own size (Pillow would resize one image for every entry)."""
    frames = [png_bytes(draw(s, rim_px=1)) for s in sizes]
    head = struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries = b""
    for s, data in zip(sizes, frames):
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    path.write_bytes(head + entries + b"".join(frames))


def main() -> None:
    write_ico(PUBLIC / "favicon.ico", [16, 32, 48])
    # Rim width grows slowly with size: 1 px on a tab, about 4 px on the 512 install icon.
    for size in (192, 512):
        (PUBLIC / f"icon-{size}.png").write_bytes(png_bytes(draw(size, rim_px=max(1, size / 128))))
    # Full-bleed and opaque: iOS rounds the touch icon, Android crops the maskable one to a circle or squircle. The
    # dots sit inside the central 80% of the box, which is the maskable safe zone.
    (PUBLIC / "apple-touch-icon.png").write_bytes(png_bytes(draw(180, rounded=False)))
    (PUBLIC / "icon-maskable-512.png").write_bytes(png_bytes(draw(512, rounded=False)))


if __name__ == "__main__":
    main()
