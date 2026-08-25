/**
 * Rides the product card's hover strip up and down after the cursor.
 *
 * The strip doesn't follow the pointer exactly — each frame it closes a
 * fraction of the remaining distance, so it trails behind a fast flick and
 * eases into place when the cursor stops. That lag is the whole effect.
 *
 * Revealing the strip is left to CSS `:hover`; this only drives position.
 * That way the strip still appears if this module fails to load, and touch
 * devices (which never hover) need no JS at all.
 */

/**
 * Fraction of the remaining distance covered per 60fps frame. Lower =
 * heavier, more lag. Corrected for real frame time below so the feel is
 * identical on 120Hz displays.
 */
const EASE = 0.14;

/** Stop the loop once we're within this many pixels of the target. */
const SETTLE = 0.25;

/** Frame duration the EASE constant is expressed against. */
const BASE_FRAME_MS = 1000 / 60;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

class ProductCardMeta extends HTMLElement {
  /** @type {HTMLElement | null} */
  #gallery = null;
  /** @type {number} */
  #frame = 0;
  /** @type {number} */
  #targetY = 0;
  /** @type {number} */
  #currentY = 0;
  /** @type {number} */
  #lastTime = 0;

  connectedCallback() {
    this.#gallery = this.closest('.card-gallery');
    if (!this.#gallery) return;

    // A coarse or hoverless pointer can't drive this, and reduced-motion
    // users shouldn't have text chasing their cursor. Both keep the CSS
    // resting placement instead.
    const canTrack =
      matchMedia('(hover: hover) and (pointer: fine)').matches &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!canTrack) return;

    this.dataset.tracking = '';

    this.#gallery.addEventListener('pointerenter', this.#onEnter);
    this.#gallery.addEventListener('pointermove', this.#onMove);
    this.#gallery.addEventListener('pointerleave', this.#onLeave);
  }

  disconnectedCallback() {
    if (!this.#gallery) return;

    this.#gallery.removeEventListener('pointerenter', this.#onEnter);
    this.#gallery.removeEventListener('pointermove', this.#onMove);
    this.#gallery.removeEventListener('pointerleave', this.#onLeave);

    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  /**
   * Where the strip's top edge should sit for a given pointer position:
   * centred on the cursor, but never past either edge of the image.
   * @param {PointerEvent} event
   * @returns {number}
   */
  #resolveY(event) {
    if (!this.#gallery) return 0;

    const { top, height } = this.#gallery.getBoundingClientRect();
    const stripHeight = this.offsetHeight;

    return clamp(event.clientY - top - stripHeight / 2, 0, Math.max(0, height - stripHeight));
  }

  /** @param {PointerEvent} event */
  #onEnter = (event) => {
    // Snap to the entry point rather than sliding in from wherever the
    // strip was left — otherwise it swoops across the card on every hover.
    this.#targetY = this.#resolveY(event);
    this.#currentY = this.#targetY;
    this.#render();
  };

  /** @param {PointerEvent} event */
  #onMove = (event) => {
    this.#targetY = this.#resolveY(event);

    if (this.#frame) return;
    this.#lastTime = performance.now();
    this.#frame = requestAnimationFrame(this.#tick);
  };

  #onLeave = () => {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  };

  /** @param {number} now */
  #tick = (now) => {
    const delta = this.#targetY - this.#currentY;

    if (Math.abs(delta) < SETTLE) {
      this.#currentY = this.#targetY;
      this.#render();
      this.#frame = 0;
      return;
    }

    // Frame-rate independent lerp: covering EASE of the gap every 16.7ms
    // means covering this much over however long the frame actually took.
    const elapsed = now - this.#lastTime;
    this.#lastTime = now;
    const factor = 1 - Math.pow(1 - EASE, elapsed / BASE_FRAME_MS);

    this.#currentY += delta * factor;
    this.#render();

    this.#frame = requestAnimationFrame(this.#tick);
  };

  #render() {
    this.style.transform = `translate3d(0, ${this.#currentY}px, 0)`;
  }
}

if (!customElements.get('product-card-meta')) {
  customElements.define('product-card-meta', ProductCardMeta);
}
