#!/usr/bin/env python3
"""Luminance key — the fallback for images `bgremove` cannot segment.

    python3 bgkey.py <out_dir> <image>... [--threshold 243] [--ramp 28]

Everything at or above `threshold` becomes transparent; the `ramp` levels
below it fade, so edges keep their anti-aliasing instead of turning into
a jagged outline. Only near-neutral pixels are keyed, so a pale but
saturated product (a beige dripper, a cream bag) is left alone.

Use this when `bgremove` fails or, worse, succeeds on the wrong thing:

  no subject at all   line art on a flat ground — a roaster's wordmark
                      standing in for a missing product shot
  the wrong subject   a dark box on a pale ground, where Vision locks on
                      to the artwork printed on the box instead of the
                      box. It reports success, the alpha check passes,
                      and only looking at the picture finds it.

It needs a genuinely flat, pale background. For a lifestyle shot — a bag
held by a person, a brewer on a worktop — neither tool applies; crop to
the product and run `bgremove` on the crop.

Requires Pillow.
"""
import argparse
import pathlib
import sys

from PIL import Image


def key(path, out_dir, threshold, ramp):
    im = Image.open(path).convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if max(r, g, b) - min(r, g, b) > 24:   # coloured: leave it
                continue
            lum = max(r, g, b)
            if lum >= threshold:
                px[x, y] = (r, g, b, 0)
            elif lum > threshold - ramp:
                px[x, y] = (r, g, b, round(a * (threshold - lum) / ramp))
    out = pathlib.Path(out_dir) / (pathlib.Path(path).stem + ".png")
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("images", nargs="+")
    ap.add_argument("--threshold", type=int, default=243)
    ap.add_argument("--ramp", type=int, default=28)
    args = ap.parse_args()

    for p in args.images:
        out = key(p, args.out_dir, args.threshold, args.ramp)
        print(f"ok    {pathlib.Path(p).name} -> {out.name} ({out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
