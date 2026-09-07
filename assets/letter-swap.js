/**
 * The site's one hover: every letter of a link slides up out of the way while
 * a copy of itself arrives from below, a beat behind its neighbour.
 *
 * Only text nodes that are direct children of a target are split. Element
 * children are left exactly as they were, which is what makes this safe to
 * point at the cart: its live count is written into markup of its own by
 * cart-icon.js, and rebuilding that markup would break the refs that script
 * holds. The same rule protects icons and anything else nested.
 *
 * Words are kept whole and only their letters are boxed, so lines still break
 * where they would have. Nothing here decides how the swap looks; the
 * stylesheet is written against the classes and the index on each letter.
 */

/**
 * Everything on the site that is a piece of clickable text. Product cards are
 * deliberately absent: a card already answers the cursor by taking on the
 * colour of the bag on it, and two hovers on one target read as a fault
 * rather than as emphasis.
 */
const TARGETS = [
  '.header-drawer__label',
  '.header-actions__cart-label',
  '.menu-drawer__menu-item-text',
  '.menu-drawer__social-link',
  '.ocp-footer__link',
  '.subscription__cta',
].join(', ');

/** Letters past this many in one target stop staggering, so a long link does
 * not finish its ripple noticeably after a short one. */
const STAGGER_CAP = 12;

/** @param {Text} node @param {{ index: number }} counter */
function splitTextNode(node, counter) {
  const fragment = document.createDocumentFragment();

  // Split on whitespace but keep it: the gaps go back in as plain text, so the
  // browser can still break a line between words and only between words.
  for (const part of node.textContent?.split(/(\s+)/) ?? []) {
    if (!part) continue;

    if (/^\s+$/.test(part)) {
      fragment.append(part);
      continue;
    }

    const word = document.createElement('span');
    word.className = 'swap-word';

    // Spread rather than split('') so a character made of two code units is
    // one letter rather than two halves of one.
    for (const character of [...part]) {
      const box = document.createElement('span');
      box.className = 'swap-char';
      box.style.setProperty('--swap-i', `${Math.min(counter.index++, STAGGER_CAP)}`);

      const inner = document.createElement('span');
      inner.className = 'swap-char__inner';

      const face = document.createElement('span');
      face.className = 'swap-char__face';
      face.textContent = character;

      const ghost = document.createElement('span');
      ghost.className = 'swap-char__face swap-char__face--ghost';
      ghost.textContent = character;
      // The copy is decoration; without this every word is read twice.
      ghost.setAttribute('aria-hidden', 'true');

      inner.append(face, ghost);
      box.append(inner);
      word.append(box);
    }

    fragment.append(word);
  }

  node.replaceWith(fragment);
}

/** @param {Element} element */
function prepare(element) {
  if (!(element instanceof HTMLElement) || element.dataset.letterSwap !== undefined) return;

  const texts = /** @type {Text[]} */ (
    [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
  );
  if (!texts.length) return;

  const label = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  const counter = { index: 0 };
  for (const node of texts) splitTextNode(node, counter);

  element.dataset.letterSwap = '';

  // The hover belongs to whatever you actually click, not to the text inside
  // it — otherwise the swap misses while the cursor is over the link's own
  // padding. Focus is given the same treatment for anyone using a keyboard.
  const host = /** @type {HTMLElement} */ (
    element.closest('a, button, [role="link"], [role="button"]') ?? element
  );
  host.dataset.swapHost = '';

  // The copies are hidden from assistive technology one by one, which is
  // enough for the accessible name — but it leaves textContent reading every
  // letter twice, and anything that reads the DOM rather than the
  // accessibility tree will see that. Naming the host outright settles it.
  // Only where there is no name already: the cart link brings its own.
  if (!host.hasAttribute('aria-label') && !host.hasAttribute('aria-labelledby')) {
    host.setAttribute('aria-label', label);
  }
}

function scan() {
  for (const element of document.querySelectorAll(TARGETS)) prepare(element);
}

// A hover that takes the letters apart is exactly what reduced motion asks us
// not to do, and leaving the markup alone is the whole of the fallback.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  scan();

  // Sections re-render on editor edits, filtering and pagination, and morph
  // leaves new links behind that were never split.
  document.addEventListener('DOMContentLoaded', scan);
  document.addEventListener('shopify:section:load', scan);
}
