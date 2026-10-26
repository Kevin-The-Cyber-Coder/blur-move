/* Functional ESM stub of three.js — enough surface for the whole game to run
   headlessly in Node so integration logic can be verified. */
export const REVISION = '160-stub';

export const AdditiveBlending = 2;
export const NormalBlending = 1;
export const NoBlending = 0;
export const DoubleSide = 2;
export const BackSide = 1;
export const FrontSide = 0;
export const SRGBColorSpace = 'srgb';
export const LinearSRGBColorSpace = 'srgb-linear';
export const ACESFilmicToneMapping = 4;
export const PCFSoftShadowMap = 2;
export const RepeatWrapping = 1000;
export const ClampToEdgeWrapping = 1001;
export const DynamicDrawUsage = 35048;
export const HalfFloatType = 1016;
export const EquirectangularReflectionMapping = 303;
export const LinearFilter = 1006;
export const NearestFilter = 1003;
export const RGBAFormat = 1023;
export const LessEqualDepth = 3;
export const MathUtils = {
  lerp: (a, b, t) => a + (b - a) * t,
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  degToRad: d => d * Math.PI / 180,
};

let uid = 0;

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { this.x = this.y = this.z = s; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScalar(s) { this.x += s; this.y += s; this.z += s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  divideScalar(s) { return this.multiplyScalar(1 / (s || 1)); }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) { const { x, y, z } = this; this.x = y * v.z - z * v.y; this.y = z * v.x - x * v.z; this.z = x * v.y - y * v.x; return this; }
  crossVectors(a, b) { this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; return this; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  distanceToSquared(v) { return (this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2; }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  applyQuaternion() { return this; }
  applyMatrix4() { return this; }
  setFromSphericalCoords() { return this; }
  setFromMatrixPosition() { return this; }
  lookAt() { return this; }
  toArray() { return [this.x, this.y, this.z]; }
  equals(v) { return this.x === v.x && this.y === v.y && this.z === v.z; }
}

export class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
}

export class Color {
  constructor(r = 1, g = 1, b = 1) { this.r = r; this.g = g; this.b = b; this._hex = 0xffffff; }
  setHex(h) { this._hex = h; this.r = ((h >> 16) & 255) / 255; this.g = ((h >> 8) & 255) / 255; this.b = (h & 255) / 255; return this; }
  set(c) { if (typeof c === 'number') return this.setHex(c); if (typeof c === 'string') return this; return this.copy(c); }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  setScalar(s) { this.r = this.g = this.b = s; return this; }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  clone() { return new Color().copy(this); }
  multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
  multiply(c) { this.r *= c.r; this.g *= c.g; this.b *= c.b; return this; }
  lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
  getHex() { return this._hex; }
  getHexString() { return this._hex.toString(16).padStart(6, '0'); }
}

export class Euler {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; this.order = 'XYZ'; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(e) { this.x = e.x; this.y = e.y; this.z = e.z; return this; }
}
export class Quaternion {
  constructor() { this.x = this.y = this.z = 0; this.w = 1; }
  setFromEuler() { return this; }
  setFromAxisAngle() { return this; }
  copy(q) { return this; }
  clone() { return new Quaternion(); }
}
export class Matrix4 {
  constructor() { this.elements = new Array(16).fill(0); }
  compose() { return this; }
  makeRotationY() { return this; }
  copy() { return this; }
  identity() { return this; }
}

export class Object3D {
  constructor() {
    this.id = ++uid;
    this.position = new Vector3();
    this.rotation = new Euler();
    this.scale = new Vector3(1, 1, 1);
    this.quaternion = new Quaternion();
    this.matrix = new Matrix4();
    this.matrixWorld = new Matrix4();
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.name = '';
    this.userData = {};
    this.castShadow = false;
    this.receiveShadow = false;
    this.frustumCulled = true;
    this.renderOrder = 0;
  }
  add(...objs) { for (const o of objs) { if (!o) continue; o.parent = this; this.children.push(o); } return this; }
  remove(...objs) { for (const o of objs) { const i = this.children.indexOf(o); if (i >= 0) { this.children.splice(i, 1); o.parent = null; } } return this; }
  removeFromParent() { this.parent?.remove(this); }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse?.(fn); }
  traverseVisible(fn) { this.traverse(fn); }
  getObjectByName(n) { let f = null; this.traverse(o => { if (!f && o.name === n) f = o; }); return f; }
  lookAt() { }
  updateMatrix() { }
  updateMatrixWorld() { }
  updateWorldMatrix() { }
  getWorldPosition(v) { return v.set(this.position.x, this.position.y, this.position.z); }
  getWorldDirection(v) { return v.set(0, 0, 1); }
  localToWorld(v) { return v; }
  worldToLocal(v) { return v; }
  clone(recursive = true) {
    const c = new this.constructor();
    c.position.copy(this.position); c.rotation.copy(this.rotation); c.scale.copy(this.scale);
    c.name = this.name;
    if (recursive) for (const ch of this.children) { const cc = ch.clone(true); c.add(cc); }
    return c;
  }
  copy(o) { this.position.copy(o.position); this.rotation.copy(o.rotation); this.scale.copy(o.scale); return this; }
  dispose() { }
}

export class Group extends Object3D { }
export class Scene extends Object3D {
  constructor() { super(); this.background = new Color(0, 0, 0); this.environment = null; this.fog = null; }
}
export class Mesh extends Object3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isMesh = true; }
}
export class SkinnedMesh extends Mesh { }
export class Points extends Object3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isPoints = true; }
}
export class Line extends Object3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isLine = true; }
}
export class LineLoop extends Line { }
export class LineSegments extends Line { }
export class Sprite extends Object3D {
  constructor(material) { super(); this.material = material; this.isSprite = true; this.center = new Vector2(0.5, 0.5); }
}
export class InstancedMesh extends Mesh {
  constructor(geometry, material, count) {
    super(geometry, material);
    this.instanceMatrix = {
      array: new Float32Array(count * 16), needsUpdate: false,
      setUsage() { return this; }, setXYZW() { }, addUpdateRange() { }, clearUpdateRanges() { },
    };
    this.instanceColor = { array: new Float32Array(count * 3), needsUpdate: false, setUsage() { return this; } };
    this.count = count;
    this.isInstancedMesh = true;
  }
  setMatrixAt() { }
  setColorAt() { }
  getMatrixAt() { }
  computeBoundingSphere() { }
}

export class BufferGeometry {
  constructor() {
    this.attributes = {};
    this.index = null;
    this.groups = [];
    this.boundingSphere = null;
    this.boundingBox = null;
    this.drawRange = { start: 0, count: Infinity };
    this.userData = {};
  }
  setAttribute(k, v) { this.attributes[k] = v; return this; }
  getAttribute(k) { return this.attributes[k]; }
  deleteAttribute(k) { delete this.attributes[k]; return this; }
  setIndex(i) { this.index = i; return this; }
  setFromPoints(pts) { this.points = pts; return this; }
  setDrawRange(s, c) { this.drawRange = { start: s, count: c }; return this; }
  computeVertexNormals() { }
  computeBoundingBox() { this.boundingBox = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 }, getCenter() { return new Vector3(); } }; }
  computeBoundingSphere() { this.boundingSphere = { center: new Vector3(), radius: 1 }; }
  computeTangents() { }
  translate(x = 0, y = 0, z = 0) { return this; }
  rotateX() { return this; }
  rotateY() { return this; }
  rotateZ() { return this; }
  scale() { return this; }
  center() { return this; }
  dispose() { this.disposed = true; }
  clone() { return new BufferGeometry(); }
}
export class PlaneGeometry extends BufferGeometry { constructor(w, h) { super(); this.width = w; this.height = h; } }
export class BoxGeometry extends BufferGeometry { constructor(w, h, d) { super(); this.params = [w, h, d]; } }
export class SphereGeometry extends BufferGeometry { constructor(r) { super(); this.radius = r; } }
export class CylinderGeometry extends BufferGeometry { constructor() { super(); } }
export class ConeGeometry extends BufferGeometry { constructor() { super(); } }
export class TorusGeometry extends BufferGeometry { constructor() { super(); } }
export class RingGeometry extends BufferGeometry { constructor() { super(); } }
export class IcosahedronGeometry extends BufferGeometry { constructor() { super(); } }
export class CapsuleGeometry extends BufferGeometry { constructor() { super(); } }
export class CircleGeometry extends BufferGeometry { constructor() { super(); } }
export class ShapeGeometry extends BufferGeometry { constructor() { super(); } }
export class TorusKnotGeometry extends BufferGeometry { constructor() { super(); } }
export class Float32BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; this.needsUpdate = false; this.updateRanges = []; }
  setUsage() { return this; }
  addUpdateRange(s, c) { this.updateRanges.push({ start: s, count: c }); }
  clearUpdateRanges() { this.updateRanges.length = 0; }
  setXYZ() { return this; }
  getX() { return 0; }
}
export class BufferAttribute extends Float32BufferAttribute { }
export class Uint32BufferAttribute extends Float32BufferAttribute { }

export class Material {
  constructor(o = {}) {
    Object.assign(this, o);
    this.color = new Color(1, 1, 1);
    if (o.color !== undefined) this.color.set(o.color);
    this.uniforms = o.uniforms || {};
    this.visible = true;
    this.needsUpdate = false;
    this.transparent = !!o.transparent;
    this.opacity = o.opacity ?? 1;
    this.blending = o.blending ?? NormalBlending;
    this.depthWrite = o.depthWrite ?? true;
  }
  dispose() { this.disposed = true; }
  clone() { return new this.constructor({}); }
}
export class MeshBasicMaterial extends Material { }
export class MeshStandardMaterial extends Material { }
export class MeshPhongMaterial extends Material { }
export class MeshLambertMaterial extends Material { }
export class MeshPhysicalMaterial extends Material { }
export class PointsMaterial extends Material { }
export class LineBasicMaterial extends Material { }
export class SpriteMaterial extends Material { }
export class ShaderMaterial extends Material {
  constructor(o = {}) { super(o); this.vertexShader = o.vertexShader; this.fragmentShader = o.fragmentShader; this.uniforms = o.uniforms || {}; }
}
export class RawShaderMaterial extends ShaderMaterial { }

export class Texture {
  constructor(image) { this.image = image; this.needsUpdate = false; this.repeat = new Vector2(1, 1); this.offset = new Vector2(0, 0); this.wrapS = 0; this.wrapT = 0; this.colorSpace = ''; this.mapping = 0; this.minFilter = 0; this.magFilter = 0; this.anisotropy = 1; this.generateMipmaps = true; }
  dispose() { this.disposed = true; }
  clone() { return new Texture(this.image); }
}
export class CanvasTexture extends Texture { }
export class DataTexture extends Texture { }
export class VideoTexture extends Texture { }
export class DepthTexture extends Texture { }

export class WebGLRenderTarget {
  constructor(w, h, o = {}) { this.width = w; this.height = h; this.texture = new Texture(); this.samples = o.samples ?? 0; this.options = o; }
  setSize(w, h) { this.width = w; this.height = h; }
  dispose() { }
  clone() { return new WebGLRenderTarget(this.width, this.height); }
}

export class Light extends Object3D {
  constructor(color = 0xffffff, intensity = 1) { super(); this.color = new Color().setHex(color); this.intensity = intensity; }
}
export class AmbientLight extends Light { }
export class HemisphereLight extends Light { constructor(sky, ground, i) { super(sky, i); this.groundColor = new Color().setHex(ground || 0); } }
export class DirectionalLight extends Light {
  constructor(c, i) { super(c, i); this.shadow = { mapSize: new Vector2(512, 512), camera: { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 100, updateProjectionMatrix() { } }, bias: 0, normalBias: 0, map: null, autoUpdate: true }; this.target = new Object3D(); }
}
export class PointLight extends Light { constructor(c, i, d) { super(c, i); this.distance = d; this.decay = 2; } }
export class SpotLight extends Light { constructor(c, i) { super(c, i); this.target = new Object3D(); this.angle = 1; this.penumbra = 0; this.distance = 0; } }

export class Fog {
  constructor(c, n, f) { this.color = new Color().setHex(c); this.near = n; this.far = f; }
}
export class FogExp2 {
  constructor(c, d) { this.color = new Color().setHex(c); this.density = d; }
}

export class PerspectiveCamera extends Object3D {
  constructor(fov = 60, aspect = 1, near = 0.1, far = 1000) {
    super(); this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
    this.projectionMatrix = new Matrix4(); this.matrixWorldInverse = new Matrix4(); this.layers = { mask: 1, set() { }, enable() { }, test: () => true };
  }
  updateProjectionMatrix() { this.projUpdates = (this.projUpdates || 0) + 1; }
  updateMatrixWorld() { }
  setViewOffset() { }
}
export class OrthographicCamera extends PerspectiveCamera { }

export class Clock {
  constructor() { this.t = performance.now(); }
  getDelta() { const n = performance.now(); const d = (n - this.t) / 1000; this.t = n; return d; }
  getElapsedTime() { return (performance.now() - this.t) / 1000; }
}

export class WebGLRenderer {
  constructor(opts = {}) {
    this.domElement = opts.canvas || { style: {}, width: 1280, height: 720 };
    this.shadowMap = { enabled: false, type: 0 };
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
    this.outputColorSpace = '';
    this.capabilities = { isWebGL2: true, getMaxAnisotropy: () => 8, getMaxTextureSize: () => 4096 };
    this.info = { render: { calls: 0, triangles: 0, frame: 0, points: 0 }, memory: { geometries: 0, textures: 0 }, programs: [], autoReset: true, reset() { } };
    this._pr = 1;
    this._size = new Vector2(1280, 720);
    this.autoClear = true;
    this.localClippingEnabled = false;
    this.state = { buffers: { depth: { setTest() { }, setMask() { } }, color: { setMask() { } } } };
  }
  setPixelRatio(p) { this._pr = p; this.pixelRatio = p; }
  getPixelRatio() { return this._pr; }
  setSize(w, h, updateStyle = true) { this._size.set(w, h); this.width = w; this.height = h; }
  getSize(v) { return v ? v.set(this._size.x, this._size.y) : this._size; }
  getDrawingBufferSize(v) { const r = { x: this._size.x * this._pr, y: this._size.y * this._pr }; if (v && v.set) return v.set(r.x, r.y); return r; }
  setRenderTarget() { }
  getRenderTarget() { return null; }
  clear() { }
  render(scene, camera) { this.info.render.calls += 3; this.info.render.frame++; }
  setAnimationLoop(fn) { this._loop = fn; }
  compile() { }
  dispose() { }
  getContext() { return {}; }
  readRenderTargetPixels() { }
  copyFramebufferToTexture() { }
  setClearColor() { }
  getViewport() { return { x: 0, y: 0, width: 1280, height: 720 }; }
  setViewport() { }
  setScissorTest() { }
  setScissor() { }
}

export class Clock2 extends Clock { }
export class Raycaster {
  constructor() { this.ray = { origin: new Vector3(), direction: new Vector3() }; }
  setFromCamera() { }
  intersectObjects() { return []; }
}
export class Box3 {
  constructor() { this.min = new Vector3(); this.max = new Vector3(); }
  setFromObject() { return this; }
  getCenter(v) { return v; }
  containsPoint() { return false; }
}
export class Sphere {
  constructor(c = new Vector3(), r = 1) { this.center = c; this.radius = r; }
}
export class Plane {
  constructor(n = new Vector3(0, 1, 0), c = 0) { this.normal = n; this.constant = c; }
}
export class PMREMGenerator {
  constructor(renderer) { this.renderer = renderer; }
  _rt() { const rt = new WebGLRenderTarget(1, 1); rt.texture = new Texture(); return rt; }
  fromScene() { return this._rt(); }
  fromEquirectangular() { return this._rt(); }
  compileEquirectangularShader() { }
  dispose() { }
}
export class WebGLCubeRenderTarget extends WebGLRenderTarget { }
export class CubeCamera extends Object3D { constructor() { super(); this.renderTarget = new WebGLRenderTarget(1, 1); } update() { } }
export class Layers { constructor() { this.mask = 1; } set() { } enable() { } enableAll() { } test() { return true; } }
export class ExtrudeGeometry extends BufferGeometry {
  constructor(shape, opts) { super(); this.shape = shape; this.opts = opts; }
}
export class Shape {
  constructor() { this.points = []; }
  moveTo() { } lineTo() { } quadraticCurveTo() { } bezierCurveTo() { } closePath() { }
}
export class ShapePath extends Shape { }
export class CatmullRomCurve3 {
  constructor(points) { this.points = points; }
  getPoint() { return new Vector3(); }
  getPointAt() { return new Vector3(); }
  getLength() { return 1; }
}
export class LineCurve3 extends CatmullRomCurve3 { }
export class QuadraticBezierCurve3 extends CatmullRomCurve3 { }
export class FontLoader { load() { } }
export class SpriteMaterial2 extends SpriteMaterial { }
export class UniformsUtils { static merge(a, b) { return { ...a, ...b }; } static clone(u) { return { ...u }; } }
export class ShaderLib { }
export class ShaderChunk { }
export class WebGLMultipleRenderTargets extends WebGLRenderTarget { }
export class AudioListener extends Object3D { }
export class Audio { constructor() { } connect() { } }
export class PositionalAudio extends Audio { }
export class GridHelper extends Object3D { }
export class AxesHelper extends Object3D { }
export class ArrowHelper extends Object3D { }
export class CameraHelper extends Object3D { }

/* ---------- submodule stubs used by the post-processing chain ---------- */
export class Pass {
  constructor() { this.enabled = true; this.needsSwap = true; this.clear = false; this.renderToScreen = false; }
  setSize() { } render() { } dispose() { }
}
export class EffectComposer {
  constructor(renderer, rt) {
    this.renderer = renderer;
    this.renderTarget1 = rt || new WebGLRenderTarget(1280, 720);
    this.renderTarget2 = new WebGLRenderTarget(1280, 720);
    this.passes = [];
    this.readBuffer = this.renderTarget1;
    this.writeBuffer = this.renderTarget2;
    this.clock = new Clock();
  }
  addPass(p) { this.passes.push(p); return p; }
  insertPass(p, i) { this.passes.splice(i, 0, p); }
  removePass(p) { const i = this.passes.indexOf(p); if (i >= 0) this.passes.splice(i, 1); }
  setSize(w, h) { this.renderTarget1.setSize(w, h); this.renderTarget2.setSize(w, h); }
  render(dt) { this.renders = (this.renders || 0) + 1; for (const p of this.passes) p.render?.(); }
  reset() { }
  dispose() { }
}
export class RenderPass extends Pass {
  constructor(scene, camera) { super(); this.scene = scene; this.camera = camera; }
  render() { }
}
export class ShaderPass extends Pass {
  constructor(shader, textureId) {
    super();
    this.uniforms = shader.uniforms || {};
    this.material = new ShaderMaterial({ uniforms: this.uniforms, vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader });
    this.fsQuad = { material: this.material };
  }
  render() { }
}
export class UnrealBloomPass extends Pass {
  constructor(res, strength, radius, threshold) {
    super();
    this.resolution = res; this.strength = strength; this.radius = radius; this.threshold = threshold;
    this.compositeMaterial = {}; this.enabled = true;
  }
  setSize() { }
  render() { }
}
export class OutputPass extends Pass { render() { } }
export class MaskPass extends Pass { }
export class CopyShader { static uniforms = {}; static vertexShader = ''; static fragmentShader = ''; }
export class LuminosityHighPassShader { static uniforms = {}; static vertexShader = ''; static fragmentShader = ''; }
export class OutputShader { static uniforms = {}; static vertexShader = ''; static fragmentShader = ''; }
export const __addons = {};
