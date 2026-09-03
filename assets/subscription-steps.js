/**
 * The subscription builder: pick one option per step, and the summary line
 * assembles what you've chosen.
 *
 * Selection state lives in `aria-pressed` rather than a class, so the
 * buttons announce themselves correctly and the styling has a single source
 * of truth. The server marks the first option of each step as pressed, so
 * without this module the section still reads as a worked example — the
 * summary line is the only part that needs JS, and CSS hides it until this
 * element is defined.
 */
class SubscriptionSteps extends HTMLElement {
  connectedCallback() {
    this.summary = this.querySelector('[ref="summary"]');

    this.addEventListener('click', this.#onClick);
    this.#renderSummary();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#onClick);
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
}

if (!customElements.get('subscription-steps')) {
  customElements.define('subscription-steps', SubscriptionSteps);
}
