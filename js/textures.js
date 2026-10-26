/* ============================================================
   TEXTURES — all generated procedurally (no external assets).
   Keeps the game a single self-contained download.
   ============================================================ */
let _c = null;
function canvas(w, h) {
  if (!_c) _c = document.createElement('canvas');
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}
const cache = new Map();
function memo(key, fn) {
  if (cache.has(key)) return cache.get(key);
  const v = fn(); cache.set(key, v); return v;
}

export function radialGlow(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return memo('glow' + size + inner + outer, () => {
    const cv = canvas(size, size), c = cv.getContext('2d');
    const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.55)'));
    g.addColorStop(1, outer);
    c.fillStyle = g; c.fillRect(0, 0, size, size);
    return cv;
  });
}

export function softCircle(size = 64) {
  return memo('soft' + size, () => {
    const cv = canvas(size, size), c = cv.getContext('2d');
    const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, size, size);
    return cv;
  });
}

export function smokePuff(size = 64) {
  return memo('smoke' + size, () => {
    const cv = canvas(size, size), c = cv.getContext('2d');
    const g = c.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.45, 'rgba(220,230,245,0.4)');
    g.addColorStop(1, 'rgba(200,215,235,0)');
    c.fillStyle = g;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const r = size * 0.16;
      c.beginPath();
      c.arc(size / 2 + Math.cos(a) * size * 0.13, size / 2 + Math.sin(a) * size * 0.13, r, 0, Math.PI * 2);
      c.fill();
    }
    return cv;
  });
}

export function rainStreak(w = 8, h = 64) {
  return memo('rain', () => {
    const cv = canvas(w, h), c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(190,230,255,0)');
    g.addColorStop(0.35, 'rgba(190,230,255,0.75)');
    g.addColorStop(1, 'rgba(190,230,255,0)');
    c.fillStyle = g;
    c.fillRect(w * 0.35, 0, w * 0.3, h);
    return cv;
  });
}

export function spark() {
  return memo('spark', () => {
    const cv = canvas(32, 32), c = cv.getContext('2d');
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,220,150,0.95)');
    g.addColorStop(0.7, 'rgba(255,140,40,0.4)');
    g.addColorStop(1, 'rgba(255,90,20,0)');
    c.fillStyle = g; c.fillRect(0, 0, 32, 32);
    return cv;
  });
}

export function streakLine(w = 256, h = 8) {
  return memo('streak', () => {
    const cv = canvas(w, h), c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    return cv;
  });
}

/* road surface with subtle noise, asphalt grain */
export function asphalt(size = 512, base = [58, 64, 82]) {
  return memo('asphalt' + size + base.join(), () => {
    const cv = canvas(size, size), c = cv.getContext('2d');
    c.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
    c.fillRect(0, 0, size, size);
    const img = c.getImageData(0, 0, size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 26;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 1.1));
    }
    c.putImageData(img, 0, 0);
    // faint aggregate speckles
    for (let i = 0; i < size * 4; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      c.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      c.fillRect(x, y, 1.4, 1.4);
    }
    return cv;
  });
}

/* diagonal chevron pattern for boost pads */
export function chevrons(color = '#22e6ff', size = 128) {
  return memo('chev' + color + size, () => {
    const cv = canvas(size, size), c = cv.getContext('2d');
    c.clearRect(0, 0, size, size);
    c.strokeStyle = color; c.lineWidth = 9; c.lineCap = 'round';
    for (let k = -1; k < 3; k++) {
      c.beginPath();
      c.moveTo(-size * 0.2 + k * size * 0.5, size * 0.95);
      c.lineTo(size * 0.25 + k * size * 0.5, size * 0.5);
      c.lineTo(-size * 0.2 + k * size * 0.5, size * 0.05);
      c.stroke();
    }
    return cv;
  });
}

/* building facade: window grid with emissive variation */
export function facade(seed = 1, tint = [34, 230, 255]) {
  return memo('facade' + seed + tint.join(), () => {
    const W = 256, H = 512;
    const cv = canvas(W, H), c = cv.getContext('2d');
    c.fillStyle = '#070a14'; c.fillRect(0, 0, W, H);
    const cols = 8, rows = 20;
    const cw = W / cols, ch = H / rows;
    let s = seed * 9301;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const on = rnd();
        if (on > 0.45) {
          const b = 0.25 + rnd() * 0.75;
          const t = rnd();
          const col = t < 0.7 ? tint : t < 0.85 ? [255, 43, 214] : [255, 227, 107];
          c.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${b.toFixed(2)})`;
          c.fillRect(x * cw + cw * 0.18, y * ch + ch * 0.2, cw * 0.64, ch * 0.5);
        } else {
          c.fillStyle = 'rgba(30,42,70,0.5)';
          c.fillRect(x * cw + cw * 0.18, y * ch + ch * 0.2, cw * 0.64, ch * 0.5);
        }
      }
    }
    // vertical neon strip
    c.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},0.55)`;
    c.fillRect(W * 0.5 - 2, 0, 4, H);
    return cv;
  });
}

/* neon sign strip */
export function neonBar(color = '#ff2bd6', w = 64, h = 256) {
  return memo('neon' + color + w + h, () => {
    const cv = canvas(w, h), c = cv.getContext('2d');
    c.clearRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(w * 0.25, 0, w * 0.5, h);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillRect(w * 0.42, 0, w * 0.16, h);
    return cv;
  });
}

/* skid mark decal (soft dark streak) */
export function skidMark(w = 32, h = 128) {
  return memo('skid', () => {
    const cv = canvas(w, h), c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.2, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.8, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(w * 0.2, 0, w * 0.6, h);
    return cv;
  });
}

/* soft vertical gradient for the sky dome */
export function skyGradient(top = '#04060f', mid = '#0b1430', bottom = '#1a1030') {
  return memo('sky' + top + mid + bottom, () => {
    const cv = canvas(4, 256), c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, top);
    g.addColorStop(0.55, mid);
    g.addColorStop(1, bottom);
    c.fillStyle = g; c.fillRect(0, 0, 4, 256);
    const tex = cv;
    return tex;
  });
}

/* generic particle sprite sheet for the GPU points system */
export function particleAtlas() {
  return memo('patlas', () => {
    const S = 64;
    const cv = canvas(S * 2, S * 2), c = cv.getContext('2d');
    // 0: smoke
    let g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    // 1: spark
    g = c.createRadialGradient(S + S / 2, S / 2, 0, S + S / 2, S / 2, S / 2);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.25, 'rgba(255,230,160,0.95)');
    g.addColorStop(0.6, 'rgba(255,120,40,0.35)');
    g.addColorStop(1, 'rgba(255,60,10,0)');
    c.fillStyle = g; c.fillRect(S, 0, S, S);
    // 2: glow dot
    g = c.createRadialGradient(S / 2, S + S / 2, 0, S / 2, S + S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, S, S, S);
    // 3: ring (shock)
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 4;
    c.beginPath(); c.arc(S + S / 2, S + S / 2, S * 0.36, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 9;
    c.beginPath(); c.arc(S + S / 2, S + S / 2, S * 0.3, 0, Math.PI * 2); c.stroke();
    return cv;
  });
}

/* car livery: base paint with stripe + accents */
export function livery(base = '#22e6ff', accent = '#ff2bd6', seed = 1) {
  return memo('livery' + base + accent + seed, () => {
    const W = 512, H = 256;
    const cv = canvas(W, H), c = cv.getContext('2d');
    // brighter base so paint reads in night lighting
    c.fillStyle = base; c.fillRect(0, 0, W, H);
    c.globalAlpha = 0.22;
    const sheen = c.createLinearGradient(0, 0, 0, H);
    sheen.addColorStop(0, '#ffffff'); sheen.addColorStop(0.45, '#ffffff00'); sheen.addColorStop(1, '#000000');
    c.fillStyle = sheen; c.fillRect(0, 0, W, H);
    c.globalAlpha = 1;
    // accent stripes
    const grad = c.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, accent); grad.addColorStop(1, base);
    c.fillStyle = grad;
    c.fillRect(0, H * 0.46, W, H * 0.13);
    c.fillStyle = accent;
    c.fillRect(W * 0.62, 0, W * 0.055, H);
    // number roundel
    c.fillStyle = 'rgba(4,8,18,0.9)';
    c.beginPath(); c.arc(W * 0.2, H * 0.5, 46, 0, Math.PI * 2); c.fill();
    c.fillStyle = accent;
    c.font = 'bold 64px Bahnschrift, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(seed), W * 0.2, H * 0.52);
    return cv;
  });
}

export function envMapCanvas(theme = 'city') {
  return memo('env' + theme, () => {
    const W = 512, H = 256;
    const cv = canvas(W, H), c = cv.getContext('2d');
    const palettes = {
      city: ['#070b18', '#16294f', '#22e6ff', '#ff2bd6'],
      desert: ['#3a2414', '#a06a2c', '#ffb347', '#ffd27a'],
      snow: ['#8fa8c2', '#dceaf8', '#ffffff', '#8fe9ff'],
      jungle: ['#0a1a10', '#1c4a2a', '#c6ff2b', '#7dffb0'],
    };
    const pal = palettes[theme] || palettes.city;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, pal[0]); g.addColorStop(0.45, pal[1]); g.addColorStop(1, pal[0]);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // bright neon strips around the horizon — these become the car's reflections
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * W, w = 6 + Math.random() * 40;
      const h = 30 + Math.random() * 110;
      c.fillStyle = Math.random() > 0.5 ? pal[2] : pal[3];
      c.globalAlpha = 0.45 + Math.random() * 0.55;
      c.fillRect(x, H * 0.42 + Math.random() * 70, w, h);
    }
    // a couple of large soft light pools for glossy highlights
    c.globalAlpha = 0.9;
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * W, y = 30 + Math.random() * (H - 60);
      const rg = c.createRadialGradient(x, y, 0, x, y, 90);
      rg.addColorStop(0, pal[2]); rg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = rg; c.fillRect(x - 90, y - 90, 180, 180);
    }
    c.globalAlpha = 1;
    return cv;
  });
}
