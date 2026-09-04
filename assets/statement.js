import { getScrollEventTarget, scrollContainerMediaQuery } from '@theme/scroll-container';

/**
 * A panel that rises into the viewport, carrying a paragraph that fills in
 * word by word as the scroll carries on.
 *
 * Progress comes from the section's own viewport rect rather than a scroll
 * offset, which sidesteps this theme's split scroll container — a rect is
 * measured against the viewport whichever element is doing the scrolling.
 * Only the event has to come from the right place.
 *
 * Nothing here decides how any of it looks. Each beat is a number between 0
 * and 1 on a custom property; the stylesheet is written against those.
 */

const BEATS = {
  panel: [0.0, 0.3],

  // The products run for the whole of the read, so the column keeps moving
  // for as long as there are words still filling.
  products: [0.3, 0.95],

  // Starts once the panel has landed. The words ride up on it, so filling
  // them on the way would have the paragraph resolving while it is still
  // travelling.
  fill: [0.32, 0.9],
};

/**
 * Share of the fill spent staggering, against how long each word takes to
 * arrive. Spreading the ripple across a fixed share rather than giving each
 * word a set delay keeps the pace steady however long the paragraph is.
 */
const STAGGER_SPREAD = 0.75;

/** Fraction of the remaining distance closed per 60fps frame, so the fill
 * trails the scroll rather than being welded to it. */
const EASE = 0.14;
const BASE_FRAME_MS = 1000 / 60;
const SETTLE = 0.0005;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** @param {number} progress @param {[number, number]} beat */
const beatAt = (progress, [from, to]) => clamp((progress - from) / (to - from), 0, 1);

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

  connectedCallback() {
    this.#words = /** @type {HTMLElement[]} */ ([...this.querySelectorAll('[data-word]')]);
    this.#track = this.querySelector('[ref="track"]');

    // The composition the stylesheet already describes — panel up, every
    // word filled — is the right one to leave standing.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    this.dataset.driven = '';

    this.#measureTrack();
    this.#read();
    this.#current = this.#target;
    this.#apply();

    this.#bindScroll();
    // Which element scrolls flips at the desktop breakpoint, and scroll
    // events don't bubble to window.
    scrollContainerMediaQuery.addEventListener('change', this.#bindScroll);
    window.addEventListener('resize', this.#onResize);
  }

  disconnectedCallback() {
    this.#scrollTarget?.removeEventListener('scroll', this.#onScroll);
    scrollContainerMediaQuery.removeEventListener('change', this.#bindScroll);
    window.removeEventListener('resize', this.#onResize);

    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #bindScroll = () => {
    this.#scrollTarget?.removeEventListener('scroll', this.#onScroll);
    this.#scrollTarget = getScrollEventTarget();
    this.#scrollTarget.addEventListener('scroll', this.#onScroll, { passive: true });
  };

  /**
   * Runs from the section's top edge reaching the bottom of the screen to
   * its bottom edge reaching there — a span of exactly its own height, so
   * the panel rises during the approach where the movement already is.
   */
  #read() {
    const rect = this.getBoundingClientRect();
    if (!rect.height) return;

    this.#target = clamp((window.innerHeight - rect.top) / rect.height, 0, 1);
  }

  #onScroll = () => {
    this.#read();

    if (this.#frame) return;
    this.#lastTime = performance.now();
    this.#frame = requestAnimationFrame(this.#tick);
  };

  #onResize = () => {
    this.#measureTrack();
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

  /**
   * How far the column has to travel for its last card to finish level with
   * the bottom of the window. Measured rather than assumed, since it
   * depends on how many products there are and how tall the cards come out.
   */
  #measureTrack() {
    if (!this.#track) return;

    const window_ = this.#track.parentElement;
    if (!window_) return;

    const travel = this.#track.scrollHeight - window_.clientHeight;

    this.style.setProperty('--products-travel', `${Math.max(0, travel)}px`);
  }

  #apply() {
    const progress = this.#current;

    this.style.setProperty('--panel', `${beatAt(progress, BEATS.panel)}`);
    this.style.setProperty('--products', `${beatAt(progress, BEATS.products)}`);

    const fill = beatAt(progress, BEATS.fill);
    const count = this.#words.length;
    const step = count > 1 ? STAGGER_SPREAD / (count - 1) : 0;
    const rise = 1 - STAGGER_SPREAD;

    this.#words.forEach((word, index) => {
      // Linear: each word only has a moment, and an ease across it does
      // nothing a straight line does not.
      const local = rise > 0 ? clamp((fill - index * step) / rise, 0, 1) : fill;
      word.style.setProperty('--fill', `${local}`);
    });
  }
}

if (!customElements.get('scroll-statement')) {
  customElements.define('scroll-statement', ScrollStatement);
}
