/* Full-game integration harness: boots the real Game class against a stubbed
   three.js + DOM, then runs a complete race with AI-controlled player.
   Verifies race rules, laps, positions, power-ups, HUD and results wiring. */
import { register } from 'node:module';
register('./three-loader.mjs', import.meta.url);

/* ---------------- DOM stub ---------------- */
const ctxGrad = { addColorStop() { } };
function ctx2d() {
  return {
    canvas: { width: 256, height: 256 }, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
    textAlign: '', textBaseline: '', globalAlpha: 1, shadowBlur: 0, shadowColor: '', lineCap: '', lineJoin: '',
    fillRect() { }, clearRect() { }, strokeRect() { }, beginPath() { }, closePath() { }, moveTo() { }, lineTo() { },
    arc() { }, ellipse() { }, fill() { }, stroke() { }, fillText() { }, strokeText() { }, save() { }, restore() { },
    translate() { }, rotate() { }, scale() { }, setTransform() { }, createLinearGradient: () => ctxGrad,
    createRadialGradient: () => ctxGrad, createPattern: () => null, drawImage() { }, putImageData() { },
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }),
    measureText: () => ({ width: 10 }), quadraticCurveTo() { }, bezierCurveTo() { },
  };
}
function el(tag = 'div') {
  const e = {
    tagName: tag, style: {}, dataset: {}, children: [], _html: '', textContent: '', value: '',
    classList: {
      _s: new Set(), add(...c) { c.forEach(x => this._s.add(x)); }, remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, v) { if (v === undefined) v = !this._s.has(c); v ? this._s.add(c) : this._s.delete(c); return v; },
      contains(c) { return this._s.has(c); },
    },
    addEventListener() { }, removeEventListener() { },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
    remove() { this.parentNode?.removeChild?.(this); },
    querySelector() { return el(); }, querySelectorAll() { return []; },
    setAttribute() { }, getAttribute() { return null; }, focus() { }, blur() { }, click() { },
    getBoundingClientRect() { return { width: 480, height: 300, left: 0, top: 0 }; },
    getContext(kind) { return kind === '2d' ? ctx2d() : {}; },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
    get firstChild() { return this.children[0]; },
    width: 1280, height: 720, clientWidth: 480, clientHeight: 300,
  };
  return e;
}
const byId = new Map();
const ids = ['hud', 'gl', 'speedo', 'minimap', 'nitro-fill', 'nitro-gain', 'nitro-segs', 'power-panel', 'power-icon',
  'power-name', 'power-count', 'combo-panel', 'drift-popups', 'hud-toasts', 'hud-countdown', 'speedlines',
  'hud-boostflash', 'nemesis-panel', 'hud-nemesis', 'hud-fps', 'hud-event', 'hud-pos', 'hud-total', 'hud-lap',
  'hud-time', 'hud-best', 'hud-mult', 'hud-drift', 'hud-gear', 'hud-rpm', 'loader', 'loadfill', 'loadtext',
  'screens', 'menu', 'touch', 'stick-zone', 'stick-base', 'stick-knob', 't-boost', 't-brake', 't-drift', 't-power',
  'btn-cam', 'btn-pause', 'app', 'overlay-fx'];
for (const id of ids) byId.set(id, el());

globalThis.window = globalThis;
globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
globalThis.document = {
  getElementById: (id) => byId.get(id) || null,
  createElement: (t) => el(t),
  addEventListener() { }, removeEventListener() { },
  body: el('body'), documentElement: { style: {} }, querySelectorAll: () => [], hidden: false,
};
globalThis.addEventListener = () => { };
globalThis.removeEventListener = () => { };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => { };
if (!globalThis.navigator) globalThis.navigator = {};
if (!globalThis.navigator.getGamepads) {
  try { Object.defineProperty(globalThis.navigator, 'getGamepads', { value: () => [], configurable: true }); } catch (e) { }
}
globalThis.AudioContext = class {
  constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = {}; }
  _gain() { return { gain: { value: 0, setTargetAtTime() { }, setValueAtTime() { }, linearRampToValueAtTime() { }, exponentialRampToValueAtTime() { }, cancelScheduledValues() { } }, connect() { return this; }, disconnect() { } }; }
  createGain() { return this._gain(); }
  createOscillator() { return { type: '', frequency: { value: 0, setTargetAtTime() { }, setValueAtTime() { }, exponentialRampToValueAtTime() { } }, connect() { return this; }, start() { }, stop() { } }; }
  createBiquadFilter() { return { type: '', frequency: { value: 0, setTargetAtTime() { }, setValueAtTime() { } }, Q: { value: 0 }, gain: { value: 0 }, connect() { return this; } }; }
  createDynamicsCompressor() { return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() { return this; } }; }
  createBufferSource() { return { buffer: null, loop: false, playbackRate: { value: 1 }, connect() { return this; }, start() { }, stop() { } }; }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createStereoPanner() { return { pan: { value: 0 }, connect() { return this; } }; }
  createWaveShaper() { return { curve: null, oversample: '', connect() { return this; } }; }
  resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); }
};

/* ---------------- run ---------------- */
const results = [];
function check(name, fn) {
  try { const o = fn(); results.push({ name, ok: true, o }); console.log(`  ok   ${name}` + (o ? ' :: ' + JSON.stringify(o).slice(0, 240) : '')); }
  catch (e) { results.push({ name, ok: false, e: e.message, stack: e.stack }); console.log(`  FAIL ${name}: ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { const o = await fn(); results.push({ name, ok: true, o }); console.log(`  ok   ${name}` + (o ? ' :: ' + JSON.stringify(o).slice(0, 240) : '')); }
  catch (e) { results.push({ name, ok: false, e: e.message, stack: e.stack }); console.log(`  FAIL ${name}: ${e.message}`); }
}

const { Game } = await import('../js/game.js');
const { TRACKS, CAREER, POWERS } = await import('../js/config.js');

const g = new Game();
window.__NEONRUSH__ = g;

await checkAsync('Game boots to menu', async () => {
  await g.boot();
  // boot leaves state=menu
  if (g.state !== 'menu') throw new Error('state ' + g.state);
  return { state: g.state, track: g.world.trackDef.id, cars: g.world.carMeshes.size };
});

check('menu screens all render', () => {
  const names = ['title', 'career', 'quick', 'garage', 'skills', 'achievements', 'settings', 'livery', 'help'];
  const out = {};
  for (const n of names) { g.menu.show(n); out[n] = document.getElementById('screens').children.length; }
  return out;
});
check('career briefing renders', () => {
  g.menu.show('briefing', CAREER[0]);
  return { ev: g.menu.arg?.id };
});

check('quick race launches with 6 cars', () => {
  g.startQuickRace({ track: 'neon-district', laps: 2, rivals: 5, mode: 'race' });
  if (g.vehicles.length !== 6) throw new Error('vehicles ' + g.vehicles.length);
  return { state: g.state, vehicles: g.vehicles.length, orbs: g.powerups.orbs.length, laps: g.raceFlags.laps };
});

/* the countdown ticks down in simulate() */
check('countdown ends and race starts', () => {
  let guard = 0;
  while (g.state === 'countdown' && guard++ < 400) g.simulate(1 / 60);
  if (g.state !== 'racing') throw new Error('still ' + g.state);
  return { guard, state: g.state };
});

/* let AI drive the player so the race actually progresses */
await checkAsync('full race completes with AI-driven player', async () => {
  const { AIDriver } = await import('../js/ai.js');
  const drift = { id: 'clean', name: 'TEST', aggression: 0.3, skill: 1, radar: 0.9, taunt: ['x'] };
  let driver = new AIDriver(g.player, g.world.track.spline, drift, { skill: 1, offset: 0 });
  // patch the input layer: the player is driven by an AI for this test
  const origInput = g.input.vehicleInput.bind(g.input);
  g.input.vehicleInput = function () {
    const ctx2 = {
      world: g.world, player: g.player, vehicles: g.vehicles, rubberBand: 1,
      onTaunt() { }, usePower: (v) => g.usePower(v), onComboStep: (v, c) => g.onComboStep(v, c),
    };
    if (g.player !== driver.v) driver = new AIDriver(g.player, g.world.track.spline, drift, { skill: 1, offset: 0 });
    return driver.update(1 / 90, ctx2);
  };

  let steps = 0, maxLap = 0, sawDrift = false, sawPower = false, sawAir = false;
  while (g.state === 'racing' && steps < 60 * 900) {
    g.simulate(1 / 90);
    try { g.updatePresentation(1 / 60); } catch (e) { throw new Error('presentation: ' + e.message + '\n' + e.stack?.split('\n')[1]); }
    maxLap = Math.max(maxLap, g.player.lap);
    if (g.player.drifting) sawDrift = true;
    if (g.player.power) sawPower = true;
    if (g.player.airborne) sawAir = true;
    steps++;
    if (steps % 900 === 0) g.player.power = Object.keys(POWERS)[(steps / 900 | 0) % 6];
  }
  g.input.vehicleInput = origInput;
  if (g.state !== 'finished' && g.state !== 'results') throw new Error('ended in ' + g.state);
  return {
    simSeconds: +(steps / 90).toFixed(1), laps: maxLap, drift: sawDrift, power: sawPower, air: sawAir,
    place: g.player.place, results: !!g.results, aiLaps: g.aiDrivers.map(d => d.v.lap),
    aiStuck: g.aiDrivers.filter(d => d.v.speed < 2).length,
  };
});
check('results screen renders with standings', () => {
  g.showResults(g.results);
  if (!g.results) throw new Error('no results');
  return { place: g.results.place, rows: g.results.standings.length, rewards: g.results.rewards?.length };
});

check('progression was written', () => {
  const p = g.save.profile;
  if (p.stats.races < 1) throw new Error('races not recorded');
  return { races: p.stats.races, coins: p.coins, level: p.level, career: Object.keys(p.career).length };
});

check('elimination mode runs and eliminates cars', () => {
  g.startQuickRace({ track: 'neon-district', laps: 99, rivals: 5, mode: 'elim' });
  let guard = 0;
  while (g.state === 'countdown' && guard++ < 400) g.simulate(1 / 60);
  // park the player so it is last, then force elimination ticks
  let eliminated = 0;
  for (let i = 0; i < 60 * 90 && g.state === 'racing'; i++) {
    g.raceFlags.elimTimer = g.raceFlags.elimInterval;
    g.simulate(1 / 60);
    eliminated = g.vehicles.filter(v => v.eliminated).length;
    if (eliminated > 0) break;
  }
  if (eliminated < 1) throw new Error('no eliminations');
  return { eliminated, state: g.state };
});

check('time trial mode has no rivals', () => {
  g.startQuickRace({ track: 'sunset-bay', laps: 3, rivals: 0, mode: 'tt' });
  if (g.vehicles.length !== 1) throw new Error('vehicles ' + g.vehicles.length);
  return { vehicles: g.vehicles.length, laps: g.raceFlags.laps };
});

check('drift attack mode sets a target', () => {
  g.startQuickRace({ track: 'neon-district', laps: 2, rivals: 3, mode: 'drift' });
  if (!g.raceFlags.target) throw new Error('no target');
  return { target: g.raceFlags.target };
});

check('career boss event loads boss personality', () => {
  const boss = CAREER.find(e => e.boss);
  g.startCareerEvent(boss);
  const bossCar = g.vehicles.find(v => v.name === boss.boss);
  if (!bossCar) throw new Error('boss not on grid: ' + g.vehicles.map(v => v.name).join(','));
  return { boss: bossCar.name, skill: bossCar.ai.skill, isBoss: bossCar.ai.isBoss };
});

check('all power-ups fire without error', () => {
  const out = [];
  for (const p of Object.keys(POWERS)) {
    g.player.power = p; g.player.powerCount = 1;
    g.usePower(g.player);
    out.push({ p, projectiles: g.powerups.projectiles.length, shield: +g.player.shield.toFixed(1) });
  }
  return out;
});

check('pause / resume cycle', () => {
  g.state = 'racing';
  g.pause();
  if (g.state !== 'paused') throw new Error('pause failed');
  g.resume();
  if (g.state !== 'racing') throw new Error('resume failed');
  return { state: g.state };
});

check('quit to menu restores backdrop', () => {
  g.quitToMenu();
  if (g.state !== 'menu') throw new Error('state ' + g.state);
  if (!g.backdropCar) throw new Error('no backdrop');
  return { state: g.state, cars: g.world.carMeshes.size };
});

check('all four tracks load + rebuild', () => {
  const out = [];
  for (const t of TRACKS) {
    const b = g.world.loadTrack(t);
    out.push({ id: t.id, len: Math.round(b.spline.length), towers: b.towerInst.count, pads: b.pads.length });
  }
  return out;
});

check('track switching does not leak meshes', () => {
  const before = g.world.scene.children.length;
  g.world.loadTrack(TRACKS[0]);
  g.world.loadTrack(TRACKS[1]);
  const after = g.world.scene.children.length;
  if (after > before + 2) throw new Error(`scene grew ${before} -> ${after}`);
  return { before, after };
});

const failed = results.filter(r => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} full-game checks passed ====`);
if (failed.length) {
  for (const f of failed) console.log(' -', f.name, ':', f.e, '\n   ', (f.stack || '').split('\n').slice(0, 4).join('\n    '));
  process.exit(1);
}
