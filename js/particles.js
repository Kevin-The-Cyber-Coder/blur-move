/* ============================================================
   PARTICLES — GPU point cloud, pooled, two blend modes.
   ============================================================ */
import * as THREE from 'three';
import { particleAtlas } from './textures.js';

const VERT = /* glsl */`
attribute float aSize;
attribute float aLife;
attribute float aMaxLife;
attribute vec3 aColor;
attribute float aRegion;
attribute float aSpin;
uniform float uPxScale;
varying vec3 vColor;
varying float vLife;
varying float vRegion;
varying float vSpin;
void main(){
  vColor = aColor;
  vLife = clamp(aLife / max(aMaxLife, 0.001), 0.0, 1.0);
  vRegion = aRegion;
  vSpin = aSpin;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // scale: perspective-correct size, growing as the particle ages
  float grow = 1.0 + (1.0 - vLife) * 1.4;
  gl_PointSize = aSize * uPxScale * grow / max(-mv.z, 0.6);
  if (aLife <= 0.0) gl_PointSize = 0.0;
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uOpacity;
varying vec3 vColor;
varying float vLife;
varying float vRegion;
varying float vSpin;
void main(){
  vec2 uv = gl_PointCoord;
  // atlas is 2x2 regions
  vec2 off = vec2(mod(vRegion, 2.0), floor(vRegion / 2.0)) * 0.5;
  // rotate the sprite
  vec2 c = uv - 0.5;
  float s = sin(vSpin), co = cos(vSpin);
  uv = vec2(c.x * co - c.y * s, c.x * s + c.y * co) + 0.5;
  vec4 tex = texture2D(uMap, off + clamp(uv, 0.001, 0.999) * 0.5);
  float fade = smoothstep(0.0, 0.18, vLife) * (0.35 + 0.65 * vLife);
  gl_FragColor = vec4(vColor * uTint, tex.a * uOpacity * fade);
}`;

class PointField {
  constructor(max, texture, blending, opacity = 1) {
    this.max = max;
    this.count = 0;
    this.positions = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.lives = new Float32Array(max);
    this.maxLives = new Float32Array(max);
    this.colors = new Float32Array(max * 3);
    this.regions = new Float32Array(max);
    this.spins = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.floor = new Float32Array(max);
    this.baseSize = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.lives, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aMaxLife', new THREE.BufferAttribute(this.maxLives, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRegion', new THREE.BufferAttribute(this.regions, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSpin', new THREE.BufferAttribute(this.spins, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uPxScale: { value: 320 },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: opacity },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending, vertexColors: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 12 : 10;
    this.geo = g;
  }

  spawn(x, y, z, vx, vy, vz, size, life, color, region, grav = 0, drag = 0.6, floor = -1e9) {
    if (this.count >= this.max) return -1;
    const i = this.count++;
    this.positions[i * 3] = x; this.positions[i * 3 + 1] = y; this.positions[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.sizes[i] = size; this.baseSize[i] = size;
    this.lives[i] = life; this.maxLives[i] = life;
    this.colors[i * 3] = color.r; this.colors[i * 3 + 1] = color.g; this.colors[i * 3 + 2] = color.b;
    this.regions[i] = region; this.spins[i] = Math.random() * Math.PI * 2;
    this.grav[i] = grav; this.drag[i] = drag; this.floor[i] = floor;
    this.grow[i] = 0;
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.lives[i] -= dt;
      if (this.lives[i] <= 0) {
        // swap-remove
        const last = n - 1;
        if (i !== last) {
          this.positions[i * 3] = this.positions[last * 3];
          this.positions[i * 3 + 1] = this.positions[last * 3 + 1];
          this.positions[i * 3 + 2] = this.positions[last * 3 + 2];
          this.vel[i * 3] = this.vel[last * 3]; this.vel[i * 3 + 1] = this.vel[last * 3 + 1]; this.vel[i * 3 + 2] = this.vel[last * 3 + 2];
          this.sizes[i] = this.sizes[last]; this.baseSize[i] = this.baseSize[last];
          this.lives[i] = this.lives[last]; this.maxLives[i] = this.maxLives[last];
          this.colors[i * 3] = this.colors[last * 3]; this.colors[i * 3 + 1] = this.colors[last * 3 + 1]; this.colors[i * 3 + 2] = this.colors[last * 3 + 2];
          this.regions[i] = this.regions[last]; this.spins[i] = this.spins[last];
          this.grav[i] = this.grav[last]; this.drag[i] = this.drag[last]; this.floor[i] = this.floor[last];
        }
        n--; i--; continue;
      }
      const i3 = i * 3;
      this.vel[i3 + 1] -= this.grav[i] * dt;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 1] *= dr; this.vel[i3 + 2] *= dr;
      this.positions[i3] += this.vel[i3] * dt;
      this.positions[i3 + 1] += this.vel[i3 + 1] * dt;
      this.positions[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.positions[i3 + 1] < this.floor[i]) {
        this.positions[i3 + 1] = this.floor[i];
        this.vel[i3 + 1] *= -0.35;
        this.vel[i3] *= 0.7; this.vel[i3 + 2] *= 0.7;
      }
      this.spins[i] += dt * 2.2;
    }
    this.count = n;
    const g = this.geo;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aLife.needsUpdate = true;
    g.attributes.aMaxLife.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aRegion.needsUpdate = true;
    g.attributes.aSpin.needsUpdate = true;
    // only upload the used slice for speed
    for (const k of ['position', 'aSize', 'aLife', 'aMaxLife', 'aColor', 'aRegion', 'aSpin']) {
      const a = g.attributes[k];
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, n) * a.itemSize);
    }
  }
}

export class ParticleSystem {
  constructor(scene, max = 5200) {
    const tex = new THREE.CanvasTexture(particleAtlas());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.glow = new PointField(Math.floor(max * 0.55), tex, THREE.AdditiveBlending, 1.0);
    this.smoke = new PointField(Math.floor(max * 0.45), tex, THREE.NormalBlending, 0.85);
    scene.add(this.glow.points, this.smoke.points);
    this._c = new THREE.Color();
    this.scene = scene;
  }
  setPixelScale(v) { this.glow.mat.uniforms.uPxScale.value = v; this.smoke.mat.uniforms.uPxScale.value = v; }

  update(dt) { this.glow.update(dt); this.smoke.update(dt); }

  /* ---- presets ---- */
  spark(x, y, z, n = 8, spread = 9, color = 0xffc04d) {
    const c = this._c.setHex(color);
    for (let i = 0; i < n; i++) {
      this.glow.spawn(x, y, z,
        (Math.random() - 0.5) * spread, Math.random() * spread * 0.8 + 1, (Math.random() - 0.5) * spread,
        0.55 + Math.random() * 0.5, 0.28 + Math.random() * 0.42, c, 1, 22, 1.2, y - 0.2);
    }
  }
  tireSmoke(x, y, z, vx, vz, strength = 1, wet = false) {
    const c = this._c.setHex(wet ? 0xdff0ff : 0xd9e4f0);
    const n = strength > 0.6 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      this.smoke.spawn(x + (Math.random() - 0.5) * 0.5, y + 0.2, z + (Math.random() - 0.5) * 0.5,
        vx * 0.18 + (Math.random() - 0.5) * 1.6, 0.9 + Math.random() * 1.2, vz * 0.18 + (Math.random() - 0.5) * 1.6,
        (1.1 + Math.random() * 1.4) * (0.7 + strength * 0.5), 0.75 + Math.random() * 0.8, c, 0, -1.1, 1.6, y - 0.1);
    }
  }
  dust(x, y, z, vx, vz, color = 0xc9a06a) {
    const c = this._c.setHex(color);
    for (let i = 0; i < 2; i++) {
      this.smoke.spawn(x, y + 0.2, z, vx * 0.1 + (Math.random() - 0.5) * 2, 1.2 + Math.random(), vz * 0.1 + (Math.random() - 0.5) * 2,
        1.4 + Math.random(), 0.9 + Math.random(), c, 0, -0.8, 1.4, y);
    }
  }
  splash(x, y, z, vx, vz) {
    const c = this._c.setHex(0xcfeaff);
    for (let i = 0; i < 3; i++) {
      this.glow.spawn(x, y + 0.1, z, (Math.random() - 0.5) * 4, 2.2 + Math.random() * 2.4, (Math.random() - 0.5) * 4,
        0.4, 0.35 + Math.random() * 0.2, c, 2, 20, 0.4, y - 0.1);
    }
  }
  boostFlame(x, y, z, vx, vy, vz, color = 0x22e6ff) {
    const c = this._c.setHex(color);
    this.glow.spawn(x, y, z, vx, vy, vz, 0.9 + Math.random() * 0.7, 0.14 + Math.random() * 0.16, c, 2, 0, 2.2);
  }
  explosion(x, y, z, scale = 1) {
    const c1 = this._c.setHex(0xffb347);
    for (let i = 0; i < 26 * scale; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 9 * scale;
      this.glow.spawn(x, y, z, Math.cos(a) * r, Math.random() * 8 * scale, Math.sin(a) * r,
        1.4 + Math.random() * 2.2, 0.4 + Math.random() * 0.6, c1, 1, 12, 1.4);
    }
    const c2 = this._c.setHex(0x553344);
    for (let i = 0; i < 14 * scale; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 3 * scale;
      this.smoke.spawn(x, y + Math.random() * 2, z, Math.cos(a) * r, 1 + Math.random() * 3, Math.sin(a) * r,
        2.4 + Math.random() * 2.4, 1.2 + Math.random(), c2, 0, -1.2, 1.1);
    }
  }
  shockRing(x, y, z, color = 0xff2bd6) {
    const c = this._c.setHex(color);
    for (let i = 0; i < 3; i++) {
      this.glow.spawn(x, y + 1, z, 0, 0.2, 0, 6 + i * 3, 0.42, c, 3, 0, 3.4);
    }
  }
  pickupBurst(x, y, z, color = 0x22e6ff) {
    const c = this._c.setHex(color);
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 5;
      this.glow.spawn(x, y, z, Math.cos(a) * r, 3 + Math.random() * 4, Math.sin(a) * r,
        0.8 + Math.random() * 0.8, 0.5 + Math.random() * 0.4, c, 2, 6, 1.6);
    }
  }
  lightningFlash() { /* visual handled by post/sky */ }

  clear() {
    this.glow.count = 0; this.smoke.count = 0;
    this.glow.geo.setDrawRange(0, 0); this.smoke.geo.setDrawRange(0, 0);
  }
}
