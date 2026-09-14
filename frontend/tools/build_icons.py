"""
Derive the app's icon sizes from public/icon.png.

Run after changing the logo:

    python3 tools/build_icons.py

Why derive rather than reference the one file everywhere. The source is 512x520
and around 250 kB, which is the right size for a home screen icon and the wrong
size for a browser tab: every visit would pull a quarter of a megabyte to draw
something sixteen pixels across. The splash needs it smaller still, and inline,
because it is painted before any JavaScript runs and a file reference there can
still be in flight while the splash is on screen.

The source is padded to a square rather than stretched. A launcher crops an icon
to its own shape, and a 512x520 image cropped square loses a slice off one edge
and sits off centre.
"""

import base64
import pathlib

from PIL import Image

PUBLIC = pathlib.Path(__file__).resolve().parent.parent / "public"
SOURCE = PUBLIC / "icon.png"

# 192 and 512 are what a web app manifest is expected to carry, 64 is for the
# browser tab, and 96 is the largest the splash needs at the size it draws.
SIZES = (512, 192, 96, 64)


def squared(image: Image.Image) -> Image.Image:
    """Pad to a square on a transparent ground, keeping the icon centred."""
    side = max(image.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(
        image,
        ((side - image.width) // 2, (side - image.height) // 2),
        image,
    )
    return canvas


def main() -> None:
    source = squared(Image.open(SOURCE).convert("RGBA"))

    for size in SIZES:
        out = PUBLIC / f"icon-{size}.png"
        source.resize((size, size), Image.LANCZOS).save(
            out, format="PNG", optimize=True
        )
        print(f"{out.name:16} {out.stat().st_size:>7} bytes")

    # The splash in index.html carries the mark as a data URI, because it is
    # painted before anything has been fetched. Printed rather than written:
    # index.html is hand maintained, and a script rewriting markup is a worse
    # trade than pasting a string on the rare occasion the logo changes.
    small = (PUBLIC / "icon-96.png").read_bytes()
    encoded = base64.b64encode(small).decode("ascii")
    print(f"\nsplash data URI, {len(encoded)} chars:\n")
    print(f"data:image/png;base64,{encoded}")


if __name__ == "__main__":
    main()
