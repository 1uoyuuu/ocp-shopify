import { getScrollContainer, scrollContainerMediaQuery } from '@theme/scroll-container';

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
 * while the big centered logo fades out (first ~60% of the range), then the
 * heading fades/slides into view (final ~50%, overlapping the tail of the
 * shrink). Only once that timeline finishes — past ~92% progress —
 * does `hero-intro-done` get added to `<body>`, revealing the site header
 * (hidden by default while this section is present) and letting the page
 * continue scrolling normally into the next section.
 */
class HeroScrollComponent extends HTMLElement {
  connectedCallback() {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;
    this.stage = this.querySelector('[ref="stage"]');
    this.logo = this.querySelector('[ref="logo"]');
    this.heading = this.querySelector('[ref="heading"]');
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
  }

  disconnectedCallback() {
    this.#scrollTrigger?.kill();
    scrollContainerMediaQuery.removeEventListener('change', this.#handleScrollerChange);
  }

  #createTrigger() {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;

    this.#scrollTrigger?.kill();

    const tl = gsap.timeline().to(
      this.stage,
      { scale: 0.15, y: '-16vh', borderRadius: '20px', ease: 'none', duration: 0.6 },
      0
    ).to(this.logo, { yPercent: -200, scale: 0.4, opacity: 0, ease: 'none', duration: 0.35 }, 0);

    if (this.heading) {
      tl.fromTo(
        this.heading,
        { y: 24, opacity: 0 },
        { y: 0, opacity: 1, ease: 'none', duration: 0.5 },
        0.5
      );
    }

    this.#scrollTrigger = ScrollTrigger.create({
      trigger: this.track,
      scroller: getScrollContainer(),
      start: 'top top',
      end: 'bottom top',
      scrub: 0.4,
      animation: tl,
      onUpdate: (self) => {
        document.body.classList.toggle('hero-intro-done', self.progress > 0.92);
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
