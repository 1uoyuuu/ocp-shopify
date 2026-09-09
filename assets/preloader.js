/**
 * The opening: the arrow alone, then ONLY, then the full lockup, then away.
 *
 * The wordmark is one drawing whose letters are separate paths, so the three
 * states are the same artwork with more of it showing each time: every letter
 * is the same size in all three, because there is only ever one drawing at
 * one scale. Cross-fading three separately sized lockups would have been
 * simpler and would have thrown that away — the letters would jump size
 * between states, which is exactly what must not happen.
 *
 * Each state is centred on what it is currently showing, so the arrow sits in
 * the middle alone, then to the right of ONLY, then a third of the way into
 * the finished lockup. It is the artwork that slides, not the letters that
 * resize.
 *
 * Everything about the timing is in CSS custom properties, and the cover
 * carries a CSS fallback that hides it whatever happens here — a preloader
 * that fails to leave is worse than no preloader at all.
 */

/** Letters, left to right, that make up each state. ONLY is the first four
 * of a lockup that reads ONLY COFFEE PROJECT; the arrow is the fourth. */
const ONLY_LETTERS = 4;

class SitePreloader extends HTMLElement {
  /** @type {HTMLElement | null} */
  #stage = null;
  /** @type {SVGGraphicsElement[]} */
  #letters = [];
  /** @type {number[]} */
  #timers = [];

  connectedCallback() {
    this.#stage = this.querySelector('[ref="stage"]');
    const svg = this.querySelector('svg');

    if (!this.#stage || !svg) {
      this.#finish();
      return;
    }

    // Document order is drawing order, not reading order — the artwork puts
    // them down in whatever sequence it was drawn. Sorting by where they
    // actually sit is what makes "the first four" mean ONLY.
    this.#letters = /** @type {SVGGraphicsElement[]} */ ([...svg.querySelectorAll('path')]).sort(
      (a, b) => a.getBBox().x - b.getBBox().x
    );

    if (this.#letters.length <= ONLY_LETTERS) {
      this.#finish();
      return;
    }

    // The first state is not a move, it is where the sequence starts. Without
    // this the artwork sits at rest — the whole lockup's centre — and the
    // arrow visibly slides in from a third of the way left before the words
    // it belongs to have appeared.
    this.#show([ONLY_LETTERS - 1], { immediate: true });

    const step = this.#ms('--preloader-step', 600);
    this.#after(step, () => this.#show(this.#range(0, ONLY_LETTERS)));
    this.#after(step * 2, () => this.#show(this.#range(0, this.#letters.length)));

    // The point of the pause is that the rest of the page is ready when it
    // ends, so the minimum wait and the page's own loading both have to be
    // over. A cap on top, since a slow image should not hold the door.
    const hold = Math.max(this.#ms('--preloader-duration', 2000), step * 3);
    Promise.race([
      Promise.all([this.#wait(hold), this.#loaded()]),
      this.#wait(this.#ms('--preloader-limit', 6000)),
    ]).then(() => this.#finish());
  }

  disconnectedCallback() {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers = [];
  }

  /** @param {string} name @param {number} fallback */
  #ms(name, fallback) {
    const value = parseFloat(getComputedStyle(this).getPropertyValue(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  /** @param {number} from @param {number} to */
  #range(from, to) {
    return Array.from({ length: to - from }, (_, i) => from + i);
  }

  /** @param {number} delay @param {() => void} run */
  #after(delay, run) {
    this.#timers.push(window.setTimeout(run, delay));
  }

  /** @param {number} ms */
  #wait(ms) {
    return new Promise((resolve) => this.#after(ms, resolve));
  }

  #loaded() {
    if (document.readyState === 'complete') return Promise.resolve();
    return new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  }

  /**
   * Shows exactly these letters and slides the artwork so they sit centred.
   *
   * The shift is measured rather than written down: it is the distance from
   * the drawing's middle to the middle of whatever is currently showing, so
   * it stays right if the wordmark is ever redrawn.
   *
   * @param {number[]} indices
   * @param {{ immediate?: boolean }} [options]
   */
  #show(indices, options = {}) {
    const visible = new Set(indices);

    this.#letters.forEach((letter, index) => {
      letter.style.opacity = visible.has(index) ? '1' : '0';
    });

    const boxes = indices.map((index) => this.#letters[index].getBBox());
    const left = Math.min(...boxes.map((box) => box.x));
    const right = Math.max(...boxes.map((box) => box.x + box.width));

    const svg = /** @type {SVGSVGElement} */ (this.querySelector('svg'));
    const width = svg.viewBox.baseVal.width;
    if (!width || !this.#stage) return;

    // As a share of the element's own width rather than in pixels: the
    // drawing is exactly this element wide, so one is the other and the shift
    // holds at whatever size the mark is rendered.
    const shift = (width / 2 - (left + right) / 2) / width;

    if (options.immediate) {
      this.#stage.style.transition = 'none';
      this.#stage.style.transform = `translateX(${shift * 100}%)`;
      // Read something laid out, so the browser cannot fold the two styles
      // together and animate straight past the state we just set.
      void this.#stage.offsetWidth;
      this.#stage.style.transition = '';
      return;
    }

    this.#stage.style.transform = `translateX(${shift * 100}%)`;
  }

  #finish() {
    this.dataset.done = '';
  }
}

if (!customElements.get('site-preloader')) {
  customElements.define('site-preloader', SitePreloader);
}
