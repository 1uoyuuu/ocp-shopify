import { Component } from '@theme/component';

/**
 * Pins the hero-video section while the user scrolls through it, shrinking
 * the video stage toward its center and fading the big centered logo up and
 * out. Reveals the site header (hidden via CSS in hero-video.liquid) once
 * the handoff completes.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} stage
 * @property {HTMLElement} logo
 *
 * @extends Component<Refs>
 */
class HeroScrollComponent extends Component {
  requiredRefs = ['stage', 'logo'];

  connectedCallback() {
    super.connectedCallback();

    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;

    if (!gsap || !ScrollTrigger) {
      // GSAP failed to load — don't leave the header permanently hidden.
      document.body.classList.add('hero-intro-done');
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.body.classList.add('hero-intro-done');
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    const { stage, logo } = this.refs;

    this.#scrollTrigger = ScrollTrigger.create({
      trigger: this,
      start: 'top top',
      end: '+=100%',
      pin: true,
      scrub: 0.4,
      animation: gsap
        .timeline()
        .to(stage, { scale: 0.62, borderRadius: '28px', ease: 'none' }, 0)
        .to(logo, { yPercent: -260, scale: 0.3, opacity: 0, ease: 'none' }, 0),
      onUpdate: (self) => {
        document.body.classList.toggle('hero-intro-done', self.progress > 0.92);
      },
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#scrollTrigger?.kill();
  }

  /** @type {import('gsap/ScrollTrigger').ScrollTrigger | undefined} */
  #scrollTrigger;
}

if (!customElements.get('hero-scroll-component')) {
  customElements.define('hero-scroll-component', HeroScrollComponent);
}
