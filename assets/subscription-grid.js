import { getScrollEventTarget, scrollContainerMediaQuery } from '@theme/scroll-container';

/**
 * The subscription grid: copy held in the middle of the screen while the
 * coffees drift up past it, and a handover partway through from the heading
 * to what the subscription actually asks.
 *
 * Four things move, and they are deliberately kept apart.
 *
 * The scroll carries each slot at a rate set by its size, and writes that on
 * one element. The pointer drifts each slot by an amount set by the same size,
 * and writes that on a second element nested inside the first. Neither can
 * clobber the other, because neither touches the other's transform.
 *
 * The two run in opposite directions across the sizes — the large slots do not
 * travel at all but drift the most, the small ones travel furthest and barely
 * drift. That is what stops the arrangement reading as one sheet: no two slots
 * agree about both at once. Big bags are the ground the small ones float over,
 * which is also why nothing here makes the reader seasick.
 *
 * Position comes from each element's own viewport rect rather than a scroll
 * offset, which sidesteps this theme's split scroll container — a rect is
 * measured against the viewport whichever element is doing the scrolling. Only
 * the event has to come from the right place.
 */

/**
 * What a size means, beyond how many columns it spans.
 *
 * `travel` is how far the slot is carried, as a share of the viewport height,
 * either side of its resting place. `drift` is how far it follows the pointer,
 * in pixels. The inversion is the point — see above.
 */
const TIERS = {
  l: { travel: 0, drift: 60 },
  m: { travel: 0.15, drift: 30 },
  s: { travel: 0.25, drift: 20 },
};

/**
 * How many slots fade in as they arrive.
 *
 * Only the first few, and each over a window of its own: a grid where every
 * slot fades is a wave, and a wave reads as a page still loading. After these
 * the arrangement is simply there, and the motion is what carries it.
 */
const ENTRANCE_COUNT = 6;

/** The randomised entrance window, in screens: fully faded by the time the
 * slot's top reaches the lower figure, starting when it was at the upper. */
const ENTRANCE_START = [1.1, 1.5];
const ENTRANCE_END = [0.0, 0.05];

/** Share of the way to the pointer closed per 60fps frame. Low enough that the
 * grid trails the cursor rather than being welded to it. */
const DRIFT_EASE = 0.09;

/**
 * Where in the held run the copy changes over, as a share of it.
 *
 * Late, and over a short window: the heading has the first half to itself,
 * the swap happens with a third of the grid still to come, and what it asks
 * for is what the reader is left holding. Measured against the run the copy
 * is actually held for — the stage less one screen — so it lands in the same
 * place however tall the grid turns out to be.
 */
const HANDOVER = [0.44, 0.74];

/**
 * The handover is a sequence, not a dissolve: the first line is gone before
 * the second starts.
 *
 * Cross-fading them meant a long stretch with both at half opacity, which
 * does not read as one line replacing another — it reads as two ghosts on top
 * of each other, and with the grid moving behind them neither was legible.
 * These are shares of the window: out by 0.42, nothing until 0.58, then in.
 * The beat between is about an eighth of a screen of scrolling, short enough
 * to be a breath and long enough that the two are never both on screen.
 */
const COPY_OUT_END = 0.42;
const COPY_IN_START = 0.58;

/**
 * How far each line travels while it goes, as a share of the viewport height.
 *
 * Both rise: the one leaving lifts away, the one arriving comes up into the
 * place it left. A fade alone at this size reads as a light being switched;
 * the movement is what makes it read as one thing giving way to another, and
 * upward is the direction everything else on this page already moves.
 */
const COPY_LIFT = 0.04;

/** Slow at both ends, quickest in the middle. Applied to the opacity and the
 * travel alike so they arrive together. */
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const BASE_FRAME_MS = 1000 / 60;

/** Below this the pointer has arrived and the frame loop can stop. */
const SETTLE = 0.0005;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** @param {[number, number]} range */
const between = ([from, to]) => from + Math.random() * (to - from);

class SubscriptionGrid extends HTMLElement {
  /** @type {EventTarget | null} */
  #scrollTarget = null;
  #frame = 0;
  #lastTime = 0;

  /** @type {{ el: HTMLElement, travel: HTMLElement, media: HTMLElement, tier: {travel: number, drift: number}, from: number, to: number }[]} */
  #slots = [];
  /** @type {HTMLElement | null} */
  #stage = null;
  /** @type {HTMLElement | null} */
  #title = null;
  /** @type {HTMLElement | null} */
  #detail = null;
  /** @type {IntersectionObserver | null} */
  #watcher = null;

  /**
   * Starts true, and the observer only ever turns it off.
   *
   * It gates cost, not correctness — so the honest default is the one where
   * the drift works. Starting false means an observer that has not reported
   * yet, or does not fire at all, leaves the pointer permanently ignored, and
   * nothing about that failure is visible.
   */
  #inView = true;
  #pointer = { targetX: 0, targetY: 0, x: 0, y: 0 };

  connectedCallback() {
    this.#stage = this.querySelector('[ref="stage"]');
    this.#title = this.querySelector('[ref="title"]');
    this.#detail = this.querySelector('[ref="detail"]');

    // The composition the stylesheet already describes is the finished one.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    this.#slots = /** @type {HTMLElement[]} */ ([...this.querySelectorAll('[data-slot]')])
      .map((el, index) => {
        const travel = /** @type {HTMLElement | null} */ (el.querySelector('[data-travel]'));
        const media = /** @type {HTMLElement | null} */ (el.querySelector('[data-media]'));
        if (!travel || !media) return null;

        return {
          el,
          travel,
          media,
          tier: TIERS[/** @type {keyof typeof TIERS} */ (el.dataset.tier ?? 'm')] ?? TIERS.m,
          // Rolled once, here, rather than per frame: the entrance is meant to
          // be uneven, not unsteady.
          from: index < ENTRANCE_COUNT ? between(ENTRANCE_START) : 0,
          to: index < ENTRANCE_COUNT ? between(ENTRANCE_END) : 0,
        };
      })
      .filter(/** @returns {slot is NonNullable<typeof slot>} */ (slot) => slot !== null);

    if (!this.#slots.length) return;

    // Only now does the pinned, cross-faded layout apply. Until this, and for
    // a reader who has asked for less motion, both pieces of copy are simply
    // stacked and both are read.
    this.dataset.driven = '';

    this.#bindScroll();
    scrollContainerMediaQuery.addEventListener('change', this.#bindScroll);
    window.addEventListener('resize', this.#onScroll, { passive: true });

    // The pointer is only worth listening to while the section is on screen,
    // and the drift is only worth computing then either.
    this.#watcher = new IntersectionObserver(([entry]) => {
      this.#inView = entry.isIntersecting;
      if (this.#inView) this.#onScroll();
    });
    this.#watcher.observe(this);
    window.addEventListener('pointermove', this.#onPointerMove, { passive: true });

    this.#lastTime = performance.now();
    this.#step(this.#lastTime);
  }

  disconnectedCallback() {
    this.#unbindScroll();
    scrollContainerMediaQuery.removeEventListener('change', this.#bindScroll);
    window.removeEventListener('resize', this.#onScroll);
    window.removeEventListener('pointermove', this.#onPointerMove);
    this.#watcher?.disconnect();
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #bindScroll = () => {
    this.#unbindScroll();
    this.#scrollTarget = getScrollEventTarget();
    this.#scrollTarget.addEventListener('scroll', this.#onScroll, { passive: true });
  };

  #unbindScroll() {
    this.#scrollTarget?.removeEventListener('scroll', this.#onScroll);
    this.#scrollTarget = null;
  }

  /**
   * Advances the animation from the scroll itself, not only from a frame.
   *
   * A handler that does nothing but ask for a frame latches shut for good the
   * first time one is starved — which is exactly what iOS does through
   * momentum scrolling. The step runs here, and a frame is only asked for if
   * something is still easing towards a rest.
   */
  #onScroll = () => {
    if (this.#step(performance.now())) this.#request();
  };

  /** @param {PointerEvent} event */
  #onPointerMove = (event) => {
    if (!this.#inView) return;

    // Against the cursor rather than with it: the grid leans away, which reads
    // as depth where following the cursor reads as a cursor effect.
    this.#pointer.targetX = 1 - (2 * event.clientX) / window.innerWidth;
    this.#pointer.targetY = 1 - (2 * event.clientY) / window.innerHeight;

    this.#lastTime = performance.now();
    this.#request();
  };

  /**
   * Asks for a frame, cancelling any frame already outstanding.
   *
   * The usual `if (this.#frame) return` is a latch: the field is only cleared
   * inside the callback, so once a frame is starved — which is what happens
   * through iOS momentum scrolling, and in a background tab — it is never
   * cleared and no frame is ever asked for again. Cancelling first costs a
   * pair of calls per event and cannot get stuck.
   */
  #request() {
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(this.#tick);
  }

  /** @param {number} now */
  #tick = (now) => {
    this.#frame = this.#step(now) ? requestAnimationFrame(this.#tick) : 0;
  };

  /**
   * One pass. Returns whether anything is still moving of its own accord.
   *
   * @param {number} now
   * @returns {boolean}
   */
  #step(now) {
    const height = window.innerHeight;
    if (!height) return false;

    const elapsed = Math.max(now - this.#lastTime, 0);
    this.#lastTime = now;

    const settling = this.#drift(elapsed);
    this.#carry(height);
    this.#hold(height);

    return settling;
  }

  /**
   * Eases the pointer offset towards where the cursor actually is, and writes
   * it per size. Framerate-independent, so a dropped frame closes proportionally
   * more of the gap rather than stalling the drift.
   *
   * @param {number} elapsed
   * @returns {boolean} whether it is still on its way
   */
  #drift(elapsed) {
    const ease = 1 - Math.pow(1 - DRIFT_EASE, elapsed / BASE_FRAME_MS);

    this.#pointer.x += (this.#pointer.targetX - this.#pointer.x) * ease;
    this.#pointer.y += (this.#pointer.targetY - this.#pointer.y) * ease;

    for (const slot of this.#slots) {
      const { drift } = slot.tier;
      slot.media.style.transform = `translate3d(${this.#pointer.x * drift}px, ${
        this.#pointer.y * drift
      }px, 0)`;
    }

    return (
      Math.abs(this.#pointer.targetX - this.#pointer.x) > SETTLE ||
      Math.abs(this.#pointer.targetY - this.#pointer.y) > SETTLE
    );
  }

  /**
   * Carries each slot by its size, and fades the first few in as they arrive.
   *
   * Both are read straight off the slot's position rather than accumulated, so
   * scrolling back up retraces exactly what scrolling down drew.
   *
   * @param {number} height
   */
  #carry(height) {
    for (const slot of this.#slots) {
      const rect = slot.el.getBoundingClientRect();

      // Nothing to write for a slot that is not on screen, and its transform is
      // already where it was left.
      if (rect.bottom < -height || rect.top > height * 2) continue;

      const centre = (rect.top + rect.height / 2) / height;
      const carried = (1 - 2 * clamp(centre, -0.5, 1.5)) * slot.tier.travel * height;

      slot.travel.style.transform = `translate3d(0, ${carried}px, 0)`;

      if (slot.from > slot.to) {
        const top = rect.top / height;
        slot.travel.style.opacity = `${clamp((slot.from - top) / (slot.from - slot.to), 0, 1)}`;
      }
    }
  }

  /**
   * Hands the held copy over: the heading out, what it asks for in, both in
   * the same place in the middle of the screen.
   *
   * Progress is measured against the run the copy is held for — the stage's
   * height less the one screen the sticky element occupies — which is exactly
   * how far the reader scrolls while it stays put.
   *
   * @param {number} height
   */
  #hold(height) {
    if (!this.#stage || !this.#title || !this.#detail) return;

    const rect = this.#stage.getBoundingClientRect();
    const run = rect.height - height;
    if (run <= 0) return;

    const [from, to] = HANDOVER;
    const held = clamp(-rect.top / run, 0, 1);
    const through = clamp((held - from) / (to - from), 0, 1);

    const leaving = easeInOut(clamp(through / COPY_OUT_END, 0, 1));
    const arriving = easeInOut(clamp((through - COPY_IN_START) / (1 - COPY_IN_START), 0, 1));
    const lift = height * COPY_LIFT;

    this.#title.style.opacity = `${1 - leaving}`;
    this.#title.style.transform = `translate3d(0, ${-leaving * lift}px, 0)`;

    this.#detail.style.opacity = `${arriving}`;
    this.#detail.style.transform = `translate3d(0, ${(1 - arriving) * lift}px, 0)`;

    // Only the one that has actually arrived takes a click. Toggling an
    // attribute rather than writing pointer-events keeps the rule in the
    // stylesheet with the rest of the layout.
    this.#detail.toggleAttribute('data-live', arriving > 0.5);
  }
}

if (!customElements.get('subscription-grid')) {
  customElements.define('subscription-grid', SubscriptionGrid);
}
