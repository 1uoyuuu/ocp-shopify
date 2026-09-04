/**
 * Text rasterised to a texture and pushed through a glass-like distortion:
 * an ambient undulation everywhere, plus a lens that follows the cursor.
 *
 * Ported from React Bits' WarpText. The original leans on `ogl` for a
 * renderer, program, triangle, mesh and texture — five thin wrappers that
 * come to about eighty lines of plain WebGL2, which is written out here
 * rather than vendoring a library this theme has no way to build or audit.
 *
 * The heading is real text in the DOM. Only once a context is running does
 * the canvas take over and the text step aside, so no WebGL, no WebGL2, a
 * lost context or a blocked module each leave the words on the page.
 */

const VERTEX = `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uTextTexture;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uPointerActive;
uniform float uTime;
uniform float uWarpStrength;
uniform float uWarpScale;
uniform float uSpeed;
uniform float uPointerInfluence;
uniform float uPointerStrength;
uniform float uRefraction;
uniform float uRipple;
uniform float uMotion;

in vec2 vUv;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p *= 2.02;
    amplitude *= 0.5;
  }
  return value;
}

vec4 sampleText(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture(uTextTexture, uv);
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float time = uTime * uSpeed;
  float scale = max(uWarpScale, 0.001);

  vec2 drift = vec2(time * 0.055, -time * 0.045);
  float n1 = fbm(uv * scale * 3.1 + drift);
  float n2 = fbm((uv + 19.17) * scale * 3.4 - drift.yx);
  vec2 ambient = (vec2(n1, n2) - 0.5) * uWarpStrength * 0.045 * uMotion;

  vec2 pointerDelta = uv - uPointer;
  vec2 aspectDelta = vec2(pointerDelta.x * aspect, pointerDelta.y);
  float dist = length(aspectDelta);
  float radius = max(uPointerInfluence, 0.001);
  float t = clamp(dist / radius, 0.0, 1.0);
  float lens = smoothstep(radius, 0.0, dist) * uPointerActive;
  float bulge = t * (1.0 - t) * (1.0 - t) * 6.75 * uPointerActive;
  vec2 dir = dist > 0.0001 ? vec2(aspectDelta.x / aspect, aspectDelta.y) / dist : vec2(0.0);

  float rippleWave = sin(dist * 28.0 - time * 4.2) * 0.5 + 0.5;
  float rippleRing = (rippleWave - 0.5) * uRipple;
  vec2 pointerWarp = -dir * bulge * uPointerStrength * 0.045;
  pointerWarp += dir * rippleRing * bulge * uPointerStrength * 0.016;

  vec2 displaced = uv + ambient + pointerWarp;
  vec2 splitDir = ambient + pointerWarp;
  float splitLen = length(splitDir);
  splitDir = splitLen > 0.00001 ? splitDir / splitLen : vec2(0.7071, 0.7071);
  vec2 split = splitDir * uRefraction * 0.16 * (0.35 + lens * 1.65);

  vec4 base = sampleText(displaced);
  float r = sampleText(displaced + split).r;
  float g = base.g;
  float b = sampleText(displaced - split).b;
  float a = max(max(sampleText(displaced + split).a, base.a), sampleText(displaced - split).a);

  vec3 color = vec3(r, g, b) + lens * base.a * 0.055;
  fragColor = vec4(color, a);
}`;

const UNIFORMS = [
  'uTextTexture', 'uResolution', 'uPointer', 'uPointerActive', 'uTime',
  'uWarpStrength', 'uWarpScale', 'uSpeed', 'uPointerInfluence',
  'uPointerStrength', 'uRefraction', 'uRipple', 'uMotion',
];

/** Retina is worth it for type; beyond that it is fill rate for nothing. */
const MAX_DPR = 2;

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number} type
 * @param {string} source
 * @returns {WebGLShader | null}
 */
function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[warp-text] shader failed to compile:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

class WarpText extends HTMLElement {
  /** @type {WebGL2RenderingContext | null} */
  #gl = null;
  /** @type {HTMLCanvasElement | null} */
  #canvas = null;
  /** @type {WebGLProgram | null} */
  #program = null;
  /** @type {WebGLTexture | null} */
  #texture = null;
  /** @type {Record<string, WebGLUniformLocation | null>} */
  #uniform = {};
  /** @type {HTMLElement | null} */
  #label = null;

  #frame = 0;
  #started = 0;
  #lost = false;
  #onScreen = true;
  #reduceMotion = false;

  #pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, active: 0, target: 0 };

  /** @type {ResizeObserver | undefined} */
  #resizeObserver;
  /** @type {IntersectionObserver | undefined} */
  #intersectionObserver;
  /** @type {MediaQueryList | undefined} */
  #motionQuery;

  connectedCallback() {
    this.#label = this.querySelector('[ref="label"]');
    if (!this.#label) return;

    this.#motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.#reduceMotion = this.#motionQuery.matches;

    if (!this.#start()) return;

    this.#motionQuery.addEventListener('change', this.#onMotionChange);
    document.addEventListener('visibilitychange', this.#onVisibility);

    this.#resizeObserver = new ResizeObserver(this.#resize);
    this.#resizeObserver.observe(this);

    // Nothing runs while it is off screen or the tab is in the background.
    this.#intersectionObserver = new IntersectionObserver(([entry]) => {
      this.#onScreen = Boolean(entry?.isIntersecting);
      this.#onScreen ? this.#play() : this.#pause();
    });
    this.#intersectionObserver.observe(this);

    // Only now does the canvas replace the words.
    this.dataset.warpActive = '';
  }

  disconnectedCallback() {
    this.#pause();

    this.#resizeObserver?.disconnect();
    this.#intersectionObserver?.disconnect();
    this.#motionQuery?.removeEventListener('change', this.#onMotionChange);
    document.removeEventListener('visibilitychange', this.#onVisibility);

    this.#canvas?.removeEventListener('pointermove', this.#onPointerMove);
    this.#canvas?.removeEventListener('pointerleave', this.#onPointerLeave);
    this.#canvas?.removeEventListener('webglcontextlost', this.#onContextLost);

    const gl = this.#gl;
    if (gl && !this.#lost) {
      if (this.#texture) gl.deleteTexture(this.#texture);
      if (this.#program) gl.deleteProgram(this.#program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }

    this.#canvas?.remove();
    this.#gl = null;
    delete this.dataset.warpActive;
  }

  /** @returns {boolean} Whether a context is up and running. */
  #start() {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    });

    if (!gl) return false;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) return false;

    const program = gl.createProgram();
    if (!program) return false;

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[warp-text] program failed to link:', gl.getProgramInfoLog(program));
      return false;
    }

    gl.useProgram(program);
    for (const name of UNIFORMS) this.#uniform[name] = gl.getUniformLocation(program, name);

    // One triangle large enough to cover the clip volume — cheaper than two,
    // and with no seam down the diagonal.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    this.#attribute(gl, program, 'position', new Float32Array([-1, -1, 3, -1, -1, 3]));
    this.#attribute(gl, program, 'uv', new Float32Array([0, 0, 2, 0, 0, 2]));

    this.#texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // The 2D canvas has y running down and the quad's v runs up.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    this.#canvas = canvas;
    this.#gl = gl;
    this.#program = program;

    canvas.addEventListener('pointermove', this.#onPointerMove);
    canvas.addEventListener('pointerleave', this.#onPointerLeave);
    canvas.addEventListener('webglcontextlost', this.#onContextLost, false);

    this.appendChild(canvas);

    this.#syncSettings();
    this.#resize();
    this.#started = performance.now();
    this.#play();

    // Metrics measured against a fallback face go stale the moment the real
    // one arrives, so the texture is drawn again once it has.
    document.fonts?.ready.then(() => this.#rasterise());

    return true;
  }

  /**
   * @param {WebGL2RenderingContext} gl
   * @param {WebGLProgram} program
   * @param {string} name
   * @param {Float32Array} data
   */
  #attribute(gl, program, name, data) {
    const location = gl.getAttribLocation(program, name);
    if (location < 0) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  }

  /** @param {string} name @param {number} fallback @returns {number} */
  #number(name, fallback) {
    const value = parseFloat(this.dataset[name] ?? '');
    return Number.isFinite(value) ? value : fallback;
  }

  #syncSettings() {
    const gl = this.#gl;
    if (!gl) return;

    gl.uniform1f(this.#uniform.uWarpStrength, this.#number('warpStrength', 0.08));
    gl.uniform1f(this.#uniform.uWarpScale, this.#number('warpScale', 1.7));
    gl.uniform1f(this.#uniform.uSpeed, this.#number('speed', 0.55));
    gl.uniform1f(this.#uniform.uPointerInfluence, this.#number('pointerInfluence', 0.42));
    gl.uniform1f(this.#uniform.uPointerStrength, this.#number('pointerStrength', 0.38));
    gl.uniform1f(this.#uniform.uRefraction, this.#number('refraction', 0.018));
    gl.uniform1f(this.#uniform.uRipple, this.dataset.ripple === 'false' ? 0 : 1);
    gl.uniform1f(this.#uniform.uMotion, this.#reduceMotion ? 0 : 1);
    gl.uniform1i(this.#uniform.uTextTexture, 0);
  }

  /**
   * Draws the heading into a 2D canvas and uploads it. The type is measured
   * from the live DOM heading rather than from settings, so it stays on the
   * site's own scale and picks up whatever the stylesheet says.
   */
  #rasterise() {
    const gl = this.#gl;
    const label = this.#label;
    if (!gl || !label || this.#lost) return;

    const { width, height } = this.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const style = getComputedStyle(label);
    let size = parseFloat(style.fontSize) || 96;
    let tracking = style.letterSpacing === 'normal' ? 0 : parseFloat(style.letterSpacing) || 0;
    let leading = parseFloat(style.lineHeight);
    if (!Number.isFinite(leading)) leading = size * 1.05;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = style.color;
    ctx.imageSmoothingQuality = 'high';

    const lines = (label.textContent ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
    const font = () => {
      ctx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
    };
    font();

    // The distortion pushes glyphs outwards, so the type is kept inside a
    // margin rather than run to the edges where it would be clipped.
    const measure = (line) => {
      const chars = [...line];
      const glyphs = chars.reduce((total, char) => total + ctx.measureText(char).width, 0);
      return glyphs + Math.max(0, chars.length - 1) * tracking;
    };

    const widest = Math.max(...lines.map(measure), 1);
    const block = Math.max(leading * lines.length, 1);
    const fit = Math.min(1, (width * 0.86) / widest, (height * 0.78) / block);

    if (fit < 1) {
      size *= fit;
      tracking *= fit;
      leading *= fit;
      font();
    }

    const top = height / 2 - (leading * (lines.length - 1)) / 2;
    lines.forEach((line, index) => {
      let cursor = width / 2 - measure(line) / 2;
      for (const char of [...line]) {
        ctx.fillText(char, cursor, top + index * leading);
        cursor += ctx.measureText(char).width + tracking;
      }
    });

    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    this.#draw();
  }

  #resize = () => {
    const gl = this.#gl;
    const canvas = this.#canvas;
    if (!gl || !canvas || this.#lost) return;

    const { width, height } = this.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(this.#uniform.uResolution, canvas.width, canvas.height);

    this.#rasterise();
  };

  /** @param {PointerEvent} event */
  #onPointerMove = (event) => {
    if (event.pointerType === 'touch' || !this.#canvas) return;

    const { left, top, width, height } = this.#canvas.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;

    this.#pointer.tx = (event.clientX - left) / width;
    this.#pointer.ty = 1 - (event.clientY - top) / height;
    this.#pointer.target = 1;
  };

  #onPointerLeave = () => {
    this.#pointer.target = 0;
  };

  /** @param {Event} event */
  #onContextLost = (event) => {
    event.preventDefault();
    this.#lost = true;
    this.#pause();

    // Put the words back rather than leaving an empty box.
    delete this.dataset.warpActive;
  };

  #onVisibility = () => {
    document.hidden ? this.#pause() : this.#play();
  };

  /** @param {MediaQueryListEvent} event */
  #onMotionChange = (event) => {
    this.#reduceMotion = event.matches;
    this.#syncSettings();
    this.#draw();
  };

  #play() {
    if (this.#frame || this.#lost || document.hidden || !this.#onScreen) return;
    this.#frame = requestAnimationFrame(this.#tick);
  }

  #pause() {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  /** @param {number} now */
  #tick = (now) => {
    const gl = this.#gl;
    if (!gl || this.#lost) return;

    const elapsed = (now - this.#started) * 0.001;
    const pointer = this.#pointer;

    // With no cursor on it the lens wanders on its own, so the type is never
    // quite still.
    const idleX = 0.5 + Math.sin(elapsed * 0.33) * 0.12;
    const idleY = 0.5 + Math.cos(elapsed * 0.27) * 0.1;
    const targetX = pointer.target > 0 ? pointer.tx : idleX;
    const targetY = pointer.target > 0 ? pointer.ty : idleY;
    const damping = pointer.target > 0 ? 0.12 : 0.035;

    pointer.x += (targetX - pointer.x) * damping;
    pointer.y += (targetY - pointer.y) * damping;
    pointer.active += ((pointer.target > 0 ? 1 : 0.18) - pointer.active) * 0.06;

    gl.uniform2f(this.#uniform.uPointer, pointer.x, pointer.y);
    gl.uniform1f(this.#uniform.uPointerActive, this.#reduceMotion ? pointer.active * 0.35 : pointer.active);
    gl.uniform1f(this.#uniform.uTime, this.#reduceMotion ? 0 : elapsed);

    this.#draw();
    this.#frame = requestAnimationFrame(this.#tick);
  };

  #draw() {
    const gl = this.#gl;
    if (!gl || this.#lost) return;

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

if (!customElements.get('warp-text')) {
  customElements.define('warp-text', WarpText);
}
