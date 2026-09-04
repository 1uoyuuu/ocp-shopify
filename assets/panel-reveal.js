import { getScrollEventTarget, scrollContainerMediaQuery } from '@theme/scroll-container';

/**
 * A scroll-driven sequence in four beats: a flat panel rises into the
 * viewport, two lines of type arrive one after the other, the lines part,
 * and an image opens between them until it fills the screen.
 *
 * Progress is read from the section's own viewport rect rather than a scroll
 * offset, which sidesteps this theme's split scroll container — a rect is
 * measured against the viewport whichever element is scrolling. Only the
 * event has to come from the right place.
 *
 * Nothing here decides how anything looks. Each beat is written out as a
 * number between 0 and 1 on a custom property, and the stylesheet does the
 * rest — so the whole thing can be retimed without touching the CSS, and
 * restyled without touching this.
 */

/**
 * Where each beat starts and ends, as a share of the section's scroll. They
 * overlap deliberately: the second line begins before the first has settled,
 * and the image starts opening while the lines are still parting.
 */
const BEATS = {
  panel: [0.0, 0.25],
  reveal: [0.25, 0.55],
  split: [0.58, 0.78],
  media: [0.62, 1.0],
};

/**
 * How much of the reveal is spent staggering, against how much each word
 * spends rising. Spreading the whole ripple across a fixed share of the
 * beat rather than giving each word a fixed delay keeps the pacing steady
 * however long the slogan is — and keeps it one ripple across both lines
 * rather than a line, then another line.
 */
const STAGGER_SPREAD = 0.55;

/** Fraction of the remaining distance closed per 60fps frame, so the
 * sequence trails the scroll rather than being welded to it. */
const EASE = 0.14;
const BASE_FRAME_MS = 1000 / 60;
const SETTLE = 0.0005;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** @param {number} progress @param {[number, number]} beat */
const beatAt = (progress, [from, to]) => clamp((progress - from) / (to - from), 0, 1);

/** Smoothstep, so each beat eases in and out of its own span rather than
 * starting and stopping abruptly inside the overall scroll. */
const smooth = (t) => t * t * (3 - 2 * t);

class PanelReveal extends HTMLElement {
  /** @type {EventTarget | null} */
  #scrollTarget = null;
  #frame = 0;
  #lastTime = 0;
  #target = 0;
  #current = 0;

  /** @type {HTMLElement[]} */
  #words = [];

  connectedCallback() {
    this.#words = /** @type {HTMLElement[]} */ ([...this.querySelectorAll('[data-word]')]);

    // The static composition the stylesheet already describes is the right
    // one to leave in place here.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    this.dataset.driven = '';

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
   * its bottom edge reaching there — a span of exactly its own height. The
   * panel therefore rises during the approach, where the movement already
   * is, rather than waiting for the section to have arrived.
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

    this.style.setProperty('--panel', `${smooth(beatAt(progress, BEATS.panel))}`);
    this.style.setProperty('--split', `${smooth(beatAt(progress, BEATS.split))}`);
    this.style.setProperty('--media', `${smooth(beatAt(progress, BEATS.media))}`);

    // One ripple across every word of the slogan, both lines included, so
    // it reads as a single phrase arriving rather than two blocks.
    const reveal = beatAt(progress, BEATS.reveal);
    const count = this.#words.length;
    const step = count > 1 ? STAGGER_SPREAD / (count - 1) : 0;
    const rise = 1 - STAGGER_SPREAD;

    this.#words.forEach((word, index) => {
      const local = rise > 0 ? clamp((reveal - index * step) / rise, 0, 1) : reveal;
      word.style.setProperty('--word', `${smooth(local)}`);
    });
  }
}

if (!customElements.get('panel-reveal')) {
  customElements.define('panel-reveal', PanelReveal);
}
