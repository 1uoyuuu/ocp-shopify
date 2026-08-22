import { getScrollContainer, scrollContainerMediaQuery } from '@theme/scroll-container';

/** Fraction of the timeline (== scroll progress, since the timeline's total
 * duration is 1) at which the traveling logo lands on the header logo. The
 * header reveal is tied to this same value so it appears the instant the
 * logo arrives, not later. */
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
 * As the user scrolls through `.hero-video-track`, a single locked-viewport
 * timeline plays: the video stage shrinks down to a small centered badge
 * (staying dead-center — it does not move) while the big centered logo
 * travels (translate + scale, computed via a FLIP-style rect diff) to land
 * exactly on top of the real header logo's position and size — first
 * `LOGO_ARRIVE_PROGRESS` of the range. The heading — split into a top and
 * bottom half that sandwich the shrunk video — then fades/slides into view
 * (final ~50%, overlapping the tail of the shrink). The instant the logo
 * *arrives* (not when the whole intro finishes), `hero-intro-done` is
 * added to `<body>`. That single class flip does two things at once via
 * CSS (see hero-video.liquid and the stylesheet below): the real header
 * fades in and the traveling logo fades out, in the same spot, at the same
 * 0.6s speed — a crossfade handoff rather than a scroll-scrubbed one, so it
 * isn't thrown off by the header's fade running on wall-clock time instead
 * of scroll position.
 */
class HeroScrollComponent extends HTMLElement {
  connectedCallback() {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;
    this.stage = this.querySelector('[ref="stage"]');
    this.logo = this.querySelector('[ref="logo"]');
    this.headingTop = this.querySelector('[ref="headingTop"]');
    this.headingBottom = this.querySelector('[ref="headingBottom"]');
    this.track = this.closest('.hero-video-track');

    if (!gsap || !ScrollTrigger || !this.stage || !this.logo || !this.track) {
      // Missing a dependency or ref — don't leave the header permanently hidden.
      document.body.classList.add('hero-intro-done');
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.body.classList.add('hero-intro-done');
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    this.#createTrigger();
    scrollContainerMediaQuery.addEventListener('change', this.#handleScrollerChange);
    // Logo/header images may still be decoding when connectedCallback runs,
    // which would measure a 0×0 header-logo rect — remeasure once everything
    // has loaded so the travel target is accurate.
    window.addEventListener('load', this.#handleScrollerChange, { once: true });
  }

  disconnectedCallback() {
    this.#scrollTrigger?.kill();
    scrollContainerMediaQuery.removeEventListener('change', this.#handleScrollerChange);
    window.removeEventListener('load', this.#handleScrollerChange);
  }

  /**
   * Diffs the hero logo's current rect against the real header logo's rect
   * (present in the DOM the whole time, just hidden via opacity) to get the
   * translate/scale that lands one exactly on the other.
   *
   * @returns {{x: number, y: number, scale: number} | null}
   */
  #computeLogoTarget() {
    const headerLogo = document.querySelector('.header-logo');
    if (!headerLogo) return null;

    const heroRect = this.logo.getBoundingClientRect();
    const headerRect = headerLogo.getBoundingClientRect();

    if (!heroRect.width || !heroRect.height || !headerRect.width || !headerRect.height) return null;

    return {
      x: headerRect.left + headerRect.width / 2 - (heroRect.left + heroRect.width / 2),
      y: headerRect.top + headerRect.height / 2 - (heroRect.top + heroRect.height / 2),
      scale: headerRect.height / heroRect.height,
    };
  }

  #createTrigger() {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;

    this.#scrollTrigger?.kill();

    // Fallback for the rare case the header logo can't be measured yet
    // (e.g. reduced layout during a design-mode re-render): travel toward
    // the top-center of the viewport and shrink to a plausible nav size.
    const target = this.#computeLogoTarget() ?? { x: 0, y: -(window.innerHeight / 2 - 30), scale: 0.16 };

    const tl = gsap
      .timeline()
      .to(this.stage, { scale: 0.15, borderRadius: '20px', ease: 'none', duration: 0.6 }, 0)
      .to(
        this.logo,
        { x: target.x, y: target.y, scale: target.scale, ease: 'none', duration: LOGO_ARRIVE_PROGRESS },
        0
      );

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
      onUpdate: (self) => {
        document.body.classList.toggle('hero-intro-done', self.progress >= LOGO_ARRIVE_PROGRESS);
      },
    });
  }

  #handleScrollerChange = () => this.#createTrigger();

  /** @type {import('gsap/ScrollTrigger').ScrollTrigger | undefined} */
  #scrollTrigger;
}

if (!customElements.get('hero-scroll-component')) {
  customElements.define('hero-scroll-component', HeroScrollComponent);
}
