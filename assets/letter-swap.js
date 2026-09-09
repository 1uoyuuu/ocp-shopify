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
  '.footer-column__link',
  '.ocp-footer__link',
  // Whatever the credit's rich text makes a link, so the studio's name behaves
  // like every other link down here rather than being the one that doesn't.
  '.ocp-footer__credit a',
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
  if (!(element instanceof HTMLElement)) return;

  // Done already — unless something has since rebuilt the inside of it, which
  // is exactly what the header does to itself. Checking for the words rather
  // than trusting the flag is what lets this heal.
  if (element.dataset.letterSwap !== undefined && element.querySelector('.swap-word')) return;

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
   * The markup this touches does not stay put. The header hydrates itself
   * after load — it re-renders through the Section Rendering API on idle —
   * and re-renders again on every cart change, and morph puts the server's
   * plain text back where the split words were.
   *
   * Watching only for added *elements* missed all of that, because what
   * morph puts back is a text node. So any change to the document schedules
   * a fresh pass instead, coalesced into one frame: the pass is a handful of
   * selectors, and everything already done bails immediately.
   */
  let queued = false;
  const rescan = () => {
    if (queued) return;
    queued = true;

    // A timeout rather than a frame. requestAnimationFrame does not run in a
    // hidden tab, and since the flag is only cleared inside the callback,
    // one starved frame would leave it raised and every later change
    // ignored — the same latch that once froze the scroll sections.
    setTimeout(() => {
      queued = false;
      scan();
    }, 0);
  };

  new MutationObserver(rescan).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // A closed <details> does not render its contents, and the menu panel is
  // one. Nothing about that should stop the split — it is DOM work, not
  // layout — but scanning again when one opens costs a single query and
  // removes the question.
  document.addEventListener('toggle', scan, { capture: true });
}
