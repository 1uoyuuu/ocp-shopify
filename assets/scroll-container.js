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
/**
 * Whether this document arrived by reloading rather than by navigating.
 *
 * A refresh starts the page over: the hero plays its intro, the sections run
 * their own reveals, and landing halfway down means arriving in the middle of
 * animations that are meant to be met from the top. Back and forward are the
 * opposite case — the reader is returning to somewhere they had already got
 * to — so only the reload is sent to the top.
 *
 * `performance.navigation.type` is the old spelling of this and is
 * deprecated; the navigation timing entry is the current one.
 */
const RELOADED = performance.getEntriesByType('navigation')[0]?.type === 'reload';

if (SQUEEZE_QUERY.matches || RELOADED) {
  history.scrollRestoration = 'manual';
}

SQUEEZE_QUERY.addEventListener('change', () => {
  history.scrollRestoration = SQUEEZE_QUERY.matches || RELOADED ? 'manual' : 'auto';
});

/**
 * Drops the position saved on this history entry, so nothing downstream can
 * act on it. hero-scroll.js reads the same key to decide whether to lock the
 * page for its intro — clearing it here rather than teaching each reader
 * about reloads keeps that decision in one place.
 */
if (RELOADED) {
  try {
    const state = typeof history.state === 'object' && history.state !== null ? { ...history.state } : {};
    delete state.scrollTop;
    history.replaceState(state, '');
  } catch (_) {
    // replaceState can throw if the state object exceeds the browser's size limit
  }
}

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

window.addEventListener('pageshow', (event) => {
  // `persisted` is a bfcache restore — the same document coming back through
  // history. The navigation entry still describes how that document was first
  // loaded, so a page that was once reloaded would otherwise be thrown to the
  // top every time the reader pressed Back into it.
  if (RELOADED && !event.persisted) {
    // Native restoration is left on below 990px, and turning it off is a
    // request the browser honours around load rather than a guarantee. Saying
    // where to be is cheap and settles it.
    getScrollContainer().scrollTo({ top: 0, behavior: 'instant' });
    return;
  }

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

/**
 * The largest the viewport gets, in pixels — `100lvh`, resolved.
 *
 * Every full-screen frame on this site is sized in `lvh` so it always covers
 * (see CLAUDE.md), but the scroll-driven sections were measuring their
 * progress against `window.innerHeight`, which is the *current* height. On a
 * phone those are different numbers, and the difference appears and vanishes
 * as the address bar hides — mid-scroll, by about ninety pixels. Progress
 * computed against a height that changes while you scroll lurches every time
 * it changes.
 *
 * Measured rather than parsed: a custom property's computed value is its token
 * stream, and there is no other way to ask what `lvh` currently means. Cached,
 * because it only changes when the window really resizes — a bar retracting is
 * not that, which is the whole point.
 */
let viewportHeight = 0;

function measureViewportHeight() {
  const probe = document.createElement('div');

  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100lvh;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();

  return height > 0 ? height : window.innerHeight;
}

/** @returns {number} */
function getViewportHeight() {
  if (!viewportHeight) viewportHeight = measureViewportHeight();
  return viewportHeight;
}

/*
 * Dropped on any resize and measured again on next use.
 *
 * No attempt is made to tell a real resize from an address bar retracting,
 * because none is needed: `lvh` is the viewport with all retractable browser
 * UI already discounted, so it does not change when that UI comes and goes.
 * Re-measuring during a bar transition returns the same number it had.
 * Guessing instead — ignoring height changes below some threshold — would
 * have left a desktop window dragged slightly shorter measuring the old
 * height until something bigger happened.
 */
window.addEventListener(
  'resize',
  () => {
    viewportHeight = 0;
  },
  { passive: true }
);

export {
  getScrollContainer,
  getScrollTop,
  scrollTo,
  getScrollEventTarget,
  getIntersectionRoot,
  getViewportHeight,
  SQUEEZE_QUERY as scrollContainerMediaQuery,
};
