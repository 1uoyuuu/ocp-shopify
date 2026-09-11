#!/usr/bin/env python3
"""Flag cut-outs that only look like they worked.

    python3 bgremove-check.py <cut_dir>

Two failure shapes matter and neither raises an error at cut time:

  nothing removed   the mask covered the whole frame, so the file is the
                    original with an opaque alpha channel bolted on
  subject lost      the mask found almost nothing, so the bag went with
                    the background

Neither is visible by eye when the packaging is white and the background
was white — which is most of this catalogue. Sey, Rose and Terraform all
ship white or frosted bags photographed on white. The alpha channel is
the only honest signal, so check it rather than the picture.

Requires Pillow.
"""
import pathlib
import sys

from PIL import Image


def check(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    alpha = im.getchannel("A")
    clear = alpha.histogram()[0] / (w * h)
    corners = [alpha.getpixel(xy) for xy in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3))]

    if clear < 0.02:
        return clear, corners, "nothing removed"
    if clear > 0.95:
        return clear, corners, "subject lost"
    # A frame corner should be background in any product shot. A few
    # units of alpha is anti-aliasing; anything more is a mask that
    # stopped short of the edge.
    if max(corners) > 8:
        return clear, corners, "opaque corner"
    return clear, corners, None


def main(directory):
    files = sorted(pathlib.Path(directory).glob("*.png"))
    if not files:
        print(f"no PNGs in {directory}")
        return 1

    suspect = []
    print(f"{'file':34} {'size':>12} {'transparent':>12} {'max corner':>11}")
    for p in files:
        clear, corners, why = check(p)
        im = Image.open(p)
        print(f"{p.name:34} {f'{im.width}x{im.height}':>12} "
              f"{clear:11.1%} {max(corners):11}   {why or ''}")
        if why:
            suspect.append((p.name, why))

    print()
    print(f"clean {len(files) - len(suspect)}/{len(files)}")
    for name, why in suspect:
        print(f"   {name} — {why}")
    return 1 if suspect else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "."))
