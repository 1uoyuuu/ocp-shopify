# Only Coffee Project — Theme Architecture Reference

Working notes for this repo. Read before changing anything; most entries here
exist because something broke.

## What this is

A **custom Shopify theme for Only Coffee Project**. It started as a copy of
Shopify's Horizon theme, but it is now our own codebase — we are free to
rewrite or override anything in it. "That's not how the base theme does it"
is not an objection. The only hard constraints are Shopify's platform
contracts (schema format, Liquid objects, the theme editor), not Horizon's
conventions.

Two standing requirements from the project owner:

1. **Everything meaningful must stay editable in the online theme editor** —
   copy, images/video, colors, fonts, links, toggles. Don't hardcode content
   or design tokens in Liquid/CSS if a merchant would reasonably want to
   change them.
2. **Don't duplicate existing settings.** If a setting already exists for a
   concept, reuse it rather than inventing a parallel one that can drift out
   of sync. (Example: MENU and CART both read the header's
   `actions_font`/`actions_font_size`/`actions_text_case` rather than each
   having their own font controls.)

## Deploy / sync workflow

GitHub `main` ↔ Shopify theme **`ocp-shopify/main`** (id `161860649065`) are
connected and sync **both ways**.

- **Deploy = `git push`.** Do not use `shopify theme push` — it writes
  straight to the theme, which then syncs back to GitHub as a separate
  "Update from Shopify" commit and causes divergence.
- **The theme editor writes back to the repo.** Any edit a merchant makes in
  the editor produces a commit on `main`.
- **Always `git fetch origin` before committing.** If the owner edited in the
  editor while we edited code, you get a real merge conflict — resolve it
  keeping *their* content values and *our* code changes. This has already
  happened once (a heading was changed to "THE BEST COFFEE SHOP" in the
  editor mid-refactor).
- Sync takes roughly 30–60s after a push.
- Preview: `https://3wnkpv-wp.myshopify.com?preview_theme_id=161860649065`

There are two other themes on the store (`Horizon` live, `Atelier`
unpublished). **They are not connected to git** — if a preview looks stale or
missing changes, check you're on the `ocp-shopify/main` preview id above.

Validate before every push:

```bash
shopify theme check
```

Run it from the repo root — from a subdirectory it silently inspects only a
couple of files and reports success (should be ~361 files).

## Directory map

| Dir | Count | Role |
|---|---|---|
| `sections/` | 43 | Page-level units. Have `{% schema %}`, appear in the editor's section list. |
| `blocks/` | 95 | Nested units inside sections. Have `{% schema %}`. |
| `snippets/` | 147 | Reusable partials. **No schema, no settings** — take params via `render`. |
| `assets/` | 131 | JS, CSS, SVG, images. |
| `templates/` | 13 | JSON files mapping sections onto each page type. |
| `config/` | 2 | `settings_schema.json` (global settings definition) + `settings_data.json` (their values). |
| `layout/` | 2 | `theme.liquid` (the HTML shell) + `password.liquid`. |
| `locales/` | 57 | Translations. `en.default.json` (storefront) and `en.default.schema.json` (editor labels). |
| `tools/` | 5 | Local scripts for preparing catalogue data — not part of the theme. Shopify only syncs the directories above, so this one is ignored the same way `offline-graphic-assets/` is. See `tools/README.md`. |

## How the theme editor connection actually works

Three separate scopes. Getting these mixed up is the most common way to break
the editor.

### 1. Global theme settings

- **Defined in** `config/settings_schema.json`
- **Values in** `config/settings_data.json`
- **Read in Liquid as** `settings.foo`
- Groups present: logo/favicon, colors, typography (37 settings), page layout,
  animations, badges, buttons, cart, drawers, icons, input fields, popovers,
  prices, product cards, search, swatches, variant pickers.

### 2. Section settings

- **Defined in** the section's `{% schema %}` → `"settings": [...]`
- **Values in** `templates/*.json` (or `sections/*-group.json` for
  header/footer)
- **Read as** `section.settings.foo`

### 3. Block settings

- **Defined in** the block's `{% schema %}`
- **Values in** the same JSON files, nested under the section's `"blocks"`
- **Read as** `block.settings.foo`

### Blocks: private vs public

- `blocks/_name.liquid` (**underscore prefix**) = private. Not offered in the
  editor's "add block" menu; rendered explicitly by a parent via
  `content_for 'block', type: '_name', id: '...'`. Used for structural pieces
  (`_header-logo`, `_header-menu`, `_product-card`).
- `blocks/name.liquid` (no prefix) = public, merchant can add it anywhere a
  section accepts `{"type": "@theme"}`.
- A `"presets"` key is what makes a block appear in the add-block menu.

### Sections accepting arbitrary blocks

```json
"blocks": [{ "type": "@theme" }, { "type": "@app" }]
```
plus `{% content_for 'blocks' %}` in the markup. `@theme` = any public theme
block, `@app` = app blocks.

### Adding a new editable setting — checklist

1. Add it to the section/block `{% schema %}` `settings` array.
2. Reference it in Liquid (`section.settings.x` / `block.settings.x`), with a
   sensible `| default:` fallback.
3. Add the value to `templates/index.json` or `sections/header-group.json` so
   the current state is explicit rather than relying on schema defaults.
4. Run `shopify theme check`.
5. **Use plain English labels** for our own settings. `t:` keys must exist in
   `locales/*.schema.json` or theme check fails — don't invent new ones.

### Setting types available

`range` `select` `header` `color` `checkbox` `text` `paragraph` `video`
`url` `image_picker` `text_alignment` `richtext` `textarea` `product`
`link_list` `collection` `collection_list` `liquid` `inline_richtext`
`video_url` `page` `blog` `font_picker` `color_scheme`.

`visible_if` conditionally shows a setting:

```json
"visible_if": "{{ block.settings.menu_trigger_style == 'text' }}"
```

## The catalogue — naming and data

OCP resells other people's coffee and other people's equipment, so every
product has a maker who is not OCP. That is the shape the whole catalogue
is built around, and it is why `vendor` names the roaster or the brand
rather than OCP: vendor is a native Shopify filter, a native admin
filter, and the axis of the built-in sales report, which is how you find
out which roaster actually sells.

### Titles

```
coffee   {Roaster} - {Country} / {Lot} / {Variety} ({Process})
gear     {Brand} - {Model} / {Category} ({Material})
merch    OCP {Item}
```

Namespaces follow the same split: `coffee.*` (17 definitions, `roaster`
metaobject) and `gear.*` (7 definitions, `brand` metaobject). Merch uses
`gear.*` too — it is four products, and a third namespace for them would
be structure for its own sake.

Real ones:

```
Rose - Ecuador / La Florida / Sidra (Honey)
Terraform - Ethiopia / Elto Elora / Ethiopian Landrace (Washed)
Hario - Switch / Immersion dripper (Glass)
OCP Tote Bag
```

The separator is a plain hyphen between maker and product, and forward
slashes inside the product. The tail carries the selling point and the
search terms — nobody searches "coffee", they search "sidra honey" or
"hario switch".

- **Everything variable is a variant, never the title.** Weight, size and
  colour all move; a title that names one of them has to be rewritten when
  a second arrives, and the URL goes with it. Square had Origami's Air S
  as five separate products because the colour was in the name.
- **Roast date never goes in the title** — it changes every batch.
  `coffee.roast_date` owns it.
- **Drop the category word only when the brand already is the category.**
  `AeroPress - Original`, not `AeroPress - Original / Brewer`. But keep it
  everywhere else: `Kalita - Wave` alone does not say whether it is the
  dripper or the filter papers, and Kalita sells both.
- **Collisions take the smallest distinguishing word.** Two Elto Elora
  lots from Terraform separate on `(Washed)` and `(Anaerobic)` without
  anything being added.
- A blend that crosses origins uses `Blend` where the country goes. Three
  or four cultivars is a spec sheet, not a selling point — name the first
  two.

### Metafields

`coffee.*` (17 definitions) and `gear.*` are separate namespaces because
they describe different things; do not try to share one. The Shopify
category metafields (`Coffee roast`, `Coffee product form`, `Country`,
`Grind size`) are deliberately **left empty** — `coffee.*` owns those
concepts and two sources of truth is how the values drift apart.

Required on a coffee, or it does not go up: `roaster`, `origin`,
`process`, `roast_profile`, `tasting_notes`. Everything else renders only
when present, which is the entire point — roasters supply anywhere from
five fields to ten plus two pages of prose, and the page has to look the
same either way. See `snippets/coffee-spec.liquid`.

The product Category is `fb-1-3-1` (Coffee Beans & Ground Coffee). It is
not cosmetic: the **Coffee collection is automated on exactly that rule**,
so setting the category is what puts a coffee in the collection. It also
drives tax and the channel mappings.

### Building products through the Admin API

Two things that look like they worked and did not:

- **`productCreate` makes one variant, not the cartesian product.** Give
  it `productOptions` with five colours and it creates the option with
  five values and exactly one variant — the first combination. Counting
  option values and reporting "5 variants" is wrong; query the variants
  back. The rest are added with `productVariantsBulkCreate`, matched by
  option value rather than by position, since Shopify returns them in its
  own order.
- **`inventorySetQuantities` reconciles against the stored quantity.**
  `changeFromQuantity` must equal what is currently on the shelf, so a
  second pass over items that were already set fails with "no longer
  matches the persisted quantity". Read the current level first and send
  that. It also needs an `@idempotent(key: "...")` directive **on the
  field**, and the key has to change between genuinely different runs.
- Prices cannot be set at create time at all — `productVariantsBulkUpdate`
  afterwards, or every variant sits at 0.00.

Taxonomy category ids are not guessable: query
`taxonomy { categories(search: "socks") { nodes { id fullName } } }`
rather than inventing `aa-1-12`. A wrong one fails the whole batch with
`Invalid product_taxonomy_node_id` and no indication of which.

Collections differ in kind and it matters: **Coffee is automated** on
`PRODUCT_CATEGORY_ID = fb-1-3-1`, so setting a coffee's category is what
files it. **Equipment and Merch are manual** — membership has to be set
with `collectionAddProducts`.

### Grind is a line item property, not a variant

We sell the roaster's sealed bag and grind to order, so a ground bag is
still one bag. As a variant it would split "100g Whole bean" and "100g
Filter" into separate stock buckets for the three bags that exist. The
cost is that grind never appears in variant-level reporting; it is on the
order and the packing slip instead. `blocks/coffee-grind.liquid`.

## Design tokens — never hardcode these

### Fonts

`config/settings_schema.json` exposes four `font_picker` settings, turned into
CSS variables in `snippets/theme-styles-variables.liquid` (~lines 157–168):

| Setting | CSS variable |
|---|---|
| `type_body_font` | `--font-body--family` / `--font-body--weight` |
| `type_subheading_font` | `--font-subheading--family` / `--weight` |
| `type_heading_font` | `--font-heading--family` / `--weight` |
| `type_accent_font` | `--font-accent--family` / `--weight` |

Always write `var(--font-subheading--family)`, never a literal font stack.

Where a merchant should pick *which* preset applies, use a `select` with
values `body|subheading|heading|accent` and interpolate:

```liquid
--x-font-family: var(--font-{{ section.settings.actions_font }}--family);
```

### Colors

`settings.color_palette` → `snippets/color-palette.liquid` → `--color-*`
variables (`--color-foreground`, `--color-background`, `--color-border`, …).
Use those. The only literal color currently in our code is the brand blue
`#0F80BE`/`#0F80C1` used as a *default value* for editable color settings —
which is fine, since the merchant can change it.

`snippets/contrast-override.liquid` generates a `.color-custom-{id}` class
that redefines `--color-foreground`/`--color-background` for a subtree. That's
how the menu panel gets its own color scheme.

### Viewport units: `lvh` to cover, `svh` to fit

Mobile browsers change the viewport height as the address bar hides. `100svh`
is the *smallest* it gets, so a full-screen sticky frame sized in `svh` leaves
a strip of the section behind showing the moment the bar retracts. Every
full-screen frame here (`hero-video`, `panel-reveal`, `statement`) is `100lvh`
— the largest — so it always covers. So are the scroll-length and overlap
settings those sections emit, so "100" keeps meaning "one screen".

`svh` is still right for anything that has to *fit* rather than cover: the
statement's card cap is `40svh`, because it must not overflow at the point the
screen is shortest. On desktop all three units are equal, so this only ever
changes mobile.

### The `--ocp-*` house tokens

All of them live in `snippets/theme-styles-variables.liquid`'s `:root`. They
are the single source for the values below — nothing else may state one.

| Token | Value | Covers |
|---|---|---|
| `--ocp-display-size` | `min(8rem, 9.5vw)`, `12vw` ≤749px | Hero headings, subscription heading |
| `--ocp-display-size-sm` | `calc(--ocp-display-size / 3)` | Display lines too long to sit at the full size — the panel-reveal slogan, the statement paragraph, the menu panel links |
| `--ocp-text-size` | `0.875rem` | Everything else, without exception |
| `--ocp-leading-display` | `1` | Both display sizes |
| `--ocp-leading-snug` | `1.15` | Headings, labels, UI text |
| `--ocp-leading-text` | `1.4` | Running text — footer, intros |
| `--ocp-letter-spacing` | `-0.02em` | All type, ours and the theme's alike |
| `--ocp-page-margin` | `16px`, `32px` ≥750px | Every section's inline gutter, header and footer included |

**The type scale is these three and no others.** No fourth size, no
`clamp()`, no `1rem` "just for this label" — hierarchy below them is weight,
case and colour. The footer is the model: its headings and links are the same
size at different weights. The site reached ten sizes once by adding one
reasonable-looking exception at a time, and undoing that touched fifteen
files.

The small display size is *derived* from the large one rather than written
out, which is the only reason a third step is safe: it cannot drift, and it
inherits the large one's responsive behaviour for free. A fourth step should
be derived the same way or not added.

Leading follows the same shape and for the same reason: three steps replaced
seven — `1`, `1.05`, `1.15`, `1.2`, `1.45`, `1.5` and `normal` — every one of
which had looked reasonable where it was written.

### The theme's own presets are on the scale too

`h1`–`h6` and `paragraph` are generated from `settings.type_size_h1` and
friends, and stock components on every non-home template read them. They had
drifted to 120/24/14/14/12/12 — which is how the same product card came to
read at 14px on the home page and 12px on a collection.

`:root` now redeclares `--font-h1--size` … `--font-paragraph--line-height`
against the tokens, *below* the loop that generates them. **That override has
to stay below the loop**: within one rule, the last declaration of a custom
property is the one that stands. It is the single place in this theme where
source order is the mechanism rather than the hazard described above, so
leave it where it is.

The theme's `--letter-spacing--*-normal` steps are pointed at
`--ocp-letter-spacing` for the same reason — stock prices, titles, buttons and
accordions all sit on the `normal` step, and left at `0em` they tracked
differently from every line of our own type. `tight` and `loose` are
untouched.

**Do not set a size, leading or tracking in `config/settings_data.json`.**
Those settings still exist and the editor still shows them, but nothing reads
them any more.

The same rule killed three settings — the header's `actions_font_size`, the
footer's `font_size`, the menu's `drawer_link_size` — along with the drum's
`text_size` and the footer's `padding_inline`. Each was a second control over
something a token already owned, and that is precisely how the values drifted
apart. **Do not add a per-section size or gutter control.** If a value needs
to change, change the token.

Watch for these, which are not obvious:

- Dormant stock paths count. The drawer's submenu, account and localization
  rules each carried their own size while rendering nothing; they would have
  reintroduced a third the moment a submenu or account link was switched on.
- Theme type presets are sizes too. `h3` is 14px and `h6` is 12px
  (`config/settings_data.json`), so a block on the `h6` preset is off-scale
  even though nothing in our CSS mentions a size.
- A token referenced inside `@media` keeps its original specificity, and
  repeating a class for weight is the fix — not moving the rule later in the
  file.

## CSS system — and its biggest trap

Section/block/snippet files carry their styles in a `{% stylesheet %}` block.
**Shopify concatenates every one of them into a single generated
`styles.css`** (~397KB here). `snippets/stylesheets.liquid` only loads
`base.css`; `styles.css` is injected by the platform.

### The trap: source order decides specificity ties

Measured byte offsets in the generated bundle:

```
blocks/_header-logo.liquid      .header-logo{                    16,036
sections/hero-video.liquid      .hero-video{                     23,172
snippets/header-actions.liquid  .header-actions__text-style{    224,226
snippets/header-drawer.liquid   (our rule)                      229,090
snippets/header-drawer.liquid   .menu-drawer{                   229,753
snippets/header-drawer.liquid   .menu-drawer__menu-item{        235,447
snippets/site-logo.liquid       .site-logo{                     350,206
```

Note that **within one file**, a rule we added near the top lost to a stock
rule further down at equal specificity. This caused three separate bugs in one
change (links left-aligned, arrow rendered at 13px, panel not centering).

**Rule: win by specificity, never by source position.** Scope through a
parent — `.menu-drawer .menu-drawer__menu-item--mainlist` beats
`.menu-drawer__menu-item` regardless of order. Reserve `!important` for
overriding platform/stock behavior we can't otherwise reach (we use it in
`snippets/site-logo.liquid` to hide `.header-logo` and force the header
transparent).

### CSS custom properties inherit **downward only**

Declaring a variable on a descendant and reading it on an ancestor silently
yields nothing (the declaration is invalid at computed-value time and the
property falls back to whatever was inherited). We hit this: the header row
needed `--drawer-text-color`, which was declared on `<header-drawer>` — a
*child* of that row. Fix was to declare it on `#header-component`, an
ancestor, via a `{% style %}` block.

### Stacking contexts

`.menu-drawer` is a **descendant of `.header__row`**. Raising the row's
`z-index` lifts the panel with it, so the panel still paints over the row's
own contents. To put a control above a descendant overlay, raise **that
control** (`position: relative` + `z-index`), not a shared ancestor.

## JavaScript system

- **Import map** in `snippets/scripts.liquid` maps 28 `@theme/*` specifiers to
  asset URLs. Add an entry there before importing a new shared module.
- **`assets/component.js`** exports a `Component` base class: auto-collects
  `[ref="name"]` descendants into `this.refs`, supports `requiredRefs`, and
  wires declarative `on:click="/method"` handlers via document-level
  delegation.
- Custom elements are registered guarded:
  ```js
  if (!customElements.get('x-component')) customElements.define('x-component', X);
  ```
- **`assets/morph.js`** DOM-diffs sections on re-render (Section Rendering
  API). Mark elements JS/animation owns with `data-skip-node-update` so morph
  leaves them alone.
- **Scroll container is not the window.** At ≥990px this theme scrolls
  `.page-wrapper`, below that the document. Always go through
  `@theme/scroll-container` (`getScrollTop`, `scrollTo`,
  `getScrollEventTarget`, `scrollContainerMediaQuery`). `window.scrollY` reads
  0 forever on desktop, and `scroll` events do **not** bubble from an element
  to `window` — a listener on `window` silently never fires.

## Our custom code

Created by us:

| File | Purpose |
|---|---|
| `sections/hero-video.liquid` | The only custom section. Full-bleed video hero + locked intro timeline. |
| `assets/hero-scroll.js` | `<hero-scroll-component>` — drives the intro. |
| `snippets/site-logo.liquid` | Page-level fixed logo (replaces the header logo site-wide). |
| `snippets/logo-wordmark.liquid` + `assets/logo-wordmark.svg` | Inlined wordmark. |
| `snippets/logo-arrow.liquid` + `assets/logo-arrow.svg` | Inlined arrow mark (fill = `currentColor`). |
| `assets/gsap.min.js`, `assets/gsap-observer.min.js` | GSAP core + Observer plugin. |
| `tools/bgremove.swift` + `bgkey.py` + `bgremove-check.py` | Cuts product photography out of its background locally, via Vision's foreground mask, with a luminance key for the images it cannot segment. Check every batch **twice**: the alpha checker catches a cut that removed nothing or everything, but it passed a cut that kept the artwork printed on a box and threw the box away. Only a contact sheet finds that. |

Modified by us: `blocks/_header-logo.liquid`, `blocks/_header-menu.liquid`,
`sections/header.liquid`, `sections/header-group.json`,
`snippets/header-actions.liquid`, `snippets/header-drawer.liquid`,
`layout/theme.liquid`, `templates/index.json`.

**Dead weight:** `assets/gsap-scrolltrigger.min.js` (~43KB) is no longer
referenced by any Liquid file — the hero moved from ScrollTrigger to Observer.
Safe to delete.

### Hero intro (`hero-video` + `hero-scroll.js`)

Not scroll-scrubbed. While it plays, page scrolling is **disabled** and
wheel/touch gestures are captured by GSAP **Observer** and fed into a paused
timeline's playhead; scrolling is released only when the timeline completes.
(A ScrollTrigger `scrub` setup means the page really is scrolling and the
animation merely follows, so the next section creeps in mid-animation.)

- `GESTURE_DISTANCE` (1200) — gesture px to play the intro start→finish.
- `LOGO_ARRIVE_PROGRESS` (0.65) — when the logo lands.
- `LOGO_NATIVE_WIDTH` (2000) / `DOCKED_SCALE` (0.1) — **must stay in sync with
  `snippets/site-logo.liquid`.** The logo renders natively huge and is always
  scaled *down*; a compositing layer rasterizes at its pre-transform size, so
  scaling a small element *up* renders blurry.
- Headings are hidden by default in CSS (deferred scripts would otherwise let
  them paint for a frame). Two escape hatches keep them from being stranded
  invisible: `hero-scroll-component:not(:defined)` if the module never loads,
  and `[data-intro-static]` which the component sets on any path where it
  skips the animation (missing GSAP, reduced motion).

### Header

Layout: **MENU** (left) — **logo** (centered, from `site-logo`, `position:
fixed`) — **CART (n)** (right).

- Menu trigger is always a single text trigger (`always_show_drawer`), not the
  stock responsive icon/inline-links switch. Reads **CLOSE** while open — both
  labels are in the markup, swapped by CSS off the `.menu-open` class the
  drawer JS already sets.
- Cart count renders inline as `CART (2)`. The stock bubble markup is
  **kept and only restyled** — `cart-icon.js` requires its three refs and
  writes the live count into them.
- Account link is behind a `show_account` setting (default off).
- `.header-logo` is hidden globally by `site-logo.liquid`; the header
  background is forced transparent there too.
- MENU and CART share `--header-actions-font-*`, emitted unconditionally in
  `sections/header.liquid` (originally only emitted for the `text` display
  style, which would have left MENU unstyled in icon mode).

### Menu panel

Full-viewport panel sliding down from the top (stock is a left side panel).
Nav centered, arrow mark below, social links at the bottom. Colors come from
the menu block's background/text color settings (brand blue / white).

Social links use a `link_list` setting — **no default**, so nothing renders
until a menu is created in Shopify admin and selected.

## Gotchas already paid for

**Schema**
- `"tag": null` → *"Invalid schema: tag must be a string."* Use `"section"` or
  omit.
- Padding `range` settings max out at **100**; larger values are rejected on
  push.
- A `range` `step` must be divisible by **0.1** — anything finer is rejected.
  For hundredths or thousandths, make the setting a whole number and scale it
  in Liquid (`| divided_by: 100.0`), as `sections/warp-text.liquid` does.
- A `range` must span **more than one step**: `min: 1, max: 2, step: 1` is
  refused. Widen the max (or shrink the step) so `(max - min) / step` is at
  least 2. **Theme check does not catch this**, and the refusal is the silent
  kind described below — the file simply never arrives. Isolated on
  2026-09-07 by comparing a refused schema against the ranges Shopify had
  already accepted in the same file, after `info` and `"tag": null` had each
  been ruled out one at a time.
- A `range` `default` must land **on the step grid** — `(default - min) / step`
  has to be a whole number. `min: 30, max: 90, step: 5, default: 62` is
  rejected. **Theme check does not catch this.**
- `{% doc %}` is only valid in snippets and blocks — **not sections**. Use
  `{% comment %}`.
- Classic `<script src>` tags need `defer` or theme check flags them as
  parser-blocking.
- `{% render 'image' %}` accepts only its documented params; `sizes`/`widths`
  are not among them — use `image_url | image_tag` for those.

**Liquid/JSON**
- `templates/*.json`, `sections/*-group.json` and `config/settings_data.json`
  all carry an "auto-generated" warning and are rewritten by the editor. Treat
  them as shared state; fetch before editing.

**JS**
- **Never let `requestAnimationFrame` be the only thing that advances a
  scroll animation.** The usual shape —
  ```js
  #onScroll = () => { this.#read(); if (this.#frame) return; this.#frame = rAF(this.#tick); }
  ```
  latches shut permanently if a frame is ever starved: `#frame` is only
  cleared inside the callback, so once it is set and no frame arrives, every
  later scroll returns immediately and nothing moves again. iOS throttles rAF
  through momentum scrolling, which is exactly when this bites. Advance the
  animation from the scroll handler too — extract a `#step(now)` that moves by
  real elapsed time and call it from both. Both `statement.js` and
  `panel-reveal.js` had this.
- **The header rebuilds itself, so anything you add to its markup is
  temporary.** It hydrates after load (`assets/section-hydration.js` →
  Section Rendering API on idle) and re-renders on every cart change; morph
  then restores the server's HTML over whatever the page had made of it. Only
  the header does this, so a bug from it looks like "the menu is broken" while
  the rest of the site is fine. `assets/letter-swap.js` survives it by
  re-checking for its own markup rather than trusting a "done" flag, and by
  scanning on any document mutation — watching for added *elements* is not
  enough, since what morph puts back is a text node.
- Duplicate `#private` class fields are a **syntax error**, not a warning —
  easy to introduce when refactoring a placeholder field into a real method.
  Quick check:
  ```bash
  node -e "new Function(require('fs').readFileSync('assets/hero-scroll.js','utf8').replace(/^import[^;]+;/m,''))"
  ```
- GSAP `pin: true` injects a wrapper element, which fights `morph.js`. Prefer
  `position: sticky` or Observer.

**Sync — when a push simply never arrives**
- Shopify applies **each commit's diff**, not the tree. So a webhook that gets
  dropped loses that commit's file changes *permanently* — later commits carry
  only their own files, and waiting achieves nothing.
- The tell that it is the connection rather than a bad schema: files with **no
  schema** (assets, snippets) are stale too. A rejection only drops the file
  whose schema is invalid, plus the JSON templates referencing it.
- The fix is a fresh commit that touches **exactly the files that were lost** —
  a comment edit is enough. A nudge commit that touches something else will
  sync that something else and leave the rest behind, which looks like a
  partial recovery and is not one. This happened on 2026-09-07 and cost about
  twenty minutes of waiting for a backlog that was never going to drain.

**Sync — how a bad schema actually shows up**
- An invalid `{% schema %}` does not fail the push and does not surface
  anywhere in git. Shopify **silently refuses that section file, and every
  JSON template that references it**, while every other file in the same
  commit lands normally. The homepage then renders the *previous* version of
  the section with the *previous* template — so the change looks like it was
  never made, or like a CSS/layout bug in code that is provably correct.
  This cost several rounds of debugging the wrong thing.
- Assets have no schema, so a `.js` file updates while its `.liquid` sits
  frozen. **A section whose JS is current and whose markup is stale is the
  signature of this.**
- Confirm it by reading the theme rather than guessing:
  ```bash
  shopify theme pull --theme 161860649065 --path ./live \
    --only sections/NAME.liquid --only templates/index.json
  ```
  then diff against the repo. `shopify theme pull` is read-only and safe —
  the ban is on `shopify theme push`.
- A rejected file also **invalidates values in other files that depend on its
  schema**. Shopify strips settings its copy of the schema does not know, so
  a refused block silently empties that block's settings out of every JSON
  that uses it. Fixing the schema is only half: the JSON has not changed
  since, and Shopify applies each commit's *diff*, so those values will never
  arrive on their own. Touch that JSON again once the schema is through.
- Two things in a setting that Shopify's parser has refused here, neither
  flagged by theme check: **`"default": ""`** on a `textarea`, and **escaped
  quotes inside `info`**. Both were in one new setting on
  `blocks/footer-menu.liquid`; removing them let the file sync on the next
  push.
- Also declaring a **private (`_`-prefixed) block in a section's schema
  `blocks`** is wrong: those are rendered statically by id and are not a type
  a section offers. `sections/product-list.liquid` renders `_product-card`
  without declaring it.

**Sync — a JSON template refused for one bad setting value**
- Shopify validates each setting value in `templates/*.json` against its
  type in the section or block schema. A value that is invalid for its
  type makes the **whole template file** invalid, and it is refused
  exactly as a bad `{% schema %}` is: clean push, every other file lands,
  the template is simply absent from the store. **Theme check does not
  look at template JSON setting values at all.**
- **Run `python3 tools/check-template-settings.py` before pushing a
  hand-built or generated template.** It compares every value against the
  schema it names. It is the only thing that catches this class.
- The proven killer is a **`range` value off the step grid**. The
  product-information `gap` range is `min 0, max 48, step 4`, so `10` is
  a legal number, inside the bounds, and fatal — the nearest legal values
  are 8 and 12. Same rule as a `range` default, but for values, and just
  as invisible.
- `block_order` is validated too: an entry naming a block that is not in
  `blocks` invalidates the file, and static blocks (`"static": true`)
  must be **left out** of it — compare `buy_buttons` in
  `templates/product.json`, whose `block_order` is `[]` while its three
  children are all static.
- **A richtext value with no block-level wrapper is *not* fatal**, despite
  looking like it should be. `templates/product.json` carries a bare
  `{{ closest.product.description }}` in a `richtext` setting and is live
  on the store. An earlier round here blamed that for a refusal and was
  wrong — the bisect had changed two things at once. Check the ranges
  first.
- `block_order` is validated too: an entry naming a block that is not in
  `blocks` invalidates the file. Static blocks (`"static": true`) must be
  **left out** of `block_order` — compare `buy_buttons` in
  `templates/product.json`, whose `block_order` is `[]` while its three
  children are all static.
- Bisect it rather than guessing, and do it in one sync cycle rather than
  five: push several throwaway `templates/product.<probe>.json` files in
  one commit, each a copy of the known-good `product.json` plus one
  suspect, then pull and see which arrived. A control that is a byte-copy
  of `product.json` tells you first whether the problem is the content at
  all or the file being new.

**Scroll restoration**
- **A refresh always goes to the top.** `scroll-container.js` reads the
  navigation timing entry, and on `type === 'reload'` it drops `scrollTop`
  from the history entry and scrolls the container to 0. Back and forward
  still restore — the reader is returning to somewhere they had reached,
  where a refresh is starting the page over, and landing halfway down means
  arriving in the middle of animations meant to be met from the top.
- Clearing the saved value is deliberately how this is done, rather than
  teaching each consumer about reloads: `hero-scroll.js` reads the same
  `history.state.scrollTop` to decide whether to lock the page for its intro,
  and it imports `scroll-container`, so that module has already run.
- The `pageshow` guard checks `event.persisted`. A bfcache restore reuses the
  document, so the navigation entry still says how it was *first* loaded — a
  page that was once reloaded would otherwise be thrown to the top every time
  the reader pressed Back into it.
- Sections here measure their own height — the statement's is its text plus
  however far its products have to travel — so the document keeps growing for
  a moment after everything has run. A restore that clamps
  (`Math.min(saved, max)`) therefore lands on the **last pixel of the page**
  when the saved position is beyond a document still settling. That is how a
  refresh from halfway down arrived in the footer. `restoreSavedScrollTop`
  waits for the height instead and refuses rather than clamping: the top is a
  better wrong answer than the bottom.
- The hero intro locks the page at the top on connect, which would undo any
  restore. It skips the lock when there is a position to return to, and
  disables Observer explicitly on that path — Observer starts enabled and
  `preventDefault` would otherwise swallow the wheel on a page that was never
  locked. On a refresh there is no saved position any more, so the intro
  locks and plays as it does on a first visit.

**Inlined SVG**
- `inline_asset_content` pastes the *same ids* every time it is rendered. Two
  copies of one SVG on a page (the wordmark is in both `site-logo` and the
  preloader) means duplicate ids, and every `url(#id)` reference in both
  copies resolves to whichever is **first in document order**.
- That is not harmless when the first copy can be hidden. `visibility`
  inherits into a `<clipPath>`'s children, and a clipPath whose children are
  hidden clips *everything* — so hiding the preloader clipped the hero logo
  out of existence. It looks like the logo was deleted, not like a clip.
- Figma exports a full-viewBox `<clipPath>` on almost everything; it does no
  work, since the outer `<svg>` already clips at its own viewport. Strip it
  rather than making the id unique. If a reference is genuinely needed, the
  snippet has to rewrite the id per render.

**Verification**
- **Never byte-compare a JSON template against the store.** Shopify rewrites
  `templates/*.json`, `sections/*-group.json` and `config/settings_data.json`
  on its side — key order, formatting, and dropping values whose setting no
  longer exists in the schema. `diff` on the raw file therefore always fails
  and looks like a stalled sync. Parse both and compare the objects.
- `curl` against the storefront returns **0 bytes** (it needs the browser
  session). A grep over an empty response "passes" every negative check —
  this produced a false "account link is gone" once. Verify in the browser.
- The in-app browser pane **freezes CSS transitions mid-flight** when hidden,
  and can return stale layout rects (it reported the panel as 0×0 while it was
  visibly full-screen). To measure a settled state:
  ```js
  el.getAnimations().forEach(a => a.finish());
  ```
  Screenshots are the more trustworthy signal.
- The pane **will not emulate a viewport narrower than itself**: it reports
  setting one and `innerWidth` stays put, so a "narrow" check silently
  measures the wide layout. To test a breakpoint, retarget its media query in
  a copy of the CSS (`max-width: 599px` → `2000px`, and disable the others)
  and load that. It exercises the real declarations at a width the pane can
  actually render.
- Enumerating `document.styleSheets[].cssRules` **throws on cross-origin
  sheets**. Since theme CSS is served from the Shopify CDN, a naive loop with
  `try/catch { continue }` silently finds nothing and looks like "no rule
  matches". Fetch the stylesheet URL and search the text instead.

## Pushing — the three ways it silently does nothing

Every one of these happened on 2026-09-07, more than once, and each time the
next step was a verification run against a commit that did not exist. **A
clean `git push` is not evidence of anything.** The evidence is the store.

**1. The push is rejected because the branch is behind.**
The editor writes back constantly, so `git fetch` and `git push` in the same
chain is a race — the fetch reports "behind 1" and the push goes ahead and
fails. Gate on it:

```bash
git fetch origin -q
if [ -n "$(git log --oneline HEAD..origin/main)" ]; then git rebase origin/main; fi
git push origin main
```

Resolve a JSON conflict by taking the editor's file and re-applying our keys
programmatically — never by hand-merging a machine-generated file.

**2. The commit is empty because the edit changed nothing.**
Rewriting a JSON template with the same values produces identical bytes,
`git commit` says "nothing to commit", and the push carries nothing. This is
the usual state when re-sending values Shopify stripped — they are already
correct in the repo, which is exactly why nothing moves. **Check `git diff
--stat` prints something before committing.** To force a real diff, change
key order (the values are what matter; Shopify rewrites the file anyway).

**3. The commit lands but Shopify refuses one file.**
See the two Sync sections above. The tell is *partial* arrival: some files
from one commit on the store, others not.

## Before pushing

1. `shopify theme check` from the repo root (~361 files), and
   `python3 tools/check-template-settings.py` if any `templates/*.json`
   changed — theme check does not read those values and a single bad
   one silently drops the whole template.
2. `git fetch origin` — check for "Update from Shopify" commits and **rebase
   before pushing**, not after being rejected.
3. `git diff --stat` — confirm there is actually a change to commit.
4. Any new merchant-facing value exposed as a setting, not hardcoded.
5. Fonts/colors via CSS variables, not literals.
6. New CSS wins by specificity, not source order.
7. `git push` (never `shopify theme push`).
8. **Verify against the store, not against the push.** `shopify theme pull`
   the files and compare — parsed content for JSON, bytes for everything
   else. Say "done" only after that comes back clean.
