/* ============================================================
   TRACK BUILDER — road ribbon, walls, props, city, pads.
   Everything is derived from the spline, so a new set of
   control points instantly produces a full neon circuit.
   ============================================================ */
import * as THREE from 'three';
import { CFG, TRACKS, THEMES, TIMES } from './config.js';
import { TrackSpline, clamp, lerp, rng, pick, TAU, mixHex, cssHex } from './util.js';
import { asphalt, chevrons, facade, neonBar, radialGlow, livery, skyGradient, envMapCanvas } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);

function mat(opts) { return new THREE.MeshStandardMaterial(opts); }

/* ------------------------------------------------------------
   Road shimmer: wet look driven by a roughness map + env map.
   ------------------------------------------------------------ */
export class TrackBuild {
  constructor(world, def) {
    this.world = world;
    this.scene = world.scene;
    this.def = def;
    this.theme = THEMES[def.theme] || THEMES.city;
    this.spline = new TrackSpline(def.points);
    this.group = new THREE.Group();
    this.group.name = 'track';
    this.scene.add(this.group);

    this.pads = [];          // boost strips
    this.pickups = [];       // pickup pad anchors
    this.ramps = [];         // launch triggers
    this.checkpoints = [];
    this.gates = [];

    this._buildRoad();
    this._buildWalls();
    this._buildBoostPads();
    this._buildPickupPads();
    this._buildRamps();
    this._buildScenery();
    this._buildTunnelAndLoop();
    this._buildCrowd();

    this.minimap = this.spline.minimapPath();
    this.splineDef = def;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }

  /* ============================ ROAD ============================ */
  _buildRoad() {
    const sp = this.spline;
    const N = sp.count;
    const hw = CFG.track.halfWidth;
    const theme = this.theme;

    const positions = [], uvs = [], normals = [], indices = [], dists = [];
    // two rows: left & right edge, plus a centre strip for banking look
    const lanes = 4;
    for (let i = 0; i < N; i++) {
      const p = sp.samples[i];
      const n = sp.normals[i];
      const d = sp.spacing * i;
      // banking: raise the outside of the turn slightly
      const curv = sp.curvature[i];
      const bank = clamp(curv * 26, -1, 1) * CFG.track.bankingMax;
      for (let l = 0; l < lanes; l++) {
        const t = l / (lanes - 1);
        const off = lerp(-hw, hw, t);
        const lift = Math.abs(bank) * Math.abs(off) / hw * (bank > 0 ? 1 : 1);
        const bankSign = curv > 0 ? 1 : -1;
        const y = p.y + bank * (off / hw) * 0.9;
        positions.push(p.x + n.x * off, y, p.z + n.z * off);
        uvs.push(t * 2.6, d / 16);
        normals.push(0, 1, 0);
        dists.push(d);
      }
    }
    for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N;
      for (let l = 0; l < lanes - 1; l++) {
        const a = i * lanes + l, b = i * lanes + l + 1, c = i2 * lanes + l, d = i2 * lanes + l + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const asphaltTex = new THREE.CanvasTexture(asphalt(512, this.def.theme === 'snow' ? [186, 200, 216] : this.def.theme === 'desert' ? [96, 76, 52] : undefined));
    asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
    asphaltTex.colorSpace = THREE.SRGBColorSpace;
    asphaltTex.anisotropy = 8;

    const roadMat = mat({
      map: asphaltTex,
      color: this.def.theme === 'snow' ? 0xdfe9f5 : 0xffffff,
      roughness: this.def.theme === 'snow' ? 0.55 : 0.82,
      metalness: 0.06,
      envMapIntensity: 0.6,
      side: THREE.DoubleSide,
    });
    this.roadMat = roadMat;
    const road = new THREE.Mesh(geo, roadMat);
    road.receiveShadow = true;
    road.name = 'road';
    this.group.add(road);

    /* --- lane markings: dashed centre + edge lines --- */
    const linePts = [];
    const laneMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(theme.line), transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const dashGeo = [];
    for (let d = 0; d < sp.length; d += 14) {
      const p = sp.pointAt(d, 0);
      const n = sp.normalAt(d);
      const t = sp.tangentAt(d);
      dashGeo.push({ p, t });
    }
    // centre dashes as instanced boxes
    const dashBox = new THREE.BoxGeometry(0.28, 0.05, 3.6);
    const dashes = new THREE.InstancedMesh(dashBox, laneMat, dashGeo.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    dashGeo.forEach((g, i) => {
      const yaw = Math.atan2(g.t.x, g.t.z);
      e.set(0, yaw, 0);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(g.p.x, g.p.y + 0.06, g.p.z), q, new THREE.Vector3(1, 1, 1));
      dashes.setMatrixAt(i, m4);
    });
    dashes.instanceMatrix.needsUpdate = true;
    dashes.frustumCulled = false;
    this.group.add(dashes);

    // edge neon lines (left & right)
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= N; i += 2) {
        const p = sp.samples[i % N];
        const n = sp.normals[i % N];
        pts.push(new THREE.Vector3(p.x + n.x * (hw - 0.5) * side, p.y + 0.08, p.z + n.z * (hw - 0.5) * side));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(theme.line), transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const line = new THREE.LineLoop(g, lineMat);
      this.group.add(line);
    }
  }

  /* ============================ WALLS ============================ */
  _buildWalls() {
    const sp = this.spline;
    const N = sp.count;
    const hw = CFG.track.halfWidth + 0.35;
    const theme = this.theme;

    for (const side of [-1, 1]) {
      const positions = [], uvs = [], indices = [];
      for (let i = 0; i < N; i++) {
        const p = sp.samples[i];
        const n = sp.normals[i];
        const x = p.x + n.x * hw * side, z = p.z + n.z * hw * side;
        positions.push(x, p.y - 0.4, z);
        positions.push(x, p.y + 2.1, z);
        const u = (i / N) * 90;
        uvs.push(u, 0, u, 1);
      }
      for (let i = 0; i < N; i++) {
        const i2 = (i + 1) % N;
        const a = i * 2, b = i * 2 + 1, c = i2 * 2, d = i2 * 2 + 1;
        if (side > 0) indices.push(a, b, c, b, d, c);
        else indices.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(indices);
      g.computeVertexNormals();

      // wall texture: dark with a bright top band
      const wc = document.createElement('canvas'); wc.width = 64; wc.height = 64;
      const cx = wc.getContext('2d');
      cx.fillStyle = '#0a0f1c'; cx.fillRect(0, 0, 64, 64);
      cx.fillStyle = '#14203a'; cx.fillRect(0, 40, 64, 8);
      const wt = new THREE.CanvasTexture(wc);
      wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
      wt.repeat.set(1, 1);
      wt.colorSpace = THREE.SRGBColorSpace;
      const wm = mat({ map: wt, color: 0x2a3550, roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide });
      const wall = new THREE.Mesh(g, wm);
      wall.receiveShadow = true;
      this.group.add(wall);

      // neon top rail
      const railPts = [];
      for (let i = 0; i <= N; i += 2) {
        const p = sp.samples[i % N], n = sp.normals[i % N];
        railPts.push(new THREE.Vector3(p.x + n.x * hw * side, p.y + 2.1, p.z + n.z * hw * side));
      }
      const rg = new THREE.BufferGeometry().setFromPoints(railPts);
      const rail = new THREE.LineLoop(rg, new THREE.LineBasicMaterial({
        color: new THREE.Color(theme.wall), transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.group.add(rail);

      // periodic light posts
      const postGeo = new THREE.BoxGeometry(0.35, 5.4, 0.35);
      const postMat = mat({ color: 0x1a2438, roughness: 0.5, metalness: 0.7 });
      const lampGeo = new THREE.SphereGeometry(0.42, 8, 6);
      const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.line) });
      const count = Math.floor(sp.length / 42);
      const posts = new THREE.InstancedMesh(postGeo, postMat, count);
      const lamps = new THREE.InstancedMesh(lampGeo, lampMat, count);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        const d = i * 42;
        const p = sp.pointAt(d, (hw + 1.4) * side);
        dummy.position.set(p.x, p.y + 2.7, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        posts.setMatrixAt(i, dummy.matrix);
        dummy.position.y = p.y + 5.3;
        dummy.updateMatrix();
        lamps.setMatrixAt(i, dummy.matrix);
      }
      posts.instanceMatrix.needsUpdate = true; lamps.instanceMatrix.needsUpdate = true;
      posts.castShadow = false;
      this.group.add(posts, lamps);

      // glow sprites on lamps (subtle, additive)
      const glowTex = new THREE.CanvasTexture(radialGlow(64));
      const sprMat = new THREE.SpriteMaterial({
        map: glowTex, color: new THREE.Color(theme.line), transparent: true,
        opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      for (let i = 0; i < count; i += 2) {
        const d = i * 42;
        const p = sp.pointAt(d, (hw + 1.4) * side);
        const s = new THREE.Sprite(sprMat);
        s.position.set(p.x, p.y + 5.3, p.z);
        s.scale.setScalar(4.2);
        this.group.add(s);
      }
    }
  }

  /* ============================ BOOST PADS ============================ */
  _buildBoostPads() {
    const sp = this.spline;
    const theme = this.theme;
    const chev = new THREE.CanvasTexture(chevrons(cssHex(theme.line), 128));
    chev.wrapS = chev.wrapT = THREE.RepeatWrapping;
    chev.repeat.set(1, 3);
    chev.colorSpace = THREE.SRGBColorSpace;
    const padMat = new THREE.MeshBasicMaterial({
      map: chev, color: 0xffffff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      toneMapped: false,
    });
    const padGeo = new THREE.PlaneGeometry(CFG.track.halfWidth * 1.5, 11);
    padGeo.rotateX(-Math.PI / 2);

    // place pads at meaningful spots: every ~340m, on the racing line side
    const count = 7;
    for (let i = 0; i < count; i++) {
      const d = (i / count) * sp.length + 60;
      const off = (i % 2 === 0 ? 1 : -1) * CFG.track.halfWidth * 0.42;
      const p = sp.pointAt(d, off);
      const t = sp.tangentAt(d);
      const mesh = new THREE.Mesh(padGeo, padMat);
      mesh.position.set(p.x, p.y + 0.09, p.z);
      mesh.rotation.y = Math.atan2(t.x, t.z);
      this.group.add(mesh);
      // side rails for the pad
      this.pads.push({ d, off, y: p.y, mesh, halfW: CFG.track.halfWidth * 0.75, len: 5.5, glow: 0 });
    }
  }

  /* ============================ PICKUP PADS ============================ */
  _buildPickupPads() {
    const sp = this.spline;
    const theme = this.theme;
    const count = 12;
    const ringGeo = new THREE.RingGeometry(1.5, 2.0, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    // three across per row
    for (let i = 0; i < count; i++) {
      const d = (i / count) * sp.length + 120;
      for (const lane of [-1, 0, 1]) {
        const off = lane * CFG.track.halfWidth * 0.55;
        const p = sp.pointAt(d, off);
        const t = sp.tangentAt(d);
        const ring = new THREE.Mesh(ringGeo, ringMat.clone());
        ring.position.set(p.x, p.y + 0.12, p.z);
        this.group.add(ring);
        this.pickups.push({ d, off, y: p.y, x: p.x, z: p.z, ring, active: true, respawn: 0, mesh: null });
      }
    }
  }

  /* ============================ RAMPS ============================ */
  _buildRamps() {
    const sp = this.spline;
    const theme = this.theme;
    // three launch ramps along the lap
    const spots = [0.19, 0.52, 0.81];
    const rampMat = mat({ color: 0x111a2c, roughness: 0.4, metalness: 0.6, envMapIntensity: 0.9 });
    const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.accent) });
    for (let i = 0; i < spots.length; i++) {
      const d = spots[i] * sp.length;
      const p = sp.pointAt(d, 0);
      const t = sp.tangentAt(d);
      const yaw = Math.atan2(t.x, t.z);
      const g = new THREE.Group();
      const W = CFG.track.halfWidth * 0.92, L = 16, H = 2.6;
      // wedge: custom geometry
      const geo = new THREE.BufferGeometry();
      const verts = [
        -W, 0, -L / 2, W, 0, -L / 2, W, 0, L / 2, -W, 0, L / 2,
        -W, H, L / 2, W, H, L / 2,
      ];
      const idx = [
        0, 1, 2, 0, 2, 3, // bottom
        3, 2, 5, 3, 5, 4, // slope
        0, 4, 5, 0, 5, 1, // back
        0, 3, 4, 1, 5, 2, // sides
      ];
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, rampMat);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      // glowing lip
      const lip = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.18, 0.5), edgeMat);
      lip.position.set(0, H, L / 2);
      g.add(lip);
      for (const sx of [-1, 1]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, L), edgeMat);
        strip.position.set(sx * W, H * 0.5, 0);
        strip.rotation.x = -Math.atan2(H, L) * 0.0;
        g.add(strip);
      }
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = yaw;
      this.group.add(g);
      this.ramps.push({ d, x: p.x, z: p.z, yaw, launch: 13.5 + i * 1.4, halfW: W, len: L, mesh: g, hit: 0 });
    }
  }

  /* ============================ SCENERY ============================ */
  _buildScenery() {
    const sp = this.spline;
    const theme = this.theme;
    const r = rng(Math.floor(sp.length));
    const B = sp.bounds;
    const cx = (B.minX + B.maxX) / 2, cz = (B.minZ + B.maxZ) / 2;
    const span = Math.max(B.maxX - B.minX, B.maxZ - B.minZ);

    /* --- ground plane --- */
    const gtex = new THREE.CanvasTexture(asphalt(256, this.def.theme === 'snow' ? [200, 214, 228] : this.def.theme === 'desert' ? [90, 68, 42] : [10, 14, 24]));
    gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping;
    gtex.repeat.set(84, 84);
    gtex.colorSpace = THREE.SRGBColorSpace;
    const groundMat = mat({
      map: gtex,
      color: this.def.theme === 'snow' ? 0xe8f2ff : this.def.theme === 'desert' ? 0xb08a5a : 0x0a0f1a,
      roughness: 0.95, metalness: 0.0,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 4, span * 4, 1, 1), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.6, cz);
    ground.receiveShadow = true;
    this.group.add(ground);
    this.groundMat = groundMat;

    /* --- skyline: instanced neon towers --- */
    const towers = [];
    const MIN_CLEAR = CFG.track.halfWidth + 16;
    for (let d = 0; d < sp.length; d += 11) {
      for (const side of [-1, 1]) {
        if (r() > 0.42) continue;
        const p = sp.pointAt(d, (MIN_CLEAR + r() * 130) * side);
        const w = 8 + r() * 22, h = 14 + r() * (this.def.theme === 'city' ? 130 : 60), dep = 8 + r() * 22;
        towers.push({ x: p.x, z: p.z, y: p.y, w, h, dep, rot: r() * TAU, tint: r() });
      }
    }
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    towerGeo.translate(0, 0.5, 0);
    const facTex = new THREE.CanvasTexture(facade(7, [34, 230, 255]));
    facTex.wrapS = facTex.wrapT = THREE.RepeatWrapping;
    facTex.colorSpace = THREE.SRGBColorSpace;
    const towerMat = mat({
      map: facTex, color: 0xffffff, roughness: 0.38, metalness: 0.5,
      emissive: 0x1b3a66, emissiveIntensity: 1.05, envMapIntensity: 1.3,
    });
    const inst = new THREE.InstancedMesh(towerGeo, towerMat, towers.length);
    inst.castShadow = true; inst.receiveShadow = true;
    const dm = new THREE.Object3D();
    const col = new THREE.Color();
    towers.forEach((t, i) => {
      dm.position.set(t.x, t.y - 0.5, t.z);
      dm.rotation.set(0, t.rot, 0);
      dm.scale.set(t.w, t.h, t.dep);
      dm.updateMatrix();
      inst.setMatrixAt(i, dm.matrix);
      col.setHex(mixHex(0x1a2a4a, 0x3a1a4a, t.tint));
      inst.setColorAt(i, col);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.group.add(inst);
    this.towerInst = inst;

    /* --- neon roof strips on a subset of towers --- */
    const stripGeo = new THREE.BoxGeometry(1, 0.6, 1);
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
    const stripCount = Math.min(towers.length, 240);
    const strips = new THREE.InstancedMesh(stripGeo, stripMat, stripCount);
    for (let i = 0; i < stripCount; i++) {
      const t = towers[i];
      dm.position.set(t.x, t.y + t.h - 1, t.z);
      dm.rotation.set(0, t.rot, 0);
      dm.scale.set(t.w * 1.06, 1, t.dep * 1.06);
      dm.updateMatrix();
      strips.setMatrixAt(i, dm.matrix);
      col.setHex(i % 3 === 0 ? 0xff2bd6 : i % 3 === 1 ? 0x22e6ff : 0xc6ff2b);
      strips.setColorAt(i, col);
    }
    strips.instanceMatrix.needsUpdate = true;
    if (strips.instanceColor) strips.instanceColor.needsUpdate = true;
    this.group.add(strips);
    this.roofStrips = strips;

    /* --- billboards along the track (glowing) --- */
    const billTexs = [];
    const billColors = [0x22e6ff, 0xff2bd6, 0xc6ff2b, 0xffe36b];
    for (let i = 0; i < 4; i++) {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
      const cx2 = cv.getContext('2d');
      cx2.fillStyle = '#05070f'; cx2.fillRect(0, 0, 256, 128);
      cx2.strokeStyle = cssHex(billColors[i]); cx2.lineWidth = 8; cx2.strokeRect(6, 6, 244, 116);
      cx2.fillStyle = cssHex(billColors[i]);
      cx2.font = 'bold 44px Bahnschrift, sans-serif';
      cx2.textAlign = 'center'; cx2.textBaseline = 'middle';
      cx2.fillText(i === 0 ? 'NEON' : i === 1 ? 'RUSH' : i === 2 ? 'BLUR' : 'GO', 128, 64);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      billTexs.push(tex);
    }
    for (let i = 0; i < 18; i++) {
      const d = (i / 18) * sp.length + 30;
      const side = i % 2 === 0 ? 1 : -1;
      const p = sp.pointAt(d, (CFG.track.halfWidth + 7.5) * side);
      const t = sp.tangentAt(d);
      const bbMat = new THREE.MeshBasicMaterial({ map: billTexs[i % billTexs.length], side: THREE.DoubleSide, toneMapped: false });
      const bb = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), bbMat);
      bb.position.set(p.x, p.y + 8.5, p.z);
      bb.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2 * side;
      this.group.add(bb);
      // support legs
      const legMat = mat({ color: 0x1a2238, roughness: 0.6, metalness: 0.6 });
      for (const sx of [-5, 5]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), legMat);
        leg.position.set(0, -4.5, sx * 0.1);
        bb.add(leg);
        leg.position.x = sx;
        leg.position.y = -4.5 - 3.5;
        leg.position.z = 0;
      }
    }

    /* --- checkpoint gates + start/finish arch --- */
    this._buildGates();

    /* --- landmark: giant neon ring sculpture --- */
    this._buildLandmarks();
  }

  _buildGates() {
    const sp = this.spline;
    const theme = this.theme;
    const nGates = 6;
    for (let i = 0; i < nGates; i++) {
      const d = (i / nGates) * sp.length;
      const p = sp.pointAt(d, 0);
      const t = sp.tangentAt(d);
      const first = i === 0;
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = Math.atan2(t.x, t.z);
      const w = CFG.track.halfWidth * 2 + 3;
      const barMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(first ? 0xffffff : theme.accent), toneMapped: false,
      });
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, 0.9), barMat);
      top.position.set(0, 8.2, 0);
      g.add(top);
      // pillars
      const pm = mat({ color: 0x0c1424, roughness: 0.35, metalness: 0.8, emissive: new THREE.Color(theme.accent), emissiveIntensity: 0.25 });
      for (const sx of [-1, 1]) {
        const pil = new THREE.Mesh(new THREE.BoxGeometry(1.1, 8.2, 1.1), pm);
        pil.position.set(sx * w / 2, 4.1, 0);
        g.add(pil);
      }
      // chequered banner for start/finish
      if (first) {
        const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64;
        const c2 = cv.getContext('2d');
        for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
          c2.fillStyle = (x + y) % 2 ? '#0b0f18' : '#ffffff';
          c2.fillRect(x * 32, y * 32, 32, 32);
        }
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.4),
          new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
        banner.position.set(0, 6.8, 0.2);
        g.add(banner);
        // neon "START" sign
        const cv2 = document.createElement('canvas'); cv2.width = 512; cv2.height = 128;
        const c3 = cv2.getContext('2d');
        c3.fillStyle = '#05070f'; c3.fillRect(0, 0, 512, 128);
        c3.fillStyle = '#22e6ff'; c3.font = 'bold 84px Bahnschrift, sans-serif';
        c3.textAlign = 'center'; c3.textBaseline = 'middle';
        c3.fillText('START', 256, 68);
        const t2 = new THREE.CanvasTexture(cv2);
        t2.colorSpace = THREE.SRGBColorSpace;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 4),
          new THREE.MeshBasicMaterial({ map: t2, transparent: true, side: THREE.DoubleSide, toneMapped: false }));
        sign.position.set(0, 11.4, 0);
        g.add(sign);
        this.startGate = g;
      }
      this.group.add(g);
      this.gates.push({ d, mesh: g });
      this.checkpoints.push({ d, index: i });
    }
  }

  _buildLandmarks() {
    const sp = this.spline;
    const theme = this.theme;
    // giant ring
    const ringD = sp.length * 0.62;
    const p = sp.pointAt(ringD, (CFG.track.halfWidth + 55) * 1);
    const ringGeo = new THREE.TorusGeometry(22, 1.6, 8, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.accent), toneMapped: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(p.x, p.y + 30, p.z);
    ring.rotation.y = Math.random() * TAU;
    this.group.add(ring);
    this.landmarkRing = ring;

    // pylon tower with bands
    const p2 = sp.pointAt(sp.length * 0.28, -(CFG.track.halfWidth + 40));
    const pylonH = 150;
    const pyl = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 7.5, pylonH, 8, 1),
      mat({ color: 0x131c30, roughness: 0.4, metalness: 0.7 }));
    pyl.position.set(p2.x, p2.y + pylonH / 2, p2.z);
    this.group.add(pyl);
    for (let i = 0; i < 6; i++) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(7.4 - i * 0.55, 7.4 - i * 0.55, 1.4, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff2bd6 : 0x22e6ff, toneMapped: false, side: THREE.DoubleSide }));
      band.position.set(p2.x, p2.y + pylonH * (0.25 + i * 0.12), p2.z);
      this.group.add(band);
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2b4d, toneMapped: false }));
    beacon.position.set(p2.x, p2.y + pylonH + 1.5, p2.z);
    this.group.add(beacon);
    this.beacon = beacon;
  }

  _buildTunnelAndLoop() {
    const sp = this.spline;
    const theme = this.theme;
    // neon tunnel: arch ribs + dark canopy strip
    const tunnelStart = sp.length * 0.40;
    const tunnelLen = 74;
    const ribMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.line), toneMapped: false });
    const ribGeo = new THREE.TorusGeometry(CFG.track.halfWidth + 1.2, 0.22, 6, 20, Math.PI);
    const ribs = Math.floor(tunnelLen / 6);
    for (let i = 0; i < ribs; i++) {
      const d = tunnelStart + i * 6;
      const p = sp.pointAt(d, 0);
      const t = sp.tangentAt(d);
      const rib = new THREE.Mesh(ribGeo, ribMat);
      rib.position.set(p.x, p.y + 0.2, p.z);
      rib.rotation.y = Math.atan2(t.x, t.z);
      this.group.add(rib);
    }
    // canopy
    const canopyPts = [];
    for (let d = tunnelStart; d <= tunnelStart + tunnelLen; d += 4) {
      const p = sp.pointAt(d, 0);
      canopyPts.push({ p, t: sp.tangentAt(d) });
    }
    const canopy = new THREE.Group();
    const cGeo = new THREE.PlaneGeometry(CFG.track.halfWidth * 2 + 2, tunnelLen, 1, 1);
    cGeo.rotateX(-Math.PI / 2);
    const cMat = new THREE.MeshStandardMaterial({
      color: 0x070a14, roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide,
      emissive: new THREE.Color(theme.line), emissiveIntensity: 0.04,
    });
    // simple: place one canopy per 10m segment following tangent
    for (let i = 0; i < canopyPts.length - 1; i++) {
      const a = canopyPts[i], b = canopyPts[i + 1];
      const seg = new THREE.Mesh(new THREE.BoxGeometry(CFG.track.halfWidth * 2 + 2, 0.5, 5),
        new THREE.MeshStandardMaterial({ color: 0x070a14, roughness: 0.5, metalness: 0.75 }));
      const mid = { x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2, z: (a.p.z + b.p.z) / 2 };
      seg.position.set(mid.x, mid.y + 7.4, mid.z);
      seg.rotation.y = Math.atan2(a.t.x, a.t.z);
      canopy.add(seg);
      // side walls of tunnel
      for (const side of [-1, 1]) {
        const n = sp.normalAt(tunnelStart + i * 4);
        const wallSeg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.4, 5),
          new THREE.MeshStandardMaterial({ color: 0x0a0e18, roughness: 0.5, metalness: 0.7 }));
        wallSeg.position.set(mid.x + n.x * (CFG.track.halfWidth + 1.4) * side, mid.y + 3.7,
          mid.z + n.z * (CFG.track.halfWidth + 1.4) * side);
        wallSeg.rotation.y = Math.atan2(a.t.x, a.t.z);
        canopy.add(wallSeg);
      }
    }
    this.group.add(canopy);

    // light strips inside tunnel
    const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.accent), toneMapped: false });
    for (let i = 0; i < 14; i++) {
      const d = tunnelStart + (i / 14) * tunnelLen;
      const p = sp.pointAt(d, 0);
      for (const side of [-1, 1]) {
        const n = sp.normalAt(d);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 4.5), stripMat);
        strip.position.set(p.x + n.x * (CFG.track.halfWidth + 1.1) * side, p.y + 6.6,
          p.z + n.z * (CFG.track.halfWidth + 1.1) * side);
        strip.rotation.y = Math.atan2(sp.tangentAt(d).x, sp.tangentAt(d).z);
        this.group.add(strip);
      }
    }

    // loop-the-loop sculpture over the track
    const loopD = sp.length * 0.12;
    const lp = sp.pointAt(loopD, 0);
    const lt = sp.tangentAt(loopD);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(17, 1.1, 10, 40),
      new THREE.MeshBasicMaterial({ color: 0x22e6ff, toneMapped: false }));
    loop.position.set(lp.x, lp.y + 15, lp.z);
    loop.rotation.y = Math.atan2(lt.x, lt.z);
    this.group.add(loop);
    // inner ring
    const inner = new THREE.Mesh(new THREE.TorusGeometry(15.4, 0.35, 6, 40),
      new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false }));
    inner.position.copy(loop.position);
    inner.rotation.copy(loop.rotation);
    this.group.add(inner);
    this.loopRing = loop;
  }

  _buildCrowd() {
    const sp = this.spline;
    // bleachers near the start straight with instanced crowd blobs
    const d0 = 8;
    const p = sp.pointAt(d0, CFG.track.halfWidth + 16);
    const t = sp.tangentAt(d0);
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = Math.atan2(t.x, t.z);
    const standMat = mat({ color: 0x141b2e, roughness: 0.8, metalness: 0.2 });
    for (let step = 0; step < 5; step++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(38, 1.2, 2.4), standMat);
      st.position.set(0, step * 1.2 + 0.6, step * 2.2);
      g.add(st);
    }
    const crowdGeo = new THREE.CapsuleGeometry(0.32, 0.7, 3, 6);
    const crowdMat = mat({ color: 0xffffff, roughness: 0.85, emissive: 0x101828, emissiveIntensity: 1 });
    const count = 150;
    const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, count);
    const dm = new THREE.Object3D(), col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 30);
      dm.position.set(-18 + (i % 30) * 1.24, row * 1.2 + 1.6, row * 2.2);
      dm.rotation.y = Math.random() * 0.6 - 0.3;
      dm.updateMatrix();
      crowd.setMatrixAt(i, dm.matrix);
      const c = pick([0x22e6ff, 0xff2bd6, 0xc6ff2b, 0xffe36b, 0xe8f4ff]);
      col.setHex(c);
      crowd.setColorAt(i, col);
    }
    crowd.instanceMatrix.needsUpdate = true;
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    g.add(crowd);
    this.group.add(g);
    this.crowd = crowd;
    this.crowdBase = crowd.instanceMatrix.array.slice();
  }

  /* ============================ QUERIES ============================ */
  /** true if a car at (x,z) is over the road (return lateral offset) */
  lateral(x, z) { return this.spline.nearest(x, z).off; }

  /** which boost pad is the car on? */
  padAt(x, z, along) {
    for (const pad of this.pads) {
      const dd = this.spline.delta(pad.d, along);
      if (Math.abs(dd) < pad.len) {
        const near = this.spline.nearest(x, z);
        if (Math.abs(near.off - pad.off) < pad.halfW) return pad;
      }
    }
    return null;
  }

  /** ramp trigger check */
  rampAt(along, lateralOff, y) {
    for (const r of this.ramps) {
      const dd = this.spline.delta(r.d, along);
      if (dd > -2 && dd < 3 && Math.abs(lateralOff) < r.halfW * 0.9) {
        if (y < this.spline.at(r.d).y + 3.2) return r;
      }
    }
    return null;
  }
}
