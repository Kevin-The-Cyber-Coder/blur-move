/* ============================================================
   PHYSICS — arcade vehicle model.
   Frame: +Z is car forward, +X is car right, +Y up.
   Uses a slip-based lateral force model with load transfer,
   handbrake drift, counter-steer stabilisation and airborne state.
   ============================================================ */
import { CFG } from './config.js';
import { clamp, clamp01, lerp, damp, wrapAngle, sign, TAU } from './util.js';

const P = CFG.phys;

/* surfaces affect grip + drag */
export const SURFACES = {
  road:  { grip: 1.00, drag: 1.00, score: 1.0 },
  wet:   { grip: 0.92, drag: 1.06, score: 1.15 },
  grass: { grip: 0.58, drag: 2.40, score: 0.5 },
  sand:  { grip: 0.50, drag: 3.00, score: 0.4 },
  ice:   { grip: 0.34, drag: 0.70, score: 1.3 },
};

export class Vehicle {
  constructor(opts) {
    this.id = opts.id;
    this.isPlayer = !!opts.isPlayer;
    this.spec = opts.spec;
    this.name = opts.name || this.spec.name;
    this.color = opts.color ?? this.spec.color;
    this.accent = opts.accent ?? this.spec.accent;

    // --- pose
    this.pos = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.prevYaw = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.yawRate = 0;

    // --- vertical / air
    this.airborne = false;
    this.airTime = 0;
    this.groundY = 0;

    // --- engine
    this.gear = 1;
    this.rpm = 800;
    this.engineLoad = 0;
    this.throttle = 0;
    this.brake = 0;
    this.steerInput = 0;
    this.steerSmooth = 0;
    this.steerRate = 0;
    this.handbrake = false;

    // --- boost
    this.nitro = 55;
    this.nitroMax = CFG.boost.max;
    this.boosting = false;
    this.boostHeld = false;
    this.boostTime = 0;

    // --- drift
    this.driftAngle = 0;       // slip angle rad
    this.drifting = false;
    this.driftTime = 0;
    this.driftScore = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.slipLat = 0;
    this.lateralVel = 0;

    // --- grip / surface
    this.surface = 'road';
    this.surfaceGrip = 1;
    this.gripMul = 1;
    this.gripLost = 0;         // 0..1 how much grip is being exceeded
    this.wheelSpin = 0;

    // --- damage
    this.damage = 0;
    this.engineHealth = 1;
    this.lastHitBy = null;
    this.invuln = 0;
    this.spinOut = 0;
    this.stunned = 0;

    // --- shield / powers
    this.shield = 0;
    this.boostPadCooldown = 0;
    this.power = null;
    this.powerCount = 0;
    this.usedPowerTimer = 0;

    // --- track progress
    this.trackDist = 0;
    this.lap = 0;
    this.lastLapTime = 0;
    this.bestLap = 0;
    this.totalTime = 0;
    this.lapStart = 0;
    this.finished = false;
    this.finishTime = 0;
    this.place = 1;
    this.wrongWay = false;
    this.cleanLap = true;
    this.wallHits = 0;

    // --- driving assists / toggles
    this.tcs = true;
    this.abs = true;
    this.autoThrottle = false;

    // --- visual state
    this.visYaw = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.suspension = [0, 0, 0, 0];
    this.wheelRot = 0;
    this.wheelSteer = 0;
    this.exhaustHeat = 0;
    this.speed = 0;
    this.forwardSpeed = 0;

    // --- ai personality (set by ai.js)
    this.ai = null;
    this.stats = { boosts: 0, drifts: 0, shunts: 0, hits: 0, maxCombo: 1, airTime: 0, topSpeed: 0 };
  }

  get fast() { return this.forwardSpeed > this.spec.speed * 0.55; }
  get topSpeed() { return this.spec.speed * (this.boosting ? CFG.boost.topSpeedMul : 1); }

  resetAt(track, dist, lateral = 0) {
    const p = track.pointAt(dist, lateral);
    this.pos.x = p.x; this.pos.z = p.z; this.pos.y = p.y;
    const t = track.tangentAt(dist);
    this.yaw = Math.atan2(t.x, t.z);
    this.visYaw = this.yaw;
    this.vx = 0; this.vz = 0; this.vy = 0; this.yawRate = 0;
    this.airborne = false; this.driftAngle = 0; this.drifting = false;
    this.trackDist = dist; this.spinOut = 0; this.stunned = 0;
    this.damage = 0; this.engineHealth = 1;
    this.boosting = false; this.boostHeld = false;
    this.nitro = 55;
    this.speed = 0;
  }

  /** apply an impulse in world space (m/s delta) */
  impulse(ix, iz, spin = 0) {
    this.vx += ix; this.vz += iz;
    this.yawRate += spin;
  }

  hit(dmg, by = null) {
    if (this.invuln > 0 || this.shield > 0) return false;
    const resist = this.damageResist ?? 1;
    this.damage = clamp(this.damage + dmg * resist, 0, 100);
    this.engineHealth = clamp(1 - Math.pow(this.damage / 100, 1.4) * 0.45, 0.55, 1);
    this.lastHitBy = by;
    this.stats.hits++;
    return true;
  }

  addNitro(v) { this.nitro = clamp(this.nitro + v, 0, this.nitroMax); }

  /* ============================================================
     main integrator
     ============================================================ */
  update(dt, input, world) {
    const spec = this.spec;
    const track = world.track.spline || world.track;

    this.prevYaw = this.yaw;
    this.invuln = Math.max(0, this.invuln - dt);
    this.stunned = Math.max(0, this.stunned - dt);
    this.spinOut = Math.max(0, this.spinOut - dt);
    this.shield = Math.max(0, this.shield - dt);
    this.boostPadCooldown = Math.max(0, this.boostPadCooldown - dt);
    this.usedPowerTimer = Math.max(0, this.usedPowerTimer - dt);

    /* ---- control inputs ---- */
    let throttle = input.throttle;
    let brake = input.brake;
    let steer = input.steer;
    if (this.autoThrottle && throttle <= 0 && brake <= 0) throttle = 0.85;
    if (this.stunned > 0) { throttle = 0; brake = 0; steer *= 0.25; }
    this.throttle = damp(this.throttle, throttle, 14, dt);
    this.brake = damp(this.brake, brake, 18, dt);

    /* ---- surface sampling ---- */
    const near = track.nearest(this.pos.x, this.pos.z);
    this.trackDist = near.along;
    const off = Math.abs(near.off);
    const halfW = CFG.track.halfWidth;
    let surf = 'road';
    if (off > halfW + 0.6) {
      surf = world.trackSurface || 'grass';
    } else if (world.wetness > 0.35 && off < halfW) {
      surf = 'wet';
    }
    this.surface = surf;
    const S = SURFACES[surf] || SURFACES.road;
    this.surfaceGrip = S.grip * (world.gripMul || 1);

    /* ---- local frame ---- */
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // forward = (sinY, cosY), right = (cosY, -sinY)
    let vF = this.vx * sinY + this.vz * cosY;
    let vR = this.vx * cosY - this.vz * sinY;

    const speed = Math.hypot(this.vx, this.vz);
    this.speed = speed;

    /* ---- steering: speed-sensitive lock + input smoothing ---- */
    const speedFactor = clamp(1 - speed * P.steerFalloff / 30, P.minSteerFactor, 1);
    const maxSteer = P.maxSteer * speedFactor * spec.handling;
    const steerTarget = clamp(steer, -1, 1) * maxSteer;
    this.steerRate = (steerTarget - this.steerSmooth) / Math.max(dt, 1e-4);
    this.steerSmooth = damp(this.steerSmooth, steerTarget, 16, dt);
    this.steerInput = steer;
    this.handbrake = !!input.handbrake;

    /* ---- nitro / boost ---- */
    if (input.boost && this.nitro > 0 && this.boostPadCooldown <= 0) {
      if (!this.boosting && this.nitro >= CFG.boost.minToStart) { this.boosting = true; this.stats.boosts++; }
      if (this.boosting) {
        this.boostHeld = true;
        this.nitro = Math.max(0, this.nitro - CFG.boost.drainPerSec * dt);
        this.boostTime += dt;
        if (this.nitro <= 0.01) { this.boosting = false; this.boostHeld = false; }
      }
    } else {
      this.boosting = false;
      this.boostHeld = false;
    }
    if (this.boosting) this.exhaustHeat = Math.min(1, this.exhaustHeat + dt * 2.4);
    else this.exhaustHeat = Math.max(0, this.exhaustHeat - dt * 0.6);

    /* ---- longitudinal forces ---- */
    const top = this.topSpeed * this.engineHealth;
    let accel = 0;
    if (!this.airborne) {
      const powerBand = clamp(1 - Math.pow(Math.max(0, vF) / (top * 1.02), 3), 0, 1);
      accel += this.throttle * spec.accel * (0.35 + 0.65 * powerBand);
      if (this.boosting) accel += CFG.boost.thrust * (1 + CFG.boost.comboBoostMul * (this.combo - 1) * 0.12);
      // engine braking
      if (this.throttle < 0.05 && vF > 0) accel -= 3.2;
      // braking
      if (this.brake > 0) {
        if (vF > 0.5) {
          const absMod = this.abs ? 1 : (0.82 + Math.sin(performance.now() * 0.06) * 0.1);
          accel -= P.brakeDecel * this.brake * absMod;
        }
      } else if (this.throttle < 0.05 && Math.abs(vF) < 0.75) {
        // standstill friction: never creep forever at 0.4 m/s
        accel -= vF * 16;
      }
      // low-speed static friction: kill residual sideways slide so the car can
      // actually stop and drive off cleanly
      if (speed < 2.5 && this.throttle < 0.6) {
        vR -= vR * Math.min(1, 9 * dt);
      }
      // drag + rolling resistance
      const dragMul = S.drag * (1 + this.damage * 0.004);
      accel -= P.drag * dragMul * vF * Math.abs(vF);
      accel -= P.rollResist * dragMul * sign(vF) * (Math.abs(vF) > 0.2 ? 1 : 0);
      // slipstream: less drag when tucked behind
      accel += this.slipBoost || 0;
      // slope: gravity along the road gradient
      const t3 = track.tangentAt(near.along);
      accel -= P.g * t3.y * 0.85;
    } else {
      accel -= P.drag * vF * Math.abs(vF);
    }

    /* ---- yaw dynamics ---- */
    const slipBefore = Math.abs(wrapAngle(Math.atan2(this.vx, this.vz) - this.yaw));
    const s2 = Math.sin(this.yaw), c2 = Math.cos(this.yaw);
    const gripNow = P.gripBase * spec.grip * this.surfaceGrip * this.gripMul * (this.handbrake ? 0.45 : 1);
    if (!this.airborne) {
      const wheelbase = 2.65;
      // bicycle-model target yaw rate, then BOUNDED by lateral grip
      let target = (vF * Math.tan(this.steerSmooth)) / wheelbase;
      const cap = gripNow / Math.max(Math.abs(vF), 3.5);
      target = clamp(target, -cap, cap);
      // handbrake: the rear lets go, so the nose rotates past the grip limit
      if (this.handbrake) target += this.steerInput * Math.min(1.7, P.driftYawGain * (0.3 + Math.abs(vF) / 120));
      const counter = clamp(-slipBefore * this.steerInput * 1.2, -1, 1);
      const gain = P.yawInertia * (1 + counter * 0.45) * (this.handbrake ? 1.6 : 1);
      this.yawRate = damp(this.yawRate, target, gain, dt);
      // self-aligning torque: great angles want to straighten out
      this.yawRate -= slipBefore * 0.9 * dt * Math.sign(vF || 1) * (this.handbrake ? -0.35 : 1);
      // slip ceiling: tires cannot sustain an unbounded slide angle
      const slipLimit = this.handbrake ? 0.80 : 0.45;
      if (slipBefore > slipLimit) this.yawRate *= Math.max(0.15, 1 - (slipBefore - slipLimit) * 2.2);
      this.yawRate = clamp(this.yawRate, -2.6, 2.6);
      if (speed > spec.speed * 0.92) this.yawRate *= 0.95;
    } else {
      const airYaw = this.steerInput * P.airControl * 0.55;
      this.yawRate = damp(this.yawRate, airYaw, 1.4, dt);
    }
    if (this.spinOut > 0) this.yawRate += 7.5 * dt * (this.spinDir || 1);
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

    /* ---- longitudinal impulse (in the chassis frame, before grip) ---- */
    vF = this.vx * s2 + this.vz * c2;
    vR = this.vx * c2 - this.vz * s2;
    if (this.stunned <= 0 || this.spinOut <= 0) {
      // reverse thrust (applied unfiltered so drag can never cancel it)
      if (!this.airborne && this.brake > 0.1 && vF < 0.5 && vF > -18) {
        vF -= (P.reverseAccel ?? 18) * this.brake * dt;
      }
      vF += accel * dt;
    } else {
      vF *= (1 - 1.6 * dt);
      vR *= (1 - 1.9 * dt);
    }
    const limit = top * 1.06;
    if (vF > limit) vF = lerp(vF, limit, clamp01(dt * 6));
    if (vF < -15) vF = -15;
    this.vx = vF * s2 + vR * c2;
    this.vz = vF * c2 - vR * s2;

    /* ---- grip: converge the velocity vector toward the travel direction ----
       The chassis rotates; grip pulls the velocity with it at a rate bounded by
       the friction circle. Anything the tires cannot catch is slip = drift.
       Reversing means the travel direction is the nose reversed. */
    const magStart = Math.hypot(this.vx, this.vz);
    let mag = magStart;
    const travelDir = (this.forwardSpeed < -0.6) ? wrapAngle(this.yaw + Math.PI) : this.yaw;
    if (!this.airborne && mag > 1.5) {
      const velAngle = Math.atan2(this.vx, this.vz);
      const err = wrapAngle(velAngle - travelDir);
      let turnRate = gripNow / Math.max(mag, 4.0);
      if (this.spinOut > 0) turnRate *= 0.35;
      const dv = turnRate * dt;
      const fixed = Math.abs(err) <= dv ? 0 : err - Math.sign(err) * dv;
      // tire scrub: sliding sideways bleeds speed (drift costs a little pace)
      const scrub = Math.min(0.55, Math.abs(err) * (this.handbrake ? 0.16 : 0.22));
      mag *= 1 - scrub * dt;
      const newAngle = travelDir + fixed;
      this.vx = Math.sin(newAngle) * mag;
      this.vz = Math.cos(newAngle) * mag;
      this.gripLost = clamp01(Math.abs(err) / 0.7);
      this.slipAngle = Math.abs(err);
    } else {
      this.gripLost = 0;
      this.slipAngle = 0;
      // stationary / very slow: no tire forces, just friction bleeding the vector
      // (only when nobody is asking for thrust - never fight reverse)
      const wantsThrust = this.brake > 0.1 || this.throttle > 0.3;
      if (!this.airborne && magStart < 1.5 && !wantsThrust) {
        const bl = Math.max(0, 1 - (5.5 * dt));
        this.vx *= bl; this.vz *= bl;
        mag = Math.hypot(this.vx, this.vz);
        if (mag < 0.4) { this.vx = 0; this.vz = 0; mag = 0; }
      }
    }
    // re-read the chassis-frame components for HUD / drift scoring
    vF = this.vx * s2 + this.vz * c2;
    vR = this.vx * c2 - this.vz * s2;
    // idle standstill guard: only when the driver is asking for nothing at all
    if (!this.airborne && this.throttle < 0.08 && this.brake < 0.08 && this.handbrake === false) {
      const s = Math.hypot(this.vx, this.vz);
      if (s < 0.9) {
        this.vx *= 0.45; this.vz *= 0.45;
        if (s < 0.3) { this.vx = 0; this.vz = 0; }
        vF = this.vx * s2 + this.vz * c2;
        vR = this.vx * c2 - this.vz * s2;
        mag = Math.hypot(this.vx, this.vz);
      }
    }
    this.lateralVel = vR;
    this.forwardSpeed = vF;
    this.speed = mag;

    /* ---- integrate position ---- */
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;

    /* ---- gravity / airborne ---- */
    const gY = typeof world.groundHeight === 'function'
      ? world.groundHeight(this.pos.x, this.pos.z)
      : track.nearest(this.pos.x, this.pos.z).y;
    this.groundY = gY;
    if (this.airborne) {
      this.vy -= P.g * dt;
      this.pos.y += this.vy * dt;
      this.airTime += dt;
      this.stats.airTime += dt;
      if (this.pos.y <= gY + 0.02) {
        // landing
        const impact = Math.min(Math.abs(this.vy), 26);
        this.pos.y = gY;
        this.vy = 0;
        this.airborne = false;
        this.airTime = 0;
        this.landImpact = Math.min(Math.abs(this.vy), 26);
        const loss = clamp(impact / 40, 0, 0.22);
        this.vx *= (1 - loss); this.vz *= (1 - loss);
        this.yawRate *= 0.4;
      }
    } else {
      this.pos.y = gY;
      const t3 = track.tangentAt(near.along);
      // follow the road gradient
      this.vy = t3.y * Math.max(0, vF);
    }

    /* ---- drift detection & scoring ---- */
    const slip = Math.abs(wrapAngle(Math.atan2(this.vx, this.vz) - travelDir));
    this.driftAngle = slip;
    const driftingNow = !this.airborne && slip > 0.16 && speed > 8 && this.stunned <= 0;
    if (driftingNow && !this.drifting) {
      this.drifting = true; this.driftTime = 0; this.driftScore = 0;
    }
    if (this.drifting && (slip < 0.085 || speed < 6.5 || this.airborne || this.stunned > 0)) {
      this.drifting = false;
      if (this.driftScore > 60 && this.combo > 1) this.comboTimer = CFG.drift.chainWindow;
    }
    if (this.drifting) {
      this.driftTime += dt;
      const rate = (CFG.drift.baseRate + slip * CFG.drift.angleScore * 8 + speed * CFG.drift.speedScore)
        * S.score * this.combo;
      this.driftScore += rate * dt;
      // combo steps
      const maxC = world.maxCombo || CFG.drift.maxCombo;
      const steps = Math.floor(this.driftTime / CFG.drift.comboStep);
      const newCombo = clamp(1 + steps, 1, maxC);
      if (newCombo > this.combo) {
        this.combo = newCombo;
        world.onComboStep?.(this, newCombo);
      }
      // nitro reward
      this.addNitro(CFG.boost.driftGain * (world.driftNitroMul || 1) * (0.6 + slip) * dt);
    } else if (this.driftScore > 0 && this.comboTimer <= 0) {
      this.combo = 1;
    }
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 1; }
    }
    this.forwardSpeed = vF;
    this.stats.topSpeed = Math.max(this.stats.topSpeed, speed);
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);

    /* ---- engine / gearbox ---- */
    this._drivetrain(dt, vF, throttle);

    /* ---- body visual dynamics ---- */
    this.visYaw = this.yaw;
    const targetRoll = clamp(-vR * 0.028 - this.steerInput * 0.02, -0.14, 0.14);
    const targetPitch = clamp(-accel * 0.0016, -0.09, 0.09);
    this.bodyRoll = damp(this.bodyRoll, targetRoll, 9, dt);
    this.bodyPitch = damp(this.bodyPitch, targetPitch, 8, dt);
    this.wheelRot += (vF / 0.36) * dt;
    this.wheelSteer = damp(this.wheelSteer, this.steerSmooth * 1.15, 14, dt);

    /* ---- spin-out recovery ---- */
    if (this.spinOut > 0 && this.spinOut <= dt) {
      this.invuln = 1.2;
      this.vx *= 0.30; this.vz *= 0.30;
    }

    /* ---- smooth wall collision trigger ---- */
    return this;
  }

  _drivetrain(dt, vF, throttle) {
    const spec = this.spec;
    const absV = Math.abs(vF);
    const top = spec.speed;
    // fake gearbox: 6 ratios
    const ratios = [0.16, 0.28, 0.42, 0.58, 0.78, 1.0];
    const norm = clamp(absV / top, 0, 1.3);
    let g = 1;
    for (let i = 0; i < ratios.length; i++) if (norm >= ratios[i] * 0.72) g = i + 1;
    if (vF < -0.5) g = -1;
    if (absV < 0.4) g = 1;
    const gearLow = ratios[g - 1] || 0;
    const gearHigh = ratios[g] || 1;
    const within = clamp01((norm - gearLow * 0.72) / ((gearHigh - gearLow) * 0.92 || 1));
    const targetRpm = 900 + within * 6200 + (this.boosting ? 500 : 0);
    const rpmLag = (this.rpm > targetRpm && throttle < 0.1) ? 5 : 9;
    this.rpm = damp(this.rpm, targetRpm, rpmLag, dt);
    this.gear = g;
    this.engineLoad = damp(this.engineLoad, throttle, 8, dt);
  }

  /** simple collision response against a wall normal (nx,nz) */
  collideWall(nx, nz, world) {
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) {
      const rest = 0.32;
      this.vx -= (1 + rest) * vn * nx;
      this.vz -= (1 + rest) * vn * nz;
      const impact = -vn;
      if (impact > 1.2) {
        const tangentX = -nz, tangentZ = nx;
        const vt = this.vx * tangentX + this.vz * tangentZ;
        this.vx -= vt * 0.30 * tangentX;
        this.vz -= vt * 0.30 * tangentZ;
        this.yawRate += (Math.random() - 0.5) * clamp(impact * 0.06, 0, 0.7);
        this.wallHits++;
        this.cleanLap = false;
        this.hit(impact * 2.2, null);
        this.stats.hits++;
        this.damage = clamp(this.damage + impact * 1.9, 0, 100);
        this.engineHealth = clamp(1 - Math.pow(this.damage / 100, 1.4) * 0.45, 0.55, 1);
        this.speedPenalty = impact;
        world.onWallHit?.(this, impact, nx, nz);
      }
    }
  }

  /** recover onto the racing line after a bad spin */
  recover(track, along) {
    const d = along ?? this.trackDist;
    const n = track.normalAt(d);
    const near = track.nearest(this.pos.x, this.pos.z);
    let off = clamp(near.off, -CFG.track.halfWidth * 0.6, CFG.track.halfWidth * 0.6);
    const p = track.pointAt(d, off);
    this.pos.x = p.x; this.pos.z = p.z; this.pos.y = p.y;
    const t = track.tangentAt(d);
    this.yaw = Math.atan2(t.x, t.z);
    this.vx = t.x * 8; this.vz = t.z * 8;
    this.yawRate = 0;
    this.spinOut = 0; this.stunned = 0;
    this.drifting = false; this.combo = 1; this.driftScore = 0;
  }
}
