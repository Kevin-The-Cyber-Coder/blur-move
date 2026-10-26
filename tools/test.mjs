/* Headless verification harness — launches Chrome with inherited stdio and
   drives it over CDP (the sandbox blocks piped child stdio / puppeteer).
   Usage: node tools/test.mjs */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'test-shots');
const PORT = 8399;
const CDP_PORT = 9333;
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = path.join(ROOT, '.chrome-test-profile');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  await mkdir(SHOTS, { recursive: true });
  for (const f of await readdir(SHOTS).catch(() => [])) await rm(path.join(SHOTS, f));
  await rm(PROFILE, { recursive: true, force: true });

  /* ---- static server ---- */
  const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs')], {
    env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  let up = false;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    try { const r = await fetch(URL + 'index.html'); if (r.ok) { up = true; break; } } catch (e) { }
  }
  if (!up) { console.error('server failed to start'); server.kill(); process.exit(1); }

  /* ---- chrome ---- */
  const chromeArgs = [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--window-size=1280,720', '--hide-scrollbars', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    'about:blank',
  ];
  const chrome = spawn(CHROME, chromeArgs, { stdio: 'ignore' });
  chrome.on('exit', c => { if (c && !globalThis.__done) console.log('chrome exited', c); });

  let cdp;
  try {
    cdp = await CDP.connect(CDP_PORT, 30000);
  } catch (e) {
    console.error('could not attach to chrome:', e.message);
    chrome.kill(); server.kill(); process.exit(1);
  }

  const logs = { errors: [], warnings: [], logs: [] };
  cdp.on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args || []).map(a => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ');
    if (p.type === 'error') logs.errors.push(text);
    else if (p.type === 'warning') logs.warnings.push(text);
    else logs.logs.push(text);
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails;
    logs.errors.push('EXCEPTION: ' + (d.exception?.description || d.text || '') + ' @' + (d.url || '') + ':' + (d.lineNumber ?? ''));
  });
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error') logs.errors.push('LOG: ' + p.entry.text + ' ' + (p.entry.url || ''));
  });
  cdp.on('Network.loadingFailed', (p) => {
    if (p.errorText !== 'net::ERR_ABORTED') logs.errors.push('NETFAIL: ' + p.errorText + ' ' + (p.blockedReason || ''));
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  const results = { steps: [], shots: [], logs };
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const out = await fn();
      results.steps.push({ name, ok: true, ms: Date.now() - t0, out });
      console.log(`  + ${name} (${Date.now() - t0}ms)` + (out !== undefined ? ' :: ' + JSON.stringify(out).slice(0, 260) : ''));
      return out;
    } catch (e) {
      results.steps.push({ name, ok: false, ms: Date.now() - t0, error: String(e && e.message || e) });
      console.log(`  X ${name}: ${String(e.message).slice(0, 400)}`);
      return null;
    }
  };
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
    results.shots.push(name);
  };
  const ev = (expr, opts) => cdp.evaluate(expr, opts);
  const waitFn = async (expr, timeout = 90000, pollMs = 200) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await ev(expr)) return true; } catch (e) { /* page may be mid-nav */ }
      await sleep(pollMs);
    }
    throw new Error('waitFn timeout: ' + expr.slice(0, 120));
  };

  console.log('\n> booting', URL);
  await cdp.send('Page.navigate', { url: URL });

  await step('boot completes', async () => {
    await waitFn('window.__NEONRUSH__ && window.__NEONRUSH__.state === "menu"', 120000);
    return await ev(`(() => { const g = window.__NEONRUSH__;
      return { state: g.state, cars: g.world.carMeshes.size, track: g.world.trackDef.id,
        len: Math.round(g.world.track.spline.length),
        gl: g.world.renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl1',
        programs: g.world.renderer.info.programs.length }; })()`);
  });
  await sleep(1500);
  await shot('01-title');

  await step('menu screens', async () => {
    const names = ['career', 'quick', 'garage', 'skills', 'achievements', 'settings', 'livery', 'help'];
    const out = {};
    for (const n of names) {
      await ev(`window.__NEONRUSH__.menu.show('${n}')`);
      await sleep(n === 'garage' || n === 'livery' ? 1500 : 350);
      out[n] = await ev(`(() => ({ cards: document.querySelectorAll('.card,.garage-item,.skill,.row').length, garage3d: !!window.__NEONRUSH__.menu.garage }))()`);
      await shot('02-' + n);
    }
    return out;
  });

  await step('start race', async () => {
    await ev(`window.__NEONRUSH__.startQuickRace({ track: 'neon-district', laps: 2, rivals: 5, mode: 'race' })`);
    await sleep(1500);
    return await ev(`(() => { const g = window.__NEONRUSH__;
      return { state: g.state, cd: +g.countdownT.toFixed(2), vehicles: g.vehicles.length,
        orbs: g.powerups.orbs.length, pads: g.world.track.pads.length, ramps: g.world.track.ramps.length }; })()`);
  });
  await shot('03-countdown');

  await step('race runs with player under AI', async () => {
    await ev(`(async () => {
      const g = window.__NEONRUSH__;
      const mod = await import('./js/ai.js');
      const drift = { id: 'clean', name: 'TEST', aggression: 0.2, skill: 1.0, radar: 0.9, taunt: ['...'] };
      g.__testDriver = new mod.AIDriver(g.player, g.world.track.spline, drift, { skill: 0.95, offset: 0 });
      g.__origUpdate = g.player.update.bind(g.player);
      g.__testPlayerAI = true;
      g.player.update = function (dt, input, world) {
        if (g.__testPlayerAI) {
          const ctx = { world, player: this, vehicles: g.vehicles, rubberBand: 1,
            onTaunt: () => {}, usePower: (v) => g.usePower(v), onComboStep: (v, c) => g.onComboStep(v, c) };
          const inp = g.__testDriver.update(dt, ctx);
          return g.__origUpdate(dt, inp, world);
        }
        return g.__origUpdate(dt, input, world);
      };
      return true;
    })()`);
    await waitFn('window.__NEONRUSH__.state === "racing"', 30000, 100);
    await sleep(10000);
    await shot('04-race');
    return await ev(`(() => { const g = window.__NEONRUSH__; const p = g.player;
      return { state: g.state, kmh: Math.round(p.speed * 3.6), lap: p.lap, place: p.place,
        t: +g.raceTime.toFixed(1), drift: Math.round(g.driftBanked), combo: p.combo,
        dmg: Math.round(p.damage), aiLaps: g.aiDrivers.map(d => d.v.lap),
        driftOn: p.drifting, air: +p.stats.airTime.toFixed(1), fps: g.world.stats.fps }; })()`);
  });
  await shot('05-race-b');

  await step('mid-race VFX (smoke / boost)', async () => {
    return await ev(`(() => { const g = window.__NEONRUSH__; const p = g.player;
      p.power = 'nitro'; p.nitro = 100; g.input.boost = true;
      p.boosting = true; p.driftScore = 4200; p.combo = 4; p.drifting = true; p.lateralVel = 7;
      g.world.particles.tireSmoke(p.pos.x, p.pos.y, p.pos.z, p.vx, p.vz, 1, true);
      g.world.particles.spark(p.pos.x, p.pos.y + 0.6, p.pos.z, 20, 9);
      return { glow: g.world.particles.glow.count, smoke: g.world.particles.smoke.count, skids: g.world.skidMesh.count }; })()`);
  });
  await sleep(700);
  await shot('06-vfx');

  await step('fast-forward to finish', async () => {
    await ev(`(() => { const g = window.__NEONRUSH__; g.player.lap = g.raceFlags.laps - 1; return true; })()`);
    await waitFn('window.__NEONRUSH__.state === "results"', 180000, 300);
    await sleep(800);
    await shot('07-results');
    return await ev(`(() => { const g = window.__NEONRUSH__;
      return { state: g.state, place: g.results?.place, rows: document.querySelectorAll('.resrow').length,
        coins: g.save.profile.coins, xp: g.save.profile.xp, lvl: g.save.profile.level,
        career: Object.keys(g.save.profile.career).length, stats: g.save.profile.stats.races }; })()`);
  });

  await step('all 4 tracks rebuild', async () => {
    return await ev(`(async () => {
      const { TRACKS } = await import('./js/config.js');
      const g = window.__NEONRUSH__;
      const out = [];
      for (const t of TRACKS) {
        const b = g.world.loadTrack(t);
        out.push({ id: t.id, samples: b.spline.count, len: Math.round(b.spline.length),
          towers: b.towerInst?.count, pads: b.pads.length, pickups: b.pickups.length,
          ramps: b.ramps.length, gates: b.gates.length });
      }
      return out; })()`);
  });

  await step('backdrop renders (snow)', async () => {
    await ev(`(() => { const g = window.__NEONRUSH__;
      g.menu.dispose(); document.getElementById('menu').classList.add('hidden');
      g.state = 'menu'; g.backdropCar = null;
      g.setupBackdrop('glacier-run'); g.camera._initialised = false; return true; })()`);
    await sleep(2500);
    await shot('08-snow');
    return await ev('window.__NEONRUSH__.world.trackDef.id');
  });
  await step('backdrop renders (desert)', async () => {
    await ev(`window.__NEONRUSH__.setMenuBackdrop('sunset-bay')`);
    await sleep(2500); await shot('09-desert');
    return await ev('window.__NEONRUSH__.world.trackDef.id');
  });
  await step('backdrop renders (jungle)', async () => {
    await ev(`window.__NEONRUSH__.setMenuBackdrop('inferno-pit')`);
    await sleep(2500); await shot('10-jungle');
    return await ev('window.__NEONRUSH__.world.trackDef.id');
  });

  await step('power-up fire test', async () => {
    return await ev(`(() => { const g = window.__NEONRUSH__;
      const out = [];
      for (const p of ['nitro', 'shield', 'shock', 'shunt', 'bolt', 'repair']) {
        g.player.power = p; g.player.powerCount = 1; g.usePower(g.player);
        out.push({ p, proj: g.powerups.projectiles.length, shield: +g.player.shield.toFixed(1), dmg: Math.round(g.player.damage) });
      }
      return out; })()`);
  });

  await step('career event launches', async () => {
    await ev(`(async () => { const { CAREER } = await import('./js/config.js');
      window.__NEONRUSH__.startCareerEvent(CAREER[0]); return true; })()`);
    await sleep(2500);
    await shot('11-career');
    return await ev(`(() => ({ state: window.__NEONRUSH__.state, ev: window.__NEONRUSH__.currentEventName }))()`);
  });

  await step('pause menu', async () => {
    await ev(`(() => { const g = window.__NEONRUSH__; if (g.state === 'countdown') { g.state = 'racing'; } g.pause(); return true; })()`);
    await sleep(600);
    await shot('12-pause');
    return await ev('window.__NEONRUSH__.state');
  });

  const perf = await ev(`(() => { const g = window.__NEONRUSH__; const r = g.world.renderer.info;
    return { fps: g.world.stats.fps, calls: r.render.calls, tris: r.render.triangles,
      geo: r.memory.geometries, tex: r.memory.textures, progs: r.programs.length,
      dpr: g.world.dprScale }; })()`);

  await writeFile(path.join(SHOTS, 'report.json'), JSON.stringify({ results, perf }, null, 2));
  console.log('\n-- RENDER --', JSON.stringify(perf));
  console.log(`-- ERRORS (${logs.errors.length}) --`);
  for (const e of [...new Set(logs.errors)].slice(0, 25)) console.log('  !', e.slice(0, 500));
  console.log(`-- WARNINGS (${logs.warnings.length}) --`);
  for (const e of [...new Set(logs.warnings)].slice(0, 10)) console.log('  ~', e.slice(0, 300));

  const failed = results.steps.filter(s => !s.ok);
  console.log(`\n-- STEPS: ${results.steps.length - failed.length}/${results.steps.length} passed --`);
  console.log('screens:', results.shots.length, '→ test-shots/');

  globalThis.__done = true;
  cdp.close();
  chrome.kill();
  server.kill();
  await sleep(300);
  process.exit(failed.length || logs.errors.length ? 2 : 0);
}
main().catch(e => { console.error('HARNESS FAIL', e); process.exit(1); });
