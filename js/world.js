/* ============================================================
   WORLD — renderer, scene, lighting, sky, weather, skids,
   and the draw loop. Owns all three.js resources.
   ============================================================ */
import * as THREE from 'three';
import { CFG, THEMES, TIMES, WEATHER } from './config.js';
import { TrackBuild } from './track.js';
import { CarMesh } from './cars.js';
import { ParticleSystem } from './particles.js';
import { PostFX } from './post.js';
import { skyGradient, radialGlow, rainStreak, envMapCanvas } from './textures.js';
import { clamp, clamp01, cssHex, lerp, damp, rand, randInt, TAU, mixHex, rng } from './util.js';

export class World {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: opts.antialias !== false, powerPreference: 'high-performance',
      alpha: false, stencil: false, depth: true,
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    });
    this.renderer.setPixelRatio(this.pixelRatioFor());
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // keep cumulative stats for the whole frame (incl. post passes)
    this.renderer.info.autoReset = false;

    this.camera = new THREE.PerspectiveCamera(CFG.camera.fovBase, 1, 0.25, 2200);
    this.camera.position.set(0, 6, -12);
    this.scene.add(this.camera);

    this.time = 0;
    this.paused = false;
    this.quality = 'high';
    this.adaptive = true;
    this.dprScale = 1;

    this._buildLighting();
    this._buildSky();
    this._buildEnv();
    this._buildWeather();
    this._buildSkids();

    this.particles = new ParticleSystem(this.scene, 5600);
    this.track = null;
    this.trackDef = null;
    this.carMeshes = new Map();
    this.clock = 0;

    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    // post chain is created after first resize to get the right size
    const sz = this.renderer.getSize(new THREE.Vector2());
    this.post = new PostFX(this.renderer, this.scene, this.camera, sz.x, sz.y);
    this.post.setQuality(this.quality);

    this.stats = { fps: 0, frame: 0 };
    this._fpsAcc = 0; this._fpsN = 0;
    this.qualityHistory = [];
    this.crowdPhase = 0;
  }

  pixelRatioFor() {
    const dpr = Math.min(window.devicePixelRatio || 1, CFG.render.maxPixelRatio);
    return dpr;
  }

  /* ---------------------------------------------------------- */
  _buildLighting() {
    this.ambient = new THREE.AmbientLight(0x8899cc, 0.5);
    this.scene.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(0x2a3a6a, 0x0a0c14, 0.6);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.sun.castShadow = true;
    const s = CFG.render.shadowMap;
    this.sun.shadow.mapSize.set(s, s);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun);
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    // rim light for the neon look
    this.rim = new THREE.DirectionalLight(0xff2bd6, 0.35);
    this.rim.position.set(-1, 0.6, -1);
    this.scene.add(this.rim);

    this.scene.fog = new THREE.FogExp2(0x0b1024, 0.0016);
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(1600, 24, 16);
    const tex = new THREE.CanvasTexture(skyGradient('#04060f', '#0b1430', '#1a1030'));
    tex.colorSpace = THREE.SRGBColorSpace;
    this.skyMat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    // stars for night themes
    const starGeo = new THREE.BufferGeometry();
    const N = 900, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.05, 1), rand(-1, 1)).normalize().multiplyScalar(1400);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.75, fog: false, depthWrite: false,
    }));
    this.scene.add(this.stars);

    // moon
    const moonMat = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(radialGlow(128, 'rgba(220,235,255,1)', 'rgba(120,150,255,0)')),
      transparent: true, opacity: 0.9, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.moon = new THREE.Sprite(moonMat);
    this.moon.scale.setScalar(190);
    this.scene.add(this.moon);
  }

  _buildEnv() {
    // procedural environment map for reflections
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = null;
    this.setThemeEnv('city');
  }

  setThemeEnv(theme) {
    if (this.envRT) this.envRT.dispose();
    const cv = envMapCanvas(theme);
    const tex = new THREE.CanvasTexture(cv);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.envRT = this.pmrem.fromEquirectangular(tex);
    this.scene.environment = this.envRT.texture;
    tex.dispose();
  }

  _buildWeather() {
    const N = 2400;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const spd = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rand(-70, 70);
      pos[i * 3 + 1] = rand(-10, 45);
      pos[i * 3 + 2] = rand(-70, 70);
      spd[i] = rand(0.6, 1.4);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
    const tex = new THREE.CanvasTexture(rainStreak(8, 64));
    const m = new THREE.PointsMaterial({
      map: tex, color: 0xbfe6ff, size: 1.5, transparent: true, opacity: 0.0,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
    });
    this.rain = new THREE.Points(geo, m);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 8;
    this.rainBasePos = pos.slice(0, N * 3);
    this.rainSpeeds = spd;
    this.rainCount = N;
    this.scene.add(this.rain);
    this.rainType = 'clear';
    this.rainOpacityTarget = 0;
    this.weather = { type: 'clear', wetness: 0, gripMul: 1, fogMul: 1 };

    // lightning
    this.lightning = { t: 0, next: rand(6, 14), flash: 0 };
  }

  _buildSkids() {
    const MAX = 720;
    const geo = new THREE.PlaneGeometry(0.42, 1.25);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x08080c, transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      blending: THREE.NormalBlending,
    });
    this.skidMesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.skidMesh.frustumCulled = false;
    this.skidMesh.count = 0;
    this.skidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.skidMesh);
    this.skidIdx = 0;
    this.skidMax = MAX;
    this._skidDummy = new THREE.Object3D();
  }

  addSkid(x, y, z, yaw, strength = 1) {
    const d = this._skidDummy;
    d.position.set(x, y + 0.035, z);
    d.rotation.set(0, yaw, 0);
    d.scale.set(1, 1, 1 + strength * 0.6);
    d.updateMatrix();
    this.skidMesh.setMatrixAt(this.skidIdx, d.matrix);
    this.skidIdx = (this.skidIdx + 1) % this.skidMax;
    this.skidMesh.count = Math.min(this.skidMesh.count + 1, this.skidMax);
    this.skidMesh.instanceMatrix.needsUpdate = true;
  }

  /* ---------------------------------------------------------- */
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.viewW = w; this.viewH = h;
    this.renderer.setPixelRatio(this.pixelRatioFor() * this.dprScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h);
    if (this.particles) {
      const ph = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
      this.particles.setPixelScale(ph * 0.30);
    }
  }

  setDprScale(s) {
    if (Math.abs(s - this.dprScale) < 0.02) return;
    this.dprScale = clamp(s, 0.55, 1.4);
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    const high = q === 'high';
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    this.stars.visible = q !== 'low';
    this.post.setQuality(q);
    if (q === 'low') {
      this.renderer.toneMappingExposure = 1.0;
    }
    this.setDprScale(high ? 1 : q === 'med' ? 0.86 : 0.68);
  }

  /* ---------------------------------------------------------- */
  loadTrack(def) {
    if (this.track) {
      this.track.dispose();
      this.scene.remove(this.track.group);
    }
    this.trackDef = def;
    this.track = new TrackBuild(this, def);
    const theme = THEMES[def.theme] || THEMES.city;
    this.setThemeEnv(def.theme);
    this.trackTheme = theme;

    // fog + background for theme
    const t = TIMES[def.time] || TIMES.night;
    this.scene.background = new THREE.Color(t.bg);
    this.scene.fog.color.set(t.bg);
    this.scene.fog.density = 0.0016 * (WEATHER[def.weather]?.fogMul || 1);
    this.applyTimeOfDay(def.time);
    this.setWeather(def.weather || 'clear');
    this.roadGrip = def.grip || 1;
    this.trackSurface = def.theme === 'desert' ? 'sand' : def.theme === 'snow' ? 'ice' : def.theme === 'jungle' ? 'grass' : 'grass';
    return this.track;
  }

  applyTimeOfDay(timeId) {
    const t = TIMES[timeId] || TIMES.night;
    this.timeId = timeId;
    this.ambient.intensity = t.ambient;
    this.ambient.color.set(t.hemi);
    this.hemi.intensity = t.ambient * 0.85;
    this.hemi.color.set(t.hemi);
    this.hemi.groundColor.set(timeId === 'day' ? 0x6a7080 : 0x14161f);
    this.sun.intensity = t.sun;
    this.sun.color.set(t.dir);
    this.sun.position.set(0.45, 0.85, 0.3).normalize().multiplyScalar(120);
    this.rim.intensity = timeId === 'night' || timeId === 'dusk' ? 0.55 : 0.18;
    this.stars.visible = (timeId === 'night' || timeId === 'dusk') && this.quality !== 'low';
    this.stars.material.opacity = timeId === 'night' ? 0.55 : 0.3;
    this.moon.visible = timeId === 'night' || timeId === 'dusk';
    this.moon.position.set(-420, 520, -700);
    this.scene.background.set(t.bg);
    if (this.scene.fog) this.scene.fog.color.set(t.bg);
    // sky tint per time
    const palettes = {
      night: ['#02030a', '#0a1226', '#1c1230'],
      day: ['#3d7fd6', '#9dc9f0', '#dfefff'],
      sunset: ['#140a24', '#5a2350', '#ff8a5a'],
      dusk: ['#07040f', '#200d3a', '#43205c'],
    };
    const p = palettes[timeId] || palettes.night;
    const tex = new THREE.CanvasTexture(skyGradient(p[0], p[1], p[2]));
    tex.colorSpace = THREE.SRGBColorSpace;
    if (this.skyMat.map) this.skyMat.map.dispose();
    this.skyMat.map = tex;
    this.skyMat.needsUpdate = true;
    this.renderer.toneMappingExposure = timeId === 'day' ? 0.78 : timeId === 'sunset' ? 0.92 : 1.05;
  }

  setWeather(type) {
    const w = WEATHER[type] || WEATHER.clear;
    this.weather = { type, ...w };
    this.wetness = w.wetness * (this.trackDef?.theme === 'snow' ? 0.4 : 1);
    this.gripMul = w.gripMul * (this.trackDef?.grip || 1);
    this.rain.material.opacity = type === 'rain' || type === 'storm' ? 0.55 : type === 'snow' ? 0.5 : 0;
    this.rain.visible = w.particles > 0;
    this.rain.material.size = type === 'snow' ? 0.9 : 1.5;
    this.rain.material.color.setHex(type === 'snow' ? 0xffffff : 0xbfe6ff);
    this.rainType = type;
    this.lightningActive = !!w.lightning;
    if (this.scene.fog) {
      this.scene.fog.density = 0.0016 * w.fogMul;
    }
    if (this.roadMat) {
      // wet roads are more reflective
      this.roadMat.roughness = lerp(0.85, 0.22, w.wetness);
      this.roadMat.metalness = lerp(0.05, 0.35, w.wetness);
      this.roadMat.needsUpdate = true;
    }
  }

  /** ground height under an XZ point (road follows the spline elevation) */
  groundHeight(x, z) {
    if (!this.track) return 0;
    return this.track.spline.nearest(x, z).y;
  }

  /* ---------------- cars ---------------- */
  addCar(vehicle, opts = {}) {
    const mesh = new CarMesh(vehicle.spec, {
      color: vehicle.color, accent: vehicle.accent, num: opts.num ?? 1,
    });
    this.scene.add(mesh.group);
    this.carMeshes.set(vehicle.id, mesh);
    return mesh;
  }
  removeCar(id) {
    const m = this.carMeshes.get(id);
    if (m) { this.scene.remove(m.group); m.dispose(); this.carMeshes.delete(id); }
  }
  clearCars() {
    for (const [id] of this.carMeshes) this.removeCar(id);
  }
  carMesh(id) { return this.carMeshes.get(id); }

  /* ---------------- effects ---------------- */
  onWallHit(v, impact, nx, nz) {
    const p = v.pos;
    this.particles.spark(p.x - nx * 1.2, p.y + 0.7, p.z - nz * 1.2, Math.min(26, 6 + impact * 2.4), 8 + impact * 0.4);
    this.post?.pulse(0xff8a1f, clamp01(impact / 26) * 0.25);
  }

  /* ---------------- frame ---------------- */
  update(dt, cameraCtrl, state) {
    this.clock += dt;
    const time = this.clock;

    /* sky + stars follow camera */
    this.sky.position.copy(this.camera.position);
    this.stars.position.copy(this.camera.position);
    this.moon.position.set(
      this.camera.position.x - 420, this.camera.position.y + 520, this.camera.position.z - 700);

    /* lightning */
    if (this.lightningActive) {
      const L = this.lightning;
      L.next -= dt;
      if (L.next <= 0) {
        L.next = rand(5, 15);
        L.flash = 1;
        this.ambient.intensity = 4.0;
        this.post?.pulse(0xcfe8ff, 0.55);
        if (this.onLightning) this.onLightning();
      }
      if (L.flash > 0) {
        L.flash -= dt * 3.5;
        this.ambient.intensity = Math.max(this.ambient.intensity, TIMES[this.timeId]?.ambient * 1.6 + L.flash * 5);
        if (L.flash <= 0) this.ambient.intensity = TIMES[this.timeId]?.ambient || 0.3;
      }
    }

    /* rain follows the camera */
    if (this.rain.visible) {
      const pos = this.rain.geometry.attributes.position;
      const arr = pos.array;
      const cx = this.camera.position.x, cz = this.camera.position.z;
      const fall = this.rainType === 'snow' ? 6 : 42;
      const drift = this.rainType === 'snow' ? 1.2 : 3.2;
      for (let i = 0; i < this.rainCount; i++) {
        const i3 = i * 3;
        arr[i3 + 1] -= fall * dt * this.rainSpeeds[i];
        arr[i3] += drift * dt * this.rainSpeeds[i];
        // wrap
        if (arr[i3 + 1] < -6) {
          arr[i3 + 1] = 44;
          arr[i3] = cx + rand(-70, 70);
          arr[i3 + 2] = cz + rand(-70, 70);
        }
        // keep the field near the camera
        if (Math.abs(arr[i3] - cx) > 78) arr[i3] = cx + rand(-70, 70);
        if (Math.abs(arr[i3 + 2] - cz) > 78) arr[i3 + 2] = cz + rand(-70, 70);
      }
      pos.needsUpdate = true;
    }

    /* subtle crowd bobbing */
    if (this.track?.crowd && this.quality !== 'low') {
      this.crowdPhase += dt;
      const arr = this.track.crowd.instanceMatrix.array;
      const base = this.track.crowdBase;
      const amp = Math.sin(this.crowdPhase * 2.2) * 0.09;
      for (let i = 0; i < arr.length; i += 16) {
        arr[i + 13] = base[i + 13] + amp * (i % 3 === 0 ? 1 : 0.6);
      }
      this.track.crowd.instanceMatrix.needsUpdate = true;
    }

    /* beacon pulse + landmark spin */
    if (this.track?.beacon) {
      const b = this.track.beacon;
      const s = 0.85 + Math.abs(Math.sin(time * 2.4)) * 0.5;
      b.scale.setScalar(s);
      b.material.color.setHex(Math.sin(time * 2.4) > 0 ? 0xff2b4d : 0x551122);
    }
    if (this.track?.landmarkRing) this.track.landmarkRing.rotation.z += dt * 0.18;
    if (this.track?.loopRing) this.track.loopRing.rotation.z += dt * 0.06;

    /* boost pad pulse */
    if (this.track?.pads) {
      const pulse = 0.6 + Math.abs(Math.sin(time * 4)) * 0.4;
      for (const pad of this.track.pads) pad.mesh.material.opacity = 0.55 * pulse + 0.25;
    }

    /* car meshes */
    for (const [id, mesh] of this.carMeshes) {
      const v = state?.vehicles?.get?.(id);
      if (v) mesh.update(dt, v, this.camera);
    }

    /* shadow camera follows player */
    if (cameraCtrl?.target) {
      const t = cameraCtrl.target;
      this.sunTarget.position.set(t.x, t.y, t.z);
      this.sun.position.set(t.x + 60, t.y + 110, t.z + 45);
    }

    /* particles */
    this.particles.update(dt);

    /* adaptive resolution */
    this._adaptive(dt);
  }

  _adaptive(dt) {
    if (!this.adaptive) return;
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc >= 1.2) {
      const fps = this._fpsN / this._fpsAcc;
      this.stats.fps = Math.round(fps);
      this._fpsAcc = 0; this._fpsN = 0;
      this.qualityHistory.push(fps);
      if (this.qualityHistory.length > 6) this.qualityHistory.shift();
      const avg = this.qualityHistory.reduce((a, b) => a + b, 0) / this.qualityHistory.length;
      if (avg < 44 && this.dprScale > 0.62) this.setDprScale(this.dprScale - 0.1);
      else if (avg > 58 && this.dprScale < 1 && this.qualityHistory.length >= 4) this.setDprScale(this.dprScale + 0.05);
      if (this.onFps) this.onFps(Math.round(avg));
    }
  }

  render(dt) {
    this.renderer.info.reset();
    this.post.render(dt);
    this.stats.frame++;
  }
}
