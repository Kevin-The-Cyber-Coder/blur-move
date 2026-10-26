import { register } from 'node:module';
register('./three-loader.mjs', import.meta.url);
import { CFG, CARS, TRACKS, AI_PERSONALITIES } from '../js/config.js';
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const { TrackSpline } = await import('../js/util.js');
const { Vehicle } = await import('../js/physics.js');
const { AIDriver } = await import('../js/ai.js');
for (const def of TRACKS) {
  const s = new TrackSpline(def.points);
  const world = { track: s, trackSurface: def.theme === 'snow' ? 'ice' : 'grass', gripMul: def.grip || 1,
    wetness: 0, maxCombo: 10, particles: new Proxy({}, { get: () => () => {} }),
    groundHeight(x,z){ return s.nearest(x,z).y; }, onComboStep(){}, onWallHit(){} };
  const lapTimes = [];
  for (let k = 0; k < 3; k++) {
    const p = AI_PERSONALITIES[k];
    const v = new Vehicle({ id:'ai'+k, isPlayer:false, spec: CARS[k], color:0, accent:0 });
    v.resetAt(s, 0, 0);
    const ai = new AIDriver(v, s, p, { skill: 0.86, offset: 0 });
    const ctx = { world, player:null, vehicles:[v], rubberBand:1, onTaunt(){}, usePower(){} };
    let prev = 0, travelled = 0, t = 0, laps = [];
    for (let i = 0; i < 60 * 240 && laps.length < 2; i++) {
      v.update(1/60, ai.update(1/60, ctx), world);
      const n = s.nearest(v.pos.x, v.pos.z);
      if (Math.abs(n.off) > CFG.track.halfWidth + 0.55) {
        const nr = s.normalAt(n.along), sg = Math.sign(n.off), ov = Math.abs(n.off) - (CFG.track.halfWidth + 0.55);
        v.pos.x -= nr.x * sg * ov; v.pos.z -= nr.z * sg * ov;
        v.collideWall(-nr.x * sg, -nr.z * sg, world);
      }
      const d = s.delta(prev, v.trackDist); prev = v.trackDist; travelled += d; t += 1/60;
      if (travelled >= s.length) { laps.push(t); travelled -= s.length; t = 0; }
    }
    lapTimes.push({ p: p.id, car: CARS[k].id, laps: laps.map(x => +x.toFixed(1)), dmg: Math.round(v.damage) });
  }
  const best = Math.min(...lapTimes.flatMap(l => l.laps.length ? l.laps : [999]));
  console.log(def.id.padEnd(14), 'AI lap', best.toFixed(1)+'s', '=>', Math.round(s.length / best * 3.6) + ' km/h avg'.padEnd(4), JSON.stringify(lapTimes));
}
