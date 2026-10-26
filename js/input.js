/* ============================================================
   INPUT — keyboard, gamepad, touch joystick + gyro, rebinding.
   ============================================================ */
import { clamp, clamp01, damp } from './util.js';

const DEFAULT_BINDS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  boost: ['ShiftLeft', 'ShiftRight', 'Space'],
  handbrake: ['Space'],
  power: ['KeyE', 'KeyF'],
  cam: ['KeyC'],
  pause: ['Escape', 'KeyP'],
  lookback: ['KeyB'],
  reset: ['KeyR'],
  horn: ['KeyH'],
  gearUp: ['KeyX'],
  gearDown: ['KeyZ'],
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.binds = JSON.parse(JSON.stringify(DEFAULT_BINDS));
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.boost = false;
    this.handbrake = false;
    this.power = false;
    this.lookback = false;
    this.actions = [];
    this.touch = { active: false, id: null, sx: 0, sy: 0, x: 0, y: 0, boost: false, brake: false, power: false };
    this.touchMode = 'auto';
    this.gyro = { enabled: false, value: 0, baseline: null, sensitivity: 1 };
    this.sensitivity = 1;
    this.deadzone = 0.14;
    this.assist = false;
    this.leftHanded = false;
    this.gamepad = { connected: false, index: -1, name: '' };
    this._prevButtons = [];
    this._btnEdge = new Set();
    this._listeners = [];
  }

  init() {
    const add = (el, ev, fn, opts) => { el.addEventListener(ev, fn, opts); this._listeners.push([el, ev, fn]); };
    add(window, 'keydown', e => {
      if (e.repeat) return;
      const code = e.code;
      if (this._isBound(code, 'pause') || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) e.preventDefault();
      this.keys.add(code);
      this.pressed.add(code);
      this._mapAction(code);
    });
    add(window, 'keyup', e => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    add(window, 'blur', () => { this.keys.clear(); this.touch.boost = this.touch.brake = false; });
    add(window, 'gamepadconnected', e => {
      this.gamepad.connected = true; this.gamepad.index = e.gamepad.index; this.gamepad.name = e.gamepad.id;
      this.gamepad.onchange?.();
    });
    add(window, 'gamepaddisconnected', () => {
      this.gamepad.connected = false; this.gamepad.index = -1;
      this.gamepad.onchange?.();
    });
    this._initTouch();
    return this;
  }

  _isBound(code, action) {
    const b = this.binds[action];
    return b && b.includes(code);
  }

  _mapAction(code) {
    for (const a of ['pause', 'cam', 'power', 'reset', 'lookback', 'horn', 'gearUp', 'gearDown']) {
      if (this._isBound(code, a)) this.actions.push(a);
    }
  }

  _initTouch() {
    const zone = document.getElementById('stick-zone');
    const base = document.getElementById('stick-base');
    const knob = document.getElementById('stick-knob');
    if (!zone || !base || !knob) return;
    const onStart = (e) => {
      const t = e.changedTouches ? e.changedTouches[0] : e;
      this.touch.active = true; this.touch.id = t.identifier ?? 'mouse';
      this.touch.sx = t.clientX; this.touch.sy = t.clientY;
      this.touch.x = 0; this.touch.y = 0;
      base.classList.add('active');
      base.style.left = (t.clientX - 66) + 'px';
      base.style.bottom = 'auto';
      base.style.top = (t.clientY - 66) + 'px';
      knob.style.transform = 'none';
      e.preventDefault?.();
    };
    const onMove = (e) => {
      if (!this.touch.active) return;
      let t = e;
      if (e.changedTouches) {
        t = Array.from(e.changedTouches).find(x => x.identifier === this.touch.id);
        if (!t) return;
      }
      let dx = t.clientX - this.touch.sx, dy = t.clientY - this.touch.sy;
      const R = 62;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      this.touch.x = dx / R; this.touch.y = dy / R;
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      e.preventDefault?.();
    };
    const onEnd = (e) => {
      if (e.changedTouches) {
        const t = Array.from(e.changedTouches).find(x => x.identifier === this.touch.id);
        if (!t) return;
      }
      this.touch.active = false; this.touch.id = null;
      this.touch.x = 0; this.touch.y = 0;
      base.classList.remove('active');
      knob.style.transform = 'none';
      base.style.left = ''; base.style.top = ''; base.style.bottom = '';
    };
    zone.addEventListener('touchstart', onStart, { passive: false });
    zone.addEventListener('touchmove', onMove, { passive: false });
    zone.addEventListener('touchend', onEnd);
    zone.addEventListener('touchcancel', onEnd);
    zone.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);

    // action buttons
    const hold = (el, on, off) => {
      if (!el) return;
      const s = e => { on(); el.classList.add('pressed'); e.preventDefault(); };
      const e2 = e => { off(); el.classList.remove('pressed'); };
      el.addEventListener('touchstart', s, { passive: false });
      el.addEventListener('touchend', e2);
      el.addEventListener('touchcancel', e2);
      el.addEventListener('mousedown', s);
      el.addEventListener('mouseup', e2);
      el.addEventListener('mouseleave', e2);
    };
    hold(document.getElementById('t-boost'), () => this.touch.boost = true, () => this.touch.boost = false);
    hold(document.getElementById('t-brake'), () => this.touch.brake = true, () => this.touch.brake = false);
    hold(document.getElementById('t-drift'), () => this.touch.drift = true, () => this.touch.drift = false);
    hold(document.getElementById('t-power'), () => { this.touch.power = true; this.actions.push('power'); }, () => this.touch.power = false);
    this.touchEnabled = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  async enableGyro() {
    if (typeof DeviceOrientationEvent === 'undefined') return false;
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return false;
      }
      window.addEventListener('deviceorientation', e => {
        if (e.gamma === null) return;
        this.gyro.value = e.gamma; // -90..90 left/right tilt
      });
      this.gyro.enabled = true;
      return true;
    } catch (err) { return false; }
  }

  setBinds(newBinds) {
    if (newBinds) this.binds = { ...this.binds, ...newBinds };
  }
  rebind(action, code) {
    this.binds[action] = [code];
  }

  pollGamepad() {
    this._btnEdge.clear();
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let gp = null;
    for (const p of pads) { if (p && p.connected) { gp = p; break; } }
    if (!gp) { this.gamepad.connected = false; return; }
    this.gamepad.connected = true;
    this.gamepad.index = gp.index;
    this.gamepad.name = gp.id;

    const ax = gp.axes[0] || 0;
    const steerAx = Math.abs(ax) > this.deadzone ? (ax - Math.sign(ax) * this.deadzone) / (1 - this.deadzone) : 0;
    const rt = gp.buttons[7]?.value ?? 0;
    const lt = gp.buttons[6]?.value ?? 0;
    const dpadUp = gp.buttons[12]?.pressed, dpadDown = gp.buttons[13]?.pressed;
    this.gpThrottle = Math.max(rt, dpadUp ? 1 : 0);
    this.gpBrake = Math.max(lt, dpadDown ? 1 : 0);
    this.gpSteer = steerAx;
    this.gpBoost = !!(gp.buttons[0]?.pressed || gp.buttons[5]?.pressed);
    this.gpHandbrake = !!(gp.buttons[2]?.pressed || gp.buttons[1]?.pressed);
    this.gpPower = !!gp.buttons[3]?.pressed;
    // edge-triggered buttons: 9 = start, 8 = select/back
    gp.buttons.forEach((b, i) => {
      if (b.pressed && !this._prevButtons[i]) this._btnEdge.add(i);
      this._prevButtons[i] = b.pressed;
    });
    if (this._btnEdge.has(9)) this.actions.push('pause');
    if (this._btnEdge.has(8)) this.actions.push('cam');
    if (this._btnEdge.has(3)) this.actions.push('power');
    if (this._btnEdge.has(4)) this.actions.push('lookback');
  }

  /** call once per frame */
  update(dt) {
    this.pollGamepad();
    let steerKb = 0, thrKb = 0, brkKb = 0;
    if (this._anyDown('left')) steerKb -= 1;
    if (this._anyDown('right')) steerKb += 1;
    if (this._anyDown('throttle')) thrKb = 1;
    if (this._anyDown('brake')) brkKb = 1;

    let steerTarget = steerKb;
    let thrTarget = thrKb;
    let brkTarget = brkKb;

    if (this.touch.active && Math.abs(this.touch.x) > this.deadzone) {
      const t = this.touch.x;
      steerTarget = Math.sign(t) * Math.pow((Math.abs(t) - this.deadzone) / (1 - this.deadzone), 1.25);
    }
    if (this.touch.active && this.touch.y < -0.25) thrTarget = clamp01((-this.touch.y - 0.25) / 0.7);
    if (this.touch.active && this.touch.y > 0.35) brkTarget = clamp01((this.touch.y - 0.35) / 0.6);

    if (this.gyro.enabled && this.gyro.value !== null) {
      if (this.gyro.baseline === null) this.gyro.baseline = this.gyro.value;
      const tilt = (this.gyro.value - this.gyro.baseline) * 0.022 * this.gyro.sensitivity;
      if (Math.abs(tilt) > 0.02) steerTarget = clamp(tilt, -1, 1);
    }

    if (this.gamepad.connected) {
      if (Math.abs(this.gpSteer || 0) > 0) steerTarget = this.gpSteer;
      thrTarget = Math.max(thrTarget, this.gpThrottle || 0);
      brkTarget = Math.max(brkTarget, this.gpBrake || 0);
    }

    // steering smoothing (sensitivity scales response)
    const rate = 12 * this.sensitivity;
    this.steer = damp(this.steer, clamp(steerTarget, -1, 1), rate, dt);
    this.throttle = damp(this.throttle, clamp01(thrTarget), 16, dt);
    this.brake = damp(this.brake, clamp01(brkTarget), 18, dt);
    this.boost = this._anyDown('boost') || this.touch.boost || !!this.gpBoost;
    this.handbrake = this._anyDown('handbrake') && !this.boost || this.touch.drift || !!this.gpHandbrake;
    this.power = this._anyDown('power') || this.touch.power || !!this.gpPower;
    this.lookback = this._anyDown('lookback') || this._btnEdge.has(4);
    this.throttleAssist();
  }

  throttleAssist() {
    if (!this.assist) return;
    if (this.brake > 0.1) this.throttle = Math.min(this.throttle, 0.25);
  }

  _anyDown(action) {
    const codes = this.binds[action] || [];
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** consume one-shot actions */
  consumeActions() {
    const a = this.actions.slice();
    this.actions.length = 0;
    return a;
  }
  wasPressed(action) {
    const codes = this.binds[action] || [];
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }
  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }

  /** snapshot for the vehicle */
  vehicleInput() {
    return {
      throttle: this.throttle,
      brake: this.brake,
      steer: this.steer,
      boost: this.boost,
      handbrake: this.handbrake,
    };
  }
}
