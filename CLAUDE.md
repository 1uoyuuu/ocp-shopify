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

All four live in `snippets/theme-styles-variables.liquid`'s `:root`. They are
the single source for the values below — nothing else may state one.

| Token | Value | Covers |
|---|---|---|
| `--ocp-display-size` | `min(8rem, 9.5vw)`, `12vw` ≤749px | Hero headings, subscription heading, menu panel links |
| `--ocp-display-size-sm` | `calc(--ocp-display-size / 2)` | Display lines too long to sit at the full size — the panel-reveal slogan |
| `--ocp-text-size` | `0.875rem` | Everything else, without exception |
| `--ocp-letter-spacing` | `-0.02em` | All of our own type |
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
- Duplicate `#private` class fields are a **syntax error**, not a warning —
  easy to introduce when refactoring a placeholder field into a real method.
  Quick check:
  ```bash
  node -e "new Function(require('fs').readFileSync('assets/hero-scroll.js','utf8').replace(/^import[^;]+;/m,''))"
  ```
- GSAP `pin: true` injects a wrapper element, which fights `morph.js`. Prefer
  `position: sticky` or Observer.

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
- Also declaring a **private (`_`-prefixed) block in a section's schema
  `blocks`** is wrong: those are rendered statically by id and are not a type
  a section offers. `sections/product-list.liquid` renders `_product-card`
  without declaring it.

**Verification**
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
- Enumerating `document.styleSheets[].cssRules` **throws on cross-origin
  sheets**. Since theme CSS is served from the Shopify CDN, a naive loop with
  `try/catch { continue }` silently finds nothing and looks like "no rule
  matches". Fetch the stylesheet URL and search the text instead.

## Before pushing

1. `shopify theme check` from the repo root (~361 files).
2. `git fetch origin` — check for "Update from Shopify" commits and merge.
3. Any new merchant-facing value exposed as a setting, not hardcoded.
4. Fonts/colors via CSS variables, not literals.
5. New CSS wins by specificity, not source order.
6. `git push` (never `shopify theme push`).
