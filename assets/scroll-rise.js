import { getScrollEventTarget, scrollContainerMediaQuery } from '@theme/scroll-container';

/**
 * A panel that rises into the viewport over whatever is behind it, holds, and
 * lets the page go.
 *
 * The whole component is one number: how far up the panel has come, written to
 * `--rise` as 0 to 1. Nothing here decides how that looks. What the stylesheet
 * describes with no script running — the panel up, the words on it — is the
 * readable composition, so nothing is ever stranded off screen.
 *
 * Progress comes from the section's own viewport rect rather than a scroll
 * offset, which sidesteps this theme's split scroll container: a rect is
 * measured against the viewport whichever element is doing the scrolling. Only
 * the event has to come from the right place.
 */

/** Share of the section, before the pause at its end, spent rising. The rest of
 * it is the panel standing still with its line on it. */
const RISE = 0.35;

/** Fraction of the remaining distance closed per 60fps frame, so the panel
 * trails the scroll rather than being welded to it. */
const EASE = 0.14;
const BASE_FRAME_MS = 1000 / 60;
const SETTLE = 0.0005;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

class ScrollRise extends HTMLElement {
  /** @type {EventTarget | null} */
  #scrollTarget = null;
  /** @type {HTMLElement | null} */
  #viewport = null;

  #frame = 0;
  #lastTime = 0;
  #target = 0;
  #current = 0;
  #riseEnd = RISE;

  connectedCallback() {
    this.#viewport = this.querySelector('[ref="frame"]');

    // The composition the stylesheet already describes is the right one to
    // leave standing.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    this.dataset.driven = '';

    this.#read();
    this.#current = this.#target;
    this.#apply();

    // The clock starts here, not at zero: the first step is a scroll away and
    // would otherwise be handed the whole time since the page loaded.
    this.#lastTime = performance.now();

    this.#bindScroll();
    // Which element scrolls flips at the desktop breakpoint, and scroll events
    // don't bubble to window.
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
   * Runs from the section's top edge reaching the bottom of the screen to its
   * bottom edge reaching there — a span of exactly its own height, so the panel
   * rises during the approach, where the movement already is.
   */
  #read() {
    const rect = this.getBoundingClientRect();
    if (!rect.height) return;

    this.#target = clamp((window.innerHeight - rect.top) / rect.height, 0, 1);

    // The sticky frame is one screen tall by definition, so measuring it
    // resolves whatever `lvh` currently means without restating the unit here.
    const screen = this.#viewport?.getBoundingClientRect().height || window.innerHeight;
    const units = parseFloat(getComputedStyle(this).getPropertyValue('--rise-tail-units'));
    const tail = ((Number.isFinite(units) ? units : 0) / 100) * screen;

    // The rise takes its share of what is left once the pause is set aside, so
    // lengthening the pause holds the finished panel longer rather than making
    // it climb more slowly.
    this.#riseEnd = clamp((rect.height - tail) / rect.height, 0.05, 1) * RISE;
  }

  #onScroll = () => {
    this.#read();

    // Advanced here as well as on the frame, so movement never depends on a
    // frame arriving. On iOS the callbacks can be starved through a momentum
    // scroll — and since a frame is what clears #frame, waiting on one would
    // latch this shut for good.
    this.#step(performance.now());

    if (this.#frame) return;
    this.#frame = requestAnimationFrame(this.#tick);
  };

  #onResize = () => {
    this.#read();
    this.#current = this.#target;
    this.#apply();
  };

  /**
   * One move toward the target, by however much real time has passed. Called
   * from the frame loop and the scroll handler alike: each advances by the time
   * actually elapsed, so doing it twice in one frame is not twice as fast.
   *
   * @param {number} now
   * @returns {boolean} whether there is still ground to cover
   */
  #step(now) {
    const delta = this.#target - this.#current;

    const elapsed = Math.min(Math.max(now - this.#lastTime, 0), 100);
    this.#lastTime = now;
    const factor = 1 - Math.pow(1 - EASE, elapsed / BASE_FRAME_MS);

    this.#current = Math.abs(delta) < SETTLE ? this.#target : this.#current + delta * factor;
    this.#apply();

    return Math.abs(this.#target - this.#current) >= SETTLE;
  }

  /** @param {number} now */
  #tick = (now) => {
    this.#frame = this.#step(now) ? requestAnimationFrame(this.#tick) : 0;
  };

  #apply() {
    this.style.setProperty('--rise', `${clamp(this.#current / this.#riseEnd, 0, 1)}`);
  }
}

if (!customElements.get('scroll-rise')) {
  customElements.define('scroll-rise', ScrollRise);
}
