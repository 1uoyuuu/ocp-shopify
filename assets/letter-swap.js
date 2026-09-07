/**
 * The site's one hover: a link's words slide up out of the way while copies
 * of themselves arrive from below.
 *
 * Only text nodes that are direct children of a target are split. Element
 * children are left exactly as they were, which is what makes this safe to
 * point at the cart: its live count is written into markup of its own by
 * cart-icon.js, and rebuilding that markup would break the refs that script
 * holds. The same rule protects icons and anything else nested.
 *
 * Nothing here decides how the swap looks; the stylesheet is written against
 * the classes below.
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
  '.statement__cta',
  '.subscription__cta',
].join(', ');

/** @param {string} word */
function buildWord(word) {
  const box = document.createElement('span');
  box.className = 'swap-word';

  const inner = document.createElement('span');
  inner.className = 'swap-word__inner';

  const face = document.createElement('span');
  face.className = 'swap-word__face';
  face.textContent = word;

  const ghost = document.createElement('span');
  ghost.className = 'swap-word__face swap-word__face--ghost';
  ghost.textContent = word;
  // The copy is decoration; without this every word is read twice.
  ghost.setAttribute('aria-hidden', 'true');

  inner.append(face, ghost);
  box.append(inner);
  return box;
}

/** @param {Text} node */
function splitTextNode(node) {
  const fragment = document.createDocumentFragment();

  // Split on whitespace but keep it: the gaps go back in as plain text, so a
  // line can still break between words — which boxing them would otherwise
  // prevent.
  for (const part of node.textContent?.split(/(\s+)/) ?? []) {
    if (!part) continue;
    fragment.append(/^\s+$/.test(part) ? part : buildWord(part));
  }

  node.replaceWith(fragment);
}

/** @param {Element} element */
function prepare(element) {
  if (!(element instanceof HTMLElement) || element.dataset.letterSwap !== undefined) return;

  const texts = /** @type {Text[]} */ (
    [...element.childNodes].filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
    )
  );
  if (!texts.length) return;

  const label = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  for (const node of texts) splitTextNode(node);
  element.dataset.letterSwap = '';

  // The hover belongs to whatever you actually click, not to the text inside
  // it — otherwise the swap misses while the cursor is over the link's own
  // padding. `summary` is in the list because the menu trigger is one, and
  // without it the MENU label would only answer a cursor directly on the
  // word. Focus gets the same treatment, for anyone using a keyboard.
  const host = /** @type {HTMLElement} */ (
    element.closest('a, button, summary, [role="link"], [role="button"]') ?? element
  );
  host.dataset.swapHost = '';

  // The copies are hidden from assistive technology one by one, which is
  // enough for the accessible name — but it leaves textContent reading every
  // word twice, and anything reading the DOM rather than the accessibility
  // tree will see that. Naming the host outright settles it, where it does
  // not already carry a name of its own: the cart brings one.
  if (!host.hasAttribute('aria-label') && !host.hasAttribute('aria-labelledby')) {
    host.setAttribute('aria-label', label);
  }
}

function scan() {
  for (const element of document.querySelectorAll(TARGETS)) prepare(element);
}

// A hover that takes a link apart is exactly what reduced motion asks us not
// to do, and leaving the markup alone is the whole of the fallback.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  scan();
  document.addEventListener('DOMContentLoaded', scan);

  /*
   * Links arrive after this script has run, and the header is the worst of
   * it: adding to the cart re-renders that section, and morph rebuilds its
   * markup from the server's HTML — taking the split words with it. Watching
   * the document is what makes the effect survive that, and a drawer or a
   * filtered list rendering for the first time.
   */
  const watcher = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches(TARGETS)) prepare(node);
        for (const found of node.querySelectorAll(TARGETS)) prepare(found);
      }
    }
  });

  watcher.observe(document.documentElement, { childList: true, subtree: true });
}
