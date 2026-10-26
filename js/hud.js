/* ============================================================
   HUD — speedo canvas, minimap, nitro, combo, popups, toasts.
   ============================================================ */
import { clamp, clamp01, fmtTime, fmtNum, cssHex, lerp, TAU, projectMini } from './util.js';
import { POWERS } from './config.js';

const $ = id => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = $('hud');
    this.speedo = $('speedo');
    this.sctx = this.speedo.getContext('2d');
    this.map = $('minimap');
    this.mctx = this.map.getContext('2d');
    this.nitroFill = $('nitro-fill');
    this.nitroGain = $('nitro-gain');
    this.nitroSegs = $('nitro-segs');
    this.powerPanel = $('power-panel');
    this.powerIcon = $('power-icon');
    this.powerName = $('power-name');
    this.powerCount = $('power-count');
    this.comboPanel = $('combo-panel');
    this.popups = $('drift-popups');
    this.toasts = $('hud-toasts');
    this.countdown = $('hud-countdown');
    this.speedlines = $('speedlines');
    this.boostflash = $('hud-boostflash');
    this.nemesis = $('nemesis-panel');
    this.nemesisName = $('hud-nemesis');
    this.fpsEl = $('hud-fps');
    this._segsBuilt = 0;
    this._lastPower = undefined;
    this._popupCount = 0;
    this._flashTimer = 0;
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.speedo.width = 260 * this._dpr;
    this.speedo.height = 260 * this._dpr;
    this.map.width = 200 * this._dpr;
    this.map.height = 200 * this._dpr;
    this._needle = 0;
    this._speedShown = 0;
    this._comboShown = 1;
  }

  show(v) {
    this.el.classList.toggle('hidden', !v);
    this.el.style.opacity = v ? '1' : '0';
  }

  setEvent(text) { $('hud-event').innerHTML = text || ''; }

  /* ---------------- toasts ---------------- */
  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    this.toasts.appendChild(d);
    setTimeout(() => d.classList.add('out'), 1700);
    setTimeout(() => d.remove(), 2050);
    if (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  /* ---------------- drift popups ---------------- */
  popup(text, kind = '') {
    const d = document.createElement('div');
    d.className = 'drift-pop ' + kind;
    d.textContent = text;
    const jitter = (this._popupCount++ % 3 - 1) * 26;
    d.style.marginLeft = jitter + 'px';
    this.popups.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }

  flash(color, amt = 0.3) {
    this.boostflash.style.background =
      `radial-gradient(ellipse at 50% 60%, transparent 30%, ${cssHex(color)}66 100%)`;
    this.boostflash.classList.add('on');
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => this.boostflash.classList.remove('on'), amt * 1000 + 120);
  }

  setCountdown(text, go = false) {
    if (text === null) { this.countdown.classList.add('hidden'); return; }
    this.countdown.classList.remove('hidden');
    this.countdown.textContent = text;
    this.countdown.classList.toggle('go', go);
  }

  /* ---------------- per-frame ---------------- */
  update(dt, state) {
    const v = state.player;
    if (!v) return;
    const g = this.game;

    /* position / lap / time */
    $('hud-pos').textContent = v.place;
    $('hud-total').textContent = state.vehicles.length;
    $('hud-lap').textContent = state.lapsEnabled
      ? `${clamp(v.lap + 1, 1, state.laps)}/${state.laps}` : '—';
    const t = state.raceTime || 0;
    $('hud-time').textContent = fmtTime(t);
    $('hud-best').textContent = fmtTime(v.bestLap || 0);

    /* nitro */
    const pct = clamp01(v.nitro / v.nitroMax) * 100;
    this.nitroFill.style.width = pct + '%';
    this.nitroFill.classList.toggle('charged', v.nitro >= v.nitroMax * 0.92);
    if (v.drifting) this.nitroGain.style.width = '100%';
    else this.nitroGain.style.width = '0%';

    /* combo */
    const comboOn = v.combo > 1 || v.drifting;
    this.comboPanel.classList.toggle('active', comboOn);
    this.comboPanel.classList.toggle('big', v.combo >= 5);
    $('hud-mult').textContent = v.combo;
    $('hud-drift').textContent = fmtNum(v.driftScore);

    /* power slot */
    if (v.power !== this._lastPower) {
      this._lastPower = v.power;
      if (v.power) {
        const p = POWERS[v.power];
        this.powerPanel.classList.remove('hidden');
        this.powerIcon.textContent = p.icon;
        this.powerName.textContent = p.name;
        this.powerIcon.style.borderColor = p.color;
        this.powerIcon.style.background =
          `radial-gradient(circle at 35% 30%, ${p.color}55, ${p.color}0d)`;
      } else {
        this.powerPanel.classList.add('hidden');
      }
    }
    this.powerCount.textContent = v.powerCount || 0;

    /* speedometer + minimap */
    this._drawSpeedo(v, dt);
    this._drawMap(state, v);
  }

  _drawSpeedo(v, dt) {
    const c = this.sctx, dpr = this._dpr, W = 260, H = 260;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 8, R = 104;
    const start = Math.PI * 0.78, end = Math.PI * 2.22;
    const speed = Math.abs(v.speed) * 3.6;
    const maxSpeed = v.spec.speed * 3.6 * 1.25;
    const t = clamp01(speed / maxSpeed);
    this._speedShown = lerp(this._speedShown, speed, 1 - Math.exp(-16 * dt));
    const shown = Math.round(this._speedShown);

    // dial background
    c.beginPath(); c.arc(cx, cy, R, 0, TAU);
    c.fillStyle = 'rgba(6,10,22,0.62)'; c.fill();
    c.lineWidth = 1.4; c.strokeStyle = 'rgba(120,220,255,0.16)'; c.stroke();

    // rpm ticks
    const rpm01 = clamp01(v.rpm / 8200);
    const ticks = 44;
    for (let i = 0; i <= ticks; i++) {
      const k = i / ticks;
      const a = start + (end - start) * k;
      const major = i % 4 === 0;
      const r1 = R - 8, r2 = R - (major ? 21 : 15);
      const active = k <= rpm01;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      if (active) {
        const hot = k > 0.82;
        c.strokeStyle = hot ? '#ff2b4d' : (v.boosting ? '#c6ff2b' : '#22e6ff');
        c.lineWidth = major ? 3 : 1.6;
        c.shadowColor = c.strokeStyle; c.shadowBlur = hot || v.boosting ? 12 : 6;
      } else {
        c.strokeStyle = 'rgba(150,180,215,0.22)'; c.lineWidth = major ? 2 : 1;
        c.shadowBlur = 0;
      }
      c.stroke();
    }
    c.shadowBlur = 0;

    // speed arc
    const arc = end - start;
    c.beginPath();
    c.arc(cx, cy, R - 27, start, start + arc * t);
    const grad = c.createLinearGradient(cx - R, cy, cx + R, cy);
    if (v.boosting) { grad.addColorStop(0, '#c6ff2b'); grad.addColorStop(1, '#22e6ff'); }
    else { grad.addColorStop(0, '#0a9dd6'); grad.addColorStop(0.6, '#22e6ff'); grad.addColorStop(1, '#ff2bd6'); }
    c.strokeStyle = grad; c.lineWidth = 5; c.lineCap = 'round';
    c.shadowColor = v.boosting ? 'rgba(198,255,43,0.9)' : 'rgba(34,230,255,0.85)';
    c.shadowBlur = 16; c.stroke(); c.shadowBlur = 0;

    // needle
    const na = start + arc * (v.rpm / 8200);
    this._needle = lerp(this._needle, na, 1 - Math.exp(-14 * dt));
    c.beginPath();
    c.moveTo(cx - Math.cos(this._needle) * 12, cy - Math.sin(this._needle) * 12);
    c.lineTo(cx + Math.cos(this._needle) * (R - 34), cy + Math.sin(this._needle) * (R - 34));
    c.strokeStyle = '#ffffff'; c.lineWidth = 2.4; c.lineCap = 'round';
    c.shadowColor = '#22e6ff'; c.shadowBlur = 10; c.stroke(); c.shadowBlur = 0;
    c.beginPath(); c.arc(cx, cy, 5, 0, TAU);
    c.fillStyle = '#22e6ff'; c.shadowColor = '#22e6ff'; c.shadowBlur = 14; c.fill(); c.shadowBlur = 0;

    // speed number
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.font = '800 52px Bahnschrift, "DIN Alternate", sans-serif';
    c.shadowColor = 'rgba(34,230,255,0.55)'; c.shadowBlur = 18;
    c.fillText(String(shown), cx, cy - 26);
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(150,180,215,0.85)';
    c.font = '700 11px Bahnschrift, sans-serif';
    c.fillText('KM/H', cx, cy + 8);

    // drift arc when drifting
    if (v.drifting) {
      const dA = clamp01(v.driftAngle / 0.9);
      c.beginPath();
      c.arc(cx, cy, R - 2, start, start + arc * dA);
      c.strokeStyle = '#c6ff2b'; c.lineWidth = 2;
      c.shadowColor = '#c6ff2b'; c.shadowBlur = 14; c.stroke(); c.shadowBlur = 0;
    }

    // gear
    c.fillStyle = '#ffffff';
    c.font = '800 15px Bahnschrift, sans-serif';
    c.fillText(v.gear === -1 ? 'R' : v.gear === 0 ? 'N' : 'D' + v.gear, cx, cy + 30);
  }

  _drawMap(state, v) {
    const c = this.mctx, dpr = this._dpr, S = 200;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, S, S);
    const track = state.trackBuild;
    if (!track) return;
    const path = track.minimap;
    const pad = 14, inner = S - pad * 2;
    const project = (x, z) => {
      const b = track.spline.bounds;
      const w = Math.max(b.maxX - b.minX, 1), h = Math.max(b.maxZ - b.minZ, 1);
      const s = Math.max(w, h);
      const ox = (s - w) / 2, oz = (s - h) / 2;
      return {
        x: pad + ((x - b.minX + ox) / s) * inner,
        y: pad + ((z - b.minZ + oz) / s) * inner,
      };
    };

    // road
    c.beginPath();
    path.forEach((p, i) => {
      const x = pad + p.x * inner, y = pad + p.y * inner;
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    });
    c.closePath();
    c.strokeStyle = 'rgba(34,230,255,0.28)';
    c.lineWidth = 7; c.lineJoin = 'round'; c.stroke();
    c.strokeStyle = 'rgba(160,240,255,0.85)';
    c.lineWidth = 1.6; c.stroke();

    // opponents
    for (const o of state.vehicles) {
      if (o === v) continue;
      const p = project(o.pos.x, o.pos.z);
      c.beginPath(); c.arc(p.x, p.y, 2.6, 0, TAU);
      c.fillStyle = cssHex(o.color); c.fill();
    }
    // pickups
    for (const pu of state.powerups?.orbs || []) {
      if (!pu.active) continue;
      const p = project(pu.mesh.position.x, pu.mesh.position.z);
      c.beginPath(); c.arc(p.x, p.y, 1.6, 0, TAU);
      c.fillStyle = 'rgba(255,227,107,0.75)'; c.fill();
    }

    // player arrow
    const pp = project(v.pos.x, v.pos.z);
    c.save();
    c.translate(pp.x, pp.y);
    c.rotate(-v.visYaw + Math.PI);
    c.beginPath();
    c.moveTo(0, -6.5); c.lineTo(4.6, 5); c.lineTo(0, 2.6); c.lineTo(-4.6, 5);
    c.closePath();
    c.fillStyle = '#ffffff'; c.shadowColor = '#22e6ff'; c.shadowBlur = 10; c.fill();
    c.shadowBlur = 0;
    c.restore();
  }

  /* ---------------- misc ---------------- */
  setSpeedlines(on) { this.speedlines.classList.toggle('on', on); }
  setFps(text) { this.fpsEl.textContent = text; }
  setNemesis(name) {
    if (!name) { this.nemesis.classList.add('hidden'); return; }
    this.nemesis.classList.remove('hidden');
    this.nemesisName.textContent = name;
  }
  buildNitroSegs(n) {
    if (this._segsBuilt === n) return;
    this._segsBuilt = n;
    this.nitroSegs.innerHTML = '';
    for (let i = 0; i < n; i++) this.nitroSegs.appendChild(document.createElement('i'));
  }
  updateNitroSegs(on) {
    const kids = this.nitroSegs.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i < on);
  }
}
