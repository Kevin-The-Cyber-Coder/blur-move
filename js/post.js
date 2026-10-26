/* ============================================================
   POST — HDR pipeline: bloom + speed warp + aberration + grade.
   ============================================================ */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CFG } from './config.js';
import { clamp01, lerp } from './util.js';

const CompositeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAberration: { value: 0.0 },
    uRadial: { value: 0.0 },
    uVignette: { value: 1.0 },
    uGrain: { value: 0.035 },
    uTime: { value: 0.0 },
    uFlash: { value: 0.0 },
    uFlashColor: { value: new THREE.Color(1, 0.3, 0.6) },
    uGrade: { value: 0.0 },
    uDamage: { value: 0.0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uDesat: { value: 0.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uAberration, uRadial, uVignette, uGrain, uTime, uFlash, uGrade, uDamage, uDesat;
    uniform vec3 uFlashColor;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r = length(c);

      // ---- radial speed blur toward edges ----
      vec3 col = vec3(0.0);
      if (uRadial > 0.001) {
        float amount = uRadial * smoothstep(0.08, 0.72, r);
        float samples = 7.0;
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 7; i++) {
          float t = float(i) / 6.0;
          vec2 dir = uv - c * amount * t * 0.5;
          acc += texture2D(tDiffuse, dir).rgb;
        }
        col = acc / samples;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }

      // ---- chromatic aberration ----
      if (uAberration > 0.0005) {
        float ab = uAberration * (0.35 + r * 1.4);
        vec2 off = normalize(c + 1e-5) * ab * 0.012;
        col.r = texture2D(tDiffuse, uv + off).r;
        col.b = texture2D(tDiffuse, uv - off).b;
      }

      // ---- colour grade: cyan shadows / magenta highs ----
      if (uGrade > 0.001) {
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 shadowTint = vec3(0.86, 1.02, 1.16);
        vec3 highTint = vec3(1.10, 0.92, 1.12);
        vec3 tinted = mix(shadowTint, highTint, smoothstep(0.15, 0.85, l));
        col = mix(col, col * tinted, uGrade);
        col = mix(col, vec3(l), uDesat);
      }

      // ---- damage: red pulse at the edges ----
      if (uDamage > 0.001) {
        float edge = smoothstep(0.28, 0.78, r);
        col = mix(col, col * vec3(1.35, 0.55, 0.6), edge * uDamage);
        col += vec3(0.20, 0.01, 0.04) * edge * uDamage;
      }

      // ---- vignette ----
      float vig = smoothstep(0.92, 0.24, r * uVignette);
      col *= mix(0.72, 1.0, vig);

      // ---- film grain ----
      float g = hash(uv * uResolution + fract(uTime) * 131.7) - 0.5;
      col += g * uGrain;

      // ---- flash (nitro / explosion / lightning) ----
      col = mix(col, uFlashColor, uFlash);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera, w, h) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;
    this.quality = 'high';

    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: renderer.capabilities.isWebGL2 ? 2 : 0,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setSize(w, h);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h),
      CFG.render.bloomStrength, CFG.render.bloomRadius, CFG.render.bloomThreshold);
    this.composer.addPass(this.bloom);

    this.composite = new ShaderPass(CompositeShader);
    this.composite.renderToScreen = false;
    this.composer.addPass(this.composite);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.u = this.composite.uniforms;
    this.u.uResolution.value.set(w, h);
    this.state = { aberration: 0, radial: 0, flash: 0, damage: 0, grade: 0.55, desat: 0 };
    this.target = { aberration: 0, radial: 0, flash: 0, damage: 0, grade: 0.55, desat: 0 };
    this._flashDecay = 0;
    this._flashColor = new THREE.Color();
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.u.uResolution.value.set(w, h);
  }

  setQuality(q) {
    this.quality = q;
    const on = q !== 'low';
    this.bloom.enabled = on;
    this.bloom.strength = q === 'high' ? CFG.render.bloomStrength : CFG.render.bloomStrength * 0.7;
    const samples = q === 'high' ? 2 : 0;
    if (this.composer.renderTarget1.samples !== undefined && this.renderer.capabilities.isWebGL2) {
      this.composer.renderTarget1.samples = samples;
      this.composer.renderTarget2.samples = samples;
    }
  }

  /** drive the effects from gameplay state */
  drive({ speed01 = 0, boost = 0, damage = 0, flash = 0, flashColor = null, wobble = 0 }) {
    const t = this.target;
    t.radial = clamp01(speed01 * 0.55 + boost * 0.85);
    t.aberration = clamp01(boost * 1.6 + wobble * 0.7 + speed01 * 0.18);
    t.damage = clamp01(damage);
    if (flash > 0 && flashColor) {
      this._flashColor.setHex(flashColor);
      this.state.flash = Math.max(this.state.flash, flash * 0.8);
      this._flashDecay = 1;
    }
    this.state.flash = Math.max(0, this.state.flash - 0.06 * (this.dt || 0.016) * 60 * 0.4);
    this.u.uFlashColor.value.lerp(this._flashColor, 0.2);
  }

  pulse(color = 0xffffff, amt = 0.35) {
    this._flashColor.setHex(color);
    this.state.flash = Math.max(this.state.flash, amt);
  }

  update(dt) {
    this.dt = dt;
    const u = this.u;
    u.uTime.value += dt;
    // smooth the driven values
    const s = this.state, t = this.target;
    const k = 1 - Math.exp(-6 * dt);
    s.radial += (t.radial - s.radial) * k;
    s.aberration += (t.aberration - s.aberration) * k;
    s.damage += (t.damage - s.damage) * k;
    u.uRadial.value = s.radial * 0.85;
    u.uAberration.value = s.aberration;
    u.uDamage.value = s.damage;
    u.uGrade.value = this.quality === 'low' ? 0 : 0.5;
    u.uGrain.value = this.quality === 'high' ? 0.012 : 0.0;
    s.flash = Math.max(0, s.flash - dt * 2.2);
    u.uFlash.value = s.flash;
    if (this.quality === 'low') {
      u.uRadial.value *= 0.5;
      u.uAberration.value *= 0.5;
    }
  }

  render(dt) {
    this.update(dt);
    this.composer.render();
  }
}
