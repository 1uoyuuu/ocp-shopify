import { getScrollContainer, scrollContainerMediaQuery } from '@theme/scroll-container';

/** Fraction of the timeline (== scroll progress, since the timeline's total
 * duration is 1) at which the logo finishes scrubbing back to its resting,
 * docked position. */
const LOGO_ARRIVE_PROGRESS = 0.65;

/** Must match snippets/site-logo.liquid's `.site-logo` width/scale — the
 * logo renders natively at LOGO_NATIVE_WIDTH and is always scaled *down*
 * from there (docked = DOCKED_SCALE, opening = computed per-viewport below,
 * capped so it never exceeds 1) so a GPU compositing layer is never
 * rasterized small and then stretched up, which is blurry. */
const LOGO_NATIVE_WIDTH = 2000;
const DOCKED_SCALE = 0.1;
const DOCKED_CENTER_Y = 33;

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
 * The same timeline also shrinks the video stage down to a small badge
 * (settling ~10svh below dead-center — see hero-video.liquid's
 * `.hero-video__composition` translate, which the heading is shifted by
 * the same amount to match), while each of the 3 heading lines reveals
 * with its own blur → sharp + upward move + fade-in, staggered so they
 * resolve one after another rather than all at once.
 */
class HeroScrollComponent extends HTMLElement {
  connectedCallback() {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;
    this.stage = this.querySelector('[ref="stage"]');
    this.logo = document.querySelector('[data-site-logo]');
    this.headingLine1 = this.querySelector('[ref="headingLine1"]');
    this.headingLine2 = this.querySelector('[ref="headingLine2"]');
    this.headingLine3 = this.querySelector('[ref="headingLine3"]');
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
   * The hero's opening look: large and vertically centered. Expressed as
   * absolute x/y/scale (not a delta from the docked state) since GSAP's
   * `scale` replaces the element's transform outright rather than
   * multiplying on top of the CSS default — see LOGO_NATIVE_WIDTH's doc
   * comment for why this is always ≤ ~1, never the small docked scale
   * stretched up.
   *
   * @returns {{y: number, scale: number}}
   */
  #computeOpeningTarget() {
    return {
      y: window.innerHeight / 2 - DOCKED_CENTER_Y,
      scale: (window.innerWidth * 0.7) / LOGO_NATIVE_WIDTH,
    };
  }

  #createTrigger() {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;

    this.#scrollTrigger?.kill();

    const opening = this.#computeOpeningTarget();
    gsap.set(this.logo, { y: opening.y, scale: opening.scale });

    const tl = gsap
      .timeline()
      .to(this.stage, { scale: 0.15, y: '10svh', ease: 'none', duration: 0.6 }, 0)
      .to(this.logo, { y: 0, scale: DOCKED_SCALE, ease: 'none', duration: LOGO_ARRIVE_PROGRESS }, 0);

    // Each line: blurred, lower, and transparent → sharp, in place, opaque.
    // Staggered start times make them resolve one after another.
    const lineReveal = (line, start) => {
      if (!line) return;
      tl.fromTo(
        line,
        { y: 30, opacity: 0, filter: 'blur(14px)' },
        { y: 0, opacity: 1, filter: 'blur(0px)', ease: 'none', duration: 0.35 },
        start
      );
    };

    lineReveal(this.headingLine1, 0.3);
    lineReveal(this.headingLine2, 0.4);
    lineReveal(this.headingLine3, 0.5);

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
