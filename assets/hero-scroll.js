/** Fraction of the timeline at which the logo finishes travelling back to
 * its resting, docked position. */
const LOGO_ARRIVE_PROGRESS = 0.65;

/** Must match snippets/site-logo.liquid's `.site-logo` width/scale — the
 * logo renders natively at LOGO_NATIVE_WIDTH and is always scaled *down*
 * from there (docked = DOCKED_SCALE, opening = computed per-viewport below,
 * capped so it never exceeds 1) so a GPU compositing layer is never
 * rasterized small and then stretched up, which is blurry. */
const LOGO_NATIVE_WIDTH = 2000;
const DOCKED_SCALE = 0.1;
const DOCKED_CENTER_Y = 33;

/** How much accumulated gesture distance (px of wheel/swipe) plays the
 * intro from start to finish. Higher = the intro takes more scrolling. */
const GESTURE_DISTANCE = 1400;

/**
 * Drives the hero-video intro, which is a *locked* sequence rather than a
 * scroll-scrubbed one: while it plays, page scrolling is disabled outright
 * and wheel/touch gestures are captured by GSAP's Observer and fed into the
 * timeline's playhead. Only when the timeline completes is scrolling
 * released, so the page can never move on with the heading still mid-blur.
 * Scrolling up from the very top of the page re-locks and rewinds it.
 *
 * (This replaced a ScrollTrigger `scrub` setup — with scrub, the page is
 * really just scrolling normally and the animation follows along, so the
 * next section starts creeping into view while the intro is unfinished.)
 *
 * The timeline itself: the video stage shrinks to a small badge settling
 * ~10svh below dead-center (matching `.hero-video__composition`'s CSS
 * translate, which the heading is shifted by too), the logo travels from
 * big-and-centered back to its docked spot, and each of the 3 heading
 * lines reveals with its own blur → sharp + upward move + fade-in,
 * staggered so they resolve one after another.
 *
 * The logo (`[data-site-logo]`, snippets/site-logo.liquid) is NOT a child
 * of this component — it's a page-level element, always `position: fixed`,
 * resting at its small docked size/position on every template. Here it's
 * overridden on load via `gsap.set()` to look large and centered, then
 * animated back to identity — landing exactly on its own resting values,
 * so there's nothing to measure or hand off to.
 */
class HeroScrollComponent extends HTMLElement {
  connectedCallback() {
    const gsap = window.gsap;
    const Observer = window.Observer;
    this.stage = this.querySelector('[ref="stage"]');
    this.logo = document.querySelector('[data-site-logo]');
    this.headingLine1 = this.querySelector('[ref="headingLine1"]');
    this.headingLine2 = this.querySelector('[ref="headingLine2"]');
    this.headingLine3 = this.querySelector('[ref="headingLine3"]');

    if (!gsap || !Observer || !this.stage || !this.logo) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(Observer);

    this.#buildTimeline();
    this.#lock();

    this.#observer = Observer.create({
      target: window,
      type: 'wheel,touch',
      onChangeY: (self) => {
        if (!this.#locked) return;
        // Observer normalizes wheel and touch so a downward scroll/swipe is
        // a positive deltaY — i.e. the same direction that would carry the
        // page forward — so it advances the intro.
        this.#progress = gsap.utils.clamp(0, 1, this.#progress + self.deltaY / GESTURE_DISTANCE);
        this.#timeline.progress(this.#progress);
        if (this.#progress >= 1) this.#unlock();
      },
      preventDefault: true,
    });

    // Scrolling back to the very top replays the intro, so the page never
    // sits at the top showing a finished hero with no way to see it again.
    this.#scrollListener = () => {
      if (this.#locked || window.scrollY > 0) return;
      this.#progress = 1;
      this.#lock();
    };
    window.addEventListener('scroll', this.#scrollListener, { passive: true });

    window.addEventListener('resize', this.#resizeListener);
  }

  disconnectedCallback() {
    this.#observer?.kill();
    this.#timeline?.kill();
    this.#unlock();
    window.gsap?.set(this.logo, { clearProps: 'all' });
    window.removeEventListener('scroll', this.#scrollListener);
    window.removeEventListener('resize', this.#resizeListener);
  }

  /**
   * The hero's opening look for the logo: large and vertically centered.
   * Expressed as absolute y/scale (not a delta from the docked state) since
   * GSAP's `scale` replaces the element's transform outright rather than
   * multiplying on top of the CSS default — see LOGO_NATIVE_WIDTH's doc
   * comment for why this is always ≤ ~1, never the docked scale stretched up.
   *
   * @returns {{y: number, scale: number}}
   */
  #computeOpeningTarget() {
    return {
      y: window.innerHeight / 2 - DOCKED_CENTER_Y,
      scale: (window.innerWidth * 0.7) / LOGO_NATIVE_WIDTH,
    };
  }

  #buildTimeline() {
    const gsap = window.gsap;

    this.#timeline?.kill();

    const opening = this.#computeOpeningTarget();

    const tl = gsap
      .timeline({ paused: true })
      .fromTo(
        this.logo,
        { y: opening.y, scale: opening.scale },
        { y: 0, scale: DOCKED_SCALE, ease: 'none', duration: LOGO_ARRIVE_PROGRESS },
        0
      )
      .fromTo(this.stage, { scale: 1, y: 0 }, { scale: 0.15, y: '10svh', ease: 'none', duration: 0.6 }, 0);

    // Each line: blurred, lower, and transparent → sharp, in place, opaque.
    // Staggered start times make them resolve one after another. The last
    // one finishes at 0.85, comfortably before the timeline's end, so the
    // lock only releases once every line has fully resolved.
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

    tl.progress(this.#progress);
    this.#timeline = tl;
  }

  #lock() {
    this.#locked = true;
    document.documentElement.classList.add('hero-intro-locked');
    this.#observer?.enable();
    window.scrollTo(0, 0);
    this.#timeline.progress(this.#progress);
  }

  #unlock() {
    this.#locked = false;
    document.documentElement.classList.remove('hero-intro-locked');
    this.#observer?.disable();
  }

  #resizeListener = () => {
    const wasLocked = this.#locked;
    this.#buildTimeline();
    if (!wasLocked) this.#timeline.progress(1);
  };

  /** @type {import('gsap').gsap.core.Timeline} */
  #timeline;

  /** @type {import('gsap/Observer').Observer | undefined} */
  #observer;

  #locked = false;

  #progress = 0;

  #scrollListener = () => {};
}

if (!customElements.get('hero-scroll-component')) {
  customElements.define('hero-scroll-component', HeroScrollComponent);
}
