/* ============================================================
   MAIN — game orchestration: boot, state machine, race rules,
   lap/position logic, collisions, scoring, results.
   ============================================================ */
import { CFG, CARS, TRACKS, CAREER, THEMES, DIFFICULTY, AI_PERSONALITIES, AI_NAMES, BOSSES, POWERS, VERSION } from './config.js';
import { World } from './world.js';
import { Vehicle } from './physics.js';
import { AIDriver } from './ai.js';
import { Powerups } from './powerups.js';
import { CameraController } from './camera.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { HUD } from './hud.js';
import { Menu } from './menu.js';
import { Save, levelProgress, xpForLevel } from './save.js';
import { clamp, clamp01, lerp, damp, rand, randInt, pick, shuffle, chance, fmtTime, fmtNum, ordinal, cssHex, TAU } from './util.js';

const $ = id => document.getElementById(id);
const PTR = { x: 0, y: 0, z: 0 };

class Game {
  constructor() {
    this.state = 'boot';
    this.world = null;
    this.save = new Save();
    this.audio = new AudioEngine();
    this.input = new Input();
    this.vehicles = [];
    this.aiDrivers = [];
    this.player = null;
    this.lapTimes = [];
    this.quickSetup = { track: this.save.settings.lastTrack || 'neon-district', laps: 3, rivals: 5, mode: 'race' };
    this.results = null;
    this.currentEvent = null;
    this.currentEventName = '';
    this.raceTime = 0;
    this.countdownT = 0;
    this.lastCountdown = null;
    this.paused = false;
    this.loopBound = this.loop.bind(this);
    this.lastFrame = 0;
    this.acc = 0;
    this.fps = 60;
    this.frameTimes = [];
    this.tutorialShown = false;
    this.raceFlags = { lapsEnabled: true, laps: 3, mode: 'race', elimTimer: 0, target: 0 };
    this.driftBanked = 0;
    this.rubberBand = 1;
    this.hitCooldowns = new Map();
    this._timeScale = 1;
    this.flags = { boostPulse: 0, damageFlash: 0 };
  }

  /* ============================================================
     BOOT
     ============================================================ */
  async boot() {
    const steps = [
      ['Compiling shaders…', 8],
      ['Generating neon city…', 26],
      ['Tuning suspension…', 46],
      ['Wiring power-ups…', 62],
      ['Synthesising audio…', 78],
      ['Calibrating AI…', 90],
      ['Ready.', 100],
    ];
    const fill = $('loadfill'), text = $('loadtext');
    const progress = async (i, msg, pct) => {
      fill.style.width = pct + '%';
      text.textContent = msg;
      await new Promise(r => setTimeout(r, 26));
    };

    try {
      this.save.ensureDaily();
      this.save.checkAchievements();

      await progress(0, ...steps[0]);
      this.world = new World($('gl'), { antialias: true, preserveDrawingBuffer: true });

      await progress(1, ...steps[1]);
      this.world.loadTrack(TRACKS[0]);

      await progress(2, ...steps[2]);
      this.camera = new CameraController(this.world);
      this.input.init();

      await progress(3, ...steps[3]);
      this.hud = new HUD(this);
      this.menu = new Menu(this);

      await progress(4, ...steps[4]);

      await progress(5, ...steps[5]);
      this.applySettings();

      await progress(6, ...steps[6]);

      // menu backdrop: park the player's car near the line and orbit it
      this.setupBackdrop();

      $('loader').classList.add('hidden');
      this.menu.show('title');
      this.state = 'menu';
      this.lastFrame = performance.now();
      requestAnimationFrame(this.loopBound);

      // unlock audio on first gesture
      const unlock = async () => {
        await this.audio.unlock();
        this.applySettings();
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('touchstart', unlock);
      };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
      window.addEventListener('touchstart', unlock);
      window.addEventListener('resize', () => this.onResize());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.state === 'racing') this.pause();
      });
      if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !location.search.includes('nosw')) {
        navigator.serviceWorker.register('./sw.js').catch(() => { });
      }
    } catch (err) {
      console.error('[boot]', err);
      $('loadtext').innerHTML = 'FAILED TO START — ' + (err?.message || 'unknown error');
      text.style.color = '#ff2b4d';
    }
  }

  applySettings() {
    const s = this.save.settings;
    this.audio.setMaster(s.audio.master);
    this.audio.setSfx(s.audio.sfx);
    this.audio.setMusic(s.audio.music);
    this.audio.setEngine(s.audio.engine);
    this.audio.setMuted(s.audio.muted);
    if (s.audio.musicOn && this.audio.ready) this.audio.startMusic(); else this.audio.stopMusic();
    this.input.sensitivity = s.controls.sensitivity;
    this.input.deadzone = s.controls.deadzone;
    this.input.assist = s.controls.assist;
    this.input.autoThrottle = s.controls.autoThrottle;
    this.applyQuality(s.graphics.quality);
    this.applyAccessibility();
    const gp = s.controls.camMode;
    if (this.camera) this.camera.setMode(gp || 'chase');
  }

  applyQuality(q) {
    if (!this.world) return;
    if (q === 'auto') { this.world.setQuality('high'); this.world.adaptive = true; }
    else { this.world.setQuality(q); this.world.adaptive = false; }
  }

  applyAccessibility() {
    const a = this.save.settings.accessibility;
    document.body.classList.toggle('large-text', a.largeText);
    document.body.classList.toggle('reduce-motion', a.reduceMotion);
    document.body.dataset.colorblind = a.colorblind || 'off';
    if (this.world) this.world.reducedMotion = a.reduceMotion;
  }

  onResize() {
    if (this.menu?.garage) this.menu.garage.onResize();
  }

  /* ============================================================
     BACKDROP (menu orbit)
     ============================================================ */
  setupBackdrop(trackId = null) {
    if (!this.world) return;
    const id = trackId || this.save.settings.lastTrack || 'neon-district';
    this.setMenuBackdrop(id);
    if (!this.backdropCar) {
      const spec = this.save.carSpec();
      const v = new Vehicle({ id: 'backdrop', isPlayer: true, spec, color: spec.color, accent: spec.accent });
      const def = TRACKS.find(t => t.id === 'neon-district');
      const track = this.world.track;
      v.resetAt(track.spline, 8, 0);
      v.speed = 0;
      this.backdropCar = v;
      this.world.addCar(v, { num: 1 });
    }
    this.state = 'menu';
  }

  setMenuBackdrop(trackId) {
    if (!this.world) return;
    if (this.world.trackDef?.id === trackId) return;
    const def = TRACKS.find(t => t.id === trackId) || TRACKS[0];
    this.world.loadTrack(def);
    this.save.settings.lastTrack = trackId;
    this.save.saveSettings();
    if (this.backdropCar) {
      this.backdropCar.resetAt(this.world.track.spline, 8, 0);
    }
  }

  /* ============================================================
     RACE SETUP
     ============================================================ */
  startCareerEvent(ev) {
    const track = TRACKS.find(t => t.id === ev.track);
    const diff = this.save.settings.controls.difficulty;
    const diffMul = DIFFICULTY[diff]?.ai || 1;
    this.launchRace({
      track,
      laps: ev.laps,
      rivals: ev.rivals,
      mode: ev.type === 'elimination' ? 'elim' : ev.type === 'drift' ? 'drift' : ev.type === 'tt' ? 'tt' : 'race',
      aiSkill: ev.ai * diffMul,
      boss: ev.boss || null,
      event: ev,
      eventName: ev.name,
      target: ev.target || 0,
    });
  }

  startQuickRace(setup) {
    const track = TRACKS.find(t => t.id === setup.track) || TRACKS[0];
    const diff = DIFFICULTY[this.save.settings.controls.difficulty] || DIFFICULTY.pro;
    const mode = setup.mode === 'elim' ? 'elim' : setup.mode === 'drift' ? 'drift' : setup.mode === 'tt' ? 'tt' : 'race';
    this.launchRace({
      track,
      laps: mode === 'elim' ? 99 : (setup.laps || 3),
      rivals: mode === 'tt' ? 0 : (setup.rivals ?? 5),
      mode,
      aiSkill: (0.78 + (this.save.profile.level - 1) * 0.004) * diff.ai,
      event: null,
      eventName: 'QUICK RACE',
      target: mode === 'drift' ? 20000 : 0,
    });
  }

  launchRace(opts) {
    this.audio?.uiClick();
    if (this.menu) this.menu.dispose();
    $('menu').classList.add('hidden');
    this.state = 'countdown';
    this.paused = false;
    this.results = null;
    this.currentEvent = opts.event || null;
    this.currentEventName = opts.eventName || 'QUICK RACE';
    this.trackDef = opts.track;
    this.driftBanked = 0;
    this.lapTimes = [];
    this.raceTime = 0;
    this.elimCount = 0;
    this.lastCountdown = null;
    this.raceFlags = {
      lapsEnabled: opts.mode !== 'elim',
      laps: opts.laps || 3,
      mode: opts.mode || 'race',
      elimTimer: 0,
      elimInterval: 20,
      target: opts.target || 0,
      boss: opts.boss || null,
    };

    /* world + track */
    this.world.adaptive = this.save.settings.graphics.quality === 'auto';
    this.world.loadTrack(opts.track);
    this.world.clearCars();
    this.world.particles.clear();
    this.world.post.pulse(0x22e6ff, 0.2);
    this.world.skidMesh.count = 0;
    this.world.skidIdx = 0;

    /* vehicles */
    this.vehicles = [];
    this.aiDrivers = [];
    this.hitCooldowns.clear();
    const total = 1 + (opts.rivals || 0);
    const baseSpec = this.save.carSpec();
    const spec = this.tunedSpec(baseSpec);
    const player = new Vehicle({
      id: 'player', isPlayer: true, spec, color: spec.color, accent: spec.accent,
    });
    player.name = this.save.profile.name || 'YOU';
    player.tcs = this.save.settings.controls.assist !== false;
    this.player = player;
    this.vehicles.push(player);

    /* grid: player starts at the back if rivals > 0, like Blur */
    const gridSlot = (i) => -i * 8.5;
    const gridLateral = (i) => (i % 2 === 0 ? -4.6 : 4.6);
    const startAlong = 6;
    player.resetAt(this.world.track.spline, startAlong + gridSlot(0), gridLateral(0));
    player.nitro = 55;
    // skill tree: nitro bottle size, combo ceiling, damage reduction, drift multipliers
    if (this.skillBonus('nit1')) player.nitroMax = CFG.boost.max + 20;
    player.maxCombo = this.skillBonus('dft3') ? 12 : CFG.drift.maxCombo;
    player.damageResist = this.skillBonus('arm2') ? 0.55 : this.skillBonus('arm1') ? 0.75 : 1;
    player.driftScoreMul = spec.driftScoreMul || 1;
    player.driftNitroMul = spec.driftNitroMul || 1;
    this.world.addCar(player, { num: 1 });

    const personalityPool = shuffle(AI_PERSONALITIES);
    const namePool = shuffle(AI_NAMES);
    const bossSpec = opts.boss ? BOSSES[opts.boss] : null;

    for (let i = 0; i < (opts.rivals || 0); i++) {
      let aiSpec, name, color, accent;
      if (bossSpec && i === 0) {
        aiSpec = CARS.find(c => c.id === bossSpec.car) || CARS[3];
        name = bossSpec.name;
        color = bossSpec.color;
        accent = 0xffffff;
      } else {
        aiSpec = CARS[randInt(0, CARS.length - 1)];
        name = namePool[i % namePool.length];
        color = aiSpec.color;
        accent = aiSpec.accent;
      }
      const v = new Vehicle({
        id: 'ai' + i, isPlayer: false, spec: aiSpec,
        color: color ?? aiSpec.color, accent: accent ?? aiSpec.accent,
      });
      v.name = name;
      v.resetAt(this.world.track.spline, startAlong + gridSlot(i + 1), gridLateral(i + 1));
      v.nitro = 55 + i * 3;
      const isBoss = !!(bossSpec && i === 0);
      const personality = isBoss
        ? { ...personalityPool[i % personalityPool.length], aggression: bossSpec.aggression, name: 'BOSS' }
        : personalityPool[i % personalityPool.length];
      const driver = new AIDriver(v, this.world.track.spline, personality, {
        skill: isBoss ? bossSpec.skill * 0.92 : (opts.aiSkill || 0.8),
        offset: rand(-5, 5),
        isBoss,
      });
      v.ai = driver;
      this.aiDrivers.push(driver);
      this.vehicles.push(v);
      this.world.addCar(v, { num: i + 2 });
    }

    /* leaderboard state */
    for (const v of this.vehicles) {
      v.lap = 0;
      v.place = 1;
      v.progressSinceLine = Math.abs(this.world.track.spline.delta(0, v.trackDist));
      v.finished = false;
      v.totalTime = 0;
      v.lapStart = 0;
      v.eliminated = false;
    }

    /* powerups */
    this.powerups?.clear();
    this.powerups = new Powerups(this.world, this);
    this.audio?.attachEngine(player);
    this.hud.show(true);
    this.hud.setEvent(`${this.currentEventName} · ${opts.track.name}`);
    this.hud.setNemesis(this.raceFlags.boss ? this.raceFlags.boss : null);
    this.hud.buildNitroSegs(3);
    this.camera.stopCinematic();
    this.camera.setMode(this.save.settings.controls.camMode || 'chase');
    this.countdownT = CFG.race.countdown + 0.8;
    this.camera.startCinematic(player, 2.4);
    $('touch').classList.toggle('hidden', !this.isTouchDevice());
    if (this.isTouchDevice()) this.input.touchEnabled = true;

    // music
    this.audio?.setStation(opts.track.music || 'neon');
    this.audio?.setMusicIntensity(0.4);
    if (this.audio?.ready && this.save.settings.audio.musicOn) this.audio.startMusic();
  }

  isTouchDevice() {
    return this.save.settings.controls.touchMode === 'on' ||
      (this.save.settings.controls.touchMode !== 'off' && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
  }

  /* ============================================================
     PAUSE / RESUME / RESTART / QUIT
     ============================================================ */
  pause() {
    if (this.state !== 'racing' && this.state !== 'countdown') return;
    this.paused = true;
    this.prevState = this.state;
    this.state = 'paused';
    this.audio?.suspend();
    this.menu.current = 'pause';
    this.menu.screen = null;
    this.menu.show('pause');
    $('menu').classList.remove('hidden');
    this.hud.show(false);
  }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.state = this.prevState || 'racing';
    this.audio?.resume();
    $('menu').classList.add('hidden');
    this.menu.dispose();
    this.hud.show(true);
    this.lastFrame = performance.now();
  }
  restartRace() {
    const setup = this.lastLaunch;
    this.paused = false;
    if (!setup) { this.quitToMenu(); return; }
    this.launchRace(setup);
  }
  quitToMenu() {
    this.paused = false;
    this.state = 'menu';
    this.audio?.detachEngine();
    this.audio?.resume();
    this.world.clearCars();
    this.world.particles.clear();
    this.powerups?.clear();
    this.powerups = null;
    this.vehicles = [];
    this.aiDrivers = [];
    this.player = null;
    this.hud.show(false);
    $('touch').classList.add('hidden');
    $('menu').classList.remove('hidden');
    this.backdropCar = null;
    this.setupBackdrop();
    this.menu.show('title');
  }

  /* ============================================================
     LOOP
     ============================================================ */
  loop(now) {
    requestAnimationFrame(this.loopBound);
    if (!this.world) return;
    const rawDt = Math.min(0.05, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;
    this.fps = this.fps * 0.9 + (1 / Math.max(rawDt, 0.001)) * 0.1;

    if (this.state === 'menu') {
      this.updateMenuBackdrop(rawDt);
      this.world.render(rawDt);
      this.updateFpsLabel();
      this.input.endFrame();
      return;
    }
    if (this.state === 'paused' || this.state === 'boot') {
      this.world.render(0.016);
      this.input.endFrame();
      return;
    }

    /* post-race: keep the world alive (particles, camera) but stop sim */
    if (this.state === 'finished' || this.state === 'results') {
      if (this.player) {
        this.camera.setLookback(false);
        this.camera.update(rawDt, this.player, {});
        this.world.update(rawDt, this.camera, { vehicles: this.vehicleMap() });
        this.world.post.drive({ speed01: 0, boost: 0, damage: 0 });
      }
      this.world.render(rawDt);
      this.updateFpsLabel();
      this.input.endFrame();
      return;
    }

    /* fixed-step physics for stability */
    this.acc += rawDt;
    const step = 1 / 90;
    let iterations = 0;
    while (this.acc >= step && iterations < 5) {
      this.simulate(step);
      this.acc -= step;
      iterations++;
    }
    if (iterations === 5) this.acc = 0;

    this.updatePresentation(rawDt);
    this.world.render(rawDt);
    this.hud.update(rawDt, this.hudState());
    this.updateFpsLabel();
    this.input.endFrame();
  }

  updateFpsLabel() {
    if (!this.save.settings.graphics.fps) { this.hud?.setFps(''); return; }
    const f = this.world.stats.fps || Math.round(this.fps);
    this.hud?.setFps(`${f} FPS · ${Math.round(this.world.dprScale * 100)}% RES`);
  }

  /* ---------------- menu backdrop ---------------- */
  updateMenuBackdrop(dt) {
    const v = this.backdropCar;
    if (!v) return;
    // idle engine + slow wheel spin for the showroom feel
    v.rpm = 900 + Math.sin(performance.now() * 0.0014) * 120;
    v.throttle = 0.05;
    v.speed = 0;
    this.world.update(dt, null, { vehicles: new Map([['backdrop', v]]) });
    this.camera.orbit(v, dt);
    this.world.post.drive({ speed01: 0.12, boost: 0, damage: 0 });
  }

  /* ---------------- simulation ---------------- */
  simulate(dt) {
    const W = this.world;
    const track = W.track.spline;
    const mode = this.raceFlags.mode;

    if (this.state === 'countdown') {
      this.countdownT -= dt;
      const c = Math.ceil(this.countdownT - 0.8);
      const label = this.countdownT > 0.8 ? c : 0;
      if (label !== this.lastCountdown && label >= 0 && label <= 3) {
        this.lastCountdown = label;
        if (label > 0) { this.hud.setCountdown(String(label)); this.audio?.countdown(label); }
        else { this.hud.setCountdown('GO', true); this.audio?.countdown(0); this.camera.stopCinematic(); }
      }
      if (this.countdownT <= 0) {
        this.state = 'racing';
        this.hud.setCountdown(null);
        this.raceStartTime = performance.now();
        this.toast('GO!', 'good');
      }
      // rev the player engine during the countdown
      this.player.rpm = 900 + this.input.throttle * 6200;
      this.updateCarsVisualOnly(dt);
      this.updateInputActions(true);
      return;
    }

    if (this.state !== 'racing') return;

    this.raceTime += dt;

    /* ---- inputs ---- */
    this.updateInputActions(false);
    const pInput = this.input.vehicleInput();
    const ctx = {
      world: W,
      track: W.track,
      player: this.player,
      vehicles: this.vehicles,
      rubberBand: this.rubberBand,
      maxCombo: this.player.maxCombo || CFG.drift.maxCombo,
      driftNitroMul: this.player.driftNitroMul || 1,
      onTaunt: (v, line) => this.onTaunt(v, line),
      usePower: (v) => this.usePower(v),
      onComboStep: (v, c) => this.onComboStep(v, c),
    };
    if (!this.player.finished) {
      this.player.autoThrottle = this.input.autoThrottle;
      this.player.update(dt, pInput, ctx);
    }

    /* ---- AI ---- */
    for (const d of this.aiDrivers) {
      if (d.v.finished || d.v.eliminated) continue;
      if (d.v.stunned > 0) { /* still integrate */ }
      const inp = d.update(dt, ctx);
      d.v.update(dt, inp, W);
    }

    /* ---- physics interactions ---- */
    for (const v of this.vehicles) {
      if (v.eliminated) continue;
      this.applyTrackBounds(v, dt);
      this.applyBoostPads(v, dt);
      this.applyRamps(v);
      this.applySlipstream(v);
      this.updateNitroRegen(v, dt);
      if (v.boosting && !v.isPlayer) v.nitro -= 4 * dt;
    }
    this.resolveCarCollisions(dt);
    this.updateProgress(dt);
    this.updatePositions();
    this.powerups?.update(dt, this.vehicles, this.player);
    this.applyDriftScoring(dt);
    this.updateWallEffects(dt);
    this.checkEliminations(dt);
    this.checkRaceEnd(dt);
    this.updateAudio(dt);
    this.updateRubberBand();
  }

  updateCarsVisualOnly(dt) {
    for (const v of this.vehicles) {
      v.rpm = damp(v.rpm, 900 + Math.random() * 40, 6, dt);
    }
  }

  updateInputActions(preRace) {
    const acts = this.input.consumeActions();
    for (const a of acts) {
      if (a === 'pause') { if (!preRace) this.pause(); }
      else if (a === 'cam') { const m = this.camera.cycleMode(); this.save.settings.controls.camMode = m; this.save.saveSettings(); this.toast('CAMERA: ' + m.toUpperCase()); }
      else if (a === 'power') { if (!preRace) this.usePower(this.player); }
      else if (a === 'reset') { if (!preRace) { this.player.recover(this.world.track.spline); this.toast('RECOVERED'); } }
      else if (a === 'lookback') { /* handled in presentation via input.lookback */ }
    }
    if (!preRace && this.input.wasPressed('pause')) this.pause();
  }

  /* ---------------- track bounds ---------------- */
  applyTrackBounds(v, dt) {
    const track = this.world.track.spline;
    const near = track.nearest(v.pos.x, v.pos.z);
    const limit = CFG.track.halfWidth + 0.55;
    if (Math.abs(near.off) > limit) {
      const n = track.normalAt(near.along);
      const sign = Math.sign(near.off);
      // push back onto the road
      const overshoot = Math.abs(near.off) - limit;
      v.pos.x -= n.x * sign * overshoot;
      v.pos.z -= n.z * sign * overshoot;
      v.collideWall(-n.x * sign, -n.z * sign, this.world);
      if (v.speedPenalty) { v.speedPenalty = 0; }
      // scrub speed when scraping
      if (v.speed > 12 && Math.random() < dt * 12) {
        this.world.particles.spark(v.pos.x, v.pos.y + 0.5, v.pos.z, 4, 6);
        if (v.isPlayer) this.audio?.wallScrape(1);
      }
      v.cleanLap = false;
    }
  }

  /* ---------------- boost pads ---------------- */
  applyBoostPads(v, dt) {
    const track = this.world.track;
    v.boostPadCooldown = Math.max(0, v.boostPadCooldown - dt);
    if (v.boostPadCooldown > 0) return;
    const near = track.spline.nearest(v.pos.x, v.pos.z);
    const pad = track.padAt(v.pos.x, v.pos.z, near.along);
    if (pad && Math.abs(near.off) < pad.halfW) {
      v.addNitro(CFG.boost.padGain);
      v.boostPadCooldown = 1.2;
      v.boosting = true;
      v.boostTime = 0;
      v.speedBoost = 1;
      if (v.isPlayer) {
        this.audio?.boostStart();
        this.hud.flash(0x22e6ff, 0.22);
        this.toast('BOOST PAD', 'good');
      }
      this.world.particles.boostFlame(v.pos.x, v.pos.y + 0.4, v.pos.z, 0, 3, 0, 0x22e6ff);
    }
  }

  /* ---------------- ramps ---------------- */
  applyRamps(v) {
    if (v.airborne) return;
    const track = this.world.track;
    const near = track.spline.nearest(v.pos.x, v.pos.z);
    const ramp = track.rampAt(near.along, near.off, v.pos.y);
    if (ramp && v.speed > 14) {
      const now = performance.now();
      if (!v._lastRamp || now - v._lastRamp > 1500) {
        v._lastRamp = now;
        v.airborne = true;
        v.airTime = 0;
        v.vy = Math.min(20, v.speed * 0.23 + ramp.launch * 0.45);
        v.pos.y = Math.max(v.pos.y, ramp.mesh.position.y + 1.6);
        this.world.particles.shockRing(v.pos.x, v.pos.y, v.pos.z, 0x22e6ff);
        if (v.isPlayer) { this.toast('LAUNCH!', 'good'); this.audio?.boostStart(); }
      }
    }
  }

  /* ---------------- slipstream / drafting ---------------- */
  applySlipstream(v) {
    v.slipBoost = 0;
    if (v.airborne) return;
    const track = this.world.track.spline;
    for (const o of this.vehicles) {
      if (o === v || o.eliminated) continue;
      const gap = track.delta(v.trackDist, o.trackDist);
      if (gap > 3 && gap < 22) {
        const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 9) {
          const dot = (dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw)) / (dist || 1);
          if (dot > 0.9 && o.speed > v.speed * 0.8) {
            v.slipBoost = 5.5;
            v.slipstream = true;
            if (v.isPlayer) this.hud.setEvent(`${this.currentEventName} · DRAFTING`);
            return;
          }
        }
      }
    }
    v.slipstream = false;
  }

  updateNitroRegen(v, dt) {
    if (v.boosting) return;
    // slow passive regen + faster while drafting
    const regen = (v.slipstream ? 3.4 : 0.9);
    v.addNitro(regen * dt);
  }

  /* ---------------- car vs car ---------------- */
  resolveCarCollisions(dt) {
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      if (a.eliminated) continue;
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (b.eliminated) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const dy = Math.abs(b.pos.y - a.pos.y);
        if (dy > 2.4) continue;
        const d2 = dx * dx + dz * dz;
        const R = 2.0;
        if (d2 > R * R || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const overlap = R - d;
        const ma = a.spec.mass, mb = b.spec.mass;
        const totalM = ma + mb;
        // separate
        a.pos.x -= nx * overlap * (mb / totalM);
        a.pos.z -= nz * overlap * (mb / totalM);
        b.pos.x += nx * overlap * (ma / totalM);
        b.pos.z += nz * overlap * (ma / totalM);
        // relative velocity along the normal
        const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
        const vn = rvx * nx + rvz * nz;
        if (vn < 0) {
          const impact = -vn;
          const impulse = impact * 1.35;
          a.vx -= nx * impulse * (mb / totalM);
          a.vz -= nz * impulse * (mb / totalM);
          b.vx += nx * impulse * (ma / totalM);
          b.vz += nz * impulse * (ma / totalM);
          if (impact > 2.2) {
            this.onCarContact(a, b, impact, nx, nz);
          }
        }
      }
    }
  }

  onCarContact(a, b, impact, nx, nz) {
    const now = performance.now();
    const key = [a.id, b.id].sort().join('|');
    const last = this.hitCooldowns.get(key) || 0;
    if (now - last < 380) return;
    this.hitCooldowns.set(key, now);

    const player = a.isPlayer ? a : b.isPlayer ? b : null;
    const other = a.isPlayer ? b : a;
    if (player) {
      const dmg = clamp(impact * 1.4, 0, 26);
      player.hit(dmg, other);
      player.vx *= 0.94; player.vz *= 0.94;
      this.camera.addShake(clamp(impact * 0.03, 0.1, 0.7));
      this.audio?.impact(clamp(impact / 12, 0.3, 1.6), 'metal');
      this.world.particles.spark(
        (player.pos.x + other.pos.x) / 2, player.pos.y + 0.7, (player.pos.z + other.pos.z) / 2,
        8 + impact, 7);
      this.hud.popup('CONTACT', 'miss');
      this.flags.damageFlash = 0.5;
      if (this.save.settings.accessibility.haptics) this.rumble(clamp(impact / 20, 0.2, 1));
      // aggressive AI gets a taunt
      if (other.ai && other.ai.aggression > 0.7 && chance(0.4)) this.onTaunt(other, pick(other.ai.p.taunt));
    }
    // AI vs AI
    if (!a.isPlayer && !b.isPlayer) {
      this.world.particles.spark((a.pos.x + b.pos.x) / 2, a.pos.y + 0.6, (a.pos.z + b.pos.z) / 2, 6, 6);
    }
  }

  rumble(strength) {
    const gp = navigator.getGamepads?.() || [];
    for (const p of gp) {
      if (p && p.vibrationActuator) {
        try {
          p.vibrationActuator.playEffect('dual-rumble', {
            duration: 120 + strength * 200, strongMagnitude: strength, weakMagnitude: strength * 0.6,
          });
        } catch (e) { }
      }
    }
    if (navigator.vibrate) navigator.vibrate(Math.round(strength * 40));
  }

  /* ---------------- laps & progress ---------------- */
  updateProgress(dt) {
    const track = this.world.track.spline;
    const L = track.length;
    for (const v of this.vehicles) {
      if (v.eliminated) continue;
      const prev = v.trackDist;
      const near = track.nearest(v.pos.x, v.pos.z);
      v.trackDist = near.along;
      const delta = track.delta(prev, v.trackDist);
      v.progressSinceLine += delta;
      if (v.progressSinceLine > L) {
        v.progressSinceLine -= L;
        this.onLapComplete(v);
      }
      // wrong way detection
      v.wrongWay = delta < -0.2 && v.speed > 6;
      if (v.wrongWay && v.isPlayer) {
        if (!this._wrongWayToast || performance.now() - this._wrongWayToast > 2500) {
          this._wrongWayToast = performance.now();
          this.toast('WRONG WAY', 'hot');
        }
      }
    }
  }

  onLapComplete(v) {
    if (v.finished) return;
    const track = this.world.track.spline;
    v.lap++;
    const lapTime = this.raceTime - v.lapStart;
    v.lapStart = this.raceTime;
    if (v.lap > 0 && lapTime > 4) {
      v.lastLapTime = lapTime;
      if (!v.bestLap || lapTime < v.bestLap) v.bestLap = lapTime;
    }
    if (v.isPlayer) {
      if (v.cleanLap) this.save.profile.stats.cleanLaps++;
      this.save.profile.stats.laps++;
      v.cleanLap = true;
      v.wallHits = 0;
      this.audio?.lap();
      if (this.save.profile.stats.laps % 3 === 0) this.save.save();
      const laps = this.raceFlags.laps;
      if (this.raceFlags.lapsEnabled && v.lap >= laps) {
        this.finishVehicle(v);
      } else if (this.raceFlags.mode === 'tt' && v.lap >= this.raceFlags.laps) {
        this.finishVehicle(v);
      } else {
        this.toast(`LAP ${Math.min(v.lap + 1, laps)} / ${laps} · ${fmtTime(lapTime)}`, v.lastLapTime && lapTime <= v.bestLap ? 'good' : '');
        this.hud.flash(0xffffff, 0.12);
      }
    } else {
      if (this.raceFlags.lapsEnabled && v.lap >= this.raceFlags.laps) this.finishVehicle(v);
    }
    this.hud?.buildNitroSegs(this.raceFlags.lapsEnabled ? this.raceFlags.laps : 3);
    this.hud.updateNitroSegs(this.player ? this.player.lap : 0);
  }

  finishVehicle(v) {
    if (v.finished) return;
    v.finished = true;
    v.finishTime = this.raceTime;
    v.totalTime = this.raceTime;
    if (v.isPlayer) {
      this.onPlayerFinished();
    } else {
      // AI presses on for a bit but stops counting
      v.ai && (v.ai.finishedAt = this.raceTime);
    }
  }

  onPlayerFinished() {
    this.state = 'finished';
    this.hud.setCountdown(null);
    $('touch').classList.add('hidden');
    const place = this.player.place;
    const win = place === 1;
    this.audio?.detachEngine();
    this.audio?.finish(win);
    // rewards
    const ev = this.currentEvent;
    const p = this.save.profile;
    p.stats.races++;
    p.stats.eventsDone++;
    if (win) p.stats.wins++;
    if (place <= 3) p.stats.podiums++;
    p.stats.driftTotal += this.driftBanked;
    p.stats.bestCombo = Math.max(p.stats.bestCombo, this.player.stats.maxCombo);
    p.stats.topSpeed = Math.max(p.stats.topSpeed, Math.round(this.player.stats.topSpeed * 3.6));
    p.stats.distance += this.world.track.spline.length * (this.player.lap + 1);
    p.stats.airTime = Math.max(p.stats.airTime, this.player.stats.airTime);

    const baseReward = ev ? ev.reward : 600;
    const placeMul = [1, 0.65, 0.45, 0.3, 0.22, 0.18, 0.15, 0.12][Math.min(place - 1, 7)];
    const coins = Math.round(baseReward * placeMul * (1 + (p.level - 1) * 0.01));
    const xp = Math.round((ev ? ev.reward * 0.6 : 420) * placeMul + this.driftBanked * 0.03);
    const rep = ev ? Math.round(ev.rep * placeMul) : 0;
    p.reputation += rep;
    this.save.addCoins(coins);
    const levels = this.save.addXp(xp);
    this.save.addSeasonXp(xp);
    this.save.dailyProgress('races', 1);
    if (win) this.save.dailyProgress('wins', 1);
    if (this.driftBanked) this.save.dailyProgress('drift', this.driftBanked);

    // event record
    let nextEvent = null;
    if (ev) {
      const rec = p.career[ev.id] || { stars: 0, bestTime: Infinity, wins: 0 };
      const stars = this.starsFor(place, win);
      rec.stars = Math.max(rec.stars, stars);
      rec.bestTime = Math.min(rec.bestTime, v0(this.player.finishTime));
      if (win) rec.wins++;
      p.career[ev.id] = rec;
      const idx = CAREER.findIndex(e => e.id === ev.id);
      if (win && idx >= 0 && idx + 1 < CAREER.length) nextEvent = CAREER[idx + 1];
      if (ev.type === 'boss' && win) { p.stats.bossWins++; if (!p.stats.bossBeaten.includes(ev.boss)) p.stats.bossBeaten.push(ev.boss); }
      if (ev.type === 'elimination' && win) p.stats.eliminationsWon++;
    }

    // time trial best
    if (this.raceFlags.mode === 'tt') {
      const best = this.save.recordTime(this.trackDef.id, this.player.finishTime);
      if (best) this.save.award('perfect_tt');
    }

    this.save.save();
    const ach = this.save.checkAchievements(this);
    if (ach.length) this.toast('ACHIEVEMENT: ' + ach[0].name, 'good');

    this.results = {
      place,
      finished: true,
      eventName: this.currentEventName,
      trackName: this.trackDef.name,
      totalTime: this.player.finishTime,
      bestLap: this.player.bestLap,
      drift: this.driftBanked,
      standings: this.standings(),
      rewards: [
        { label: 'PRIZE', value: '◈' + fmtNum(coins) },
        { label: 'XP', value: '+' + fmtNum(xp) },
        { label: 'REP', value: '+' + rep },
        { label: 'DRIFT', value: fmtNum(this.driftBanked) },
        ...(levels > 0 ? [{ label: 'LEVEL UP', value: 'LV ' + p.level }] : []),
      ],
      nextEvent,
      onAgain: () => this.restartRace(),
      onNext: () => { if (nextEvent) { this.launchFromEvent(nextEvent); } },
    };
    setTimeout(() => {
      if (this.state !== 'finished') return;
      this.showResults(this.results);
    }, 1400);
  }

  launchFromEvent(ev) {
    this.startCareerEvent(ev);
  }

  starsFor(place, win) {
    if (place === 1) return 3;
    if (win || place <= 2) return 2;
    if (place <= 3) return 1;
    return 0;
  }

  standings() {
    return this.ranked().map(v => ({
      name: v.name, color: v.color, isPlayer: v.isPlayer,
      totalTime: v.finished ? v.totalTime : this.raceTime,
      bestLap: v.bestLap, finished: v.finished,
    }));
  }

  ranked() {
    const arr = this.vehicles.slice();
    arr.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      if (a.eliminated && !b.eliminated) return 1;
      if (b.eliminated && !a.eliminated) return -1;
      return b.progressSinceLine - a.progressSinceLine;
    });
    return arr;
  }

  updatePositions() {
    const arr = this.ranked();
    arr.forEach((v, i) => { v.place = i + 1; });
  }

  /* ---------------- drift scoring ---------------- */
  applyDriftScoring(dt) {
    const v = this.player;
    if (!v) return;
    v.bankFlash = Math.max(0, (v.bankFlash || 0) - dt * 2);
    if (v.drifting) {
      this.hud.setSpeedlines(v.combo >= 3);
      if (this.world.post) this.world.post.drive({ speed01: clamp01(v.speed / (v.spec.speed * 1.1)), boost: v.boosting ? 1 : 0, damage: v.damage / 100, wobble: v.gripLost * 0.3 });
    }
  }

  /** called by physics when a drift step raises the combo */
  onComboStep(v, combo) {
    if (!v.isPlayer) return;
    this.hud.popup(`x${combo} COMBO`, combo >= 5 ? '' : 'nitro');
    this.hud.flash(0xc6ff2b, 0.16);
    if (combo >= 3) this.camera.addShake(0.1);
    this.save.dailyProgress('drift', 0);
  }

  /** bank the drift when the player stops drifting (called from presentation) */
  bankDrift(v) {
    if (!v || v.driftScore < 40) { if (v) v.driftScore = 0; return; }
    const pts = Math.round(v.driftScore * v.combo);
    this.driftBanked += pts;
    this.save.profile.stats.bestDrift = Math.max(this.save.profile.stats.bestDrift, pts);
    this.save.profile.stats.driftTotal += pts;
    this.save.dailyProgress('drift', pts);
    this.hud.popup(`+${fmtNum(pts)}`, 'nitro');
    v.nitro = clamp(v.nitro + 8 + v.combo * 2, 0, v.nitroMax);
    v.driftScore = 0;
    v.combo = 1;
    v.bankFlash = 1;
    this.audio?.pickup();
    if (pts > 2500) this.save.award('first_drift');
    if (v.stats.maxCombo >= 5) this.save.award('combo5');
    this.save.checkAchievements();
  }

  /* ---------------- eliminations ---------------- */
  checkEliminations(dt) {
    if (this.raceFlags.mode !== 'elim') return;
    this.raceFlags.elimTimer += dt;
    if (this.raceFlags.elimTimer >= this.raceFlags.elimInterval) {
      this.raceFlags.elimTimer = 0;
      const alive = this.vehicles.filter(v => !v.eliminated && !v.finished);
      if (alive.length <= 1) return;
      const ranked = this.ranked().filter(v => !v.eliminated && !v.finished);
      const last = ranked[ranked.length - 1];
      if (!last) return;
      last.eliminated = true;
      last.finished = true;
      last.finishTime = this.raceTime;
      last.totalTime = this.raceTime;
      this.elimCount++;
      this.world.particles.explosion(last.pos.x, last.pos.y + 1, last.pos.z, 1.4);
      this.audio?.explode();
      if (last.isPlayer) {
        this.toast('ELIMINATED', 'hot');
        this.state = 'finished';
        this.player.finalPlace = ranked.length;
        this.results = {
          place: ranked.length, finished: false,
          eventName: this.currentEventName, trackName: this.trackDef.name,
          standings: this.standings(),
          rewards: [{ label: 'PRIZE', value: '◈' + fmtNum(Math.round(this.driftBanked * 0.1)) }],
          onAgain: () => this.restartRace(),
        };
        this.save.addCoins(Math.round(this.driftBanked * 0.1));
        setTimeout(() => this.showResults(this.results), 900);
      } else {
        this.toast(`${last.name} ELIMINATED`, 'hot');
        this.hud.popup('ELIMINATED', 'miss');
        this.world.removeCar(last.id);
      }
      this.camera.addShake(0.3);
    }
  }

  /* ---------------- race end ---------------- */
  checkRaceEnd(dt) {
    if (this.state !== 'racing') return;
    if (this.raceFlags.mode === 'elim') {
      const alive = this.vehicles.filter(v => !v.eliminated && !v.finished);
      if (this.player.eliminated) return;
      if (alive.length <= 1 && alive[0] === this.player) {
        // survive to the end: convert to a finish
        this.player.finished = true;
        this.player.finishTime = this.raceTime;
        this.onPlayerFinished();
      }
      return;
    }
    if (this.raceFlags.mode === 'drift') {
      const target = this.raceFlags.target || 20000;
      if (this.driftBanked >= target) {
        this.player.finished = true;
        this.player.finishTime = this.raceTime;
        this.toast('TARGET REACHED', 'good');
        this.onPlayerFinished();
      }
    }
  }

  /* ---------------- power-ups ---------------- */
  onPowerPickup(p) {
    this.audio?.pickup();
    const spec = POWERS[p];
    this.toast(`${spec.icon} ${spec.name}`, 'good');
    this.hud.flash(0x22e6ff, 0.16);
    this.save.profile.stats.nitroUses += p === 'nitro' ? 0 : 0;
  }

  usePower(v) {
    if (!v || !v.power) return;
    const p = v.power;
    const ok = this.powerups.fire(v, p);
    if (!ok) return;
    if (v.isPlayer) {
      if (p === 'nitro') { this.toast('NITRO!', 'good'); this.hud.flash(0x22e6ff, 0.3); this.camera.addShake(0.18); }
      if (p === 'shock') this.toast('SHOCK FIRED', 'hot');
      if (p === 'shunt') this.toast('SHUNT FIRED', 'hot');
      if (p === 'shield') this.toast('SHIELD UP', 'good');
      if (p === 'repair') this.toast('REPAIRED', 'good');
      if (p === 'bolt') this.toast('BOLT FIRED', 'hot');
      if (p === 'nitro') this.save.profile.stats.nitroUses++;
      this.save.profile.stats.shunts += (p === 'shunt' || p === 'shock' || p === 'bolt') ? 1 : 0;
      this.save.dailyProgress('nitro', p === 'nitro' ? 1 : 0);
      if (p === 'shunt') this.save.dailyProgress('shunts', 1);
      this.save.checkAchievements();
    }
    this.hud.updateNitroSegs(0);
  }

  onHit(victim, attacker, kind) {
    if (kind === 'blocked') {
      if (victim.isPlayer) this.toast('BLOCKED!', 'good');
      return;
    }
    if (victim.isPlayer) {
      this.camera.addShake(0.55);
      this.hud.flash(0xb00030, 0.4);
      this.flags.damageFlash = 1;
      this.hud.popup('HIT!', 'miss');
      if (this.save.settings.accessibility.haptics) this.rumble(0.9);
      this.save.profile.stats.hitsTaken++;
      this.save.checkAchievements();
    } else if (attacker && attacker.isPlayer) {
      this.toast(`HIT ${victim.name}`, 'hot');
      this.hud.popup('HIT!', 'nitro');
      this.camera.addShake(0.22);
      if (victim.ai) this.onTaunt(victim, pick(['Ugh!', 'Lucky shot.', 'You will pay for that.']));
    }
  }

  onTaunt(v, line) {
    if (!line) return;
    // only surface taunts for nearby cars
    if (this.player && Math.abs(this.world.track.spline.delta(v.trackDist, this.player.trackDist)) < 60) {
      this.hud.toast(`${v.name}: "${line}"`, 'hot');
      this.audio?.taunt();
    }
  }

  onWallHitImpact() { }

  /** has the player learned a skill? (used by power-ups / physics) */
  skillBonus(id) { return this.save.skillRank(id) > 0; }

  /** effective car spec with skill tree + upgrades applied */
  tunedSpec(base) {
    const spec = { ...base };
    const has = (id) => this.save.skillRank(id) > 0;
    const up = this.save.upgradesFor(base.id || this.save.profile.currentCar);
    if (has('top1')) spec.speed *= 1.04;
    if (has('top2')) spec.speed *= 1.04;
    if (has('top3')) spec.speed *= 1.06;
    if (has('acc1')) spec.accel *= 1.07;
    if (has('acc2')) spec.accel *= 1.08;
    if (has('grip1')) spec.grip *= 1.05;
    if (has('dft1')) spec.driftScoreMul = 1.15;
    if (has('nit2')) spec.driftNitroMul = 1.3;
    spec.speed *= 1 + up.engine * 0.03;
    spec.accel *= 1 + up.engine * 0.035;
    spec.grip *= 1 + up.tires * 0.03;
    return spec;
  }

  updateWallEffects(dt) {
    const p = this.player;
    if (!p) return;
    if (p.drifting && !p.airborne && p.speed > 8) {
      // skid marks at the rear wheels
      const b = this.world.track;
      const sinY = Math.sin(p.yaw), cosY = Math.cos(p.yaw);
      for (const side of [-1, 1]) {
        const wx = p.pos.x + cosY * 0.98 * side - sinY * 1.46;
        const wz = p.pos.z - sinY * 0.98 * side - cosY * 1.46;
        this.world.addSkid(wx, p.groundY, wz, p.yaw, clamp01(p.lateralVel / 12));
      }
      // tire smoke
      if (Math.random() < dt * 40) {
        const wet = this.world.wetness > 0.4;
        const wx = p.pos.x - sinY * 1.5, wz = p.pos.z - cosY * 1.5;
        this.world.particles.tireSmoke(wx, p.groundY, wz, p.vx, p.vz, clamp01(Math.abs(p.lateralVel) / 10), wet);
      }
      if (Math.random() < dt * 8) this.audio?.tireScreech(clamp01(Math.abs(p.lateralVel) / 10));
    }
    // off-road dust
    if (p.surface !== 'road' && p.surface !== 'wet' && p.speed > 10 && Math.random() < dt * 24) {
      this.world.particles.dust(p.pos.x, p.groundY, p.pos.z, p.vx, p.vz,
        this.trackDef?.theme === 'snow' ? 0xffffff : this.trackDef?.theme === 'desert' ? 0xc9a06a : 0x6a7a5a);
    }
    // wet splashes
    if (this.world.wetness > 0.5 && p.speed > 16 && Math.random() < dt * 18) {
      this.world.particles.splash(p.pos.x, p.groundY, p.pos.z, p.vx, p.vz);
    }
  }

  updateAudio(dt) {
    const p = this.player;
    if (!p) return;
    this.audio?.updateEngine(p, dt, true);
    // music intensity follows action
    if (this.audio?._music) {
      const intensity = clamp01(0.35 + (p.speed / (p.spec.speed * 1.2)) * 0.45 + (p.boosting ? 0.2 : 0) + (p.combo - 1) * 0.03);
      this.audio.setMusicIntensity(intensity);
    }
  }

  updateRubberBand() {
    // difficulty assist: if the player is far behind, ease the AI; far ahead, push them
    const p = this.player;
    if (!p) return;
    const leader = this.ranked()[0];
    if (!leader) return;
    const gap = this.world.track.spline.delta(p.trackDist, leader.trackDist);
    this.rubberBand = clamp(1 + gap / 500, 0.55, 1.6);
  }

  /* ============================================================
     PRESENTATION (once per rendered frame)
     ============================================================ */
  updatePresentation(dt) {
    const p = this.player;
    if (!p) return;
    const W = this.world;

    // bank drift score when a drift ends
    if (this._wasDrifting && !p.drifting) this.bankDrift(p);
    this._wasDrifting = p.drifting;
    // combo timeout also banks
    if (p.driftScore > 0 && !p.drifting && p.combo <= 1) this.bankDrift(p);
    if (p.spinOut > 0 || p.stunned > 0) p.driftScore = 0;

    // camera
    this.camera.setLookback(this.input.lookback);
    this.camera.update(dt, p, { ballCam: false });
    // cinematic during the countdown from a different angle
    if (this.state === 'countdown' && this.camera.cinematic) { /* camera handles it */ }

    // post FX
    const speed01 = clamp01(p.speed / (p.spec.speed * 1.05));
    const dmg = clamp01(p.damage / 100);
    W.post.drive({
      speed01,
      boost: p.boosting ? 1 : 0,
      damage: dmg * 0.85,
      wobble: p.gripLost * 0.4 + (p.spinOut > 0 ? 0.6 : 0),
      flash: this.flags.boostPulse,
      flashColor: 0x22e6ff,
    });
    this.flags.damageFlash = Math.max(0, this.flags.damageFlash - dt * 1.4);

    // HUD side effects
    this.hud.setSpeedlines(p.boosting || speed01 > 0.92);
    this.hud.updateNitroSegs(this.raceFlags.lapsEnabled ? p.lap : 0);
    if (this.state === 'racing') {
      this.hud.setEvent(`${this.currentEventName}${p.slipstream ? ' · DRAFTING' : ''}${this.raceFlags.mode === 'elim' ? ' · ELIMINATION IN ' + Math.ceil(this.raceFlags.elimInterval - this.raceFlags.elimTimer) + 's' : ''}`);
    }

    // world tick (particles, weather, sky, cars)
    W.update(dt, this.camera, { vehicles: this.vehicleMap() });

    // crowd / weather audio ambience
    this.ambienceTimer = (this.ambienceTimer || 0) + dt;
    if (this.ambienceTimer > 1) {
      this.ambienceTimer = 0;
      if (this.trackDef?.weather === 'water' || this.trackDef?.weather === 'rain') { /* noop */ }
    }
  }

  vehicleMap() {
    if (!this._vmap) this._vmap = new Map();
    this._vmap.clear();
    for (const v of this.vehicles) this._vmap.set(v.id, v);
    return this._vmap;
  }

  /* ---------------- results ---------------- */
  showResults(res) {
    this.state = 'results';
    $('menu').classList.remove('hidden');
    this.hud.show(false);
    this.menu.show('results', res);
  }

  /* ---------------- helpers ---------------- */
  toast(text, kind = '') {
    if (this.hud) this.hud.toast(text, kind);
  }

  flash(color, amt) {
    if (this.hud) this.hud.flash(color, amt);
    this.world?.post?.pulse(typeof color === 'number' ? color : 0xffffff, amt);
  }

  hudState() {
    return {
      player: this.player,
      vehicles: this.vehicles,
      raceTime: this.raceTime,
      laps: this.raceFlags.laps,
      lapsEnabled: this.raceFlags.lapsEnabled,
      trackBuild: this.world.track,
      powerups: this.powerups,
      mode: this.raceFlags.mode,
    };
  }

  async enableGyro() {
    return this.input.enableGyro();
  }
}

function v0(x) { return isFinite(x) ? x : Infinity; }

export { Game };
