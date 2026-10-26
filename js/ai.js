/* ============================================================
   AI — racing line following, corner braking, rubber-banding,
   overtaking, drafting, personality behaviours and taunts.
   ============================================================ */
import { CFG } from './config.js';
import { clamp, clamp01, lerp, wrapAngle, angleDiff, rand, chance, pick } from './util.js';

export class AIDriver {
  constructor(vehicle, track, personality, opts = {}) {
    this.v = vehicle;
    this.track = track;
    this.p = personality;
    this.skill = (opts.skill ?? 1) * personality.skill;
    this.aggression = personality.aggression;
    this.radar = personality.radar ?? 0.8;
    this.lineOffset = opts.offset ?? 0;     // preferred lateral offset on the racing line
    this.lanePhase = rand(0, Math.PI * 2);
    this.laneFreq = rand(0.13, 0.3);
    this.mode = 'race';
    this.overtakeTimer = 0;
    this.avoidSide = chance(0.5) ? 1 : -1;
    this.reactionTimer = 0;
    this.stuckTimer = 0;
    this.recoverTimer = 0;
    this.thinkTimer = rand(0.2, 0.6);
    this.tauntCooldown = rand(14, 30);
    this.boostCooldown = rand(0.5, 2.5);
    this.rubberBand = 0;
    this.targetOff = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, boost: false, handbrake: false };
    this.desiredPower = null;
    this.isBoss = !!opts.isBoss;
  }

  /* main decision tick */
  update(dt, ctx) {
    const v = this.v;
    const track = this.track;
    const s = this.skill;

    /* ---------- stuck / off-track recovery ---------- */
    if (v.speed < 2.5 && v.spinOut <= 0) this.stuckTimer += dt;
    else this.stuckTimer = 0;
    if (this.stuckTimer > 2.4) {
      this.stuckTimer = 0;
      v.recover(track, v.trackDist + 2);
      ctx.world.particles?.pickupBurst(v.pos.x, v.pos.y + 1, v.pos.z, 0x22e6ff);
    }

    /* ---------- line selection ---------- */
    const speed01 = clamp01(v.speed / (v.spec.speed * 1.6));
    this.lanePhase += dt * this.laneFreq;
    let lineOff = clamp(this.lineOffset + Math.sin(this.lanePhase) * 1.8, -CFG.track.halfWidth * 0.6, CFG.track.halfWidth * 0.6);

    /* ---------- curvature-aware racing line (inside of the corner) ---------- */
    const kAhead = track.curvatureAt(v.trackDist + 24 + v.speed * 0.35);
    const insideBias = clamp(kAhead * 140, -1, 1) * CFG.track.halfWidth * 0.42;
    lineOff = clamp(lineOff + insideBias, -CFG.track.halfWidth * 0.7, CFG.track.halfWidth * 0.7);

    /* ---------- avoid other cars ---------- */
    let nearestAhead = null, nearestAheadDist = 1e9, nearestAheadGap = 0;
    let nearestBehind = null, nearestBehindDist = 1e9;
    for (const o of ctx.vehicles) {
      if (o === v) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 30) continue;
      // is it ahead in track space?
      const gap = track.delta(v.trackDist, o.trackDist);
      if (gap > 0 && gap < 26 && d < nearestAheadDist) { nearestAhead = o; nearestAheadDist = d; nearestAheadGap = gap; }
      if (gap < 0 && -gap < 22 && d < nearestBehindDist) { nearestBehind = o; nearestBehindDist = d; }
      // hard avoidance
      if (d < 6.5) {
        const myOffN = track.nearest(v.pos.x, v.pos.z).off;
        const theirOff = track.nearest(o.pos.x, o.pos.z).off;
        if (Math.abs(theirOff - myOffN) < 3.4) {
          const dir = theirOff > myOffN ? -1 : 1;
          lineOff += dir * (6.5 - d) * (this.radar) * 1.2;
        }
      }
    }
    // overtaking behaviour
    if (nearestAhead && nearestAheadDist < 14) {
      this.overtakeTimer += dt;
      const theirOff = track.nearest(nearestAhead.pos.x, nearestAhead.pos.z).off;
      const myOff = track.nearest(v.pos.x, v.pos.z).off;
      // pick a side to pass
      let side = this.avoidSide;
      if (myOff > CFG.track.halfWidth * 0.35) side = -1;
      else if (myOff < -CFG.track.halfWidth * 0.35) side = 1;
      const passOff = clamp(theirOff + side * 4.4, -CFG.track.halfWidth * 0.72, CFG.track.halfWidth * 0.72);
      lineOff = lerp(lineOff, passOff, clamp01(0.5 + this.aggression * 0.5));
      this.mode = 'overtake';
      // aggressive: bump them
      if (this.aggression > 0.75 && nearestAheadDist < 5 && chance(dt * 1.2)) {
        this.mode = 'attack';
      }
    } else {
      this.mode = 'race';
      this.overtakeTimer = 0;
    }

    this.targetOff = clamp(lineOff, -CFG.track.halfWidth * 0.78, CFG.track.halfWidth * 0.78);

    /* ---------- steering toward look-ahead point ---------- */
    const lookDist = Math.max(9, Math.min(34, 7 + v.speed * 0.42)) * (0.9 + s * 0.12);
    const targetAlong = v.trackDist + lookDist;
    const tp = track.pointAt(targetAlong, this.targetOff);
    const desiredYaw = Math.atan2(tp.x - v.pos.x, tp.z - v.pos.z);
    let err = wrapAngle(desiredYaw - v.yaw);
    // steering with counter-steer for slides
    let steer = clamp(err * 1.85, -1, 1);
    const slideAngle = Math.atan2(v.lateralVel, Math.max(Math.abs(v.forwardSpeed), 3));
    steer = clamp(steer - slideAngle * 0.55, -1, 1);
    // smooth reaction delay
    this.input.steer = clamp(v.steerInput + (steer - v.steerInput) * clamp01(dt * (8 + s * 6)), -1, 1);

    /* ---------- speed target: corner-aware + braking-distance correct ---------- */
    const gripAccel = CFG.phys.gripBase * v.spec.grip * v.surfaceGrip * 1.02;
    const brakeDist = Math.max(24, (v.speed * v.speed) / (CFG.phys.brakeDecel * 0.62));
    const cornerLimit = track.minSpeedAhead(v.trackDist, brakeDist + lookDist * 0.5, gripAccel);
    // safety: the faster you are, the more margin you need
    const safety = 0.80 + s * 0.13;
    let targetSpeed = Math.min(v.spec.speed * (0.88 + s * 0.14), cornerLimit * safety);
    // off-line: scrub speed so the car can rejoin instead of ploughing on
    const myOff = track.nearest(v.pos.x, v.pos.z).off;
    if (Math.abs(myOff) > CFG.track.halfWidth * 0.7) targetSpeed *= 0.82;
    // rubber banding toward the player
    if (ctx.player) {
      const gap = track.delta(v.trackDist, ctx.player.trackDist);
      const rb = clamp(gap / CFG.ai.catchUpDist, -1, 1);
      const band = CFG.ai.rubberBandMax * ctx.rubberBand;
      targetSpeed *= (1 + band * (rb < 0 ? 1 : -0.6));
      this.rubberBand = rb;
    }
    // boost logic
    this.boostCooldown -= dt;
    if (v.nitro > 25 && this.boostCooldown <= 0 && cornerLimit > v.speed * 1.05 && chance(dt * 0.9)) {
      v.boosting = true;
      this.boostCooldown = rand(1.4, 4.0);
    }
    if (v.boosting && (v.nitro <= 2 || cornerLimit < v.speed * 0.9)) v.boosting = false;

    /* ---------- throttle / brake ---------- */
    const diff = targetSpeed - v.forwardSpeed;
    if (diff > 3) { this.input.throttle = 1; this.input.brake = 0; }
    else if (diff > 0.5) { this.input.throttle = 0.7; this.input.brake = 0; }
    else if (diff > -2) { this.input.throttle = 0.15; this.input.brake = 0.1; }
    else if (diff > -10) { this.input.throttle = 0; this.input.brake = clamp01(-diff / 12); }
    else { this.input.throttle = 0; this.input.brake = 1; }

    // don't slam into the car ahead
    if (nearestAhead && nearestAheadDist < 8 && (this.aggression < 0.7 || this.mode !== 'attack')) {
      const theirSpeed = nearestAhead.forwardSpeed;
      if (v.forwardSpeed > theirSpeed - 1) {
        this.input.throttle *= 0.5;
        this.input.brake = Math.max(this.input.brake, 0.25);
      }
    }

    /* ---------- handbrake drift for the drifter personality ---------- */
    const curv = Math.abs(track.curvatureAt(v.trackDist + lookDist * 0.6));
    if (this.p.id === 'drifter' && curv > 0.012 && v.speed > 22 && chance(dt * 0.6)) {
      this.input.handbrake = true;
    } else this.input.handbrake = false;

    /* ---------- power-up logic ---------- */
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = rand(0.9, 2.2);
      this.thinkPower(ctx, nearestAhead, nearestAheadDist, nearestBehind, nearestBehindDist);
    }

    /* ---------- taunts ---------- */
    this.tauntCooldown -= dt;
    if (this.tauntCooldown <= 0) {
      this.tauntCooldown = rand(20, 45);
      if (ctx.player && Math.abs(track.delta(v.trackDist, ctx.player.trackDist)) < 40 && chance(0.5)) {
        ctx.onTaunt?.(v, pick(this.p.taunt));
      }
    }
    return this.input;
  }

  thinkPower(ctx, ahead, aheadDist, behind, behindDist) {
    const v = this.v;
    if (!v.power) return;
    const p = v.power;
    if (p === 'nitro') {
      const curv = Math.abs(this.track.curvatureAt(v.trackDist + 40));
      if (curv < 0.008 && v.speed > 30) ctx.usePower(v);
    } else if (p === 'shock') {
      if (ahead && aheadDist < 80) ctx.usePower(v);
    } else if (p === 'shunt') {
      if (ahead && aheadDist < 7) ctx.usePower(v);
      else if (behind && behindDist < 7) ctx.usePower(v);
    } else if (p === 'shield') {
      if (v.damage > 20 || (behind && behindDist < 22)) ctx.usePower(v);
    } else if (p === 'bolt') {
      if (ahead && aheadDist < 40) ctx.usePower(v);
    } else if (p === 'repair') {
      if (v.damage > 45) ctx.usePower(v);
    }
  }
}

/* end of AI module */
