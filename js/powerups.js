/* ============================================================
   POWER-UPS — Blur-style pickups: nitro, shock, shunt, shield,
   bolt, repair. Projectiles, homing, damage + visual FX.
   ============================================================ */
import * as THREE from 'three';
import { CFG, POWERS, POWER_KEYS, PICKUP_WEIGHTS } from './config.js';
import { clamp, clamp01, pick, rand, wrapAngle, chance, lerp } from './util.js';
import { radialGlow } from './textures.js';

const WEIGHTED = [];
for (const k of POWER_KEYS) for (let i = 0; i < (PICKUP_WEIGHTS[k] || 1); i++) WEIGHTED.push(k);

export function rollPower(rng = Math.random) {
  return WEIGHTED[Math.floor(rng() * WEIGHTED.length)];
}

export class Powerups {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.orbs = [];
    this.projectiles = [];
    this.pickupTimer = 0;
    this._buildOrbs();
  }

  _buildOrbs() {
    const track = this.world.track;
    const geo = new THREE.IcosahedronGeometry(0.85, 1);
    const glowTex = new THREE.CanvasTexture(radialGlow(128, 'rgba(255,255,255,0.9)'));
    this.orbGlowTex = glowTex;
    for (const pad of track.pickups) {
      const color = new THREE.Color(pick(0x22e6ff, 0xff2bd6, 0xc6ff2b, 0xffe36b));
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 2.2, metalness: 0.7, roughness: 0.2,
        transparent: true, opacity: 0.95,
      });
      const mesh = new THREE.Mesh(geo, mat);
      // wireframe shell
      const shell = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color, wireframe: true, transparent: true, opacity: 0.5, toneMapped: false,
      }));
      shell.scale.setScalar(1.5);
      mesh.add(shell);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color, transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      halo.scale.setScalar(5.4);
      mesh.add(halo);
      mesh.position.set(pad.x, pad.y + 1.9, pad.z);
      this.world.scene.add(mesh);
      this.orbs.push({
        pad, mesh, shell, halo, active: true, respawn: 0, phase: rand(0, 6.28),
        color: color.getHex(), baseY: pad.y + 1.9,
      });
      pad.mesh = mesh;
    }
  }

  clear() {
    for (const o of this.orbs) { if (o.mesh.parent) o.mesh.parent.remove(o.mesh); }
    for (const p of this.projectiles) { if (p.mesh.parent) p.mesh.parent.remove(p.mesh); }
    this.orbs = []; this.projectiles = [];
  }

  /* ---------------- per-frame ---------------- */
  update(dt, vehicles, player) {
    const t = performance.now() * 0.001;

    /* ----- orbs ----- */
    for (const o of this.orbs) {
      if (!o.active) {
        o.respawn -= dt;
        if (o.respawn <= 0) {
          o.active = true;
          o.mesh.visible = true;
          this.world.particles.pickupBurst(o.mesh.position.x, o.mesh.position.y, o.mesh.position.z, o.color);
        }
        continue;
      }
      o.phase += dt;
      o.mesh.rotation.y += dt * 1.6;
      o.mesh.rotation.x = Math.sin(o.phase * 0.7) * 0.35;
      o.mesh.position.y = o.baseY + Math.sin(o.phase * 1.9) * 0.22;
      o.halo.material.opacity = 0.55 + Math.sin(o.phase * 3) * 0.2;

      // collection: any vehicle passing within range
      for (const v of vehicles) {
        const dx = v.pos.x - o.mesh.position.x;
        const dz = v.pos.z - o.mesh.position.z;
        const dy = Math.abs(v.pos.y - o.pad.y);
        if (dx * dx + dz * dz < 12.25 && dy < 4.5) {
          if (v.power) continue; // already carrying
          const p = rollPower();
          v.power = p;
          v.powerCount = 1;
          o.active = false;
          o.respawn = 8.5;
          o.mesh.visible = false;
          this.world.particles.pickupBurst(o.mesh.position.x, o.mesh.position.y, o.mesh.position.z, o.color);
          if (v.isPlayer) this.game.onPowerPickup(p);
          break;
        }
      }
    }

    /* ----- projectiles ----- */
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      let dead = pr.life <= 0;

      if (pr.type === 'shock' || pr.type === 'bolt') {
        // homing toward the nearest vehicle ahead of the owner
        if (pr.type === 'shock' && !pr.target) this._acquire(pr, vehicles);
        if (pr.target && !pr.target.finished) {
          const dx = pr.target.pos.x - pr.mesh.position.x;
          const dz = pr.target.pos.z - pr.mesh.position.z;
          const dy = (pr.target.pos.y + 0.8) - pr.mesh.position.y;
          const desired = Math.atan2(dx, dz);
          pr.dir = wrapAngle(pr.dir + wrapAngle(desired - pr.dir) * clamp01(dt * 4.4));
          pr.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        }
        const sp = pr.speed;
        pr.mesh.position.x += Math.sin(pr.dir) * Math.cos(pr.pitch) * sp * dt;
        pr.mesh.position.z += Math.cos(pr.dir) * Math.cos(pr.pitch) * sp * dt;
        pr.mesh.position.y += Math.sin(pr.pitch) * sp * dt;
        pr.mesh.rotation.y = pr.dir;
        // trail
        if (Math.random() < dt * 60) {
          this.world.particles.boostFlame(pr.mesh.position.x, pr.mesh.position.y, pr.mesh.position.z,
            rand(-1, 1), rand(-1, 1), rand(-1, 1), pr.color);
        }
        // hit check
        for (const v of vehicles) {
          if (v === pr.owner || v.finished) continue;
          const d2 = (v.pos.x - pr.mesh.position.x) ** 2 + (v.pos.z - pr.mesh.position.z) ** 2;
          if (d2 < 9.5) {
            this._hit(pr, v);
            dead = true;
            break;
          }
        }
      } else if (pr.type === 'shunt') {
        pr.life -= dt;
        const sp = pr.speed;
        pr.mesh.position.x += Math.sin(pr.dir) * sp * dt;
        pr.mesh.position.z += Math.cos(pr.dir) * sp * dt;
        for (const v of vehicles) {
          if (v === pr.owner) continue;
          const d2 = (v.pos.x - pr.mesh.position.x) ** 2 + (v.pos.z - pr.mesh.position.z) ** 2;
          if (d2 < 22) { this._hit(pr, v); dead = true; break; }
        }
        if (pr.life <= 0) {
          this.world.particles.explosion(pr.mesh.position.x, pr.mesh.position.y, pr.mesh.position.z, 0.7);
          dead = true;
        }
      } else if (pr.type === 'beam') {
        // instant visual beam, no travel
        dead = true;
      }

      if (dead) {
        if (pr.mesh.parent) pr.mesh.parent.remove(pr.mesh);
        this.projectiles.splice(i, 1);
        if (pr.timer) pr.timer();
      }
    }
    this._hitFlash = Math.max(0, (this._hitFlash || 0) - dt * 2);
  }

  _acquire(pr, vehicles) {
    const owner = pr.owner;
    let best = null, bestGap = 1e9;
    for (const v of vehicles) {
      if (v === owner || v.finished) continue;
      const gap = this.world.track.spline.delta(owner.trackDist, v.trackDist);
      if (gap > 0 && gap < 140) {
        const d = Math.hypot(v.pos.x - pr.mesh.position.x, v.pos.z - pr.mesh.position.z);
        if (gap < bestGap) { bestGap = gap; best = v; }
      }
    }
    pr.target = best;
  }

  /* ---------------- firing ---------------- */
  fire(vehicle, type) {
    const v = vehicle;
    const spec = POWERS[type];
    if (!spec) return false;
    const world = this.world;
    const pos = v.pos;
    const fwdX = Math.sin(v.yaw), fwdZ = Math.cos(v.yaw);
    const color = new THREE.Color(parseInt(spec.color.slice(1), 16));

    switch (type) {
      case 'nitro': {
        v.addNitro(70);
        v.boostPadCooldown = 0;
        v.boosting = true;
        v.boostTime = 0;
        this._flash(v, 0x22e6ff);
        world.particles.shockRing(pos.x, pos.y + 1, pos.z, 0x22e6ff);
        break;
      }
      case 'shield': {
        v.shield = spec.dur + (this.game.skillBonus('shd1') ? 3 : 0);
        this._flash(v, 0xc6ff2b);
        world.particles.shockRing(pos.x, pos.y + 1, pos.z, 0xc6ff2b);
        break;
      }
      case 'repair': {
        v.damage = Math.max(0, v.damage - (45 * (this.game.skillBonus('rep1') ? 1.4 : 1)));
        v.engineHealth = clamp(1 - Math.pow(v.damage / 100, 1.4) * 0.45, 0.55, 1);
        this._flash(v, 0x7dffb0);
        world.particles.pickupBurst(pos.x, pos.y + 1, pos.z, 0x7dffb0);
        break;
      }
      case 'shock': {
        this._spawnProjectile(v, 'shock', 0x22e6ff, 0.5, 62, 4.2, 42);
        break;
      }
      case 'shunt': {
        // short range shove: find target ahead
        let target = null, best = 1e9;
        for (const o of this.game.vehicles) {
          if (o === v) continue;
          const gap = world.track.spline.delta(v.trackDist, o.trackDist);
          if (gap > 0 && gap < 60 && gap < best) { best = gap; target = o; }
        }
        this._spawnProjectile(v, 'shunt', 0xff8a1f, 0.42, 70, 3.2, 1);
        if (target) {
          const bias = Math.atan2(target.pos.x - pos.x, target.pos.z - pos.z);
          this.projectiles[this.projectiles.length - 1].dir = bias;
        }
        break;
      }
      case 'bolt': {
        for (let i = 0; i < 3; i++) {
          this._spawnProjectile(v, 'bolt', 0xffe36b, 0.24, 96, 1.4, 0, i);
        }
        break;
      }
    }
    v.usedPowerTimer = 0.4;
    v.power = null;
    v.powerCount = 0;
    if (v.stats) v.powerUses = (v.powerUses || 0) + 1;
    this.game.audio?.fire(type);
    return true;
  }

  _spawnProjectile(owner, type, colorHex, radius, speed, life, homing, index = 0) {
    const geo = new THREE.SphereGeometry(radius, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.orbGlowTex, color: colorHex, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(radius * 12);
    mesh.add(glow);
    const p = owner.pos;
    const fwdX = Math.sin(owner.yaw), fwdZ = Math.cos(owner.yaw);
    const rightX = Math.cos(owner.yaw), rightZ = -Math.sin(owner.yaw);
    mesh.position.set(
      p.x + fwdX * 2.6 + rightX * (index - 1) * 0.8,
      p.y + 0.75,
      p.z + fwdZ * 2.6 + rightZ * (index - 1) * 0.8,
    );
    this.world.scene.add(mesh);
    this.projectiles.push({
      type, owner, mesh, dir: owner.yaw, pitch: 0, speed, life, color: colorHex,
      target: null, homing: !!homing,
    });
  }

  _hit(pr, victim) {
    const v = victim;
    const world = this.world;
    const dmg = pr.type === 'bolt' ? 7 : pr.type === 'shock' ? 26 : 34;
    // shield blocks and reflects
    if (v.shield > 0) {
      v.shield = 0;
      world.particles.shockRing(v.pos.x, v.pos.y + 1, v.pos.z, 0xc6ff2b);
      this.game.audio?.shieldHit();
      this.game.onHit(v, pr.owner, 'blocked');
      // reflect damage to owner if the game allows
      if (pr.owner && pr.owner !== v) {
        pr.owner.stunned = 0.9;
        pr.owner.spinOut = 1.2;
        pr.owner.spinDir = chance(0.5) ? 1 : -1;
        pr.owner.hit(dmg * 0.5, v);
        world.particles.explosion(pr.owner.pos.x, pr.owner.pos.y + 1, pr.owner.pos.z, 0.6);
        this.game.audio?.explode();
      }
      return;
    }
    const applied = v.hit(dmg, pr.owner);
    if (applied) {
      v.stunned = pr.type === 'shunt' ? 1.4 : 1.0;
      v.spinOut = pr.type === 'shunt' ? 1.6 : 1.1;
      v.spinDir = chance(0.5) ? 1 : -1;
      // knockback
      const dx = v.pos.x - pr.mesh.position.x, dz = v.pos.z - pr.mesh.position.z;
      const dl = Math.hypot(dx, dz) || 1;
      const force = pr.type === 'shunt' ? 26 : 12;
      v.impulse(dx / dl * force, dz / dl * force, (chance(0.5) ? 1 : -1) * 1.6);
      v.vx *= 0.72; v.vz *= 0.72;
      world.particles.explosion(v.pos.x, v.pos.y + 1.0, v.pos.z, pr.type === 'shunt' ? 1.3 : 0.8);
      world.particles.shockRing(v.pos.x, v.pos.y + 1, v.pos.z, pr.color);
      this.game.audio?.impact(1.2, 'metal');
      this.game.audio?.explode();
      this.game.onHit(v, pr.owner, pr.type);
    }
  }

  _flash(v, color) {
    if (v.isPlayer) this.game.flash(color, 0.28);
  }
}
