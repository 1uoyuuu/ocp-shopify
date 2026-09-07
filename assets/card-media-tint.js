/**
 * Paints each product card's hover surface in the colour of the bag on it.
 *
 * The photography is cut out — a transparent PNG with nothing behind it — so
 * every pixel that is opaque belongs to the product. Sampling only those
 * pixels gives the bag's own colour without any of the surface it is sitting
 * on getting into the average.
 *
 * Shopify does not report a dominant colour for an image, so it is read from
 * the pixels here rather than stored anywhere: nothing to fill in per product,
 * and it follows the photograph if the photograph is ever replaced.
 *
 * A card whose colour cannot be read — no image, a canvas the browser will not
 * let us read back — is simply left alone, and the stylesheet's plain lift
 * stands in.
 */

/** Pixels a side to sample. The bag fills most of the frame, so this is
 * plenty to find its colour and small enough to decode in no time. */
const SAMPLE = 32;

/** Below this the pixel is the cut-out background, not the product. */
const MIN_ALPHA = 200;

/**
 * Labels are white and print is black, and both cover a lot of a coffee bag.
 * Neither is the colour anybody would say the bag *is*, so the neutral end of
 * the image is left out of the count.
 */
const MIN_SATURATION = 0.18;
const LIGHTNESS_RANGE = [0.1, 0.9];

/**
 * What the chosen colour is allowed to be, once found. The hue is the bag's;
 * the lightness is ours, because the roaster line goes white on top of it and
 * has to stay legible against a pale bag as well as a dark one.
 */
const TINT_LIGHTNESS = [0.34, 0.6];

/** Colours are binned this coarsely before counting, so a photograph's
 * thousands of near-identical shades count as one colour rather than losing to
 * a flat printed block. */
const BUCKET = 24;

/** @type {Map<string, Promise<string | null>>} */
const readings = new Map();

/** @param {number} r @param {number} g @param {number} b */
function toHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2 / 255;
  const chroma = max - min;

  if (!chroma) return { hue: 0, saturation: 0, lightness };

  const saturation = chroma / (255 - Math.abs(max + min - 255));

  let hue;
  if (max === r) hue = ((g - b) / chroma + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / chroma + 2) / 6;
  else hue = ((r - g) / chroma + 4) / 6;

  return { hue, saturation, lightness };
}

/**
 * The most common colour among the pixels that are actually the product,
 * returned as a CSS colour with its lightness brought into the band white text
 * can be read against.
 *
 * @param {Uint8ClampedArray} data
 * @returns {string | null}
 */
function dominant(data) {
  /** @type {Map<number, { count: number, r: number, g: number, b: number }>} */
  const bins = new Map();
  let fallback = null;

  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < MIN_ALPHA) continue;

    const { saturation, lightness } = toHsl(r, g, b);
    fallback ??= { r, g, b };

    if (saturation < MIN_SATURATION) continue;
    if (lightness < LIGHTNESS_RANGE[0] || lightness > LIGHTNESS_RANGE[1]) continue;

    const key =
      Math.round(r / BUCKET) * 65536 + Math.round(g / BUCKET) * 256 + Math.round(b / BUCKET);

    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bin.count += 1;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }

  let winner = null;
  for (const bin of bins.values()) {
    if (!winner || bin.count > winner.count) winner = bin;
  }

  const picked = winner
    ? { r: winner.r / winner.count, g: winner.g / winner.count, b: winner.b / winner.count }
    : fallback;

  if (!picked) return null;

  // Scale the whole colour toward or away from black until its lightness lands
  // in the band. Scaling rather than mixing keeps the hue and the saturation
  // exactly where the photograph put them.
  const { lightness } = toHsl(picked.r, picked.g, picked.b);
  const target = Math.min(Math.max(lightness, TINT_LIGHTNESS[0]), TINT_LIGHTNESS[1]);
  const scale = lightness > 0 ? target / lightness : 1;

  const channel = (value) => Math.round(Math.min(255, Math.max(0, value * scale)));

  return `rgb(${channel(picked.r)} ${channel(picked.g)} ${channel(picked.b)})`;
}

/**
 * The same image at a fraction of the size. Shopify serves whatever width is
 * asked for, so the pixels are read from a thumbnail rather than the full
 * photograph.
 *
 * @param {string} src
 */
function thumbnail(src) {
  try {
    const url = new URL(src, window.location.href);
    url.searchParams.set('width', `${SAMPLE * 4}`);
    url.searchParams.delete('height');
    url.searchParams.delete('crop');
    return url.href;
  } catch {
    return src;
  }
}

/** @param {string} src @returns {Promise<string | null>} */
function read(src) {
  const cached = readings.get(src);
  if (cached) return cached;

  const reading = new Promise((resolve) => {
    const image = new Image();

    // Without this the canvas is tainted and cannot be read back at all.
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';

    image.addEventListener('load', () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE;
        canvas.height = SAMPLE;

        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(null);

        context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
        resolve(dominant(context.getImageData(0, 0, SAMPLE, SAMPLE).data));
      } catch {
        resolve(null);
      }
    });

    image.addEventListener('error', () => resolve(null));
    image.src = thumbnail(src);
  });

  readings.set(src, reading);
  return reading;
}

/** @param {Element} gallery */
async function tint(gallery) {
  if (!(gallery instanceof HTMLElement) || gallery.dataset.tintChecked !== undefined) return;
  gallery.dataset.tintChecked = '';

  const image = gallery.querySelector('img');
  if (!image?.currentSrc && !image?.src) return;

  const colour = await read(image.currentSrc || image.src);
  if (!colour) return;

  gallery.style.setProperty('--card-media-hover', colour);
  gallery.dataset.tinted = '';
}

/**
 * Read lazily: a card far down a collection page may never be looked at, and
 * decoding its image to find a colour nobody will see is work for nothing.
 */
const watcher =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            tint(entry.target);
          }
        },
        { rootMargin: '200px' }
      )
    : null;

function scan() {
  for (const gallery of document.querySelectorAll('.card-gallery')) {
    if (/** @type {HTMLElement} */ (gallery).dataset.tintChecked !== undefined) continue;
    if (watcher) watcher.observe(gallery);
    else tint(gallery);
  }
}

scan();

// Sections re-render on filter, pagination and editor edits, and morph leaves
// new cards behind that were never scanned.
document.addEventListener('shopify:section:load', scan);
document.addEventListener('DOMContentLoaded', scan);
