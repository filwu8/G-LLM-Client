#!/usr/bin/env python3
"""Regenerate the Windows-only icon assets from the in-app brand mark.

Source of truth: src/renderer/src/assets/gllm-logo.png (the logo shown in the
top-left of the app UI). The full asset carries a wordmark and a tagline under
the mark; at 16-32 px - all the taskbar and tray ever show - both turn to mush.
So the wordmark rows are wiped, the whole plate is resampled around the mark,
and the original rounded-square alpha mask is re-applied. Nothing is pasted, so
there is no visible seam, and the colour keeps the app's own mark rather than a
monochrome glyph (the white tray glyph disappeared on a light taskbar).

Touched (Windows only):
  resources/app-icon.png          dev window icon + MSIX package icon
  build/icon.ico                  exe / NSIS installer / taskbar icon
  resources/tray-icon-win-*.ico   system tray icon (both theme variants)

NOT touched: build/icon-mac.png, build/icon.icns, build/icon-mac assets, the
macOS tray template (resources/tray-icon-template.png).

Usage: python scripts/make-windows-icon.py
"""

from pathlib import Path

import sys

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src/renderer/src/assets/gllm-logo.png"

MASTER = 1024
TEXT_TOP = 326  # first row of the "G-LLM" wordmark in the 512 px source
MARK_W = 302  # mark bbox width (106..408) in the 512 px source
MARK_CX = 257
MARK_CY = 201
MARK_WIDTH_RATIO = 0.72  # mark width relative to the icon edge
OPTICAL_CENTER_Y = 0.50

ICO_WINDOW = [16, 20, 24, 32, 40, 48, 64, 128, 256]
ICO_TRAY = [16, 20, 24, 32, 40, 48, 64]


def build_master() -> Image.Image:
    src = Image.open(SOURCE).convert("RGBA")
    w, h = src.size

    # 1. Wipe the wordmark + tagline. The plate is flat and slightly darker
    #    towards the bottom there, so a smooth vertical ramp between the plate
    #    colour just above the wordmark and the plate colour at the very bottom
    #    replaces them without a seam. (Copying a single row per column instead
    #    would stretch the source's per-column noise into visible streaks.)
    cleaned = src.copy()
    px = cleaned.load()

    def band_avg(y0: int, y1: int) -> tuple[int, int, int]:
        acc = [0, 0, 0]
        n = 0
        for y in range(y0, y1):
            for x in range(0, w, 2):
                r, g, b, _a = px[x, y]
                acc[0] += r
                acc[1] += g
                acc[2] += b
                n += 1
        return tuple(round(c / n) for c in acc)  # type: ignore[return-value]

    top = band_avg(TEXT_TOP - 8, TEXT_TOP - 1)
    bottom = band_avg(h - 12, h - 2)
    for y in range(TEXT_TOP, h):
        t = (y - TEXT_TOP) / (h - 1 - TEXT_TOP)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = (*color, 255)

    # 2. Resample the whole plate around the mark instead of pasting a crop.
    scale = (MASTER * MARK_WIDTH_RATIO) / MARK_W
    big = cleaned.resize((round(w * scale), round(h * scale)), Image.LANCZOS)

    left = round(MARK_CX * scale - MASTER / 2)
    top = round(MARK_CY * scale - MASTER * OPTICAL_CENTER_Y)

    # Pad the plate colour where the crop would fall outside the resampled art
    # (only ever a few px at the top/bottom edge, which is flat plate colour).
    pad = max(0, -left, -top)
    canvas = Image.new("RGBA", (big.width + pad * 2, big.height + pad * 2), big.getpixel((2, 2)))
    canvas.paste(big, (pad, pad))
    icon = canvas.crop((left + pad, top + pad, left + pad + MASTER, top + pad + MASTER))

    # 3. Re-apply the original rounded-square alpha, so the corner radius matches
    #    the in-app logo exactly.
    icon.putalpha(src.split()[3].resize((MASTER, MASTER), Image.LANCZOS))
    return icon


def save_ico(img: Image.Image, path: Path, sizes: list[int]) -> None:
    img.save(path, format="ICO", sizes=[(s, s) for s in sizes])
    print(f"  {path.relative_to(ROOT)}  {path.stat().st_size // 1024} KB  {len(sizes)} sizes")


def main() -> None:
    master = build_master()

    app_icon = ROOT / "resources/app-icon.png"
    # Keep the historical 256 px canvas: the window/taskbar icon is loaded from
    # this exact path, and Windows shells are touchy about swapping in a larger
    # bitmap under a name they have already cached.
    master.resize((256, 256), Image.LANCZOS).save(app_icon)
    print(f"  {app_icon.relative_to(ROOT)}  256x256")

    save_ico(master, ROOT / "build/icon.ico", ICO_WINDOW)
    # Both Windows tray variants now carry the brand colour, so the tray stays
    # readable whichever way the taskbar is themed.
    save_ico(master, ROOT / "resources/tray-icon-win-light.ico", ICO_TRAY)
    save_ico(master, ROOT / "resources/tray-icon-win-dark.ico", ICO_TRAY)

    if "--preview" in sys.argv:
        master.save(ROOT / "build/windows-icon-preview.png")
        print("  build/windows-icon-preview.png  1024x1024 (preview only)")


if __name__ == "__main__":
    main()
