import {
  getIntersectionRoot,
  getScrollEventTarget,
  getScrollTop,
  scrollContainerMediaQuery,
} from '@theme/scroll-container';

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

  // Starts once the panel has landed. The words ride up on it, so filling
  // them on the way would have the paragraph resolving while it is still
  // travelling.
  fill: [0.32, 0.9],
};

/**
 * How much of the page's scroll the carousel takes on top of its own drift.
 * A fraction rather than the whole distance, so scrolling nudges the column
 * along instead of yanking it — the drift stays the thing you notice.
 */
const SCROLL_COUPLING = 0.35;

/**
 * The carousel only runs where there is a column to run in. Below this the
 * products sit stacked under the paragraph and the page's own scroll is the
 * only movement they need.
 */
const carouselMedia = matchMedia('(min-width: 990px)');

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
  /** @type {HTMLElement | null} */
  #window = null;

  /** Running distance the carousel has travelled, in px, kept inside the
   * height of one card so it never grows without bound. */
  #offset = 0;
  #lastScrollTop = 0;
  #paused = false;
  #looping = false;
  #loopFrame = 0;
  #loopTime = 0;
  /** @type {IntersectionObserver | null} */
  #observer = null;

  connectedCallback() {
    this.#words = /** @type {HTMLElement[]} */ ([...this.querySelectorAll('[data-word]')]);
    this.#track = this.querySelector('[ref="track"]');
    this.#window = this.#track?.parentElement ?? null;

    // The composition the stylesheet already describes — panel up, every
    // word filled — is the right one to leave standing.
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

    // Turning over off-screen would burn a frame budget on something nobody
    // can see, and the whole point is that it never stops while you watch.
    this.#observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) this.#startLoop();
        else this.#stopLoop();
      },
      // At the desktop breakpoint the page scrolls .page-wrapper, not the
      // document, so the observer has to watch against that.
      { root: getIntersectionRoot() }
    );
    this.#observer.observe(this);

    carouselMedia.addEventListener('change', this.#onBreakpoint);

    this.#window?.addEventListener('pointerenter', this.#onPointerEnter);
    this.#window?.addEventListener('pointerleave', this.#onPointerLeave);
  }

  disconnectedCallback() {
    this.#scrollTarget?.removeEventListener('scroll', this.#onScroll);
    scrollContainerMediaQuery.removeEventListener('change', this.#bindScroll);
    window.removeEventListener('resize', this.#onResize);

    carouselMedia.removeEventListener('change', this.#onBreakpoint);
    this.#window?.removeEventListener('pointerenter', this.#onPointerEnter);
    this.#window?.removeEventListener('pointerleave', this.#onPointerLeave);

    this.#observer?.disconnect();
    this.#observer = null;
    this.#stopLoop();

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

  #onPointerEnter = () => {
    this.#paused = true;
  };

  #onPointerLeave = () => {
    this.#paused = false;
  };

  #onBreakpoint = () => {
    if (carouselMedia.matches) {
      this.#startLoop();
      return;
    }

    this.#stopLoop();

    // Stacked below the breakpoint the stylesheet wants no transform at all,
    // and an inline one would outrank it.
    this.#track?.style.removeProperty('transform');
  };

  #startLoop() {
    if (this.#looping || !this.#track || !carouselMedia.matches) return;

    this.#looping = true;
    this.#loopTime = performance.now();
    this.#lastScrollTop = getScrollTop();
    this.#loopFrame = requestAnimationFrame(this.#loop);
  }

  #stopLoop() {
    this.#looping = false;
    cancelAnimationFrame(this.#loopFrame);
    this.#loopFrame = 0;
  }

  /**
   * The carousel proper. Two things push it: a drift it does on its own, and
   * a share of whatever the page just scrolled — so it is alive while you sit
   * still and answers you when you move.
   *
   * @param {number} now
   */
  #loop = (now) => {
    if (!this.#looping || !this.#track) return;

    const elapsed = Math.min(now - this.#loopTime, 100);
    this.#loopTime = now;

    const scrollTop = getScrollTop();
    const scrolled = scrollTop - this.#lastScrollTop;
    this.#lastScrollTop = scrollTop;

    const speed = Number(getComputedStyle(this).getPropertyValue('--statement-speed')) || 0;
    const drift = this.#paused ? 0 : (speed * elapsed) / 1000;

    this.#offset += drift + scrolled * SCROLL_COUPLING;
    this.#recycle();

    this.#track.style.transform = `translate3d(0, ${-this.#offset}px, 0)`;

    this.#loopFrame = requestAnimationFrame(this.#loop);
  };

  /**
   * What makes the column endless: once a card has gone off the top it is
   * moved to the bottom of the track and the offset drops by exactly what it
   * occupied, so the pixels on screen do not shift.
   *
   * Moving the cards beats cloning them — a clone means two DOM nodes with
   * the same ids and two of every quick-add form, and half of what you see
   * would be the dead copy.
   */
  #recycle() {
    const track = this.#track;
    if (!track || track.children.length < 2) return;

    const gap = parseFloat(getComputedStyle(track).rowGap) || 0;

    // Guard the loops: a card that measures zero (images still loading)
    // would otherwise never satisfy the condition.
    let guard = track.children.length * 2;

    while (guard-- > 0) {
      const first = /** @type {HTMLElement} */ (track.firstElementChild);
      const advance = first.offsetHeight + gap;
      if (advance <= 0 || this.#offset < advance) break;

      track.append(first);
      this.#offset -= advance;
    }

    guard = track.children.length * 2;

    while (guard-- > 0 && this.#offset < 0) {
      const last = /** @type {HTMLElement} */ (track.lastElementChild);
      const advance = last.offsetHeight + gap;
      if (advance <= 0) break;

      track.prepend(last);
      this.#offset += advance;
    }
  }

  #apply() {
    const progress = this.#current;

    this.style.setProperty('--panel', `${beatAt(progress, BEATS.panel)}`);

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
