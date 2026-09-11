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

`bgremove` segments a *photographed subject*, and there are two ways that
goes wrong. Only one of them announces itself.

**It finds nothing.** Line art on a flat ground — a roaster's wordmark
standing in for a missing product shot — has no subject, and `bgremove`
fails cleanly rather than guessing. Terraform's San Sebastian and the
SUPERGIANT drip bag are both this.

**It finds the wrong thing.** A dark box on a pale grey ground: Vision
locked on to the mountain range *printed on* the APAX Lab box and cut
that out, discarding the box. It reported success, the alpha check
passed — transparent corners, opaque middle, a plausible ratio — and only
looking at the picture caught it. **Run your eyes over a contact sheet as
well as the checker.** The checker catches arithmetic failures; it cannot
tell a box from the artwork on a box.

Both want the luminance key:

```bash
python3 bgkey.py cut/ src/00-apax.png --threshold 208 --ramp 26
```

Measure the background before choosing a threshold — it is often not
white. APAX's ground ran 214–229 across the frame, so the 243 default
removed nothing and 228 left an opaque corner.

**Neither tool handles a lifestyle shot.** The OCP tote is photographed
held by a person, and `bgremove` faithfully kept the trousers along with
the bag. Crop to the product first, then run `bgremove` on the crop.

### Uploading the results

Shopify will not take bytes directly. `productCreateMedia` wants a URL,
so each PNG goes to a `stagedUploadsCreate` target first (POST the
multipart form it hands back), and the `resourceUrl` it returns is what
the media mutation is given. See CLAUDE.md for how to reach the Admin
API from this repo.
