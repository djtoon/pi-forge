// AI Icon Pack — morphing AI state icons. Zero dependencies; works as an ES module in any browser or bundler,
// and is SSR-safe (nothing touches the DOM until createAIState() is called).
//
//   import { createAIState } from './ai-state.js';
//   const ai = createAIState(document.querySelector('#status'), { state: 'idle', variant: 'outline', size: 24 });
//   ai.set('thinking');            // morphs smoothly from the current state
//
//   <ai-state state="thinking" variant="filled" size="32" gradient></ai-state>   (custom element, auto-registered)
//
// Every state is drawn with the same five "blobs". A blob is one closed path with a fixed command structure
// (M + 4 Q + Z), so any state can morph into any other by interpolating each blob's parameters.

const STROKE = 1.75;
const N = 5;

// Blob parameters: [x, y, rx, ry, k, rot (deg), opacity, solid]
//   k = curvature: 0.22 is the pack's spark, 0.91 is a circle, 0 is a diamond. rx≈0 turns a blob into a round-capped line.
//   solid = how much the blob fills in the filled variant (0 keeps it a ring, e.g. the search lens).
const hidden = (x = 12, y = 12) => [x, y, 0, 0, 0.91, 0, 0, 1];
const spark = (x, y, r, rot = 0) => [x, y, r, r, 0.22, rot, 1, 1];
const dot = (x, y, r) => [x, y, r, r, 0.91, 0, 1, 1];
const ring = (x, y, r) => [x, y, r, r, 0.91, 0, 1, 0];
const line = (x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  return [(x1 + x2) / 2, (y1 + y2) / 2, 0.01, len / 2, 0.91, (Math.atan2(-dx, dy) * 180) / Math.PI, 1, 1];
};

// Blob order is fixed across states: A is the "hero" (usually the spark), B–E are supporting marks.
export const STATES = {
  idle: [spark(10, 14, 7), spark(18, 6, 3), dot(19.5, 17.5, 1), hidden(10, 14), hidden(10, 14)],
  listening: [line(12, 4.5, 12, 19.5), line(8, 7, 8, 17), line(16, 7, 16, 17), line(4, 9.5, 4, 14.5), line(20, 9.5, 20, 14.5)],
  thinking: [spark(12, 6.5, 3.5), dot(5.5, 15.5, 0.75), dot(12, 15.5, 0.75), dot(18.5, 15.5, 0.75), hidden(12, 15.5)],
  searching: [ring(10.5, 10.5, 6.25), line(15.5, 15.5, 20, 20), spark(10.5, 10.5, 2.75), hidden(10.5, 10.5), hidden(10.5, 10.5)],
  working: [spark(12, 12, 4.75), dot(17.66, 6.34, 1), dot(6.34, 6.34, 1), dot(6.34, 17.66, 1), dot(17.66, 17.66, 1)],
  generating: [spark(15, 17.5, 3.5), line(3.5, 6.5, 17.5, 6.5), line(3.5, 12, 14, 12), line(3.5, 17.5, 9, 17.5), hidden(9, 17.5)],
  speaking: [spark(8, 12, 4.75), line(15, 9, 15, 15), line(18, 6, 18, 18), line(21, 8.5, 21, 15.5), hidden(8, 12)],
  done: [spark(6.5, 6, 2.5), line(4.5, 12.5, 9.5, 17.5), line(9.5, 17.5, 19.5, 7.5), hidden(12, 12), hidden(12, 12)],
  error: [hidden(12, 12), line(6, 6, 18, 18), line(18, 6, 6, 18), hidden(12, 12), hidden(12, 12)],
  paused: [hidden(12, 12), line(9, 6, 9, 18), line(15, 6, 15, 18), hidden(12, 12), hidden(12, 12)],
};
export const STATE_NAMES = Object.keys(STATES);

export const STATE_LABELS = {
  idle: 'AI idle', listening: 'AI listening', thinking: 'AI thinking', searching: 'AI searching', working: 'AI working',
  generating: 'AI generating', speaking: 'AI speaking', done: 'AI done', error: 'AI error', paused: 'AI paused',
};

// ── live motion per state (applied on top of the resting frame) ──────────────────────────────────────────────
const scale = (b, s) => { b[2] *= s; b[3] *= s; };
const LIVE = {
  idle(b, t) { scale(b[0], 1 + 0.05 * Math.sin(t * 1.8)); scale(b[1], 1 + 0.18 * Math.sin(t * 2.6 + 1)); b[1][5] += 10 * Math.sin(t * 1.3); },
  listening(b, t) { [0, 1.1, 2.3, 0.6, 1.7].forEach((ph, i) => { b[i][3] *= 0.62 + 0.38 * Math.sin(t * 3.4 + ph); }); },
  thinking(b, t) {
    for (let i = 1; i <= 3; i++) b[i][1] -= 1.6 * Math.max(0, Math.sin(t * 5.2 - (i - 1) * 0.9));
    b[0][5] += 12 * Math.sin(t * 1.4); scale(b[0], 1 + 0.08 * Math.sin(t * 2.1));
  },
  searching(b, t) { const dx = 1.25 * Math.cos(t * 2.2), dy = 1.25 * Math.sin(t * 2.2); for (const i of [0, 1, 2]) { b[i][0] += dx; b[i][1] += dy; } b[2][5] += t * 60; },
  working(b, t) {
    for (let i = 1; i <= 4; i++) {
      const R = Math.hypot(b[i][0] - 12, b[i][1] - 12), a = Math.atan2(b[i][1] - 12, b[i][0] - 12) + t * 1.6;
      b[i][0] = 12 + R * Math.cos(a); b[i][1] = 12 + R * Math.sin(a);
    }
    b[0][5] += t * 45; scale(b[0], 1 + 0.06 * Math.sin(t * 3));
  },
  generating(b, t) {
    const end = 7.5 + 2.5 * Math.sin(t * 1.8);           // the last line is being written…
    b[3][0] = (3.5 + end) / 2; b[3][3] = (end - 3.5) / 2;
    b[0][0] = end + 6; scale(b[0], 1 + 0.1 * Math.sin(t * 4)); // …and the spark rides its tip
  },
  speaking(b, t) { [0.4, 1.5, 2.6].forEach((ph, j) => { b[j + 1][3] *= 0.55 + 0.45 * Math.sin(t * 4.6 + ph); }); scale(b[0], 1 + 0.07 * Math.sin(t * 4.6)); },
  done(b, t) { scale(b[0], 1 + 0.12 * Math.sin(t * 2.2)); },
  error(b, t, ts) { const dx = Math.sin(ts * 40) * 0.9 * Math.max(0, 1 - ts / 0.6); b[1][0] += dx; b[2][0] += dx; },
  paused(b, t) { const o = 0.7 + 0.3 * Math.cos(t * 1.6); b[1][6] *= o; b[2][6] *= o; },
};

// ── geometry ──────────────────────────────────────────────────────────────────────────────────────────────────
const f = (v) => +v.toFixed(2);

/** Path for one blob. Always M + 4 Q + Z, so every blob in every state is morph-compatible (also with CSS `d` transitions). */
export function blobPath([x, y, rx, ry, k, rot]) {
  const a = (rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const P = (px, py) => `${f(x + px * c - py * s)} ${f(y + px * s + py * c)}`;
  const kx = k * rx, ky = k * ry;
  return `M${P(0, -ry)}Q${P(kx, -ky)} ${P(rx, 0)}Q${P(kx, ky)} ${P(0, ry)}Q${P(-kx, ky)} ${P(-rx, 0)}Q${P(-kx, -ky)} ${P(0, -ry)}Z`;
}

const clone = (blobs) => blobs.map((b) => b.slice());
// Each blob starts slightly after the previous one, so shapes flow past each other instead of clumping.
const STAGGER = 0.08;
const blobProgress = (p, i) => ease(Math.max(0, Math.min(1, (p - i * STAGGER) / (1 - (N - 1) * STAGGER))));
function lerp(from, to, p) {
  return from.map((a, i) => {
    const b = to[i], r = a.slice(), e = blobProgress(p, i);
    for (let j = 0; j < 8; j++) r[j] = a[j] + (b[j] - a[j]) * e;
    // Blobs are symmetric under 180° rotation: always turn the short way.
    const d = ((((b[5] - a[5]) % 180) + 270) % 180) - 90;
    r[5] = a[5] + d * e;
    return r;
  });
}
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** Inner markup (paths only) of a state's resting frame, for static SVGs. */
export function stateMarkup(name) {
  const blobs = STATES[name];
  if (!blobs) throw new Error(`unknown AI state "${name}". States: ${STATE_NAMES.join(', ')}`);
  return blobs.filter((b) => b[6] > 0).map((b) => `<path d="${blobPath(b)}"${b[7] < 0.5 ? ' fill="none"' : ''}/>`).join('');
}

/** Complete static SVG for a state (variant 'outline' | 'filled'). */
export function stateSvg(name, variant = 'outline') {
  const fill = variant === 'filled' ? 'currentColor' : 'none';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${stateMarkup(name)}</svg>`;
}

// ── runtime ───────────────────────────────────────────────────────────────────────────────────────────────────
let uid = 0;
const SVGNS = 'http://www.w3.org/2000/svg';
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Mount a morphing AI state icon inside `host`.
 * options: state ('idle'), variant ('outline' | 'filled'), size (24), gradient (false), live (true), duration (450 ms), label
 * Returns { svg, state, set(state), configure(options), destroy() }.
 */
export function createAIState(host, options = {}) {
  const opts = { state: 'idle', variant: 'outline', size: 24, gradient: false, live: undefined, duration: 450 };
  for (const [k, v] of Object.entries(options)) if (v !== undefined) opts[k] = v;
  if (opts.live === undefined) opts.live = !reducedMotion();
  if (!STATES[opts.state]) opts.state = 'idle';
  const id = `ai-state-grad-${++uid}`;

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('role', 'img');
  svg.style.display = 'block';
  svg.style.overflow = 'visible';
  svg.innerHTML =
    `<defs><linearGradient id="${id}" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#8B5CF6"/><stop offset=".55" stop-color="#6366F1"/><stop offset="1" stop-color="#06B6D4"/></linearGradient></defs>`;
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('stroke-width', STROKE);
  g.setAttribute('stroke-linecap', 'round');
  g.setAttribute('stroke-linejoin', 'round');
  const paths = Array.from({ length: N }, () => g.appendChild(document.createElementNS(SVGNS, 'path')));
  svg.appendChild(g);
  host.appendChild(svg);

  let state = opts.state, enteredAt = performance.now();
  let from = null, morphStart = 0, raf = 0;
  let current = clone(STATES[state]);

  function paint() {
    const p = opts.gradient ? `url(#${id})` : 'currentColor';
    g.setAttribute('stroke', p);
    g.setAttribute('fill', opts.variant === 'filled' ? p : 'none');
    svg.setAttribute('width', opts.size);
    svg.setAttribute('height', opts.size);
    svg.setAttribute('aria-label', opts.label || STATE_LABELS[state] || `AI ${state}`);
  }

  function frame(now) {
    const t = now / 1000;
    const target = clone(STATES[state]);
    if (opts.live && LIVE[state]) LIVE[state](target, t, (now - enteredAt) / 1000);
    let e = 1;
    if (from) {
      e = opts.duration > 0 ? Math.min(1, (now - morphStart) / opts.duration) : 1;
      current = e < 1 ? lerp(from, target, e) : target;
      if (e >= 1) from = null;
    } else current = target;
    current.forEach((b, i) => {
      paths[i].setAttribute('d', blobPath(b));
      paths[i].setAttribute('opacity', f(Math.max(0, Math.min(1, b[6]))));
      paths[i].setAttribute('fill-opacity', f(Math.max(0, Math.min(1, b[7]))));
    });
    raf = from || opts.live ? requestAnimationFrame(frame) : 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  paint();
  frame(performance.now());

  return {
    svg,
    get state() { return state; },
    set(next) {
      if (!STATES[next]) throw new Error(`unknown AI state "${next}". States: ${STATE_NAMES.join(', ')}`);
      if (next === state) return;
      from = clone(current);
      morphStart = enteredAt = performance.now();
      state = next;
      paint();
      kick();
    },
    configure(next = {}) {
      const { state: nextState, ...rest } = next;
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) opts[k] = v;
      paint();
      kick();
      if (nextState && nextState !== state) this.set(nextState);
    },
    destroy() { cancelAnimationFrame(raf); raf = 0; svg.remove(); },
  };
}

// ── <ai-state> custom element ─────────────────────────────────────────────────────────────────────────────────
export function defineAIStateElement(tag = 'ai-state') {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return;
  class AIStateElement extends HTMLElement {
    static get observedAttributes() { return ['state', 'variant', 'size', 'gradient', 'live', 'duration', 'label']; }
    options() {
      const a = (n) => this.getAttribute(n);
      return {
        state: a('state') || 'idle', variant: a('variant') || 'outline', size: a('size') || 24,
        gradient: this.hasAttribute('gradient') && a('gradient') !== 'false',
        live: a('live') === null ? !reducedMotion() : a('live') !== 'false',
        duration: a('duration') === null ? 450 : +a('duration'), label: a('label') || undefined,
      };
    }
    connectedCallback() { if (!this.ai) { if (!this.style.display) this.style.display = 'inline-flex'; this.ai = createAIState(this, this.options()); } }
    disconnectedCallback() { this.ai?.destroy(); this.ai = null; }
    attributeChangedCallback(name) { if (!this.ai) return; name === 'state' ? this.ai.set(this.options().state) : this.ai.configure({ ...this.options(), state: undefined }); }
    get state() { return this.getAttribute('state') || 'idle'; }
    set state(v) { this.setAttribute('state', v); }
  }
  customElements.define(tag, AIStateElement);
}
defineAIStateElement();

/** Inner markup of the frame `e` (0–1, eased) of the morph from state `a` to state `b`. Handy for previews and tests. */
export function morphMarkup(a, b, e) {
  return lerp(STATES[a], STATES[b], e).filter((x) => x[6] > 0.01)
    .map((x) => `<path d="${blobPath(x)}" opacity="${f(x[6])}"${x[7] < 0.5 ? ' fill="none"' : ''}/>`).join('');
}
