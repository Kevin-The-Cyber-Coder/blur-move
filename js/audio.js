/* ============================================================
   AUDIO — 100% procedural Web Audio: engine synth, tire screech,
   wind, impacts, power-ups, adaptive music with speed-reactive
   tempo, and 3D positional one-shots. No external assets.
   ============================================================ */
import { clamp, clamp01, lerp, rand } from './util.js';

const NOTE = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.masterVol = 0.85;
    this.musicVol = 0.42;
    this.sfxVol = 0.9;
    this.engineVol = 0.32;
    this.musicOn = true;
    this.station = 'neon';
    this.muted = false;
    this._lastFootstep = 0;
  }

  async unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    // master chain with a soft limiter
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVol;
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;
    this.master.connect(this.comp).connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = this.sfxVol; this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0; this.musicBus.connect(this.master);
    this.engineBus = this.ctx.createGain(); this.engineBus.gain.value = this.engineVol; this.engineBus.connect(this.master);

    this.noiseBuf = this._makeNoise(2.0);
    this.ready = true;
    if (this.musicOn) this.startMusic();
  }

  _makeNoise(sec) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ready) return;
    this.master.gain.setTargetAtTime(m ? 0 : this.masterVol, this.ctx.currentTime, 0.05);
  }
  setMaster(v) { this.masterVol = v; if (this.ready && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setSfx(v) { this.sfxVol = v; if (this.ready) this.sfxBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.musicVol = v; if (this.ready) this.musicBus.gain.setTargetAtTime(this.musicOn ? v : 0, this.ctx.currentTime, 0.1); }
  setEngine(v) { this.engineVol = v; if (this.ready) this.engineBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  /* ============================ ENGINE ============================ */
  attachEngine(vehicle) {
    if (!this.ready) return;
    const ctx = this.ctx;
    if (this._eng) this.detachEngine();
    const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator(); osc2.type = 'square';
    const osc3 = ctx.createOscillator(); osc3.type = 'sawtooth';
    const g1 = ctx.createGain(); g1.gain.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.18;
    const g3 = ctx.createGain(); g3.gain.value = 0.12;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.value = 900; filter.Q.value = 5.5;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this._driveCurve(2.4);
    shaper.oversample = '2x';
    const bus = ctx.createGain(); bus.gain.value = 1;
    // noise for induction/exhaust grit
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf; noise.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1400; nf.Q.value = 1.1;
    const ng = ctx.createGain(); ng.gain.value = 0.0;
    // turbo whine
    const turbo = ctx.createOscillator(); turbo.type = 'sine'; turbo.frequency.value = 2400;
    const tg = ctx.createGain(); tg.gain.value = 0.0;

    osc1.connect(g1); osc2.connect(g2); osc3.connect(g3);
    g1.connect(shaper); g2.connect(shaper); g3.connect(shaper);
    noise.connect(nf).connect(ng).connect(shaper);
    turbo.connect(tg).connect(bus);
    shaper.connect(filter).connect(bus).connect(this.engineBus);

    osc1.start(); osc2.start(); osc3.start(); noise.start(); turbo.start();
    this._eng = { osc1, osc2, osc3, g1, g2, g3, filter, shaper, bus, noise, nf, ng, turbo, tg, vehicle, lastFire: 0 };
  }

  _driveCurve(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      c[i] = Math.tanh(x * k);
    }
    return c;
  }

  detachEngine() {
    if (!this._eng) return;
    const e = this._eng;
    try {
      e.osc1.stop(); e.osc2.stop(); e.osc3.stop(); e.noise.stop(); e.turbo.stop();
      e.bus.disconnect();
    } catch (err) { /* already stopped */ }
    this._eng = null;
  }

  updateEngine(v, dt, active = true) {
    if (!this.ready || !this._eng) return;
    const e = this._eng, ctx = this.ctx, t = ctx.currentTime;
    const rpm = v.rpm;
    const load = clamp01(v.throttle * 0.7 + (v.boosting ? 0.6 : 0) + (v.speed / (v.spec.speed * 1.3)) * 0.4);
    const base = 42 + (rpm / 8200) * 210;
    const vol = active ? 1 : 0.0;
    e.osc1.frequency.setTargetAtTime(base, t, 0.03);
    e.osc2.frequency.setTargetAtTime(base * 0.5, t, 0.03);
    e.osc3.frequency.setTargetAtTime(base * 1.505, t, 0.03);
    e.filter.frequency.setTargetAtTime(420 + rpm * 0.42 + (v.boosting ? 1800 : 0), t, 0.04);
    e.g1.gain.setTargetAtTime((0.30 + load * 0.35) * vol, t, 0.05);
    e.g2.gain.setTargetAtTime((0.10 + load * 0.16) * vol, t, 0.05);
    e.g3.gain.setTargetAtTime((0.05 + load * 0.12) * vol, t, 0.05);
    e.nf.frequency.setTargetAtTime(900 + rpm * 0.25, t, 0.06);
    e.ng.gain.setTargetAtTime((0.035 + load * 0.09) * vol, t, 0.06);
    e.turbo.frequency.setTargetAtTime(1500 + rpm * 0.55, t, 0.05);
    e.tg.gain.setTargetAtTime((v.boosting ? 0.05 : 0.012) * vol, t, 0.08);

    // exhaust pops on boost / lift-off
    if (v.boosting && Math.random() < dt * 9) this.pop(0.55);
    else if (v.throttle < 0.1 && v.speed > 20 && Math.random() < dt * 1.6) this.pop(0.22);
  }

  pop(strength = 0.4) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 60 + Math.random() * 70;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(strength * 0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 180 + Math.random() * 300;
    o.connect(f).connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.12);
  }

  /* ============================ SFX ============================ */
  _env(gain, t, a, d, peak) {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  noiseBurst({ dur = 0.3, freq = 1200, q = 1, type = 'bandpass', vol = 0.5, pan = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = rand(0.85, 1.15);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t, 0.005, dur, vol);
    let out = g;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
      g.connect(p); out = p;
    }
    src.connect(f).connect(g);
    out.connect(this.sfxBus);
    src.start(t); src.stop(t + dur + 0.05);
  }

  tone({ freq = 440, freqTo = null, dur = 0.2, type = 'sine', vol = 0.3, pan = 0, attack = 0.005, delay = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t + dur);
    const g = ctx.createGain();
    this._env(g, t, attack, dur, vol);
    let out = g;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
      g.connect(p); out = p;
    }
    o.connect(g); out.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.08);
  }

  impact(strength = 1, material = 'metal') {
    const s = clamp(strength, 0.1, 2);
    this.noiseBurst({ dur: 0.18 + s * 0.12, freq: 320 + Math.random() * 500 * (material === 'glass' ? 3 : 1), q: 1.4, vol: 0.35 * s });
    this.tone({ freq: 90 + Math.random() * 40, freqTo: 40, dur: 0.16 + s * 0.1, type: 'triangle', vol: 0.22 * s });
    if (material === 'glass') this.noiseBurst({ dur: 0.5, freq: 5200, q: 0.7, type: 'highpass', vol: 0.2 * s });
  }
  wallScrape(strength = 1) {
    this.noiseBurst({ dur: 0.16, freq: 2600 + Math.random() * 1200, q: 0.9, type: 'highpass', vol: 0.12 * clamp(strength, 0.2, 2) });
  }
  tireScreech(amount = 1) {
    this.noiseBurst({ dur: 0.12, freq: 1700 + Math.random() * 500, q: 3.5, vol: 0.10 * clamp(amount, 0, 1.6) });
  }
  boostStart() {
    this.tone({ freq: 220, freqTo: 1400, dur: 0.5, type: 'sawtooth', vol: 0.16 });
    this.noiseBurst({ dur: 0.6, freq: 3000, q: 0.6, type: 'highpass', vol: 0.22 });
  }
  boostLoop() { /* handled by engine bus */ }
  pickup() {
    this.tone({ freq: NOTE(84), dur: 0.09, type: 'square', vol: 0.1 });
    this.tone({ freq: NOTE(91), dur: 0.12, type: 'square', vol: 0.1, delay: 0.06 });
  }
  fire(power) {
    switch (power) {
      case 'shock':
        this.tone({ freq: 900, freqTo: 180, dur: 0.32, type: 'sawtooth', vol: 0.18 });
        this.noiseBurst({ dur: 0.3, freq: 2400, q: 2, vol: 0.2 });
        break;
      case 'shunt':
        this.impact(1.4, 'metal');
        break;
      case 'bolt':
        this.tone({ freq: 1600, freqTo: 500, dur: 0.16, type: 'square', vol: 0.13 });
        break;
      default:
        this.tone({ freq: 500, freqTo: 900, dur: 0.2, type: 'sine', vol: 0.16 });
    }
  }
  shieldUp() {
    this.tone({ freq: 300, freqTo: 700, dur: 0.35, type: 'sine', vol: 0.18 });
    this.tone({ freq: 450, freqTo: 1050, dur: 0.4, type: 'sine', vol: 0.10, delay: 0.04 });
  }
  shieldHit() {
    this.noiseBurst({ dur: 0.4, freq: 3200, q: 1.4, vol: 0.28 });
    this.tone({ freq: 700, freqTo: 2200, dur: 0.3, type: 'triangle', vol: 0.14 });
  }
  explode() {
    this.noiseBurst({ dur: 0.9, freq: 220, q: 0.7, vol: 0.6 });
    this.noiseBurst({ dur: 0.5, freq: 1200, q: 0.5, vol: 0.35 });
    this.tone({ freq: 120, freqTo: 30, dur: 0.8, type: 'sawtooth', vol: 0.3 });
  }
  countdown(n) {
    this.tone({ freq: n > 0 ? 520 : 1040, dur: n > 0 ? 0.16 : 0.5, type: 'square', vol: 0.16 });
    if (n === 0) { this.tone({ freq: 1560, dur: 0.35, type: 'square', vol: 0.13 }); }
  }
  lap() { this.tone({ freq: 880, dur: 0.1, type: 'sine', vol: 0.12 }); this.tone({ freq: 1320, dur: 0.16, type: 'sine', vol: 0.12, delay: 0.09 }); }
  finish(win) {
    const notes = win ? [72, 76, 79, 84, 88] : [72, 68, 64, 60];
    notes.forEach((m, i) => this.tone({ freq: NOTE(m), dur: 0.32, type: 'triangle', vol: 0.15, delay: i * 0.13 }));
  }
  uiClick() { this.tone({ freq: 700, dur: 0.05, type: 'square', vol: 0.06 }); }
  uiHover() { this.tone({ freq: 1000, dur: 0.03, type: 'sine', vol: 0.03 }); }
  uiError() { this.tone({ freq: 200, dur: 0.2, type: 'sawtooth', vol: 0.1 }); }
  thunder() {
    const delay = rand(0.4, 2.2);
    setTimeout(() => {
      if (!this.ready) return;
      this.noiseBurst({ dur: 1.8, freq: 90, q: 0.6, type: 'lowpass', vol: 0.4 });
      this.noiseBurst({ dur: 2.6, freq: 240, q: 0.5, type: 'lowpass', vol: 0.25 });
    }, delay * 1000);
  }
  taunt(pan = 0) {
    // radio-ish voice blip
    this.tone({ freq: 800, freqTo: 300, dur: 0.18, type: 'square', vol: 0.06, pan });
  }

  /* ============================ MUSIC ============================ */
  startMusic() {
    if (!this.ready || this._music) return;
    this.musicOn = true;
    this.musicBus.gain.setTargetAtTime(this.musicVol, this.ctx.currentTime, 0.8);
    this._music = { bar: 0, step: 0, nextTime: this.ctx.currentTime + 0.15, bpm: 124, intensity: 0.4 };
    this._sched = setInterval(() => this._schedule(), 25);
  }
  stopMusic() {
    this.musicOn = false;
    if (this.ready) this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    if (this._sched) { clearInterval(this._sched); this._sched = null; }
    this._music = null;
  }
  setStation(id) { this.station = id; }
  setMusicIntensity(v) { if (this._music) this._music.intensity = clamp01(v); }

  _scale(station) {
    switch (station) {
      case 'ice': return [57, 60, 62, 64, 67, 69, 72, 74];        // A minor-ish
      case 'sunset': return [55, 58, 60, 62, 65, 67, 70, 72];     // G major pentatonic-ish
      case 'inferno': return [52, 55, 58, 60, 63, 65, 68, 70];    // E phrygian
      default: return [57, 60, 63, 65, 67, 70, 72, 75];           // A minor
    }
  }

  _musicNote(midi, time, dur, type, vol, filterHz = 2400) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(NOTE(midi), time);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterHz; f.Q.value = 1.2;
    o.connect(f).connect(g).connect(this.musicBus);
    o.start(time); o.stop(time + dur + 0.02);
  }

  _drum(kind, time, vol) {
    const ctx = this.ctx;
    if (kind === 'kick') {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(140, time);
      o.frequency.exponentialRampToValueAtTime(42, time + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
      o.connect(g).connect(this.musicBus);
      o.start(time); o.stop(time + 0.26);
    } else {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      src.playbackRate.value = kind === 'hat' ? 2.2 : 1;
      const f = ctx.createBiquadFilter();
      f.type = kind === 'hat' ? 'highpass' : 'bandpass';
      f.frequency.value = kind === 'hat' ? 7000 : 1900; f.Q.value = kind === 'hat' ? 0.7 : 1.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + (kind === 'hat' ? 0.05 : 0.16));
      src.connect(f).connect(g).connect(this.musicBus);
      src.start(time); src.stop(time + 0.2);
    }
  }

  _schedule() {
    if (!this.ready || !this._music || !this.musicOn) return;
    const m = this._music, ctx = this.ctx;
    const scale = this._scale(this.station);
    const spb = 60 / m.bpm / 4; // sixteenth note
    while (m.nextTime < ctx.currentTime + 0.24) {
      const t = m.nextTime;
      const step = m.step;
      const inten = m.intensity;
      // drums
      if (step % 4 === 0) this._drum('kick', t, 0.5);
      if (step % 4 === 2 && inten > 0.35) this._drum('snare', t, 0.22 * inten + 0.06);
      if (inten > 0.2) this._drum('hat', t + spb * 0.5, 0.05 + inten * 0.03);
      // bass
      if (step % 2 === 0) {
        const root = scale[0] - 12;
        const n = step % 8 === 0 ? root : root + (step % 16 === 8 ? 3 : 0);
        this._musicNote(n, t, spb * 1.6, 'sawtooth', 0.10 + inten * 0.05, 700);
      }
      // arp lead
      if (inten > 0.25 && step % 2 === 1) {
        const idx = (step * 3 + m.bar) % scale.length;
        this._musicNote(scale[idx] + 12, t, spb * 1.1, 'square', 0.045 + inten * 0.035, 3200);
      }
      // pad/chord every bar
      if (step === 0) {
        const chord = [scale[0], scale[2], scale[4]];
        chord.forEach((n, i) => this._musicNote(n + 12, t, spb * 15, 'triangle', 0.03 + inten * 0.02, 1800));
        m.bar++;
        // slight bpm lift with intensity
        m.bpm = 118 + inten * 26;
      }
      m.nextTime += spb;
      m.step = (m.step + 1) % 64;
    }
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
}
