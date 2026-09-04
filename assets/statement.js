import { getScrollEventTarget, scrollContainerMediaQuery } from '@theme/scroll-container';

/**
 * A panel that rises into the viewport carrying a paragraph, which fills in
 * word by word; then a run of products carried past the reader before the
 * section lets the page go — up the right-hand side on a wide screen, across
 * the bottom on a narrow one.
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

  // The column climbs into place from below once the paragraph is half
  // filled: 0.32 + 0.5 × (0.9 − 0.32). Arriving under its own beat rather
  // than after the read means the eye is already moving right by the time
  // the scroll hands over to it, and starting at the halfway mark leaves it
  // settled well before the last words land.
  enter: [0.61, 0.96],
};

/**
 * Which way the products travel. Above this they are a column beside the
 * paragraph and are carried upward; below it they are a strip under the
 * paragraph and are carried leftward. The timeline is the same either way —
 * only the axis it is measured and written on changes.
 */
const uprightMedia = matchMedia('(min-width: 990px)');

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

  /** How far the products have to move for the last card to finish on screen. */
  #travel = 0;
  /** How far past its resting place the run starts, along whichever axis. */
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

    // The clock starts here, not at zero: the first step is a scroll away
    // and would otherwise be handed the whole time since the page loaded.
    this.#lastTime = performance.now();

    this.#bindScroll();
    // Which element scrolls flips at the desktop breakpoint, and scroll
    // events don't bubble to window.
    scrollContainerMediaQuery.addEventListener('change', this.#bindScroll);
    uprightMedia.addEventListener('change', this.#onResize);
    window.addEventListener('resize', this.#onResize);

    // Cards arrive before their images have been measured, and the whole
    // timeline is built on how far the run turns out to reach. The track's
    // own box only changes on one axis, so the cards are watched too.
    if ('ResizeObserver' in window && this.#track) {
      this.#resize = new ResizeObserver(this.#onResize);
      this.#resize.observe(this.#track);
      for (const card of this.#track.children) this.#resize.observe(card);
    }

    // Images and webfonts both land after this runs and both move the cards.
    window.addEventListener('load', this.#onResize);
    document.fonts?.ready.then(this.#onResize);
  }

  disconnectedCallback() {
    this.#scrollTarget?.removeEventListener('scroll', this.#onScroll);
    scrollContainerMediaQuery.removeEventListener('change', this.#bindScroll);
    uprightMedia.removeEventListener('change', this.#onResize);
    window.removeEventListener('resize', this.#onResize);
    window.removeEventListener('load', this.#onResize);

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
   * How far the products have to go, and where they start from.
   *
   * Written once for both axes: upright it is heights and tops, sideways it
   * is widths and lefts, and nothing else differs. The track never
   * contributes the dimension being measured — out of flow when upright, no
   * wider than its cell can constrain when sideways — so reading it cannot
   * be circular with the section height that depends on it.
   */
  #measure() {
    const track = this.#track;
    const column = this.#column;
    const panel = column?.parentElement;

    if (!track || !column || !panel) {
      this.#travel = 0;
      this.style.setProperty('--products-travel', '0px');
      return;
    }

    const upright = uprightMedia.matches;
    const columnRect = column.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();

    // Both rects carry the panel's transform, so the difference between them
    // is the products' place within the panel and nothing else.
    const inset = upright ? columnRect.top - panelRect.top : columnRect.left - panelRect.left;

    const extent = upright ? window.innerHeight : window.innerWidth;

    // Measured off the last card rather than the track's own scroll size.
    // The track is sized to its content, so its scroll size is only ever its
    // own box — which reports nothing useful if the layout it depends on has
    // not applied. Where the last card ends is true either way.
    const last = /** @type {HTMLElement | undefined} */ (track.children[track.children.length - 1]);
    const reach = last
      ? upright
        ? last.offsetTop + last.offsetHeight
        : last.offsetLeft + last.offsetWidth
      : 0;

    // A whole screen past its resting place puts the first card just off the
    // far edge, whatever the panel's padding happens to be.
    this.#enterFrom = extent - inset;

    // The same inset again at the other end, so the last card finishes clear
    // of the edge rather than flush against it.
    const visible = Math.max(200, extent - inset * 2);

    this.#travel = Math.max(0, reach - visible);
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

    // Advanced here as well as on the frame, so movement never depends on a
    // frame arriving. On iOS the callbacks can be starved through a momentum
    // scroll — and since a frame is what clears #frame, waiting on one would
    // latch this shut for good: every later scroll would see the flag still
    // raised and return without doing anything.
    this.#step(performance.now());

    if (this.#frame) return;
    this.#frame = requestAnimationFrame(this.#tick);
  };

  #onResize = () => {
    this.#measure();
    this.#read();
    this.#current = this.#target;
    this.#apply();
  };

  /**
   * One move toward the target, by however much real time has passed.
   *
   * Called from the frame loop and from the scroll handler alike, so the two
   * can interleave freely: each advances by the time actually elapsed, so
   * doing it twice in one frame is not doing it twice as fast.
   *
   * @param {number} now
   * @returns {boolean} whether there is still ground to cover
   */
  #step(now) {
    const delta = this.#target - this.#current;

    // Frame-rate independent: closing EASE of the gap every 16.7ms means
    // closing this much over however long it actually took. Capped, so a
    // long gap between calls cannot close the whole distance at once.
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

    // Two movements along one axis: arriving into place, then being carried
    // on past. Written as a single offset so the handover cannot show a seam
    // between them, and left to the stylesheet to decide which axis it is.
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
