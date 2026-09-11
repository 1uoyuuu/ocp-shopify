# tools

Local scripts used to prepare catalogue data. Nothing here is part of the
theme — Shopify's GitHub integration only reads `assets/`, `blocks/`,
`config/`, `layout/`, `locales/`, `sections/`, `snippets/` and
`templates/`, so this directory is ignored on sync the same way
`offline-graphic-assets/` is.

## Product photography — background removal

OCP resells other roasters' bags, so the product photography arrives as
whatever each roaster shot, on whatever ground they shot it. The site
wants them cut out on transparency, which lets the card supply its own
background rather than baking a white box into every image.

```bash
swiftc -O bgremove.swift -o bgremove
./bgremove cut/ src/*.jpeg
python3 bgremove-check.py cut/
```

`bgremove` uses the Vision framework's foreground-instance mask — the
engine behind "Copy Subject" in Preview. It runs on this machine: no
model download, no third-party upload, no per-image cost. macOS 14+.

**Always run `bgremove-check.py` afterwards.** Most of this catalogue is
white or frosted packaging photographed on white, and those render
identically whether or not the background came away — only the alpha
channel can tell you. The checker flags the two silent failures: a mask
that covered the whole frame (nothing removed) and one that found almost
nothing (subject lost).

### Where it does not work

It segments a *photographed subject*. Line art on a flat ground — a
roaster's logo used as a placeholder where there is no product shot —
has no subject to find, and `bgremove` fails on it cleanly rather than
guessing. Those want a luminance key instead: make near-white
transparent, and ramp the alpha across the last ~30 levels so the strokes
keep their anti-aliasing instead of turning into a jagged outline.

One image in the first import needed this: Terraform's San Sebastian,
which has the Terraform wordmark in place of a photograph.

### Uploading the results

Shopify will not take bytes directly. `productCreateMedia` wants a URL,
so each PNG goes to a `stagedUploadsCreate` target first (POST the
multipart form it hands back), and the `resourceUrl` it returns is what
the media mutation is given. See CLAUDE.md for how to reach the Admin
API from this repo.
