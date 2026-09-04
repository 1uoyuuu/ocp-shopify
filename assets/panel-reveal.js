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
  panel: [0.0, 0.09],
  reveal: [0.09, 0.24],
  split: [0.26, 0.34],
  // The frame opening, overlapping the parting lines it opens between.
  media: [0.28, 0.36],
};

/**
 * Where the locations begin, which is where the frame has finished opening
 * — not where it started. Sharing the opening with the first location's
 * span left that one only a sliver of scroll to show its name in, while
 * every other location had a full share.
 *
 * Everything from here to the end belongs to them, split evenly, so adding
 * one lengthens the sequence rather than squeezing the rest.
 */
const SLIDES_FROM = 0.36;

/** Share of a location's own span spent cross-fading into it. Low enough to
 * read as a change rather than a dissolve, high enough not to snap. */
const CROSSFADE = 0.32;

/**
 * Where the sequence finishes, as a share of the section's scroll. The rest
 * is a hold: the last location stays pinned in the frame while the section
 * below rises over it.
 *
 * Without it the sequence ends at the exact scroll position where the
 * sticky frame lets go, so the last photo starts moving away at the very
 * moment the next section arrives — and there is nothing left to rise over.
 */
const SEQUENCE_END = 0.75;

/**
 * Share of a span a name takes to change. Short enough to read as the name
 * simply changing rather than as an effect of its own.
 *
 * A name hands straight over to the next at the midpoint of the cross-fade
 * bringing its image in — one fading out as the other fades in, meeting at
 * that point rather than overlapping across it. Only one shop is ever
 * legible, and the change is tied to the picture changing instead of
 * trailing it.
 */
const NAME_FADE = 0.05;

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
  /** @type {HTMLElement[]} */
  #slides = [];
  /** @type {HTMLElement[]} */
  #snapPoints = [];

  connectedCallback() {
    this.#words = /** @type {HTMLElement[]} */ ([...this.querySelectorAll('[data-word]')]);
    this.#slides = /** @type {HTMLElement[]} */ ([...this.querySelectorAll('[data-slide]')]);

    // The static composition the stylesheet already describes is the right
    // one to leave in place here.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    this.dataset.driven = '';

    this.#read();
    this.#current = this.#target;
    this.#apply();

    this.#buildSnapPoints();
    this.#placeSnapPoints();

    // The clock starts here, not at zero: the first step is a scroll away
    // and would otherwise be handed the whole time since the page loaded.
    this.#lastTime = performance.now();

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

    const scrolled = (window.innerHeight - rect.top) / rect.height;

    this.#target = clamp(scrolled / SEQUENCE_END, 0, 1);
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
    this.#placeSnapPoints();
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

    this.#applySlides(progress);
  }

  /**
   * One snap target per location, so a scroll settles on a shop rather than
   * between two.
   *
   * They are made here rather than written into the markup because their
   * positions come from the same constants that time the sequence — put
   * them in Liquid and the two would drift the first time a beat moved.
   */
  #buildSnapPoints() {
    if (this.#snapPoints.length) return;

    this.#snapPoints = this.#slides.map(() => {
      const point = document.createElement('div');
      point.className = 'panel-reveal__snap';
      point.setAttribute('aria-hidden', 'true');
      this.appendChild(point);
      return point;
    });
  }

  /**
   * Progress is (viewportHeight - rect.top) / height, so for the sequence to
   * read `settled` the section's top must sit at `viewportHeight -
   * settled * height`. A snap target aligned to the top of the screen puts
   * it exactly there when it sits that far down the section.
   */
  #placeSnapPoints() {
    const height = this.getBoundingClientRect().height;
    const count = this.#slides.length;
    if (!height || !count) return;

    const span = (1 - SLIDES_FROM) / count;
    const fade = span * CROSSFADE;
    const nameFade = span * NAME_FADE;

    this.#snapPoints.forEach((point, index) => {
      const from = SLIDES_FROM + index * span;

      // Where that location has fully arrived — image swapped, name up.
      const settled = index === 0 ? BEATS.media[1] + nameFade : from + fade + nameFade;

      // `settled` is a point in the sequence; the section's own scroll runs
      // SEQUENCE_END times longer than that.
      point.style.top = `${settled * SEQUENCE_END * height - window.innerHeight}px`;
    });
  }

  /**
   * Each location holds the frame for an equal share of the scroll after it
   * opens, and the next fades in over the one before it.
   *
   * Only fading in is needed: they are stacked, later ones paint over
   * earlier ones, so the one underneath is covered as its successor
   * arrives. Fading both would show the panel through them at the halfway
   * point of every change.
   *
   * @param {number} progress
   */
  #applySlides(progress) {
    const count = this.#slides.length;
    if (!count) return;

    const span = (1 - SLIDES_FROM) / count;
    const fade = span * CROSSFADE;

    const nameFade = span * NAME_FADE;

    this.#slides.forEach((slide, index) => {
      const from = SLIDES_FROM + index * span;

      // The first is simply there as the frame opens — the clip is what
      // reveals it, so fading it as well would wash the opening out.
      slide.style.setProperty(
        '--slide',
        index === 0 ? '1' : `${smooth(clamp((progress - from) / fade, 0, 1))}`
      );

      // Its name takes over halfway through the cross-fade that brings its
      // image in, and gives way at the point the next one takes over. The
      // first has no cross-fade to sit in the middle of, so it arrives as
      // the frame finishes opening.
      const takesOver = index === 0 ? BEATS.media[1] : from + fade / 2;
      const givesWay = index === count - 1 ? null : SLIDES_FROM + (index + 1) * span + fade / 2;

      // Linear, and over a couple of svh — long enough not to flicker,
      // short enough that it reads as the name changing rather than as
      // something being animated.
      const arriving = clamp((progress - takesOver) / nameFade, 0, 1);
      const leaving = givesWay === null ? 0 : clamp((progress - (givesWay - nameFade)) / nameFade, 0, 1);

      slide.style.setProperty('--name', `${arriving * (1 - leaving)}`);
    });
  }
}

if (!customElements.get('panel-reveal')) {
  customElements.define('panel-reveal', PanelReveal);
}
