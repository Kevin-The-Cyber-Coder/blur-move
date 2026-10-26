/* ============================================================
   UTIL — math, spline, colour, formatting helpers
   ============================================================ */

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a || 1);
export const smoothstep = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const mix = lerp;
export const approach = (cur, target, delta) => cur < target ? Math.min(cur + delta, target) : Math.max(cur - delta, target);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const sign = v => v < 0 ? -1 : v > 0 ? 1 : 0;
export const deg = r => r * 180 / Math.PI;
export const rad = d => d * Math.PI / 180;
export const kmh = mps => mps * 3.6;
export const wrapAngle = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export const angleDiff = (a, b) => wrapAngle(a - b);
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const chance = p => Math.random() < p;
export const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const uuid = () => Math.random().toString(36).slice(2, 10);
export const round = (v, n = 0) => { const f = Math.pow(10, n); return Math.round(v * f) / f; };

/* ---- colour helpers (0xRRGGBB ints) ---- */
export const hexToRgb = h => ({ r: (h >> 16) & 255, g: (h >> 8) & 255, b: h & 255 });
export const rgbToHex = (r, g, b) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
export const mixHex = (a, b, t) => {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(Math.round(lerp(A.r, B.r, t)), Math.round(lerp(A.g, B.g, t)), Math.round(lerp(A.b, B.b, t)));
};
export const scaleHex = (h, k) => {
  const c = hexToRgb(h);
  return rgbToHex(clamp(c.r * k, 0, 255) | 0, clamp(c.g * k, 0, 255) | 0, clamp(c.b * k, 0, 255) | 0);
};
export const cssHex = h => '#' + h.toString(16).padStart(6, '0');

/* ---- formatting ---- */
export function fmtTime(sec) {
  if (!isFinite(sec) || sec <= 0) return '--:--.--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
export function fmtShort(sec) {
  if (!isFinite(sec) || sec <= 0) return '0.0';
  return sec < 60 ? sec.toFixed(1) : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}
export function fmtNum(n) {
  n = Math.round(n);
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(0) + 'K';
  return n.toLocaleString('en-US');
}
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
export const pad2 = n => String(n).padStart(2, '0');

/* ---- small deterministic RNG (mulberry32) ---- */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================================================
   TRACK SPLINE — closed, arc-length parameterised racing line.
   Everything positional in the game funnels through this.
   ============================================================ */
export class TrackSpline {
  constructor(points, closed = true) {
    this.closed = closed;
    this.pts = points.map(p => ({ x: p[0], y: p[2] || 0, z: p[1] }));
    this._build();
  }

  _cr(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  _build(density = 60) {
    const P = this.pts, n = P.length;
    const raw = [];
    const segCount = this.closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const i0 = (i - 1 + n) % n, i1 = i, i2 = (i + 1) % n, i3 = (i + 2) % n;
      const p0 = P[i0], p1 = P[i1], p2 = P[i2], p3 = P[i3];
      for (let s = 0; s < density; s++) {
        const t = s / density;
        raw.push({
          x: this._cr(p0.x, p1.x, p2.x, p3.x, t),
          y: this._cr(p0.y, p1.y, p2.y, p3.y, t),
          z: this._cr(p0.z, p1.z, p2.z, p3.z, t),
        });
      }
    }
    if (this.closed) raw.push({ ...raw[0] }); else raw.push(P[n - 1]);

    // cumulative arc length
    let len = 0;
    const cum = [0];
    for (let i = 1; i < raw.length; i++) {
      len += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y, raw[i].z - raw[i - 1].z);
      cum.push(len);
    }
    // resample uniformly
    const N = Math.max(120, Math.round(len / 2.2));
    const pts = [], dists = [];
    let j = 0;
    for (let i = 0; i < N; i++) {
      const target = (i / N) * len;
      while (j < cum.length - 2 && cum[j + 1] < target) j++;
      const t = (target - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      const a = raw[j], b = raw[Math.min(j + 1, raw.length - 1)];
      pts.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
      dists.push(target);
    }
    this.length = len;
    this.samples = pts;
    this.count = N;
    this.spacing = len / N;

    // tangents (unit, 3D) + normals (horizontal right vector)
    this.tangents = [];
    this.normals = [];
    for (let i = 0; i < N; i++) {
      const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
      let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
      const l = Math.hypot(tx, ty, tz) || 1;
      tx /= l; ty /= l; tz /= l;
      this.tangents.push({ x: tx, y: ty, z: tz });
      // right = normalize(cross(tangent, up)) in XZ
      const rx = tz, rz = -tx;
      const rl = Math.hypot(rx, rz) || 1;
      this.normals.push({ x: rx / rl, z: rz / rl });
    }
    // curvature (signed) and suggested max speed per sample
    this.curvature = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.tangents[(i - 1 + N) % N], b = this.tangents[(i + 1) % N];
      const crossY = a.z * b.x - a.x * b.z; // signed y of cross
      const dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
      const ang = Math.acos(dot);
      this.curvature[i] = (Math.atan2(crossY, dot) || 0) / (this.spacing * 2);
    }
    // smooth curvature a little
    const sm = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -3; k <= 3; k++) s += this.curvature[(i + k + N) % N];
      sm[i] = s / 7;
    }
    this.curvature = sm;

    // spatial hash for nearest-point queries
    this.cell = 30;
    this.hash = new Map();
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      const k = this._key(p.x, p.z);
      let arr = this.hash.get(k);
      if (!arr) this.hash.set(k, arr = []);
      arr.push(i);
    }
    // bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    this.bounds = { minX, maxX, minZ, maxZ, minY, maxY };
  }

  _key(x, z) { return (Math.floor(x / this.cell)) + ',' + (Math.floor(z / this.cell)); }

  /* wrap a distance into [0,length) */
  wrap(d) { const L = this.length; return ((d % L) + L) % L; }
  /* signed delta along track from a to b */
  delta(a, b) { let d = b - a; const L = this.length; if (d > L / 2) d -= L; if (d < -L / 2) d += L; return d; }

  idxAt(d) {
    const i = Math.floor(this.wrap(d) / this.spacing) % this.count;
    return (i + this.count) % this.count;
  }

  /** position/tangent/normal at distance d (linear interpolation between samples) */
  at(d, out = { x: 0, y: 0, z: 0 }) {
    const L = this.length;
    d = this.wrap(d);
    const f = d / this.spacing;
    const i = Math.floor(f) % this.count;
    const i2 = (i + 1) % this.count;
    const t = f - Math.floor(f);
    const a = this.samples[i], b = this.samples[i2];
    out.x = lerp(a.x, b.x, t); out.y = lerp(a.y, b.y, t); out.z = lerp(a.z, b.z, t);
    return out;
  }

  tangentAt(d, out = { x: 0, y: 0, z: 0 }) {
    const i = this.idxAt(d), i2 = (i + 1) % this.count;
    const a = this.tangents[i], b = this.tangents[i2];
    out.x = a.x + (b.x - a.x) * 0.5; out.y = a.y + (b.y - a.y) * 0.5; out.z = a.z + (b.z - a.z) * 0.5;
    const l = Math.hypot(out.x, out.y, out.z) || 1;
    out.x /= l; out.y /= l; out.z /= l;
    return out;
  }

  normalAt(d, out = { x: 0, z: 0 }) {
    const i = this.idxAt(d);
    out.x = this.normals[i].x; out.z = this.normals[i].z;
    return out;
  }

  /** point at distance d, offset laterally by `off` metres (+ = right) */
  pointAt(d, off = 0, out = { x: 0, y: 0, z: 0 }) {
    this.at(d, out);
    const i = this.idxAt(d);
    out.x += this.normals[i].x * off;
    out.z += this.normals[i].z * off;
    return out;
  }

  /** nearest sample to an XZ position; returns {i, dist, off, y} */
  nearest(x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= 2 && best < 0; r++) {
      for (let ox = -r; ox <= r; ox++) for (let oz = -r; oz <= r; oz++) {
        if (r > 0 && Math.abs(ox) !== r && Math.abs(oz) !== r) continue;
        const arr = this.hash.get((cx + ox) + ',' + (cz + oz));
        if (!arr) continue;
        for (const i of arr) {
          const p = this.samples[i];
          const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (dd < bestD) { bestD = dd; best = i; }
        }
      }
    }
    if (best < 0) { // linear fallback for far-away points
      for (let i = 0; i < this.count; i++) {
        const p = this.samples[i];
        const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (dd < bestD) { bestD = dd; best = i; }
      }
    }
    // refine against neighbours for smooth projection
    const i = best;
    const prev = (i - 1 + this.count) % this.count, next = (i + 1) % this.count;
    let segA = i, segB = next;
    const pA = this.samples[i], pB = this.samples[next];
    let ex = pB.x - pA.x, ez = pB.z - pA.z;
    const el2 = ex * ex + ez * ez || 1;
    let t = ((x - pA.x) * ex + (z - pA.z) * ez) / el2;
    if (t < 0) { segA = prev; segB = i; }
    // distance along
    const base = this.spacing * (segA + clamp(t, 0, 1));
    const p = this.samples[i];
    const n = this.normals[i];
    const off = (x - p.x) * n.x + (z - p.z) * n.z;
    return { i, along: this.wrap(base), off, y: p.y, dist: Math.sqrt(bestD) };
  }

  /** distance along track of a world XZ point */
  along(x, z) { return this.nearest(x, z).along; }

  /** curvature at distance */
  curvatureAt(d) { return this.curvature[this.idxAt(d)]; }

  /** suggested speed limit (m/s) given lateral grip accel */
  speedLimit(d, gripAccel) {
    const k = Math.abs(this.curvatureAt(d));
    if (k < 1e-5) return 999;
    return Math.sqrt(gripAccel / k);
  }

  /** lowest safe speed over the next `ahead` metres (corner braking) */
  minSpeedAhead(fromD, ahead, gripAccel) {
    let v = 999;
    const step = Math.max(4, this.spacing * 2);
    for (let s = 0; s <= ahead; s += step) {
      v = Math.min(v, this.speedLimit(fromD + s, gripAccel));
    }
    return v;
  }

  /** resample closed loop for minimap path (normalised 0..1 coords) */
  minimapPath() {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const w = Math.max(maxX - minX, 1), h = Math.max(maxZ - minZ, 1);
    const s = Math.max(w, h);
    const ox = (s - w) / 2, oz = (s - h) / 2;
    const pts = [];
    const stride = Math.max(1, Math.floor(this.count / 160));
    for (let i = 0; i < this.count; i += stride) {
      const p = this.samples[i];
      pts.push({ x: (p.x - minX + ox) / s, y: (p.z - minZ + oz) / s });
    }
    return pts;
  }
}

/* ---- 2D helpers for minimap / HUD ---- */
export function projectMini(p, bounds, size, pad = 0) {
  const { minX, maxX, minZ, maxZ } = bounds;
  const w = Math.max(maxX - minX, 1), h = Math.max(maxZ - minZ, 1);
  const s = Math.max(w, h);
  const ox = (s - w) / 2, oz = (s - h) / 2;
  const inner = size - pad * 2;
  return {
    x: pad + ((p.x - minX + ox) / s) * inner,
    y: pad + ((p.z - minZ + oz) / s) * inner,
  };
}

/* ---- easing ---- */
export const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
export const easeInOutQuad = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
export const easeOutBack = t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

/* ---- tiny event bus ---- */
export class Bus {
  constructor() { this.map = new Map(); }
  on(k, fn) { let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(fn); return () => this.off(k, fn); }
  off(k, fn) { const a = this.map.get(k); if (!a) return; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  emit(k, ...args) { const a = this.map.get(k); if (!a) return; for (const fn of a.slice()) { try { fn(...args); } catch (e) { console.error('[bus]', k, e); } } }
  clear() { this.map.clear(); }
}
export const bus = new Bus();

/* ---- simple object pool ---- */
export class Pool {
  constructor(factory, reset, size = 64) {
    this.factory = factory; this.reset = reset; this.free = []; this.active = [];
    for (let i = 0; i < size; i++) this.free.push(factory());
  }
  get() {
    const o = this.free.pop() || this.factory();
    this.active.push(o);
    return o;
  }
  release(o) {
    const i = this.active.indexOf(o);
    if (i >= 0) this.active.splice(i, 1);
    this.reset(o);
    this.free.push(o);
  }
  clear() { while (this.active.length) this.release(this.active[0]); }
}

/* ---- performance helpers ---- */
export function nowMs() { return performance.now(); }

export class RingStat {
  constructor(n = 60) { this.n = n; this.buf = []; }
  push(v) { this.buf.push(v); if (this.buf.length > this.n) this.buf.shift(); }
  get avg() { return this.buf.length ? this.buf.reduce((a, b) => a + b, 0) / this.buf.length : 0; }
  get max() { return this.buf.length ? Math.max(...this.buf) : 0; }
}
