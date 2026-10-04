/**
 * The benefit cards as an accordion on a phone.
 *
 * At desktop widths the cards are a hover grid and none of this applies. Below
 * 750px each card becomes a closed row that opens on tap, one at a time. The
 * button semantics are added only while that is true and taken away again
 * above it, so a card is never announced as something it cannot do.
 *
 * Styling keys off `[role='button']` and `[data-open]`, so with no script the
 * cards simply stay as the always-open stacked rows.
 */

const PHONE = matchMedia('(max-width: 749px)');

/** @returns {HTMLElement[]} */
const cards = () => [...document.querySelectorAll('.subscription-card')].filter((c) => c instanceof HTMLElement);

/** @param {HTMLElement} card @param {boolean} open */
function setOpen(card, open) {
  if (open) card.setAttribute('data-open', '');
  else card.removeAttribute('data-open');
  card.setAttribute('aria-expanded', String(open));
}

function sync() {
  for (const card of cards()) {
    if (PHONE.matches) {
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      if (!card.hasAttribute('aria-expanded')) card.setAttribute('aria-expanded', 'false');
    } else {
      card.removeAttribute('role');
      card.removeAttribute('tabindex');
      card.removeAttribute('aria-expanded');
      card.removeAttribute('data-open');
    }
  }
}

/** @param {HTMLElement} card */
function toggle(card) {
  const opening = !card.hasAttribute('data-open');
  const list = card.closest('.subscription-panel__list');

  // One open at a time, as the FAQ below does.
  if (opening && list) {
    for (const other of list.querySelectorAll('.subscription-card[data-open]')) {
      if (other instanceof HTMLElement && other !== card) setOpen(other, false);
    }
  }

  setOpen(card, opening);
}

document.addEventListener('click', (event) => {
  if (!PHONE.matches || !(event.target instanceof Element)) return;
  const card = event.target.closest('.subscription-card');
  if (card instanceof HTMLElement) toggle(card);
});

document.addEventListener('keydown', (event) => {
  if (!PHONE.matches || (event.key !== 'Enter' && event.key !== ' ')) return;
  if (!(event.target instanceof HTMLElement) || !event.target.matches('.subscription-card')) return;
  event.preventDefault();
  toggle(event.target);
});

PHONE.addEventListener('change', sync);
// The editor swaps a section's markup in without reloading the page.
document.addEventListener('shopify:section:load', sync);
sync();
