#!/usr/bin/env python3
"""Generate WhimprFlow app icon and tray icon.

Mark: text cursor (I-beam) with two sound arcs arriving from the left.
App icon: dark squircle, light mark.
Tray icon: white mark on transparent (macOS template image).
"""
import math
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image, ImageDraw

ICONS_DIR = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"


def draw_squircle(img: Image.Image, fill: str, border: str | None = None):
    """Draw a macOS-style squircle (superellipse) filling the image."""
    w, h = img.size
    draw = ImageDraw.Draw(img)
    # Approximate with a rounded rectangle; macOS squircle radius is ~22.37% of width
    r = int(w * 0.2237)
    draw.rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=fill, outline=border, width=2 if border else 0)


def draw_mark(draw: ImageDraw.Draw, cx: float, cy: float, size: float, color: str, stroke: float):
    """Draw the cursor + sound arcs mark centered at (cx, cy)."""
    # Lighter I-beam color, thinner than the arcs.
    cursor_color = "#D1D1D6" if color in ("#E5E5E7",) else color
    beam_stroke = stroke * 0.8

    # Shift the whole mark left so its visual midpoint sits on cx.
    # Leftmost arc edge ~ cx - 0.24 - 0.34 = cx - 0.58
    # Rightmost serif edge ~ cx + 0.08 + 0.11 = cx + 0.19
    # Visual midpoint of the group = (-0.58 + 0.19) / 2 = -0.195, so shift +0.195
    # But we're building from individual offsets, so just nudge cursor_x.
    cursor_x = cx + size * 0.16
    cursor_h = size * 0.58
    serif_w = size * 0.11

    # Cursor vertical bar
    draw.rounded_rectangle(
        [cursor_x - beam_stroke / 2, cy - cursor_h / 2,
         cursor_x + beam_stroke / 2, cy + cursor_h / 2],
        radius=int(beam_stroke / 2),
        fill=cursor_color,
    )
    # Cursor serifs (top and bottom)
    for dy in [-cursor_h / 2, cursor_h / 2]:
        draw.rounded_rectangle(
            [cursor_x - serif_w, cy + dy - beam_stroke / 2,
             cursor_x + serif_w, cy + dy + beam_stroke / 2],
            radius=int(beam_stroke / 2),
            fill=cursor_color,
        )

    # Sound arcs: 2 arcs opening rightward toward the cursor, spaced apart.
    arc_center_x = cx - size * 0.36
    arc_center_y = cy
    arc_stroke = max(int(stroke), 2)

    for radius in [size * 0.18, size * 0.34]:
        bbox = [
            arc_center_x - radius, arc_center_y - radius,
            arc_center_x + radius, arc_center_y + radius,
        ]
        draw.arc(bbox, start=-45, end=45, fill=color, width=arc_stroke)


def gen_app_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_squircle(img, fill="#1C1C1E", border="#3A3A3C")
    draw = ImageDraw.Draw(img)
    mark_size = size * 0.62
    stroke = size * 0.035
    draw_mark(draw, size / 2, size / 2, mark_size, "#E5E5E7", stroke)
    return img


def gen_tray_icon(w: int, h: int) -> Image.Image:
    """White mark on transparent. macOS uses this as a template image."""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    mark_size = min(w, h) * 0.85
    stroke = max(2.0, min(w, h) * 0.055)
    draw_mark(draw, w / 2, h / 2, mark_size, "#FFFFFF", stroke)
    return img


def main():
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    # App icon master (1024x1024) and all required sizes
    master = gen_app_icon(1024)
    master.save(ICONS_DIR / "icon.png")
    print("icon.png (1024x1024)")

    for size in [512, 256, 128, 64, 32]:
        resized = master.resize((size, size), Image.LANCZOS)
        name = f"{size}x{size}.png"
        resized.save(ICONS_DIR / name)
        print(name)

    # 128x128@2x is 256px
    master.resize((256, 256), Image.LANCZOS).save(ICONS_DIR / "128x128@2x.png")
    print("128x128@2x.png")

    # ICO (multi-resolution)
    ico_sizes = [master.resize((s, s), Image.LANCZOS) for s in [256, 64, 48, 32, 16]]
    ico_sizes[0].save(ICONS_DIR / "icon.ico", format="ICO", sizes=[(s.width, s.height) for s in ico_sizes], append_images=ico_sizes[1:])
    print("icon.ico")

    # ICNS via sips (macOS only)
    try:
        tmp_iconset = ICONS_DIR / "icon.iconset"
        tmp_iconset.mkdir(exist_ok=True)
        icns_sizes = [16, 32, 64, 128, 256, 512]
        for s in icns_sizes:
            master.resize((s, s), Image.LANCZOS).save(tmp_iconset / f"icon_{s}x{s}.png")
            master.resize((s * 2, s * 2), Image.LANCZOS).save(tmp_iconset / f"icon_{s}x{s}@2x.png")
        subprocess.run(["iconutil", "-c", "icns", str(tmp_iconset), "-o", str(ICONS_DIR / "icon.icns")], check=True)
        import shutil
        shutil.rmtree(tmp_iconset)
        print("icon.icns")
    except Exception as e:
        print(f"icns skipped: {e}")

    # Tray icon (78x44 to match original dimensions, @2x)
    tray = gen_tray_icon(78, 44)
    tray.save(ICONS_DIR / "tray.png")
    print("tray.png (78x44)")

    print("\nDone.")


if __name__ == "__main__":
    main()
