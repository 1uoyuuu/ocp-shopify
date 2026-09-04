import { getScrollEventTarget, scrollContainerMediaQuery } from '@theme/scroll-container';

/**
 * Marks the header when what sits behind it is light.
 *
 * `mix-blend-mode: difference` turns the header's white into |255 - backdrop|,
 * which over a white section is 0 — black. No blend can be told to do
 * something else there: landing on the brand blue over white would need a
 * source of rgb(240,127,65), and that same source shows as orange over a dark
 * section. One colour cannot produce both, because the blend has no idea what
 * it is over. So the backdrop is measured instead, and the blend is switched
 * off where it would come out black.
 */

/** Relative luminance past which a backdrop counts as light. Set above the
 * pale greys a product shot might sit on, so only genuinely white-ish
 * sections trip it. */
const LIGHT_THRESHOLD = 0.72;

/** Fractions of the width to sample — roughly under MENU, the logo and CART.
 * All three must be light before the header changes, so a pale card drifting
 * under one of them doesn't flip the whole row. */
const SAMPLES = [0.08, 0.5, 0.92];

/** Media has its own colours and is exactly what difference is for. */
const MEDIA = new Set(['VIDEO', 'IMG', 'CANVAS', 'SVG', 'PICTURE']);

/** Fixed overlays that sit over the page rather than being part of it. The
 * logo matters as much as the header here: it is centred, so it lands under
 * the middle sample, and being an SVG it would read as media and hold the
 * header dark on every section. */
const OVERLAYS = '#header-component, [data-site-logo]';

/** @param {number} channel */
const linear = (channel) => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/**
 * @param {string} colour A computed `rgb()` / `rgba()` string.
 * @returns {{r: number, g: number, b: number, a: number} | null}
 */
function parse(colour) {
  const parts = colour.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return null;

  return {
    r: Number(parts[0]),
    g: Number(parts[1]),
    b: Number(parts[2]),
    a: parts.length > 3 ? Number(parts[3]) : 1,
  };
}

class HeaderTone extends HTMLElement {
  #frame = 0;
  /** @type {EventTarget | null} */
  #scrollTarget = null;
  /** @type {HTMLElement} The header itself — this element is a marker with
   * no box of its own, so the row it sits in is what gets measured and
   * flagged. */
  #host = this;

  connectedCallback() {
    this.#host = /** @type {HTMLElement} */ (this.closest('#header-component') ?? this);

    this.#bindScroll();
    // Which element scrolls flips at the desktop breakpoint, and scroll
    // events don't bubble to window.
    scrollContainerMediaQuery.addEventListener('change', this.#bindScroll);
    window.addEventListener('resize', this.#schedule);

    this.#schedule();
  }

  disconnectedCallback() {
    this.#scrollTarget?.removeEventListener('scroll', this.#schedule);
    scrollContainerMediaQuery.removeEventListener('change', this.#bindScroll);
    window.removeEventListener('resize', this.#schedule);

    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #bindScroll = () => {
    this.#scrollTarget?.removeEventListener('scroll', this.#schedule);
    this.#scrollTarget = getScrollEventTarget();
    this.#scrollTarget.addEventListener('scroll', this.#schedule, { passive: true });
  };

  #schedule = () => {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(this.#measure);
  };

  /**
   * The luminance of what is actually visible under a point.
   *
   * This walks the hit stack — every element under the point, nearest
   * first — rather than the ancestor chain of the topmost one. A section's
   * colour is often painted by an absolutely positioned sibling of its
   * content rather than by an ancestor of it: `.section-background` is
   * exactly that. Walking upwards missed it and carried on to the
   * `.shopify-section` wrapper, which the hero's stacking rule paints white
   * — so a blue section with white type on it read as a white backdrop and
   * the header turned blue in the middle of it.
   *
   * @param {number} x
   * @param {number} y
   * @returns {number | null} Relative luminance, or null if unknowable.
   */
  #luminanceAt(x, y) {
    for (const element of document.elementsFromPoint(x, y)) {
      if (element.closest(OVERLAYS)) continue;

      // Media has its own colours and is what difference is for.
      if (MEDIA.has(element.tagName)) return null;

      const colour = parse(getComputedStyle(element).backgroundColor);

      // Anything see-through says nothing about what shows through it.
      if (!colour || colour.a <= 0.9) continue;

      return 0.2126 * linear(colour.r) + 0.7152 * linear(colour.g) + 0.0722 * linear(colour.b);
    }

    return null;
  }

  #measure = () => {
    this.#frame = 0;

    const { top, height } = this.#host.getBoundingClientRect();
    if (!height) return;

    const y = top + height / 2;
    const width = window.innerWidth;

    // Every sample has to agree. An unreadable one — media, or nothing but
    // transparency all the way up — counts as not light, which leaves the
    // blend doing what it already did.
    const light = SAMPLES.every((fraction) => {
      const luminance = this.#luminanceAt(width * fraction, y);
      return luminance !== null && luminance >= LIGHT_THRESHOLD;
    });

    this.#host.toggleAttribute('data-over-light', light);
  };
}

if (!customElements.get('header-tone')) {
  customElements.define('header-tone', HeaderTone);
}
