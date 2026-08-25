import { Component } from '@theme/component';
import { trapFocus, removeTrapFocus } from '@theme/focus';
import { onAnimationEnd, removeWillChangeOnAnimationEnd } from '@theme/utilities';

/**
 * The panel's slide is driven here rather than by a CSS transition. A closed
 * <details> doesn't render its contents, so on the first open there is no
 * previous style for a transition to start from and the panel simply
 * appears. Animating explicitly also lets the close finish before `open` is
 * removed, which is what makes the upward slide visible at all.
 */
const PANEL_DURATION = 600;
const PANEL_CLOSE_DURATION = 520;

/** Leaves quickly and lands soft. */
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** The mirror of it: eases in, then leaves fast. */
const EASE_IN = 'cubic-bezier(0.7, 0, 0.84, 0)';

/** Per-line reveal, and the gap between consecutive lines starting. */
const ITEM_DURATION = 760;
const ITEM_STAGGER = 90;

/** How long after the panel starts moving the first line begins. */
const ITEM_LEAD_IN = 200;

/**
 * The lines that wipe up as the panel arrives, in the order they do it.
 * Link *text* is animated rather than the link itself so the link can clip
 * it — that's what makes a line rise out of nothing instead of drifting in.
 */
const REVEAL_SELECTOR = [
  '.menu-drawer__menu-item--mainlist .menu-drawer__menu-item-text',
  '.menu-drawer__brand',
  '.menu-drawer__utility-links',
].join(', ');

/**
 * A custom element that manages the main menu drawer.
 *
 * @typedef {object} Refs
 * @property {HTMLDetailsElement} details - The details element.
 * @property {HTMLDivElement} menuDrawer - The slideable drawer panel containing the menu.
 *
 * @extends {Component<Refs>}
 */
class HeaderDrawer extends Component {
  requiredRefs = ['details', 'menuDrawer'];

  /** @type {Animation[]} Everything currently in flight, so an interrupted
   * open can be cancelled rather than left fighting the close. */
  #motion = [];

  /** Bumped on every open and close. A close that finishes after a newer
   * open has started is stale, and must not run its teardown — stripping
   * `open` out from under the panel that just reopened is what made a
   * quick MENU → CLOSE → MENU leave the menu apparently dead. */
  #sequence = 0;

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener('keyup', this.#onKeyUp);
    this.#setupAnimatedElementListeners();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keyup', this.#onKeyUp);
  }

  /**
   * Close the main menu drawer when the Escape key is pressed
   * @param {KeyboardEvent} event
   */
  #onKeyUp = (event) => {
    if (event.key !== 'Escape') return;

    this.#close(this.#getDetailsElement(event));
  };

  /**
   * @returns {boolean} Whether the main menu drawer is open
   */
  get isOpen() {
    return this.refs.details.hasAttribute('open');
  }

  /**
   * Get the closest details element to the event target
   * @param {Event | undefined} event
   * @returns {HTMLDetailsElement}
   */
  #getDetailsElement(event) {
    if (!(event?.target instanceof Element)) return this.refs.details;

    return event.target.closest('details') ?? this.refs.details;
  }

  /**
   * Toggle the main menu drawer
   * @param {Event} [event]
   */
  toggle(event) {
    // The summary's own toggle has to be cancelled, not merely worked
    // around. Left alone it strips `open` the instant a close begins, which
    // unmounts the panel before it can slide away, and on a fast second
    // click it flips the attribute out of step with the animation — the
    // menu then looks like it ignored the click entirely.
    event?.preventDefault();

    return this.isOpen ? this.close() : this.open();
  }

  /**
   * Whether we should drive this element's motion ourselves. Submenus keep
   * the stock CSS animations, and reduced-motion users get neither.
   * @param {Element | null} element
   * @returns {boolean}
   */
  #ownsMotion(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (!element.classList.contains('menu-drawer')) return false;
    if (typeof element.animate !== 'function') return false;

    return !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  #cancelMotion() {
    for (const animation of this.#motion) animation.cancel();
    this.#motion = [];
  }

  /**
   * Slide the panel down and wipe the lines up behind it.
   * @param {HTMLElement} drawer
   * @returns {Animation} The panel's own animation.
   */
  #animateOpen(drawer) {
    this.#cancelMotion();

    const panel = drawer.animate(
      { transform: ['translateY(-100%)', 'translateY(0)'] },
      // `backwards` holds the off-screen start through any delay but hands
      // back to CSS on finish, so nothing is left pinned by a filled
      // animation once the panel has arrived.
      { duration: PANEL_DURATION, easing: EASE_OUT, fill: 'backwards' }
    );

    const lines = [...drawer.querySelectorAll(REVEAL_SELECTOR)].map((line, index) =>
      line.animate(
        { transform: ['translateY(115%)', 'translateY(0)'], opacity: [0, 1] },
        {
          duration: ITEM_DURATION,
          delay: ITEM_LEAD_IN + index * ITEM_STAGGER,
          easing: EASE_OUT,
          fill: 'backwards',
        }
      )
    );

    this.#motion = [panel, ...lines];

    return panel;
  }

  /**
   * Slide the panel back up. The caller must not tear down `open` until the
   * returned promise settles, or the panel is hidden before it can move.
   * @param {HTMLElement} drawer
   * @returns {Promise<void>}
   */
  #animateClose(drawer) {
    this.#cancelMotion();

    // `menu-open` is already gone, so CSS has the panel parked off-screen
    // and hidden. Hold it painted for the length of the slide.
    drawer.style.visibility = 'visible';

    const panel = drawer.animate(
      { transform: ['translateY(0)', 'translateY(-100%)'] },
      { duration: PANEL_CLOSE_DURATION, easing: EASE_IN, fill: 'backwards' }
    );

    this.#motion = [panel];

    return panel.finished
      .catch(() => {})
      .then(() => {
        drawer.style.visibility = '';
      });
  }

  /**
   * Open the closest drawer or the main menu drawer
   * @param {string} [target]
   * @param {Event} [event]
   */
  open(target, event) {
    const details = this.#getDetailsElement(event);
    const summary = details.querySelector('summary');

    if (!summary) return;

    // Same reason as in toggle() — and because the default is cancelled on
    // every path into here, `open` is ours to set rather than the browser's.
    event?.preventDefault();
    this.#sequence++;
    details.open = true;

    summary.setAttribute('aria-expanded', 'true');

    this.preventInitialAccordionAnimations(details);
    requestAnimationFrame(() => {
      details.classList.add('menu-open');

      if (target) {
        this.refs.menuDrawer.classList.add('menu-drawer--has-submenu-opened');
      }

      // Wait for the drawer animation to complete before trapping focus
      const drawer = details.querySelector('.menu-drawer, .menu-drawer__submenu');

      if (this.#ownsMotion(drawer)) {
        this.#animateOpen(/** @type {HTMLElement} */ (drawer))
          .finished.catch(() => {})
          .then(() => trapFocus(details));
      } else {
        onAnimationEnd(drawer || details, () => trapFocus(details), { subtree: false });
      }
    });
  }

  /**
   * Go back or close the main menu drawer
   * @param {Event} [event]
   */
  back(event) {
    this.#close(this.#getDetailsElement(event));
  }

  /**
   * Close the main menu drawer
   */
  close() {
    this.#close(this.refs.details);
  }

  /**
   * Close the closest menu or submenu that is open
   *
   * @param {HTMLDetailsElement} details
   */
  #close(details) {
    const summary = details.querySelector('summary');

    if (!summary) return;

    summary.setAttribute('aria-expanded', 'false');
    details.classList.remove('menu-open');
    this.refs.menuDrawer.classList.remove('menu-drawer--has-submenu-opened');

    // Wait for the .menu-drawer element's transition, not the entire details subtree
    // This avoids waiting for child accordion/resource-card animations which can cause issues on Firefox
    const drawer = details.querySelector('.menu-drawer, .menu-drawer__submenu');

    const token = ++this.#sequence;

    const settle = () => {
      // A newer open has taken over; tearing down now would close it.
      if (token !== this.#sequence) return;

      reset(details);
      if (details === this.refs.details) {
        removeTrapFocus();
        const openDetails = this.querySelectorAll('details[open]:not(accordion-custom > details)');
        openDetails.forEach(reset);
      } else {
        trapFocus(this.refs.details);
      }
    };

    // `reset` strips the `open` attribute, which stops <details> rendering
    // its contents — so it has to wait for the slide, not race it.
    if (this.#ownsMotion(drawer)) {
      this.#animateClose(/** @type {HTMLElement} */ (drawer)).then(settle);
    } else {
      onAnimationEnd(drawer || details, settle, { subtree: false });
    }
  }

  /**
   * Attach animationend event listeners to all animated elements to remove will-change after animation
   * to remove the stacking context and allow submenus to be positioned correctly
   */
  #setupAnimatedElementListeners() {
    const allAnimated = this.querySelectorAll('.menu-drawer__animated-element');
    allAnimated.forEach((element) => {
      element.addEventListener('animationend', removeWillChangeOnAnimationEnd);
    });
  }

  /**
   * Temporarily disables accordion animations to prevent unwanted transitions when the drawer opens.
   * Adds a no-animation class to accordion content elements, then removes it after 100ms to
   * re-enable animations for user interactions.
   * @param {HTMLDetailsElement} details - The details element containing the accordions
   */
  preventInitialAccordionAnimations(details) {
    const content = details.querySelectorAll('accordion-custom .details-content');

    content.forEach((element) => {
      if (element instanceof HTMLElement) {
        element.classList.add('details-content--no-animation');
      }
    });
    setTimeout(() => {
      content.forEach((element) => {
        if (element instanceof HTMLElement) {
          element.classList.remove('details-content--no-animation');
        }
      });
    }, 100);
  }
}

if (!customElements.get('header-drawer')) {
  customElements.define('header-drawer', HeaderDrawer);
}

/**
 * Reset an open details element to its original state
 *
 * @param {HTMLDetailsElement} element
 */
function reset(element) {
  element.classList.remove('menu-open');
  element.removeAttribute('open');
  element.querySelector('summary')?.setAttribute('aria-expanded', 'false');
}
