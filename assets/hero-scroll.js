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
 * As the user scrolls through `.hero-video-track`, the video stage shrinks
 * toward its center and the big centered logo fades up and out. Past ~92%
 * progress, `hero-intro-done` is added to `<body>`, which reveals the site
 * header (hidden by default while this section is present).
 */
class HeroScrollComponent extends HTMLElement {
  connectedCallback() {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;
    this.stage = this.querySelector('[ref="stage"]');
    this.logo = this.querySelector('[ref="logo"]');
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

    this.#scrollTrigger = ScrollTrigger.create({
      trigger: this.track,
      scroller: getScrollContainer(),
      start: 'top top',
      end: 'bottom top',
      scrub: 0.4,
      animation: gsap
        .timeline()
        .to(this.stage, { scale: 0.62, borderRadius: '28px', ease: 'none' }, 0)
        .to(this.logo, { yPercent: -260, scale: 0.3, opacity: 0, ease: 'none' }, 0),
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
