/**
 * The subscription section's two behaviours: the optional step picker, and
 * the cursor parallax on the scattered cards behind the copy.
 *
 * Both are enhancements. The server marks the first option of each step as
 * pressed and the cards carry their resting position in CSS, so with this
 * module absent the section still reads correctly — only the summary line
 * needs JS, and CSS hides that until the element is defined.
 */

/** Pixels a card at full depth travels when the cursor reaches the edge. */
const PARALLAX_TRAVEL = 42;

/** Fraction of the remaining distance closed per 60fps frame — the drift
 * trails the cursor rather than tracking it, which is what reads as depth
 * rather than as the whole layout being dragged about. */
const EASE = 0.06;

/** Frame duration the EASE constant is expressed against. */
const BASE_FRAME_MS = 1000 / 60;

class SubscriptionSteps extends HTMLElement {
  /** @type {HTMLElement[]} */
  #cards = [];
  #frame = 0;
  #lastTime = 0;
  #targetX = 0;
  #targetY = 0;
  #currentX = 0;
  #currentY = 0;

  connectedCallback() {
    this.summary = this.querySelector('[ref="summary"]');
    this.#cards = /** @type {HTMLElement[]} */ ([...this.querySelectorAll('[data-card]')]);

    this.addEventListener('click', this.#onClick);
    this.#renderSummary();

    // A cursor is the only thing that can drive this, and a drifting
    // background is exactly what reduced motion asks us not to do.
    const canDrift =
      this.#cards.length > 0 &&
      matchMedia('(hover: hover) and (pointer: fine)').matches &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (canDrift) {
      this.addEventListener('pointermove', this.#onPointerMove);
      this.addEventListener('pointerleave', this.#onPointerLeave);
    }
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#onClick);
    this.removeEventListener('pointermove', this.#onPointerMove);
    this.removeEventListener('pointerleave', this.#onPointerLeave);

    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    if (!(event.target instanceof Element)) return;

    const option = event.target.closest('[data-option]');
    if (!option || !this.contains(option)) return;

    const step = option.closest('[data-step]');
    if (!step) return;

    // One choice per step, so pressing one releases the rest of its row.
    for (const sibling of step.querySelectorAll('[data-option]')) {
      sibling.setAttribute('aria-pressed', String(sibling === option));
    }

    this.#renderSummary();
  };

  #renderSummary() {
    if (!this.summary) return;

    const chosen = [...this.querySelectorAll('[data-step]')]
      .map((step) => step.querySelector('[data-option][aria-pressed="true"]'))
      .filter((option) => option instanceof HTMLElement)
      .map((option) => /** @type {HTMLElement} */ (option).dataset.label)
      .filter(Boolean);

    this.summary.textContent = chosen.join(' · ');
  }

  /** @param {PointerEvent} event */
  #onPointerMove = (event) => {
    const { left, top, width, height } = this.getBoundingClientRect();
    if (!width || !height) return;

    // -0.5 at one edge, +0.5 at the other, so a card's travel is symmetric
    // about the centre whatever the section's proportions.
    this.#targetX = (event.clientX - left) / width - 0.5;
    this.#targetY = (event.clientY - top) / height - 0.5;

    this.#start();
  };

  #onPointerLeave = () => {
    // Settle back rather than snapping — the same easing carries it home.
    this.#targetX = 0;
    this.#targetY = 0;
    this.#start();
  };

  #start() {
    if (this.#frame) return;
    this.#lastTime = performance.now();
    this.#frame = requestAnimationFrame(this.#tick);
  }

  /** @param {number} now */
  #tick = (now) => {
    const deltaX = this.#targetX - this.#currentX;
    const deltaY = this.#targetY - this.#currentY;

    // Frame-rate independent: closing EASE of the gap every 16.7ms means
    // closing this much over however long the frame actually took.
    const elapsed = now - this.#lastTime;
    this.#lastTime = now;
    const factor = 1 - Math.pow(1 - EASE, elapsed / BASE_FRAME_MS);

    this.#currentX += deltaX * factor;
    this.#currentY += deltaY * factor;

    for (const card of this.#cards) {
      const depth = Number(card.dataset.depth ?? 0);
      if (!depth) continue;

      // Against the cursor, so the scene reads as being looked around
      // rather than pushed.
      const shift = (depth / 10) * PARALLAX_TRAVEL;
      card.style.setProperty('--card-shift-x', `${-this.#currentX * shift}px`);
      card.style.setProperty('--card-shift-y', `${-this.#currentY * shift}px`);
    }

    // Below a twentieth of a pixel of travel there is nothing left to see.
    if (Math.abs(deltaX) < 0.0005 && Math.abs(deltaY) < 0.0005) {
      this.#frame = 0;
      return;
    }

    this.#frame = requestAnimationFrame(this.#tick);
  };
}

if (!customElements.get('subscription-steps')) {
  customElements.define('subscription-steps', SubscriptionSteps);
}
