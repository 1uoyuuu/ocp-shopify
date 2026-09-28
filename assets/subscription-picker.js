/**
 * The subscription drawer: opens and closes it, works out which variant the
 * chosen options point at, and keeps the price and the button in step.
 *
 * Only the product's own options go through here. Grind, bag count and
 * frequency are plain named radios inside the form — `properties[Grind]`,
 * `quantity`, `selling_plan` — so they submit themselves and this file only
 * has to read them for the price. The option radios are deliberately not
 * submitted (their `form` attribute names a form that does not exist); the
 * cart takes a variant id, and the id is what this file writes.
 */
class SubscriptionPicker extends HTMLElement {
  /** @type {{id: number, options: string[], available: boolean, price: number, plans: Record<string, number>}[]} */
  #variants = [];
  #currency = 'USD';
  #locale = 'en';

  connectedCallback() {
    const data = this.querySelector('[data-sub-data]');
    if (!data) return;

    const parsed = JSON.parse(data.textContent || '{}');
    this.#variants = parsed.variants || [];
    this.#currency = parsed.currency || 'USD';
    this.#locale = parsed.locale || 'en';

    this.addEventListener('click', this.#onClick);
    this.addEventListener('change', this.#update);
    this.#update();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#onClick);
    this.removeEventListener('change', this.#update);
  }

  get #dialog() {
    return /** @type {HTMLDialogElement | null} */ (this.querySelector('dialog'));
  }

  /** @param {Event} event */
  #onClick = (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const dialog = this.#dialog;
    if (!dialog) return;

    if (target.closest('[data-sub-open]')) {
      if (!dialog.open) dialog.showModal();
    } else if (target.closest('[data-sub-close]') || target === dialog) {
      // A click on the dialog itself, rather than anything inside it, can
      // only be the backdrop.
      dialog.close();
    }
  };

  #update = () => {
    const form = this.querySelector('[data-sub-form]');
    if (!form) return;

    const chosen = [...form.querySelectorAll('input[data-option-index]:checked')]
      .map((input) => /** @type {HTMLInputElement} */ (input))
      .sort((a, b) => Number(a.dataset.optionIndex) - Number(b.dataset.optionIndex))
      .map((input) => input.value);

    const variant = this.#variants.find((candidate) =>
      candidate.options.every((value, index) => value === chosen[index])
    );

    const idInput = /** @type {HTMLInputElement | null} */ (form.querySelector('[data-sub-variant-id]'));
    if (idInput && variant) idInput.value = String(variant.id);

    const plan = /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="selling_plan"]:checked'));
    const quantity = /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="quantity"]:checked'));
    const count = Number(quantity?.value || 1);

    const price = this.querySelector('[data-sub-price]');
    if (price) {
      if (variant) {
        const unit = plan && variant.plans[plan.value] != null ? variant.plans[plan.value] : variant.price;
        price.textContent = new Intl.NumberFormat(this.#locale, {
          style: 'currency',
          currency: this.#currency,
        }).format((unit * count) / 100);
      } else {
        price.textContent = '';
      }
    }

    const submit = /** @type {HTMLButtonElement | null} */ (this.querySelector('[data-sub-submit]'));
    if (submit) {
      const ready = Boolean(variant && variant.available);
      submit.disabled = !ready;
      submit.textContent = !variant
        ? submit.dataset.labelUnavailable || ''
        : variant.available
          ? submit.dataset.labelAdd || ''
          : submit.dataset.labelSoldOut || '';
    }
  };
}

if (!customElements.get('subscription-picker')) {
  customElements.define('subscription-picker', SubscriptionPicker);
}
