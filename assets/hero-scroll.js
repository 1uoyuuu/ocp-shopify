import { getScrollTop, scrollTo, getScrollEventTarget, scrollContainerMediaQuery } from '@theme/scroll-container';

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

/** How much accumulated gesture distance plays the intro from start to
 * finish. Higher = the intro takes more scrolling.
 *
 * Wheel and touch need separate numbers because they aren't the same unit:
 * a wheel notch reports roughly 100px, while a drag reports the raw pixels
 * the finger actually travelled. Sharing the wheel figure would demand
 * about one and a half full swipes of a phone screen to get through the
 * intro. */
const GESTURE_DISTANCE = 1200;
const TOUCH_GESTURE_DISTANCE = 700;

/** Below this the hero stacks: the video leaves the middle row and takes a
 * line of its own. Must stay in step with the matching media query in
 * sections/hero-video.liquid — the two describe the same layout. */
const STACKED_LAYOUT = '(max-width: 749px)';

/** The badge's shape once it settles. Held at this ratio on every screen
 * rather than being allowed to inherit the viewport's, which is what turned
 * it into a tall sliver on phones. */
const BADGE_ASPECT = 1.6;

/** Fallback share of the screen's *width* the badge spans when stacked,
 * used if the section's own setting is missing or unparseable. */
const DEFAULT_MOBILE_BADGE_SCALE = 0.7;

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
    this.headingLine2Left = this.querySelector('[ref="headingLine2Left"]');
    this.headingLine2Right = this.querySelector('[ref="headingLine2Right"]');
    this.headingLine3 = this.querySelector('[ref="headingLine3"]');
    this.videoSlot = this.querySelector('[ref="videoSlot"]');
    this.media = this.querySelector('[ref="media"]');

    // The headings and the site header are hidden by default in CSS so they
    // can't flash in before the timeline's "from" state applies — any path
    // that skips the animation has to reveal them itself.
    if (!gsap || !Observer || !this.stage || !this.logo) {
      this.#skipIntro();
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.#skipIntro();
      return;
    }

    gsap.registerPlugin(Observer);

    // Split once, here rather than in #buildTimeline — that re-runs on
    // resize, and re-splitting would throw away the elements the live
    // timeline is animating.
    for (const line of [
      this.headingLine1,
      this.headingLine2Left,
      this.headingLine2Right,
      this.headingLine3,
    ]) {
      if (line) this.#chars.set(line, this.#splitChars(line));
    }

    this.#buildTimeline();
    this.#lock();

    this.#observer = Observer.create({
      target: window,
      type: 'wheel,touch',
      onChangeY: (self) => {
        if (!this.#locked) return;

        // Observer does *not* reconcile the two input types: its drag
        // handler reports `clientY - previousClientY`, so a finger moving
        // down is positive, while a wheel's native deltaY is positive
        // scrolling down. Those are opposite intentions — you swipe *up* to
        // go forward — so a drag has to be negated to mean "onward" like a
        // wheel does. Left alone, touch devices play the intro backwards.
        const isWheel = self.event?.type === 'wheel';
        const distance = isWheel ? GESTURE_DISTANCE : TOUCH_GESTURE_DISTANCE;
        const delta = isWheel ? self.deltaY : -self.deltaY;

        this.#progress = gsap.utils.clamp(0, 1, this.#progress + delta / distance);
        this.#timeline.progress(this.#progress);
        if (this.#progress >= 1) this.#unlock();
      },
      preventDefault: true,
    });

    this.#bindScrollListener();
    // Which element actually scrolls (and so which one emits scroll events)
    // flips at the desktop breakpoint — rebind when it does.
    scrollContainerMediaQuery.addEventListener('change', this.#bindScrollListener);

    window.addEventListener('resize', this.#resizeListener);

    // Where the video lands depends on the width of the words either side of
    // it, so a timeline built against fallback font metrics goes stale the
    // moment the real face swaps in. Rebuild once it has.
    document.fonts?.ready.then(() => this.#resizeListener());
  }

  disconnectedCallback() {
    this.#observer?.kill();
    this.#timeline?.kill();
    this.#unlock();
    window.gsap?.set(this.logo, { clearProps: 'all' });
    this.#scrollEventTarget?.removeEventListener('scroll', this.#scrollListener);
    scrollContainerMediaQuery.removeEventListener('change', this.#bindScrollListener);
    window.removeEventListener('resize', this.#resizeListener);
  }

  /**
   * Watches the real scroll container — this theme scrolls `.page-wrapper`
   * rather than the document at desktop widths, and scroll events don't
   * bubble from an element up to `window`, so listening on `window` here
   * silently never fired on desktop.
   */
  #bindScrollListener = () => {
    this.#scrollEventTarget?.removeEventListener('scroll', this.#scrollListener);
    this.#scrollEventTarget = getScrollEventTarget();
    this.#scrollEventTarget.addEventListener('scroll', this.#scrollListener, { passive: true });
  };

  /**
   * Scrolling back to the very top re-locks the intro at its end, so it can
   * be rewound by continuing to scroll up.
   */
  #scrollListener = () => {
    if (this.#locked || getScrollTop() > 0) return;
    this.#progress = 1;
    this.#lock();
  };

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

  /**
   * Wraps each character of a heading in its own span so they can be
   * animated individually, keeping words intact so the line still wraps at
   * word boundaries rather than mid-word.
   *
   * The split spans are `aria-hidden` and the original string is put back on
   * the element as `aria-label`, so assistive tech reads the heading as text
   * rather than spelling it out one span at a time.
   *
   * @param {HTMLElement} line
   * @returns {HTMLElement[]} the character elements, in order
   */
  #splitChars(line) {
    const text = line.textContent.trim();
    if (!text) return [];

    line.setAttribute('aria-label', text);
    line.textContent = '';

    const chars = [];
    // Keeps the separators, so spacing between words survives the split.
    for (const token of text.split(/(\s+)/)) {
      if (!token) continue;

      if (/^\s+$/.test(token)) {
        line.appendChild(document.createTextNode(' '));
        continue;
      }

      const word = document.createElement('span');
      word.className = 'hero-video__word';
      word.setAttribute('aria-hidden', 'true');

      // Iterating the string yields whole code points, so multi-unit
      // characters aren't split down the middle into broken halves.
      for (const character of token) {
        const span = document.createElement('span');
        span.className = 'hero-video__char';
        span.textContent = character;
        word.appendChild(span);
        chars.push(span);
      }

      line.appendChild(word);
    }

    return chars;
  }

  /**
   * Sizes the slot reserved in the middle row to the footprint the video
   * ends up occupying, and returns the scale that gets it there.
   *
   * The video's final height is meant to match the heading's font size, so
   * the scale is derived from the measured font size rather than being a
   * fixed number — it then tracks whatever `--hero-heading-size` resolves to
   * at the current viewport, along with the transform that gets it there.
   *
   * @returns {{scaleX: number, scaleY: number}}
   */
  #sizeVideoSlot() {
    const reference = this.headingLine2Left ?? this.headingLine1;
    const fontSize = reference ? parseFloat(getComputedStyle(reference).fontSize) : 0;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Fall back to the previous fixed scale if anything is unmeasurable.
    if (!fontSize || !viewportHeight || !viewportWidth) {
      return { scaleX: 0.15, scaleY: 0.15 };
    }

    // Stacked, the badge spans a share of the screen's width; inline, its
    // height matches the cap height of the type it sits between. Either way
    // the other side follows from BADGE_ASPECT, so the shape is the same
    // everywhere.
    const width = matchMedia(STACKED_LAYOUT).matches
      ? viewportWidth * this.#mobileBadgeScale()
      : fontSize * BADGE_ASPECT;
    const height = width / BADGE_ASPECT;

    if (this.videoSlot) {
      this.videoSlot.style.width = `${width}px`;
      this.videoSlot.style.height = `${height}px`;
    }

    // Scaling a full-bleed stage unevenly is what frees the badge from the
    // viewport's aspect ratio. On its own it would stretch the video with
    // it — a transform scales what has already been laid out, and
    // object-fit can't undo that — so #syncMediaScale corrects for it.
    return { scaleX: width / viewportWidth, scaleY: height / viewportHeight };
  }

  /**
   * The stacked badge's share of the screen's width, from the section's
   * "Video size on mobile" setting.
   *
   * @returns {number}
   */
  #mobileBadgeScale() {
    const percent = parseFloat(this.dataset.mobileBadgeScale ?? '');

    if (!Number.isFinite(percent) || percent <= 0) return DEFAULT_MOBILE_BADGE_SCALE;

    return percent / 100;
  }

  /**
   * Where the video has to travel to land in the gap the middle row leaves
   * for it, and at what scale.
   *
   * The stage is `inset: 0` on the section, so scaling alone keeps it
   * centred on the section — but the slot is not at that centre: the word
   * before it is wider than the word after it, so the row's midpoint sits
   * off to one side. The difference between the two centres is the offset
   * the stage needs.
   *
   * Both are read as viewport rects and subtracted, so the result is a
   * section-relative delta and stays correct whatever the page's scroll
   * position is when this runs.
   *
   * @returns {{scaleX: number, scaleY: number, x: number, y: number}}
   */
  #computeStageTarget() {
    const size = this.#sizeVideoSlot();
    if (!this.videoSlot) return { ...size, x: 0, y: 0 };

    const slot = this.videoSlot.getBoundingClientRect();
    const section = this.getBoundingClientRect();

    return {
      ...size,
      x: slot.left + slot.width / 2 - (section.left + section.width / 2),
      y: slot.top + slot.height / 2 - (section.top + section.height / 2),
    };
  }

  /**
   * Keeps the video's own scale uniform while the stage's deliberately is
   * not.
   *
   * This cannot be a tween of its own. Multiplying two linear tweens does
   * not give a linear result, so a separately animated counter-scale landed
   * on the right value at both ends while stretching the video by as much
   * as 1.6x in between. Deriving it from whatever the stage is actually at,
   * every frame, holds the ratio at every point instead.
   *
   * The larger axis is the one that has to be covered; matching it leaves
   * the video overflowing the shorter one, which the stage's
   * `overflow: hidden` then crops — so the badge is never left with a gap.
   */
  #syncMediaScale = () => {
    if (!this.media || !this.stage) return;

    const gsap = window.gsap;
    const scaleX = Number(gsap.getProperty(this.stage, 'scaleX'));
    const scaleY = Number(gsap.getProperty(this.stage, 'scaleY'));

    if (!scaleX || !scaleY) return;

    const cover = Math.max(scaleX, scaleY);

    gsap.set(this.media, { scaleX: cover / scaleX, scaleY: cover / scaleY });
  };

  #buildTimeline() {
    const gsap = window.gsap;

    this.#timeline?.kill();

    const opening = this.#computeOpeningTarget();
    const stage = this.#computeStageTarget();

    const tl = gsap
      .timeline({ paused: true })
      .fromTo(
        this.logo,
        { y: opening.y, scale: opening.scale },
        { y: 0, scale: DOCKED_SCALE, ease: 'none', duration: LOGO_ARRIVE_PROGRESS },
        0
      )
      // Travels to the slot the middle row leaves for it, rather than just
      // shrinking in place — the slot is not at the section's centre.
      .fromTo(
        this.stage,
        { scaleX: 1, scaleY: 1, x: 0, y: 0 },
        {
          scaleX: stage.scaleX,
          scaleY: stage.scaleY,
          x: stage.x,
          y: stage.y,
          ease: 'none',
          duration: 0.6,
          onUpdate: this.#syncMediaScale,
        },
        0
      );

    // The from-state is rendered without firing onUpdate, so square the
    // media away before the first frame is seen.
    this.#syncMediaScale();

    // Each character resolves on its own — blurred, lower and transparent →
    // sharp, in place, opaque — rippling left to right across the line, and
    // the three lines start in turn. The last finishes at 0.88, before the
    // timeline's end, so the lock only releases once every line has landed.
    //
    // `amount` (rather than `each`) spreads the whole ripple across a fixed
    // slice of the timeline no matter how many characters there are, so the
    // pacing holds when the headings are edited in the theme editor.
    const lineReveal = (line, start) => {
      const chars = line && this.#chars.get(line);
      if (!chars?.length) return;

      // The line itself is hidden in CSS to stop it flashing before the
      // scripts run; from here the characters carry the reveal.
      gsap.set(line, { opacity: 1 });

      tl.fromTo(
        chars,
        { yPercent: 120, opacity: 0, filter: 'blur(8px)' },
        {
          yPercent: 0,
          opacity: 1,
          filter: 'blur(0px)',
          ease: 'power3.out',
          duration: 0.18,
          force3D: true,
          stagger: { amount: 0.2 },
        },
        start
      );
    };

    // The middle row's two halves start together so they read as one line.
    lineReveal(this.headingLine1, 0.22);
    lineReveal(this.headingLine2Left, 0.36);
    lineReveal(this.headingLine2Right, 0.36);
    lineReveal(this.headingLine3, 0.5);

    tl.progress(this.#progress);
    this.#timeline = tl;
  }

  /**
   * Marks the intro as never-playing, revealing the headings — they're
   * hidden by default in CSS so they can't flash in before the timeline's
   * "from" state applies, so something has to show them when the animation
   * is skipped.
   */
  #skipIntro() {
    this.dataset.introStatic = '';
  }

  #lock() {
    this.#locked = true;
    document.documentElement.classList.add('hero-intro-locked');
    this.#observer?.enable();
    scrollTo({ top: 0, behavior: 'instant' });
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

  /** @type {EventTarget | undefined} */
  #scrollEventTarget;

  /**
   * Heading element → its character spans, populated once on connect.
   * @type {Map<HTMLElement, HTMLElement[]>}
   */
  #chars = new Map();

  #locked = false;

  #progress = 0;
}

if (!customElements.get('hero-scroll-component')) {
  customElements.define('hero-scroll-component', HeroScrollComponent);
}
