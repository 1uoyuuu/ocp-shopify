const PAGE_WRAPPER_SELECTOR = '.page-wrapper';
const SQUEEZE_QUERY = window.matchMedia('(min-width: 990px)');

/**
 * Returns the current page scroll container.
 * In the squeeze layout (desktop ≥990px), `.page-wrapper` is the scroll container instead of
 * `document.scrollingElement`. On mobile, the document root scrolls natively so the address bar
 * can hide/show.
 *
 * @returns {Element} The scroll container element
 */
function getScrollContainer() {
  if (SQUEEZE_QUERY.matches) {
    return document.querySelector(PAGE_WRAPPER_SELECTOR) ?? document.scrollingElement ?? document.documentElement;
  }
  return document.scrollingElement ?? document.documentElement;
}

/**
 * Returns the current scroll position of the page scroll container.
 *
 * @returns {number} The scrollTop value
 */
function getScrollTop() {
  return getScrollContainer().scrollTop;
}

/**
 * Scrolls the page scroll container to the specified position.
 *
 * @param {ScrollToOptions} options - The scroll options (top, left, behavior)
 */
function scrollTo(options) {
  getScrollContainer().scrollTo(options);
}

/**
 * Manual scroll restoration for `.page-wrapper` as scroll container.
 *
 * On desktop (≥990px), the browser restores scroll on `document.scrollingElement`, which
 * has `overflow: hidden` in the squeeze layout and can never scroll. We disable native
 * restoration and handle it via `history.state` instead.
 *
 * On mobile (<990px), `document.scrollingElement` IS the scroll container, so native
 * restoration works perfectly — leave it enabled to avoid a one-frame flash from rAF.
 *
 * Save: `pagehide` — fires exactly once per navigation, captures the exact scroll position
 * at the moment the user leaves. More accurate than debounced scroll (which can be stale
 * if the user scrolls and immediately clicks a link).
 *
 * Restore: unconditional `pageshow` — Horizon uses cross-document view transitions, so
 * `pageshow` fires on every navigation (both bfcache and fresh loads). `popstate` is not
 * used because it doesn't fire for cross-document back navigation.
 */
if (SQUEEZE_QUERY.matches) {
  history.scrollRestoration = 'manual';
}

SQUEEZE_QUERY.addEventListener('change', () => {
  history.scrollRestoration = SQUEEZE_QUERY.matches ? 'manual' : 'auto';
});

/**
 * Saves the current scroll position into the current history entry.
 */
function saveScrollPosition() {
  try {
    const currentState = typeof history.state === 'object' && history.state !== null ? history.state : {};
    history.replaceState({ ...currentState, scrollTop: getScrollContainer().scrollTop }, '');
  } catch (_) {
    // replaceState can throw if the state object exceeds the browser's size limit
  }
}

window.addEventListener('pagehide', saveScrollPosition);

/**
 * How long to keep waiting for the page to reach the height it had.
 *
 * Sections here measure themselves — the statement's height is its text plus
 * however far its products have to travel, which is not known until the cards
 * have laid out — so on a fresh load the document grows for a moment after
 * everything has run.
 */
const RESTORE_WINDOW_MS = 1200;

/** How often to look again while waiting. Short enough not to be seen. */
const RESTORE_RETRY_MS = 50;

/**
 * Restores a saved scroll position onto the current scroll container.
 *
 * Refuses rather than clamps. `Math.min(saved, max)` looks harmless and is
 * not: while the document is still growing the saved position is beyond its
 * end, and clamping lands on the last pixel of the page — which is how a
 * refresh from halfway down arrived in the footer. Waiting for the height is
 * the answer, and the top is a better wrong answer than the bottom.
 *
 * @param {number} savedScrollTop
 * @param {number} [deadline] Retry until this timestamp while the page is short.
 */
function restoreSavedScrollTop(savedScrollTop, deadline = 0) {
  if (!Number.isFinite(savedScrollTop) || savedScrollTop < 0) return;

  const container = getScrollContainer();
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);

  if (savedScrollTop > maxScrollTop) {
    // Only while nobody has moved yet: a reader who has started scrolling has
    // said where they want to be more recently than the last page did.
    if (deadline && performance.now() < deadline && container.scrollTop === 0) {
      // A timer, not a frame: requestAnimationFrame does not run in a hidden
      // tab, and a restore that quietly never happens is the same bug in a
      // different coat.
      setTimeout(() => restoreSavedScrollTop(savedScrollTop, deadline), RESTORE_RETRY_MS);
    }
    return;
  }

  // Use scrollTo with 'instant' to override CSS scroll-behavior: smooth on .page-wrapper
  container.scrollTo({ top: savedScrollTop, behavior: 'instant' });
}

window.addEventListener('pageshow', () => {
  const scrollTop = history.state?.scrollTop;
  if (scrollTop == null) return;

  requestAnimationFrame(() => {
    restoreSavedScrollTop(scrollTop, performance.now() + RESTORE_WINDOW_MS);
  });
});

/**
 * Same-document scroll restoration for pushState navigation.
 *
 * `pagehide`/`pageshow` only fire for cross-document navigations. For same-document
 * pushState navigation (filters, pagination), we patch pushState to auto-save scroll
 * position before each new entry, and restore on popstate (back/forward).
 */
const originalPushState = history.pushState.bind(history);
history.pushState = function (state, title, url) {
  saveScrollPosition();
  originalPushState(state, title, url);
};

window.addEventListener('popstate', () => {
  const scrollTop = history.state?.scrollTop;
  if (scrollTop == null) return;

  requestAnimationFrame(() => {
    restoreSavedScrollTop(scrollTop);
  });
});

/**
 * Returns the appropriate target for listening to scroll events.
 * On desktop (≥990px), `.page-wrapper` emits scroll events directly.
 * On mobile, the document root scrolls natively and scroll events bubble to `document`.
 *
 * @returns {EventTarget} The target to call addEventListener('scroll', ...) on
 */
function getScrollEventTarget() {
  if (SQUEEZE_QUERY.matches) {
    return document.querySelector(PAGE_WRAPPER_SELECTOR) ?? document;
  }
  return document;
}

/**
 * Returns the appropriate root for an IntersectionObserver monitoring the scroll container.
 * On desktop (≥990px), `.page-wrapper` must be set as the explicit root.
 * On mobile, `null` uses the viewport root (the IntersectionObserver default).
 *
 * @returns {Element | null} The root option for IntersectionObserver
 */
function getIntersectionRoot() {
  if (SQUEEZE_QUERY.matches) {
    return document.querySelector(PAGE_WRAPPER_SELECTOR) ?? null;
  }
  return null;
}

export {
  getScrollContainer,
  getScrollTop,
  scrollTo,
  getScrollEventTarget,
  getIntersectionRoot,
  SQUEEZE_QUERY as scrollContainerMediaQuery,
};
