import { getScrollEventTarget, scrollContainerMediaQuery } from '@theme/scroll-container';

/**
 * Parallax for images: `<parallax-frame>` is a clip box around one image, and
 * the image inside drifts against the page as it scrolls past.
 *
 * The image is scaled up a little and only ever translated, so the frame has
 * no geometry to fight with — nothing about how the image is sized or fitted
 * in its own section changes. The scale is what makes the drift safe: it
 * leaves more image above and below the frame than the drift ever uses, so no
 * edge shows.
 *
 * The position is a pure function of where the frame is in the viewport, so
 * it is written straight from the scroll handler. There is no frame loop to
 * starve — the trap that froze the scroll sections on iOS — and nothing
 * stateful to latch.
 *
 * The scroll listener goes on whichever element scrolls: the page container
 * from 990px, the document below, and scroll events do not bubble to window.
 */

/** How far the image travels each way, as a share of the frame's height. */
const RANGE = 0.07;

/** Enough over-scale that a drift of RANGE never uncovers an edge. */
const SCALE = 1.16;

/** @type {Set<ParallaxFrame>} */
const frames = new Set();

/** The frames currently on screen — only these are worth moving. */
/** @type {Set<ParallaxFrame>} */
const visible = new Set();

/** @type {EventTarget | null} */
let scrollTarget = null;
/** @type {IntersectionObserver | null} */
let observer = null;

const update = () => {
  for (const frame of visible) frame.update();
};

const bindScroll = () => {
  scrollTarget?.removeEventListener('scroll', update);
  scrollTarget = getScrollEventTarget();
  scrollTarget.addEventListener('scroll', update, { passive: true });
};

function start() {
  if (observer) return;

  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const frame = /** @type {ParallaxFrame} */ (entry.target);
      if (entry.isIntersecting) {
        visible.add(frame);
        frame.update();
      } else {
        visible.delete(frame);
      }
    }
  });

  bindScroll();
  scrollContainerMediaQuery.addEventListener('change', bindScroll);
  window.addEventListener('resize', update);
}

function stop() {
  observer?.disconnect();
  observer = null;
  scrollTarget?.removeEventListener('scroll', update);
  scrollTarget = null;
  scrollContainerMediaQuery.removeEventListener('change', bindScroll);
  window.removeEventListener('resize', update);
  visible.clear();
}

class ParallaxFrame extends HTMLElement {
  /** @type {HTMLElement | SVGElement | null} */
  #media = null;

  connectedCallback() {
    // Asked not to move: the image stays exactly as its section drew it.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    this.#media = this.querySelector('img, svg');
    if (!this.#media) return;

    this.#media.style.willChange = 'transform';
    frames.add(this);
    start();
    observer?.observe(this);
    this.update();
  }

  disconnectedCallback() {
    if (!frames.delete(this)) return;
    visible.delete(this);
    observer?.unobserve(this);
    if (!frames.size) stop();
  }

  update() {
    if (!this.#media) return;

    const rect = this.getBoundingClientRect();
    const half = window.innerHeight / 2;

    // -1 as the frame's centre is a screen-half below the middle, +1 a
    // screen-half above, clamped beyond either.
    const progress = (rect.top + rect.height / 2 - half) / (half + rect.height / 2);
    const clamped = Math.max(-1, Math.min(1, progress));

    // Opposite to the scroll, so the image lags the frame it sits in.
    const shift = -clamped * RANGE * rect.height;
    this.#media.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0) scale(${SCALE})`;
  }
}

if (!customElements.get('parallax-frame')) {
  customElements.define('parallax-frame', ParallaxFrame);
}
