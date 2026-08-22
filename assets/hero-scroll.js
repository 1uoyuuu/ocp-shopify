import { getScrollContainer, scrollContainerMediaQuery } from '@theme/scroll-container';

/** Fraction of the timeline (== scroll progress, since the timeline's total
 * duration is 1) at which the logo finishes scrubbing back to its resting,
 * docked position. */
const LOGO_ARRIVE_PROGRESS = 0.65;

/**
 * Drives the hero-video intro animation. `.hero-video` is kept in place via
 * native `position: sticky` (see hero-video.liquid) rather than GSAP's
 * `pin: true` — pinning inserts a wrapper element, which fights the theme's
 * own DOM-morphing on section re-render. Scrubbing plain transforms here
 * never touches the DOM structure, so the two systems stay out of each
 * other's way.
 *
 * The theme scrolls `.page-wrapper` (not the document) at desktop widths and
 * switches to native document scrolling below that — see
 * @theme/scroll-container. ScrollTrigger needs to be told which one is
 * actually scrolling, and re-created when that switches.
 *
 * The logo (`[data-site-logo]`, snippets/site-logo.liquid) is NOT a child of
 * this component — it's a page-level element, always `position: fixed`,
 * resting by default at its small "docked" CSS size/position (i.e. the
 * site's permanent header logo, on every template). Here on the hero
 * template only, this component overrides it on load with `gsap.set()` to
 * look large and centered, then scrubs that override back to identity
 * (scale/x/y → 0) as the user scrolls through `.hero-video-track` — landing
 * it exactly on its own resting values, so there's nothing to measure or
 * hand off to.
 *
 * The same timeline also shrinks the video stage down to a small centered
 * badge (staying dead-center — it does not move), and fades/slides the
 * heading — split into a top and bottom half that sandwich the shrunk
 * video — into view over the final ~50% (overlapping the tail of the
 * shrink).
 */
class HeroScrollComponent extends HTMLElement {
  connectedCallback() {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;
    this.stage = this.querySelector('[ref="stage"]');
    this.logo = document.querySelector('[data-site-logo]');
    this.headingTop = this.querySelector('[ref="headingTop"]');
    this.headingBottom = this.querySelector('[ref="headingBottom"]');
    this.track = this.closest('.hero-video-track');

    if (!gsap || !ScrollTrigger || !this.stage || !this.logo || !this.track) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(ScrollTrigger);

    this.#createTrigger();
    scrollContainerMediaQuery.addEventListener('change', this.#handleScrollerChange);
  }

  disconnectedCallback() {
    this.#scrollTrigger?.kill();
    window.gsap?.set(this.logo, { clearProps: 'all' });
    scrollContainerMediaQuery.removeEventListener('change', this.#handleScrollerChange);
  }

  /**
   * How much bigger/lower the logo should look on load versus its resting,
   * docked CSS values (a horizontally-centered, fixed-width box near the
   * top of the viewport) — i.e. the hero's opening state, expressed as an
   * override on top of that resting state rather than as absolute values.
   *
   * @returns {{y: number, scale: number}}
   */
  #computeOpeningOverride() {
    const rect = this.logo.getBoundingClientRect();
    const restingWidth = rect.width || 1;
    const restingCenterY = rect.top + rect.height / 2;
    const openingWidth = window.innerWidth * 0.7;
    const openingCenterY = window.innerHeight / 2;

    return {
      y: openingCenterY - restingCenterY,
      scale: openingWidth / restingWidth,
    };
  }

  #createTrigger() {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;

    this.#scrollTrigger?.kill();

    const opening = this.#computeOpeningOverride();
    gsap.set(this.logo, { y: opening.y, scale: opening.scale });

    const tl = gsap
      .timeline()
      .to(this.stage, { scale: 0.15, borderRadius: '20px', ease: 'none', duration: 0.6 }, 0)
      .to(this.logo, { y: 0, scale: 1, ease: 'none', duration: LOGO_ARRIVE_PROGRESS }, 0);

    if (this.headingTop) {
      tl.fromTo(this.headingTop, { y: 24, opacity: 0 }, { y: 0, opacity: 1, ease: 'none', duration: 0.5 }, 0.5);
    }

    if (this.headingBottom) {
      tl.fromTo(this.headingBottom, { y: -24, opacity: 0 }, { y: 0, opacity: 1, ease: 'none', duration: 0.5 }, 0.5);
    }

    this.#scrollTrigger = ScrollTrigger.create({
      trigger: this.track,
      scroller: getScrollContainer(),
      start: 'top top',
      end: 'bottom top',
      scrub: 0.4,
      animation: tl,
    });
  }

  #handleScrollerChange = () => this.#createTrigger();

  /** @type {import('gsap/ScrollTrigger').ScrollTrigger | undefined} */
  #scrollTrigger;
}

if (!customElements.get('hero-scroll-component')) {
  customElements.define('hero-scroll-component', HeroScrollComponent);
}
