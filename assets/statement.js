import { getScrollEventTarget, scrollContainerMediaQuery } from '@theme/scroll-container';

/**
 * A panel that rises into the viewport carrying a paragraph, which fills in
 * word by word; then a column of products carried up past the reader before
 * the section lets the page go.
 *
 * The two are scrolled one after the other. The section is long enough for
 * both — its own length for the read, plus however far the column has to
 * travel, measured here and handed to the stylesheet. Because exactly that
 * much height is added for exactly that much travel, the column moves a
 * pixel for a pixel scrolled.
 *
 * Progress comes from the section's own viewport rect rather than a scroll
 * offset, which sidesteps this theme's split scroll container — a rect is
 * measured against the viewport whichever element is doing the scrolling.
 * Only the event has to come from the right place.
 *
 * Nothing here decides how any of it looks. Each beat is a number on a custom
 * property; the stylesheet is written against those.
 */

/**
 * Beats within the read, as fractions of it. They are scaled by the share of
 * the section the read actually occupies, which depends on how far the column
 * turns out to have to travel.
 */
const BEATS = {
  panel: [0.0, 0.3],

  // Starts once the panel has landed. The words ride up on it, so filling
  // them on the way would have the paragraph resolving while it is still
  // travelling.
  fill: [0.32, 0.9],

  // The column climbs into place from below while the last quarter of the
  // paragraph is still filling: 0.32 + 0.75 × (0.9 − 0.32). Arriving under
  // its own beat rather than after the read means the eye is already moving
  // right by the time the scroll hands over to it.
  enter: [0.755, 0.98],
};

/**
 * The column only travels where there is a column to travel in. Below this
 * the products sit stacked under the paragraph and the page's own scroll is
 * the only movement they need.
 */
const columnMedia = matchMedia('(min-width: 990px)');

/** Share of the fill spent staggering, against how long each word takes to
 * arrive. Spreading the ripple across a fixed share rather than giving each
 * word a set delay keeps the pace steady however long the paragraph is. */
const STAGGER_SPREAD = 0.75;

/** Fraction of the remaining distance closed per 60fps frame, so the fill
 * trails the scroll rather than being welded to it. */
const EASE = 0.14;
const BASE_FRAME_MS = 1000 / 60;
const SETTLE = 0.0005;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** @param {number} progress @param {[number, number]} beat */
const beatAt = (progress, [from, to]) =>
  to <= from ? (progress >= to ? 1 : 0) : clamp((progress - from) / (to - from), 0, 1);

/** @param {[number, number]} beat @param {number} share */
const scaled = ([from, to], share) => /** @type {[number, number]} */ ([from * share, to * share]);

class ScrollStatement extends HTMLElement {
  /** @type {EventTarget | null} */
  #scrollTarget = null;
  #frame = 0;
  #lastTime = 0;
  #target = 0;
  #current = 0;

  /** @type {HTMLElement[]} */
  #words = [];
  /** @type {HTMLElement | null} */
  #track = null;
  /** @type {HTMLElement | null} */
  #column = null;
  /** @type {ResizeObserver | null} */
  #resize = null;

  /** How far the column has to move for its last card to finish on screen. */
  #travel = 0;
  /** Where the column starts, measured down from its resting place. */
  #enterFrom = 0;
  /** Share of the section the read occupies; the rest belongs to the column. */
  #readSpan = 1;

  connectedCallback() {
    this.#words = /** @type {HTMLElement[]} */ ([...this.querySelectorAll('[data-word]')]);
    this.#track = this.querySelector('[ref="track"]');
    this.#column = this.querySelector('[ref="column"]');

    // The composition the stylesheet already describes — panel up, every
    // word filled — is the right one to leave standing.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    this.dataset.driven = '';

    this.#measure();
    this.#read();
    this.#current = this.#target;
    this.#apply();

    this.#bindScroll();
    // Which element scrolls flips at the desktop breakpoint, and scroll
    // events don't bubble to window.
    scrollContainerMediaQuery.addEventListener('change', this.#bindScroll);
    columnMedia.addEventListener('change', this.#onResize);
    window.addEventListener('resize', this.#onResize);

    // Cards arrive before their images have been measured, and the whole
    // timeline is built on how tall the column turns out to be.
    if ('ResizeObserver' in window && this.#track) {
      this.#resize = new ResizeObserver(this.#onResize);
      this.#resize.observe(this.#track);
    }
  }

  disconnectedCallback() {
    this.#scrollTarget?.removeEventListener('scroll', this.#onScroll);
    scrollContainerMediaQuery.removeEventListener('change', this.#bindScroll);
    columnMedia.removeEventListener('change', this.#onResize);
    window.removeEventListener('resize', this.#onResize);

    this.#resize?.disconnect();
    this.#resize = null;

    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #bindScroll = () => {
    this.#scrollTarget?.removeEventListener('scroll', this.#onScroll);
    this.#scrollTarget = getScrollEventTarget();
    this.#scrollTarget.addEventListener('scroll', this.#onScroll, { passive: true });
  };

  /**
   * How far the column has to go, and where it starts from.
   *
   * The track is out of flow, so its height is its own and reading it cannot
   * be circular — the section's height depends on this measurement rather
   * than the other way round.
   */
  #measure() {
    const track = this.#track;
    const column = this.#column;
    const panel = column?.parentElement;

    if (!track || !column || !panel || !columnMedia.matches) {
      this.#travel = 0;
      this.style.setProperty('--products-travel', '0px');
      return;
    }

    // Both rects carry the panel's transform, so the difference between them
    // is the column's place within the panel and nothing else.
    const inset = column.getBoundingClientRect().top - panel.getBoundingClientRect().top;

    // A screen's height below its resting place puts the first card just off
    // the bottom edge, whatever the panel's padding happens to be.
    this.#enterFrom = window.innerHeight - inset;

    // The same inset again at the bottom, so the last card finishes clear of
    // the edge rather than flush against it.
    const visible = Math.max(200, window.innerHeight - inset * 2);

    this.#travel = Math.max(0, track.scrollHeight - visible);
    this.style.setProperty('--products-travel', `${this.#travel}px`);
  }

  /**
   * Runs from the section's top edge reaching the bottom of the screen to
   * its bottom edge reaching there — a span of exactly its own height, so
   * the panel rises during the approach where the movement already is.
   */
  #read() {
    const rect = this.getBoundingClientRect();
    if (!rect.height) return;

    this.#target = clamp((window.innerHeight - rect.top) / rect.height, 0, 1);

    // Whatever the section is long enough for beyond the read belongs to the
    // column; the read's beats are squeezed into what is left.
    this.#readSpan = clamp((rect.height - this.#travel) / rect.height, 0.05, 1);
  }

  #onScroll = () => {
    this.#read();

    if (this.#frame) return;
    this.#lastTime = performance.now();
    this.#frame = requestAnimationFrame(this.#tick);
  };

  #onResize = () => {
    this.#measure();
    this.#read();
    this.#current = this.#target;
    this.#apply();
  };

  /** @param {number} now */
  #tick = (now) => {
    const delta = this.#target - this.#current;

    // Frame-rate independent: closing EASE of the gap every 16.7ms means
    // closing this much over however long the frame actually took.
    const elapsed = now - this.#lastTime;
    this.#lastTime = now;
    const factor = 1 - Math.pow(1 - EASE, elapsed / BASE_FRAME_MS);

    this.#current = Math.abs(delta) < SETTLE ? this.#target : this.#current + delta * factor;
    this.#apply();

    if (Math.abs(this.#target - this.#current) < SETTLE) {
      this.#frame = 0;
      return;
    }

    this.#frame = requestAnimationFrame(this.#tick);
  };

  #apply() {
    const progress = this.#current;
    const share = this.#readSpan;

    this.style.setProperty('--panel', `${beatAt(progress, scaled(BEATS.panel, share))}`);

    const fill = beatAt(progress, scaled(BEATS.fill, share));
    const count = this.#words.length;
    const step = count > 1 ? STAGGER_SPREAD / (count - 1) : 0;
    const rise = 1 - STAGGER_SPREAD;

    this.#words.forEach((word, index) => {
      // Linear: each word only has a moment, and an ease across it does
      // nothing a straight line does not.
      const local = rise > 0 ? clamp((fill - index * step) / rise, 0, 1) : fill;
      word.style.setProperty('--fill', `${local}`);
    });

    if (!columnMedia.matches) {
      this.style.removeProperty('--products-offset');
      return;
    }

    // Two movements along one axis: climbing into place, then being carried
    // on past. Written as a single offset so the handover cannot show a seam
    // between them.
    const entered = beatAt(progress, scaled(BEATS.enter, share));
    const carried = beatAt(progress, [share, 1]);

    this.style.setProperty(
      '--products-offset',
      `${(1 - entered) * this.#enterFrom - carried * this.#travel}px`
    );
  }
}

if (!customElements.get('scroll-statement')) {
  customElements.define('scroll-statement', ScrollStatement);
}
