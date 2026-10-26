/* ============================================================
   CAR MESH — low-poly Blur-style car with neon underglow,
   head/tail lights, boost plumes and damage deformation.
   ============================================================ */
import * as THREE from 'three';
import { livery, radialGlow } from './textures.js';
import { clamp, clamp01, damp, cssHex, lerp } from './util.js';

const BODY_GEO_CACHE = new Map();
function bodyGeometry(len = 4.3, wid = 2.0, hgt = 0.62) {
  const key = len + ':' + wid + ':' + hgt;
  if (BODY_GEO_CACHE.has(key)) return BODY_GEO_CACHE.get(key);
  // side profile extruded: a tapered wedge with a low nose
  const s = new THREE.Shape();
  s.moveTo(-len * 0.5, 0);
  s.lineTo(-len * 0.46, hgt * 0.55);
  s.lineTo(-len * 0.18, hgt * 0.92);
  s.lineTo(len * 0.16, hgt * 0.86);
  s.lineTo(len * 0.42, hgt * 0.42);
  s.lineTo(len * 0.5, hgt * 0.1);
  s.lineTo(len * 0.46, 0);
  s.lineTo(-len * 0.5, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: wid, bevelEnabled: true, bevelSize: 0.09, bevelThickness: 0.09, bevelSegments: 2 });
  g.rotateY(Math.PI / 2);
  g.translate(-wid / 2, 0, 0);
  // extrude is along +z after rotation; recentre
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(0, 0, -(bb.min.z + bb.max.z) / 2);
  g.computeVertexNormals();
  BODY_GEO_CACHE.set(key, g);
  return g;
}

const WHEEL_GEO = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14);
WHEEL_GEO.rotateZ(Math.PI / 2);
const RIM_GEO = new THREE.TorusGeometry(0.22, 0.045, 6, 12);
RIM_GEO.rotateY(Math.PI / 2);

export class CarMesh {
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.color = opts.color ?? spec.color;
    this.accent = opts.accent ?? spec.accent;
    this.num = opts.num ?? 1;
    this.group = new THREE.Group();
    this.group.name = 'car-' + this.num;
    this.wheels = [];
    this.panels = [];
    this.damageState = 0;

    const paintTex = new THREE.CanvasTexture(livery(cssHex(this.color), cssHex(this.accent), this.num));
    paintTex.colorSpace = THREE.SRGBColorSpace;

    const paintMat = new THREE.MeshStandardMaterial({
      map: paintTex,
      color: 0xffffff,
      metalness: 0.42,
      roughness: 0.22,
      envMapIntensity: 2.4,
      emissive: this.color,
      emissiveIntensity: 0.10,
    });
    this.paintMat = paintMat;

    // ---- main body: layered volumes read far better than one extrusion ----
    const paint = paintMat;
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x121722, metalness: 0.6, roughness: 0.35, envMapIntensity: 1.6 });

    // lower chassis / skid plate
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.20, 4.30), darkMat);
    skirt.position.y = 0.30;
    skirt.castShadow = true;
    this.group.add(skirt);

    // main body slab
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.42, 4.32), paint);
    body.position.y = 0.56;
    body.castShadow = true; body.receiveShadow = true;
    body.name = 'body';
    this.body = body;
    this.group.add(body);

    // tapered nose (narrower, lower) — gives the wedge
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.70, 0.28, 1.34), paint);
    nose.position.set(0, 0.47, 1.92);
    nose.castShadow = true;
    this.group.add(nose);

    // splitter
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.07, 0.55), darkMat);
    splitter.position.set(0, 0.30, 2.34);
    this.group.add(splitter);

    // hood vents
    for (const sx of [-0.52, 0.52]) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.045, 0.62), darkMat);
      vent.position.set(sx, 0.78, 1.42);
      this.group.add(vent);
    }

    // rear deck + diffuser
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.24, 1.05), paint);
    deck.position.set(0, 0.79, -1.72);
    deck.castShadow = true;
    this.group.add(deck);
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.90, 0.20, 0.42), darkMat);
    diffuser.position.set(0, 0.34, -2.18);
    this.group.add(diffuser);

    // fender flares
    for (const sx of [-1, 1]) {
      for (const sz of [1.42, -1.46]) {
        const flare = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.30, 1.15), paint);
        flare.position.set(sx * 1.02, 0.52, sz);
        flare.castShadow = true;
        this.group.add(flare);
      }
    }

    // side intakes
    for (const sx of [-1, 1]) {
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.20, 0.85), darkMat);
      intake.position.set(sx * 1.03, 0.62, -0.15);
      this.group.add(intake);
    }

    // cabin / canopy — a raked glass box reads far better than a squashed sphere
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x16233a, metalness: 0.85, roughness: 0.16, transparent: true, opacity: 0.94,
      envMapIntensity: 3.4, emissive: 0x0a1830, emissiveIntensity: 0.5,
    });
    const cabinGeo = new THREE.BoxGeometry(1.52, 0.5, 2.0);
    const cabin = new THREE.Mesh(cabinGeo, glassMat);
    cabin.position.set(0, 0.92, -0.18);
    cabin.castShadow = true;
    this.group.add(cabin);
    // windscreen / rear rake
    const rake = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.42, 0.9), glassMat);
    rake.position.set(0, 0.85, 1.02);
    rake.rotation.x = -0.42;
    this.group.add(rake);
    const rearRake = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.40, 0.8), glassMat);
    rearRake.position.set(0, 0.86, -1.34);
    rearRake.rotation.x = 0.5;
    this.group.add(rearRake);

    // roof accent
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.07, 1.7), paintMat);
    roof.position.set(0, 1.19, -0.2);
    roof.castShadow = true;
    this.group.add(roof);

    // spoiler
    const spoilerMat = new THREE.MeshStandardMaterial({ color: this.accent, metalness: 0.6, roughness: 0.3, emissive: this.accent, emissiveIntensity: 0.25 });
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.09, 0.42), spoilerMat);
    spoiler.position.set(0, 0.98, -2.0);
    this.group.add(spoiler);
    for (const sx of [-0.72, 0.72]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.2), darkMat);
      strut.position.set(sx, 0.82, -1.95);
      this.group.add(strut);
    }

    // headlights
    const headMat = new THREE.MeshBasicMaterial({ color: 0xdff6ff, toneMapped: false });
    for (const sx of [-0.62, 0.62]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.06), headMat);
      hl.position.set(sx, 0.62, 2.16);
      this.group.add(hl);
    }
    // taillights
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2b4d, toneMapped: false });
    this.tailMat = tailMat;
    for (const sx of [-0.68, 0.68]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.05), tailMat);
      tl.position.set(sx, 0.68, -2.16);
      this.group.add(tl);
    }
    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.04), tailMat);
    tailBar.position.set(0, 0.72, -2.17);
    this.group.add(tailBar);

    // neon underglow (flat plane with radial gradient, additive)
    const glowTex = new THREE.CanvasTexture(radialGlow(128, 'rgba(255,255,255,0.95)'));
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex, color: this.accent, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    });
    const ug = new THREE.Sprite(glowMat);
    ug.scale.set(3.6, 1.5, 1);
    ug.position.y = 0.16;
    this.underglow = ug;
    this.group.add(ug);

    // boost plumes
    this.plumes = [];
    const plumeMat = new THREE.MeshBasicMaterial({
      color: 0x66f0ff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    for (const sx of [-0.42, 0.42]) {
      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.5, 8, 1, true), plumeMat);
      plume.rotation.x = Math.PI / 2;
      plume.position.set(sx, 0.52, -2.55);
      plume.visible = false;
      this.group.add(plume);
      this.plumes.push(plume);
    }

    // damageable panels (doors / fenders)
    const panelGeo = new THREE.BoxGeometry(0.06, 0.52, 1.5);
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(panelGeo, paintMat);
      p.position.set(side * 1.02, 0.55, 0.1);
      p.castShadow = true;
      this.group.add(p);
      this.panels.push({ mesh: p, off: false, side });
    }

    // wheels
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x0b0e16, roughness: 0.92, metalness: 0.05 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xc8d8ea, roughness: 0.25, metalness: 1.0, envMapIntensity: 2 });
    const offsets = [
      [-0.94, 0.36, 1.42], [0.94, 0.36, 1.42],
      [-0.98, 0.36, -1.46], [0.98, 0.36, -1.46],
    ];
    offsets.forEach((o, i) => {
      const w = new THREE.Group();
      const tire = new THREE.Mesh(WHEEL_GEO, tireMat);
      tire.castShadow = true;
      w.add(tire);
      const rim = new THREE.Mesh(RIM_GEO, rimMat);
      rim.position.x = o[0] > 0 ? 0.15 : -0.15;
      w.add(rim);
      w.position.set(o[0], o[1], o[2]);
      this.group.add(w);
      this.wheels.push({ group: w, tire, rim, front: i < 2, side: o[0] > 0 ? 1 : -1, base: new THREE.Vector3(o[0], o[1], o[2]) });
    });

    // shadow blob (cheap contact shadow)
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false,
      map: glowTex, blending: THREE.NormalBlending,
    });
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5), shadowMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    this.group.add(blob);
    this.blob = blob;

    this.group.scale.setScalar(opts.scale ?? 1);
  }

  setVisible(v) { this.group.visible = v; }

  update(dt, v, camera) {
    const g = this.group;
    g.position.set(v.pos.x, v.pos.y, v.pos.z);
    g.rotation.y = v.visYaw;
    // body attitude: roll + pitch
    this.body.rotation.z = v.bodyRoll;
    this.body.rotation.x = v.bodyPitch;
    // suspension bounce
    const bounce = Math.sin(performance.now() * 0.012 + this.num) * 0.006 * Math.min(1, v.speed / 40);
    this.body.position.y = 0.52 + bounce;

    // wheels
    for (const w of this.wheels) {
      w.group.position.y = w.base.y - Math.min(0.06, v.gripLost * 0.05);
      w.tire.rotation.x = v.wheelRot;
      if (w.front) w.group.rotation.y = v.wheelSteer;
      w.group.rotation.z = 0;
    }

    // underglow: pulse with boost/combo (kept subtle so it never washes the car)
    const boostGlow = v.boosting ? 1.5 : 1;
    this.underglow.material.opacity = 0.28 + Math.sin(performance.now() * 0.006 + this.num) * 0.05 + (v.boosting ? 0.22 : 0);
    this.underglow.scale.set(3.4 * boostGlow, 1.5 * boostGlow, 1);

    // brake lights
    const braking = v.brake > 0.2 || v.handbrake;
    this.tailMat.color.setHex(braking ? 0xff5a2b : 0xff2b4d);
    this.tailMat.color.multiplyScalar(braking ? 2.4 : 1.0);

    // plumes
    const on = v.boosting && v.nitro > 0;
    for (const p of this.plumes) {
      p.visible = on;
      if (on) {
        const s = 0.7 + Math.random() * 0.55;
        p.scale.set(s, s * (0.9 + Math.random() * 0.5), s);
      }
    }

    // damage visuals
    const dmg = clamp01(v.damage / 100);
    if (Math.abs(dmg - this.damageState) > 0.01) {
      this.damageState = dmg;
      const dark = lerp(1, 0.34, dmg);
      this.paintMat.color.setScalar(dark);
      for (const p of this.panels) {
        const shouldOff = dmg > 0.62 ? true : p.off;
        if (shouldOff && !p.off) {
          p.off = true;
          p.mesh.visible = false;
        }
      }
      // wheels deform
      for (const w of this.wheels) {
        w.tire.scale.set(1 - dmg * 0.12, 1 - dmg * 0.18, 1);
      }
    }

    // shield bubble
    if (v.shield > 0 && !this.shieldMesh) {
      const sm = new THREE.Mesh(new THREE.SphereGeometry(3.1, 16, 12),
        new THREE.MeshBasicMaterial({
          color: 0xc6ff2b, transparent: true, opacity: 0.16,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
        }));
      sm.position.y = 1.1;
      this.shieldMesh = sm;
      g.add(sm);
    }
    if (this.shieldMesh) {
      this.shieldMesh.visible = v.shield > 0;
      if (v.shield > 0) {
        this.shieldMesh.rotation.y += dt * 0.8;
        this.shieldMesh.material.opacity = 0.12 + Math.abs(Math.sin(performance.now() * 0.004)) * 0.12;
      }
    }
  }

  dispose() {
    this.group.traverse(o => {
      if (o.geometry && !BODY_GEO_CACHE.has(o.geometry)) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }
}
