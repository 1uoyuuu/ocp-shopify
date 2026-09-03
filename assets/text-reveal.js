import { getScrollEventTarget, scrollContainerMediaQuery } from '@theme/scroll-container';

/**
 * A drum of text lines standing on a 3D cylinder, turned by scroll position.
 *
 * Each line sits at its own angle around the cylinder's axis and faces the
 * viewer as the drum brings it round. The section is taller than the
 * viewport and its inner frame is sticky, so the turn is scrubbed across
 * that extra height rather than played once on entry.
 *
 * Position comes from the section's own viewport rect rather than a scroll
 * offset, which sidesteps this theme's split scroll container entirely —
 * a rect is measured against the viewport whichever element is scrolling.
 * Only the *event* has to come from the right place.
 */

/** Fraction of the remaining angle closed per 60fps frame — the drum trails
 * the scroll slightly rather than being welded to it. */
const EASE = 0.12;

/** Frame duration the EASE constant is expressed against. */
const BASE_FRAME_MS = 1000 / 60;

/** Below this many degrees of remaining travel there is nothing to see. */
const SETTLE = 0.01;

/** Where in the turn the paragraph starts and finishes resolving in. The
 * lines have gone by well before the end, so this fills the stretch after
 * them rather than leaving it as scroll with nothing happening. */
const INTRO_FADE_FROM = 0.7;
const INTRO_FADE_TO = 0.92;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

class TextReveal extends HTMLElement {
  /** @type {HTMLElement | null} */
  #drum = null;
  /** @type {HTMLElement | null} */
  #intro = null;
  /** @type {EventTarget | null} */
  #scrollTarget = null;
  #frame = 0;
  #lastTime = 0;
  #target = 0;
  #current = 0;
  #start = 0;
  #end = 0;

  connectedCallback() {
    this.#drum = this.querySelector('[ref="drum"]');
    if (!this.#drum) return;

    this.#intro = this.querySelector('[ref="intro"]');

    this.#start = Number(this.dataset.startRotation ?? 0);
    this.#end = Number(this.dataset.endRotation ?? 0);

    this.#measure();

    // Land on the true starting angle rather than easing in from zero the
    // first time the page is scrolled.
    this.#readProgress();
    this.#current = this.#target;
    this.#apply();

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    this.#bindScroll();
    // Which element scrolls flips at the desktop breakpoint, and scroll
    // events don't bubble to window — so the listener has to move with it.
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
   * The cylinder's radius follows from how far apart the lines are pitched:
   * for a line of height h to clear its neighbour `gap` degrees away, the
   * surface has to sit (h / 2) / tan(gap / 2) from the axis. Measuring it
   * rather than fixing a number keeps the spacing right when the type
   * resizes with the viewport.
   */
  #measure() {
    if (!this.#drum) return;

    const gap = Number(this.dataset.gap ?? 15);
    const height = this.#drum.offsetHeight;
    if (!gap || !height) return;

    const radius = height / 2 / Math.tan((gap / 2) * (Math.PI / 180));
    this.#drum.style.setProperty('--reveal-radius', `${radius}px`);

    // How far the lines actually swing above and below centre: the last one
    // sits (lines - 1) x gap round the cylinder, and its height off the axis
    // is the radius times the sine of that. Past a quarter turn a line is
    // edge-on and contributes nothing further, so the angle is capped.
    const lastAngle = Math.min((this.#drum.children.length - 1) * gap, 90);
    const sweep = 2 * radius * Math.sin(lastAngle * (Math.PI / 180)) + height;
    this.style.setProperty('--reveal-sweep', `${sweep}px`);
  }

  /**
   * Progress runs from the moment the section's top edge appears at the
   * bottom of the screen to the moment its bottom edge reaches there —
   * a range of exactly the section's own height.
   *
   * Measuring only the sticky travel instead (from the section reaching the
   * top of the screen) meant the drum stood still for the whole of its rise
   * over the section before it, and then turned once it had already
   * arrived. Starting at first sight puts the turn into the rise, where the
   * movement is, and leaves whatever height is left over as a hold at the
   * end rather than as dead scroll at the start.
   */
  #readProgress() {
    const rect = this.getBoundingClientRect();
    if (!rect.height) return;

    const progress = clamp((window.innerHeight - rect.top) / rect.height, 0, 1);

    this.#target = this.#start + progress * (this.#end - this.#start);
  }

  #onScroll = () => {
    this.#readProgress();

    if (this.#frame) return;
    this.#lastTime = performance.now();
    this.#frame = requestAnimationFrame(this.#tick);
  };

  #onResize = () => {
    this.#measure();
    this.#readProgress();
    this.#current = this.#target;
    this.#apply();
  };

  /** @param {number} now */
  #tick = (now) => {
    const delta = this.#target - this.#current;

    if (Math.abs(delta) < SETTLE) {
      this.#current = this.#target;
      this.#apply();
      this.#frame = 0;
      return;
    }

    // Frame-rate independent: closing EASE of the gap every 16.7ms means
    // closing this much over however long the frame actually took.
    const elapsed = now - this.#lastTime;
    this.#lastTime = now;
    const factor = 1 - Math.pow(1 - EASE, elapsed / BASE_FRAME_MS);

    this.#current += delta * factor;
    this.#apply();

    this.#frame = requestAnimationFrame(this.#tick);
  };

  #apply() {
    this.#drum?.style.setProperty('--reveal-rotation', `${this.#current}deg`);

    if (!this.#intro) return;

    // Taken from the eased angle rather than raw scroll, so the paragraph
    // arrives in step with the lines it is following.
    const span = this.#end - this.#start;
    const progress = span ? (this.#current - this.#start) / span : 0;
    const opacity = clamp(
      (progress - INTRO_FADE_FROM) / (INTRO_FADE_TO - INTRO_FADE_FROM),
      0,
      1
    );

    this.#intro.style.setProperty('--reveal-intro-opacity', `${opacity}`);
  }
}

if (!customElements.get('text-reveal')) {
  customElements.define('text-reveal', TextReveal);
}
