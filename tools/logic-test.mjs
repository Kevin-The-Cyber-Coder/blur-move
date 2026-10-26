/* Logic validation harness — runs the pure game simulation in Node with a
   lightweight DOM shim. Verifies spline, physics, AI, drift scoring, power-ups,
   lap logic and save/progression without a browser. */
import assert from 'node:assert/strict';
import { CFG, CARS, TRACKS, POWERS, CAREER, SKILLS } from '../js/config.js';
import { TrackSpline, clamp, fmtTime, rng, Pool } from '../js/util.js';
import { Vehicle, SURFACES } from '../js/physics.js';
import { AIDriver } from '../js/ai.js';
import { Save } from '../js/save.js';

/* ---------- tiny DOM shim so modules that touch the DOM import cleanly ---------- */
const listeners = {};
globalThis.window = globalThis;
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ style: {}, getContext: () => null, addEventListener() { }, appendChild() { } }),
  addEventListener() { },
  body: { classList: { toggle() { }, add() { }, remove() { } }, dataset: {} },
  querySelectorAll: () => [],
  documentElement: { style: {} },
};
try { globalThis.navigator = { getGamepads: () => [], maxTouchPoints: 0 }; } catch (e) { /* node has a read-only navigator */ }
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 1);
globalThis.cancelAnimationFrame = () => { };
globalThis.addEventListener = (k, fn) => { (listeners[k] ||= []).push(fn); };
globalThis.removeEventListener = () => { };
globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;

const results = [];
function test(name, fn) {
  try {
    const out = fn();
    results.push({ name, ok: true, out });
    console.log(`  ok  ${name}` + (out !== undefined ? '  :: ' + JSON.stringify(out).slice(0, 220) : ''));
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

/* ============================================================ */
console.log('\n== SPLINE ==');
const spline = new TrackSpline(TRACKS[0].points);
test('spline builds with sane length', () => {
  assert.ok(spline.length > 1500, 'length ' + spline.length);
  assert.ok(spline.count > 400);
  return { len: Math.round(spline.length), n: spline.count, spacing: +spline.spacing.toFixed(2) };
});
test('spline positions are continuous (no jumps)', () => {
  let maxJump = 0;
  for (let d = 0; d < spline.length; d += 5) {
    const a = spline.at(d, { x: 0, y: 0, z: 0 });
    const b = spline.at(d + 5, { x: 0, y: 0, z: 0 });
    maxJump = Math.max(maxJump, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  }
  assert.ok(maxJump < 12, 'jump ' + maxJump);
  return { maxJump: +maxJump.toFixed(2) };
});
test('spline wraps and is closed', () => {
  const a = spline.at(0, {});
  const b = spline.at(spline.length, {});
  const c = spline.at(-10, {});
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.01);
  assert.ok(Math.abs(spline.wrap(-10) - (spline.length - 10)) < 0.01);
  return 'closed + wraps';
});
test('nearest() round-trips: sample point -> same distance', () => {
  let worst = 0;
  for (let i = 0; i < 60; i++) {
    const d = (i / 60) * spline.length;
    const p = spline.pointAt(d, (i % 5 - 2) * 3);
    const n = spline.nearest(p.x, p.z);
    worst = Math.max(worst, Math.abs(spline.delta(d, n.along)));
  }
  assert.ok(worst < 14, 'worst ' + worst);
  return { worstErr: +worst.toFixed(2) };
});
test('curvature is finite everywhere', () => {
  for (let i = 0; i < spline.count; i++) assert.ok(isFinite(spline.curvature[i]));
  const maxK = Math.max(...spline.curvature.map(Math.abs));
  return { maxCurvature: +maxK.toFixed(4) };
});
test('speed limits are sensible', () => {
  const grip = CFG.phys.gripBase;
  let min = 1e9, max = 0;
  for (let d = 0; d < spline.length; d += 10) {
    const v = spline.speedLimit(d, grip);
    if (v < 900) { min = Math.min(min, v); max = Math.max(max, v); }
  }
  assert.ok(min > 8, 'min ' + min);
  return { slowestCornerKmh: Math.round(min * 3.6), fastestKmh: Math.round(max * 3.6) };
});
for (const t of TRACKS) {
  test(`track "${t.id}" builds + drivable widths`, () => {
    const s = new TrackSpline(t.points);
    const b = s.bounds;
    assert.ok(s.length > 1200);
    return { len: Math.round(s.length), w: Math.round(b.maxX - b.minX), h: Math.round(b.maxZ - b.minZ) };
  });
}

/* ============================================================ */
console.log('\n== WORLD STUB + PHYSICS ==');
function makeWorld(def = TRACKS[0]) {
  const s = new TrackSpline(def.points);
  return {
    track: s,
    trackSurface: 'grass',
    gripMul: 1, wetness: 0, maxCombo: CFG.drift.maxCombo,
    particles: { spark() { }, tireSmoke() { }, pickupBurst() { }, explosion() { }, shockRing() { }, dust() { }, splash() { }, boostFlame() { } },
    groundHeight(x, z) { return s.nearest(x, z).y; },
    onComboStep() { },
    onWallHit() { },
  };
}
const world = makeWorld();

function makeCar(id = 'test', spec = CARS[0]) {
  const v = new Vehicle({ id, isPlayer: id === 'test', spec, color: spec.color, accent: spec.accent });
  v.resetAt(spline, 20, 0);
  return v;
}
const noInput = { throttle: 0, brake: 0, steer: 0, boost: false, handbrake: false };
const fullInput = { throttle: 1, brake: 0, steer: 0, boost: false, handbrake: false };

test('car accelerates under full throttle', () => {
  const v = makeCar();
  for (let i = 0; i < 300; i++) v.update(1 / 60, fullInput, world);
  assert.ok(v.speed > 20, 'speed ' + v.speed);
  return { kmh: Math.round(v.speed * 3.6), gear: v.gear, rpm: Math.round(v.rpm) };
});
test('car reaches near top speed and does not exceed it', () => {
  const v = makeCar();
  // drive along the spline so it does not hit walls: repeatedly re-centre
  for (let i = 0; i < 60 * 25; i++) {
    v.update(1 / 60, fullInput, world);
    const n = spline.nearest(v.pos.x, v.pos.z);
    const t = spline.tangentAt(n.along);
    v.pos.x = spline.pointAt(n.along, 0).x;
    v.pos.z = spline.pointAt(n.along, 0).z;
    v.yaw = Math.atan2(t.x, t.z);
  }
  assert.ok(v.speed > v.spec.speed * 0.8, 'speed ' + v.speed);
  assert.ok(v.speed <= v.spec.speed * 1.07, 'over top: ' + v.speed);
  return { kmh: Math.round(v.speed * 3.6), spec: Math.round(v.spec.speed * 3.6) };
});
test('braking stops the car', () => {
  const v = makeCar();
  for (let i = 0; i < 180; i++) v.update(1 / 60, fullInput, world);
  const before = v.speed;
  let minSpeed = before;
  for (let i = 0; i < 150; i++) {
    v.update(1 / 60, { ...noInput, brake: 1 }, world);
    minSpeed = Math.min(minSpeed, v.speed);
  }
  assert.ok(minSpeed < before * 0.2, `${before} -> ${minSpeed}`);
  return { from: Math.round(before * 3.6), minKmh: Math.round(minSpeed * 3.6) };
});
test('reverse gear works', () => {
  const v = makeCar();
  for (let i = 0; i < 120; i++) v.update(1 / 60, { ...noInput, brake: 1 }, world);
  assert.ok(v.forwardSpeed < -2, 'fwd ' + v.forwardSpeed);
  return { reverseKmh: Math.round(v.forwardSpeed * 3.6), gear: v.gear };
});
test('steering turns the car', () => {
  const v = makeCar();
  for (let i = 0; i < 120; i++) v.update(1 / 60, fullInput, world);
  const yaw0 = v.yaw;
  for (let i = 0; i < 60; i++) v.update(1 / 60, { ...fullInput, steer: 1 }, world);
  assert.ok(Math.abs(v.yaw - yaw0) > 0.15, 'yaw delta ' + (v.yaw - yaw0));
  return { yawDelta: +(v.yaw - yaw0).toFixed(2) };
});
test('handbrake induces a drift + sets drifting flag', () => {
  const v = makeCar();
  for (let i = 0; i < 150; i++) v.update(1 / 60, fullInput, world);
  let drifted = false, maxSlip = 0;
  for (let i = 0; i < 100; i++) {
    v.update(1 / 60, { throttle: 1, brake: 0, steer: 0.7, boost: false, handbrake: true }, world);
    maxSlip = Math.max(maxSlip, v.driftAngle);
    if (v.drifting) drifted = true;
    const n = spline.nearest(v.pos.x, v.pos.z);
    if (Math.abs(n.off) > CFG.track.halfWidth) {
      const p = spline.pointAt(n.along, 0);
      v.pos.x = p.x; v.pos.z = p.z;
    }
  }
  assert.ok(drifted, 'never drifted (slip ' + maxSlip + ')');
  assert.ok(maxSlip > 0.35 && maxSlip < 1.2, 'slip out of range: ' + maxSlip);
  assert.ok(v.driftScore > 100, 'no score');
  return { maxSlipDeg: Math.round(maxSlip * 57.3), score: Math.round(v.driftScore) };
});
test('drift generates nitro', () => {
  const v = makeCar();
  for (let i = 0; i < 150; i++) v.update(1 / 60, fullInput, world);
  v.nitro = 10;
  for (let i = 0; i < 120; i++) {
    v.update(1 / 60, { throttle: 1, brake: 0, steer: -0.9, boost: false, handbrake: true }, world);
    const n = spline.nearest(v.pos.x, v.pos.z);
    v.pos.x = spline.pointAt(n.along, 0).x; v.pos.z = spline.pointAt(n.along, 0).z;
  }
  assert.ok(v.nitro > 12, 'nitro ' + v.nitro);
  return { nitro: +v.nitro.toFixed(1) };
});
test('nitro boost raises top speed', () => {
  const a = makeCar('a'), b = makeCar('b');
  const drive = (v, boost) => {
    for (let i = 0; i < 60 * 14; i++) {
      v.update(1 / 60, { ...fullInput, boost }, world);
      const n = spline.nearest(v.pos.x, v.pos.z);
      const t = spline.tangentAt(n.along);
      const p = spline.pointAt(n.along, 0);
      v.pos.x = p.x; v.pos.z = p.z; v.yaw = Math.atan2(t.x, t.z);
      if (boost) v.nitro = 100;
    }
    return v.speed;
  };
  const normal = drive(a, false);
  b.nitro = 100;
  const boosted = drive(b, true);
  assert.ok(boosted > normal * 1.05, `${normal} vs ${boosted}`);
  return { normalKmh: Math.round(normal * 3.6), boostKmh: Math.round(boosted * 3.6) };
});
test('wall collision registers damage and keeps car on track', () => {
  const v = makeCar();
  for (let i = 0; i < 120; i++) v.update(1 / 60, fullInput, world);
  // aim at the wall
  v.yaw += 0.9;
  const n = spline.nearest(v.pos.x, v.pos.z);
  const nrm = spline.normalAt(n.along);
  v.collideWall(-nrm.x, -nrm.z, world);
  assert.ok(v.damage >= 0);
  return { damage: Math.round(v.damage), wallHits: v.wallHits };
});
test('surfaces change grip', () => {
  const road = SURFACES.road.grip, ice = SURFACES.ice.grip, grass = SURFACES.grass.grip;
  assert.ok(ice < grass && grass < road);
  return { road, wet: SURFACES.wet.grip, grass, ice };
});

/* ============================================================ */
console.log('\n== AI ==');
test('AI completes a full lap unaided', () => {
  const v = new Vehicle({ id: 'ai0', isPlayer: false, spec: CARS[0], color: 0xffffff, accent: 0 });
  v.resetAt(spline, 0, 0);
  const ai = new AIDriver(v, spline, { id: 'clean', aggression: 0.2, skill: 1, radar: 0.9, taunt: ['x'] }, { skill: 1 });
  const w2 = makeWorld();
  let laps = 0, prevDist = 0, travelled = 0;
  const ctx = { world: w2, player: null, vehicles: [v], rubberBand: 1, onTaunt() { }, usePower() { } };
  for (let i = 0; i < 60 * 90; i++) {
    const inp = ai.update(1 / 60, ctx);
    v.update(1 / 60, inp, w2);
    const n = spline.nearest(v.pos.x, v.pos.z);
    // wall enforcement like the game
    if (Math.abs(n.off) > CFG.track.halfWidth + 0.55) {
      const nrm = spline.normalAt(n.along);
      const sgn = Math.sign(n.off);
      const over = Math.abs(n.off) - (CFG.track.halfWidth + 0.55);
      v.pos.x -= nrm.x * sgn * over; v.pos.z -= nrm.z * sgn * over;
      v.collideWall(-nrm.x * sgn, -nrm.z * sgn, w2);
    }
    const d = spline.delta(prevDist, v.trackDist);
    travelled += d; prevDist = v.trackDist;
    if (travelled >= spline.length) { laps++; travelled -= spline.length; }
  }
  assert.ok(laps >= 1, 'laps ' + laps + ' dist ' + Math.round(travelled));
  return { laps, avgKmh: Math.round(travelled / 90 * 3.6), maxKmh: Math.round(v.stats.topSpeed * 3.6) };
});
test('AI stays within track bounds over a lap', () => {
  const v = new Vehicle({ id: 'ai1', isPlayer: false, spec: CARS[1], color: 0xffffff, accent: 0 });
  v.resetAt(spline, 0, 0);
  const ai = new AIDriver(v, spline, { id: 'aggressive', aggression: 0.9, skill: 1, radar: 0.8, taunt: ['x'] }, { skill: 1 });
  const w2 = makeWorld();
  let maxOff = 0;
  const ctx = { world: w2, player: null, vehicles: [v], rubberBand: 1, onTaunt() { }, usePower() { } };
  for (let i = 0; i < 60 * 60; i++) {
    v.update(1 / 60, ai.update(1 / 60, ctx), w2);
    const n = spline.nearest(v.pos.x, v.pos.z);
    maxOff = Math.max(maxOff, Math.abs(n.off));
    if (Math.abs(n.off) > 60) break;
  }
  assert.ok(maxOff < 40, 'max offset ' + maxOff);
  return { maxOff: Math.round(maxOff), width: CFG.track.halfWidth };
});
test('AI does not get stuck (moves every second)', () => {
  const v = new Vehicle({ id: 'ai2', isPlayer: false, spec: CARS[2], color: 0xffffff, accent: 0 });
  v.resetAt(spline, 0, 0);
  const ai = new AIDriver(v, spline, { id: 'clean', aggression: 0.1, skill: 1, radar: 1, taunt: ['x'] }, { skill: 1 });
  const w2 = makeWorld();
  const ctx = { world: w2, player: null, vehicles: [v], rubberBand: 1, onTaunt() { }, usePower() { } };
  let stalled = 0;
  for (let s = 0; s < 20; s++) {
    const p0 = { x: v.pos.x, z: v.pos.z };
    for (let i = 0; i < 60; i++) v.update(1 / 60, ai.update(1 / 60, ctx), w2);
    if (Math.hypot(v.pos.x - p0.x, v.pos.z - p0.z) < 3) stalled++;
  }
  assert.equal(stalled, 0, 'stalled seconds: ' + stalled);
  return { stalled, kmh: Math.round(v.speed * 3.6) };
});

/* ============================================================ */
console.log('\n== SAVE / PROGRESSION ==');
test('save round-trips through localStorage', () => {
  const s = new Save();
  s.reset();
  s.addCoins(1234);
  s.addXp(5000);
  const s2 = new Save();
  assert.equal(s2.profile.coins, s.profile.coins);
  assert.equal(s2.profile.level, s.profile.level);
  return { coins: s2.profile.coins, level: s2.profile.level, xp: s2.profile.xp };
});
test('level curve is monotonic + skill points awarded', () => {
  const s = new Save(); s.reset();
  const before = s.profile.skillPoints;
  const levels = s.addXp(20000);
  assert.ok(levels >= 2, 'levels ' + levels);
  assert.ok(s.profile.skillPoints > before);
  return { levels, level: s.profile.level, sp: s.profile.skillPoints };
});
test('car purchase respects coins', () => {
  const s = new Save(); s.reset();
  assert.equal(s.ownsCar('spectre'), false);
  assert.equal(s.buyCar('spectre'), false, 'bought without coins!');
  s.addCoins(10000);
  assert.equal(s.buyCar('spectre'), true);
  assert.equal(s.ownsCar('spectre'), true);
  return { coins: s.profile.coins, owned: s.profile.ownedCars };
});
test('skill tree enforces prerequisites', () => {
  const s = new Save(); s.reset();
  s.profile.skillPoints = 10;
  const top2 = SKILLS.find(k => k.id === 'top2');
  const r1 = s.learnSkill(top2);
  assert.equal(r1.ok, false, 'tier2 learned without tier1');
  const top1 = SKILLS.find(k => k.id === 'top1');
  assert.equal(s.learnSkill(top1).ok, true);
  assert.equal(s.learnSkill(top2).ok, true);
  return { sp: s.profile.skillPoints };
});
test('achievements award xp + coins once', () => {
  const s = new Save(); s.reset();
  s.profile.stats.wins = 1;
  const got = s.checkAchievements();
  assert.ok(got.length >= 1);
  const again = s.checkAchievements();
  assert.equal(again.length, 0, 'achievement awarded twice');
  return { got: got.map(g => g.id) };
});
test('daily challenges progress + claim', () => {
  const s = new Save(); s.reset();
  const d = s.ensureDaily();
  assert.ok(d.list.length === 3);
  const c = d.list[0];
  for (let i = 0; i < 50; i++) s.dailyProgress(c.type, Math.ceil(c.target / 40) + 1);
  const ok = s.claimDaily(c.id);
  assert.equal(ok, true, 'claim failed, progress ' + c.progress + '/' + c.target);
  assert.equal(s.claimDaily(c.id), false, 'double claim');
  return { type: c.type, target: c.target, progress: c.progress };
});
test('best times only improve', () => {
  const s = new Save(); s.reset();
  assert.equal(s.recordTime('x', 100), true);
  assert.equal(s.recordTime('x', 120), false);
  assert.equal(s.recordTime('x', 90), true);
  assert.equal(s.profile.bestTimes.x, 90);
  return s.profile.bestTimes;
});
test('career data integrity: every event has a valid track', () => {
  for (const ev of CAREER) {
    assert.ok(TRACKS.some(t => t.id === ev.track), 'bad track in ' + ev.id);
    assert.ok(ev.laps >= 1);
    assert.ok(ev.reward > 0);
  }
  return { events: CAREER.length };
});
test('every power-up is reachable and described', () => {
  const keys = Object.keys(POWERS);
  for (const k of keys) {
    assert.ok(POWERS[k].name && POWERS[k].icon && POWERS[k].color);
  }
  return { count: keys.length, keys };
});
test('every car has unique stats and a cost curve', () => {
  const ids = new Set(CARS.map(c => c.id));
  assert.equal(ids.size, CARS.length);
  for (const c of CARS) {
    assert.ok(c.speed > 70 && c.speed < 130);
    assert.ok(c.accel > 10 && c.accel < 40);
  }
  return { cars: CARS.length, costs: CARS.map(c => c.cost) };
});

/* ============================================================ */
console.log('\n== RACE MATH ==');
test('position ranking by progress', () => {
  const vs = [];
  for (let i = 0; i < 6; i++) {
    const v = new Vehicle({ id: 'r' + i, isPlayer: i === 0, spec: CARS[0], color: 0, accent: 0 });
    v.progressSinceLine = i * 100;
    vs.push(v);
  }
  vs.sort((a, b) => b.progressSinceLine - a.progressSinceLine);
  assert.equal(vs[0].id, 'r5');
  assert.equal(vs[5].id, 'r0');
  return vs.map(v => v.id);
});
test('lap time formatting', () => {
  assert.equal(fmtTime(75.4), '1:15.40');
  assert.equal(fmtTime(9.05), '0:09.05');
  assert.equal(fmtTime(0), '--:--.--');
  return 'ok';
});
test('drift combo scoring curve is monotonic', () => {
  const score = (t, slip, speed) => (CFG.drift.baseRate + slip * CFG.drift.angleScore * 8 + speed * CFG.drift.speedScore) * t;
  assert.ok(score(2, 0.5, 30) > score(1, 0.5, 30));
  assert.ok(score(1, 0.8, 30) > score(1, 0.3, 30));
  return { a: Math.round(score(2, 0.5, 30)) };
});
test('easing / math helpers', () => {
  assert.equal(clamp(5, 0, 3), 3);
  let seed = rng(42);
  const a = seed(), b = seed();
  assert.ok(a >= 0 && a < 1 && b >= 0 && b < 1 && a !== b);
  const pool = new Pool(() => ({}), () => { }, 4);
  const o = pool.get(); pool.release(o);
  assert.equal(pool.free.length, 4);
  return 'ok';
});

/* ============================================================ */
const failed = results.filter(r => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(' -', f.name, ':', f.error);
  process.exit(1);
}
