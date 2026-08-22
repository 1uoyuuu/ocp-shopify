import { getScrollContainer, scrollContainerMediaQuery } from '@theme/scroll-container';

/** Fraction of the timeline (== scroll progress, since the timeline's total
 * duration is 1) at which the traveling logo finishes landing at its fixed
 * spot. */
const LOGO_ARRIVE_PROGRESS = 0.65;

/** Final rendered height (px) of the logo once it's landed, and how far
 * down (px) from the top of the viewport its center sits — i.e. roughly
 * the header's own logo size/position. Tune these to taste; there's no
 * other element being measured against anymore. */
const LOGO_FINAL_HEIGHT = 32;
const LOGO_FINAL_CENTER_Y = 33;

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
 * travels (translate + scale) to a fixed point near the top of the viewport
 * — first `LOGO_ARRIVE_PROGRESS` of the range. The heading — split into a
 * top and bottom half that sandwich the shrunk video — then fades/slides
 * into view (final ~50%, overlapping the tail of the shrink).
 *
 * Once the logo arrives, `hero-intro-done` on <body> switches it from
 * `position: absolute` (inside `.hero-video`, sticky at the viewport's
 * top-left this whole time) to `position: fixed` at that same spot — see
 * hero-video.liquid's stylesheet. The two positioning modes share the same
 * origin at that moment, so the switch is invisible, and the logo then
 * stays put (above the header, via z-index) for the rest of the page —
 * there is no second, separate header logo to hand off to or align with.
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
      // Missing a dependency or ref — leave the logo in its landed state.
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

  /**
   * The logo starts centered in the viewport (`.hero-video` is 100vw ×
   * 100svh, sticky at the top-left). No horizontal move is needed — the
   * viewport's horizontal center already is the logo's horizontal center.
   * Vertically, it needs to move from mid-viewport up to
   * `LOGO_FINAL_CENTER_Y`, and shrink from its natural rendered height down
   * to `LOGO_FINAL_HEIGHT`.
   *
   * @returns {{x: number, y: number, scale: number}}
   */
  #computeLogoTarget() {
    const svg = this.logo.querySelector('svg') ?? this.logo;
    const naturalHeight = svg.getBoundingClientRect().height || 1;

    return {
      x: 0,
      y: LOGO_FINAL_CENTER_Y - window.innerHeight / 2,
      scale: LOGO_FINAL_HEIGHT / naturalHeight,
    };
  }

  #createTrigger() {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;

    this.#scrollTrigger?.kill();

    const target = this.#computeLogoTarget();

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
        // Use the animation's own (eased/scrubbed) progress, not self.progress
        // (the raw, immediate scroll position) — with `scrub` as a number the
        // animation lags behind scroll by design, so gating on self.progress
        // would flip the logo to `fixed` before it had visually arrived.
        document.body.classList.toggle('hero-intro-done', self.animation.progress() >= LOGO_ARRIVE_PROGRESS);
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
