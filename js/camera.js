/* ============================================================
   CAMERA — chase / far / hood / cinematic / orbit, with FOV
   kick, impact shake and drift lean.
   ============================================================ */
import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp, clamp01, damp, lerp, lerpAngle, rand } from './util.js';

const MODES = ['chase', 'far', 'hood', 'bumper'];

export class CameraController {
  constructor(world) {
    this.world = world;
    this.camera = world.camera;
    this.mode = 'chase';
    this.modeIndex = 0;
    this.fov = CFG.camera.fovBase;
    this.shake = 0;
    this.shakeT = 0;
    this.orbitAngle = 0;
    this.cinematic = null;
    this.lookback = false;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.smoothPos = new THREE.Vector3();
    this.smoothLook = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.roll = 0;
    this.fovKick = 0;
    this._initialised = false;
  }

  setMode(m) {
    this.mode = m;
    this.modeIndex = MODES.indexOf(m);
    if (this.modeIndex < 0) this.modeIndex = 0;
    this._initialised = false;
  }
  cycleMode() {
    this.modeIndex = (this.modeIndex + 1) % MODES.length;
    this.mode = MODES[this.modeIndex];
    this._initialised = false;
    return this.mode;
  }
  setLookback(v) { this.lookback = v; }

  addShake(amount) {
    this.shake = Math.min(1.6, this.shake + amount);
    this.shakeT = 0;
  }

  /* cinematic flyby: t in 0..1 */
  startCinematic(vehicle, duration = 3.2) {
    this.cinematic = { v: vehicle, t: 0, duration };
  }
  stopCinematic() { this.cinematic = null; }

  orbit(v, dt) {
    this.orbitAngle += dt * 0.32;
    const r = 9.5, h = 3.4;
    const p = v.pos;
    const x = p.x + Math.cos(this.orbitAngle) * r;
    const z = p.z + Math.sin(this.orbitAngle) * r;
    this.camera.position.set(x, p.y + h, z);
    this.camera.lookAt(p.x, p.y + 0.9, p.z);
    this.camera.fov = damp(this.camera.fov, 46, 4, dt);
    this.camera.updateProjectionMatrix();
    this.target.set(p.x, p.y, p.z);
  }

  update(dt, v, opts = {}) {
    if (!v) return;
    const cam = this.camera;
    const p = v.pos;
    this.target.set(p.x, p.y, p.z);

    if (this.cinematic) {
      const c = this.cinematic;
      c.t += dt;
      const k = clamp01(c.t / c.duration);
      const n = c.v || v;
      const ang = -0.9 + k * 2.6;
      const rad = lerp(16, 6.5, k);
      const hgt = lerp(7.5, 2.6, k);
      const tx = n.pos.x + Math.sin(n.yaw + Math.PI + ang) * rad;
      const tz = n.pos.z + Math.cos(n.yaw + Math.PI + ang) * rad;
      this.smoothPos.set(tx, n.pos.y + hgt, tz);
      this.smoothLook.set(n.pos.x, n.pos.y + 0.9, n.pos.z);
      cam.position.copy(this.smoothPos);
      cam.lookAt(this.smoothLook);
      cam.fov = lerp(38, CFG.camera.fovBase, k * k);
      cam.updateProjectionMatrix();
      this._initialised = false;
      return;
    }

    /* ---- mode offsets ---- */
    let dist = CFG.camera.chaseDist, height = CFG.camera.chaseHeight, lookH = 1.1, lag = CFG.camera.lag;
    if (this.mode === 'far') { dist = 11.5; height = 5.4; lookH = 1.6; lag = 4.0; }
    else if (this.mode === 'hood') { dist = 0.15; height = 0.92; lookH = 0.85; lag = 26; }
    else if (this.mode === 'bumper') { dist = -1.4; height = 0.62; lookH = 0.62; lag = 30; }

    // pull camera back with speed
    const speed01 = clamp01(v.speed / (v.spec.speed * 1.15));
    dist += speed01 * 1.8 + (v.boosting ? 1.2 : 0);

    // drift / steer lean: aim slightly into the drift
    const driftLean = clamp(v.lateralVel * 0.075, -1.4, 1.4);
    const yaw = v.visYaw + (this.lookback ? Math.PI : 0);
    const back = this.lookback ? 1 : -1;
    const tx = p.x + Math.sin(yaw) * dist * back - Math.cos(yaw) * driftLean * 0.5;
    const tz = p.z + Math.cos(yaw) * dist * back + Math.sin(yaw) * driftLean * 0.5;
    // keep the camera above the road
    const roadY = this.world.groundHeight(p.x, p.z);
    const ty = Math.max(p.y, roadY) + height + (v.airborne ? clamp(v.pos.y - v.groundY, 0, 3) * 0.7 : 0);

    // look point: ahead of the car along its velocity/heading
    const aheadDist = (this.mode === 'hood' || this.mode === 'bumper') ? 12 : CFG.camera.lookAhead + speed01 * 5;
    const lx = p.x + Math.sin(v.visYaw) * aheadDist * (this.lookback ? -1 : 1);
    const lz = p.z + Math.cos(v.visYaw) * aheadDist * (this.lookback ? -1 : 1);

    if (!this._initialised) {
      this.smoothPos.set(tx, ty, tz);
      this.smoothLook.set(lx, p.y + lookH, lz);
      this._initialised = true;
    } else {
      const k = 1 - Math.exp(-lag * dt);
      this.smoothPos.x += (tx - this.smoothPos.x) * k;
      this.smoothPos.y += (ty - this.smoothPos.y) * (1 - Math.exp(-(lag * 1.2) * dt));
      this.smoothPos.z += (tz - this.smoothPos.z) * k;
      const lk = 1 - Math.exp(-(lag * 1.5) * dt);
      this.smoothLook.x += (lx - this.smoothLook.x) * lk;
      this.smoothLook.y += (p.y + lookH - this.smoothLook.y) * lk;
      this.smoothLook.z += (lz - this.smoothLook.z) * lk;
    }

    /* ---- shake ---- */
    if (this.shake > 0.001) {
      this.shakeT += dt;
      const s = this.shake * this.shake;
      const t = this.shakeT * 46;
      cam.position.set(
        this.smoothPos.x + Math.sin(t * 1.7) * s * 0.42 + rand(-1, 1) * s * 0.12,
        this.smoothPos.y + Math.sin(t * 2.3) * s * 0.34 + rand(-1, 1) * s * 0.1,
        this.smoothPos.z + Math.cos(t * 1.9) * s * 0.42 + rand(-1, 1) * s * 0.12,
      );
      this.shake = Math.max(0, this.shake - dt * CFG.camera.shakeDecay);
    } else {
      cam.position.copy(this.smoothPos);
    }

    cam.lookAt(this.smoothLook.x, this.smoothLook.y, this.smoothLook.z);

    /* ---- roll (drift lean) ---- */
    const targetRoll = -clamp(v.lateralVel * 0.006 + v.bodyRoll * 0.4, -0.09, 0.09);
    this.roll = damp(this.roll, targetRoll, 6, dt);
    cam.rotation.z += this.roll;

    /* ---- FOV ---- */
    let targetFov = CFG.camera.fovBase + speed01 * (CFG.camera.fovMax - CFG.camera.fovBase);
    if (v.boosting) targetFov += CFG.camera.fovBoost;
    if (this.mode === 'hood' || this.mode === 'bumper') targetFov += 4;
    this.fov = damp(this.fov, targetFov, 3.4, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();

    /* ---- far plane / fog tuning from speed ---- */
    cam.far = 2200;
  }
}
