import { getScrollEventTarget, scrollContainerMediaQuery } from '@theme/scroll-container';

/**
 * Marks the header when the section behind it is light, so it can take one of
 * two colours rather than being computed from the backdrop.
 *
 * It used to switch a `difference` blend off here and leave it on everywhere
 * else. A blend has no knowledge of what it sits over, so it could not be
 * asked for a particular colour — over the brand blue it resolved to orange,
 * and over a pale product card to black. Two colours chosen outright is what
 * the site wanted; this decides which.
 */

/** Relative luminance past which a backdrop counts as light. Set above the
 * pale greys a product shot might sit on, so only genuinely white-ish
 * sections trip it. */
const LIGHT_THRESHOLD = 0.72;

/** Fractions of the width to sample — roughly under MENU, the logo and CART.
 * All three must be light before the header changes, so a pale card drifting
 * under one of them doesn't flip the whole row. */
const SAMPLES = [0.08, 0.5, 0.92];

/**
 * How much of the width something must span to count as the backdrop.
 *
 * The header follows the *section* it is over, not whatever happens to be
 * travelling under one of the sample points. A section background or a
 * full-screen panel spans the page; a product card, a heading, a scattered
 * bag does not. Without this the statement's product column voted every time
 * a card passed under the cart, and the header flickered between the panel
 * behind it and the card in front.
 */
const BACKDROP_MIN_WIDTH = 0.8;

/**
 * The class hero-scroll.js puts on <html> while the intro holds the page.
 *
 * Everything else that changes what sits behind the header does it by
 * scrolling, and a scroll event is what prompts a fresh reading. The intro is
 * the exception: it is driven by gestures against a page pinned with
 * `overflow: clip`, so the stage can grow from a badge back to full-bleed
 * video without a single scroll event. Left to the scroll listener alone the
 * header keeps whatever it decided on the way in — blue, from the hero's own
 * white background at the end of the intro — and holds it while the video
 * fills the screen behind it.
 */
const INTRO_LOCK_CLASS = 'hero-intro-locked';

/** Media has colours of its own that cannot be read from a computed style. */
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
  /** While the intro is playing, the reading is retaken every frame. */
  #introFrame = 0;
  #watchingIntro = false;
  /** @type {MutationObserver | null} */
  #introWatcher = null;
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

    // The intro announces itself with a class, so that is what is watched
    // rather than the hero component, which this has no other reason to know
    // about.
    this.#introWatcher = new MutationObserver(this.#syncIntroWatch);
    this.#introWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    this.#syncIntroWatch();

    this.#schedule();
  }

  disconnectedCallback() {
    this.#scrollTarget?.removeEventListener('scroll', this.#schedule);
    scrollContainerMediaQuery.removeEventListener('change', this.#bindScroll);
    window.removeEventListener('resize', this.#schedule);

    this.#introWatcher?.disconnect();
    this.#introWatcher = null;
    this.#watchingIntro = false;

    cancelAnimationFrame(this.#introFrame);
    this.#introFrame = 0;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  /**
   * Starts and stops the per-frame reading as the intro takes and gives back
   * the page. One more reading on the way out, so the settled composition is
   * what the header ends on.
   */
  #syncIntroWatch = () => {
    const locked = document.documentElement.classList.contains(INTRO_LOCK_CLASS);
    if (locked === this.#watchingIntro) return;

    this.#watchingIntro = locked;

    if (locked) {
      this.#readWhileIntroPlays();
      return;
    }

    cancelAnimationFrame(this.#introFrame);
    this.#introFrame = 0;
    this.#schedule();
  };

  #readWhileIntroPlays = () => {
    // Cleared first, so a starved frame leaves nothing latched behind it.
    this.#introFrame = 0;
    if (!this.#watchingIntro) return;

    this.#measure();
    this.#introFrame = requestAnimationFrame(this.#readWhileIntroPlays);
  };

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
   * Only something spanning most of the page counts, so the section behind
   * decides and the content in front of it does not.
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

      // Narrow things are content sitting on the section, not the section.
      // This has to come before the media test, or a product photograph would
      // still stop the walk and be read as an unknowable backdrop.
      if (element.getBoundingClientRect().width < window.innerWidth * BACKDROP_MIN_WIDTH) {
        continue;
      }

      // Full-bleed media — the hero's video — cannot be read from a computed
      // style, and is dark enough in practice to take the dark treatment.
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
    // transparency all the way up — counts as not light, which is the
    // treatment that works over a video.
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
