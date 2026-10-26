/* Visual probe — loads the game, jumps into a race, and captures frames from
   several camera/state configurations. All writes are scoped to test-shots/. */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'test-shots');
const PORT = 8400;
const CDP_PORT = 9344;
const URL = `http://127.0.0.1:${PORT}/?nosw=1`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = path.join(ROOT, '.chrome-probe');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const track = process.argv[2] || 'neon-district';
const tag = process.argv[3] || track;

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs')], {
    env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  let up = false;
  for (let i = 0; i < 60; i++) { await sleep(150); try { if ((await fetch(URL + 'index.html')).ok) { up = true; break; } } catch (e) { } }
  if (!up) { console.error('server failed'); server.kill(); process.exit(1); }

  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1280,720',
    '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    'about:blank',
  ], { stdio: 'ignore' });

  const cdp = await CDP.connect(CDP_PORT, 30000);
  const errors = [];
  cdp.on('Runtime.exceptionThrown', p => errors.push('EXC: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text)));
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') errors.push('ERR: ' + (p.args || []).map(a => a.value ?? a.description).join(' '));
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.hardReload();
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: URL });

  const ev = (e) => cdp.evaluate(e);
  const wait = async (expr, ms = 120000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (e) { } await sleep(200); }
    throw new Error('timeout ' + expr);
  };
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(SHOTS, `${tag}-${name}.png`);
    await writeFile(p, Buffer.from(r.data, 'base64'));
    console.log('  shot', name);
  };

  await wait('window.__NEONRUSH__ && window.__NEONRUSH__.state === "menu"', 120000);
  // clear any previously installed service worker so code is always fresh
  await ev(`(async () => { try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  } catch (e) {} return true; })()`);
  await sleep(400);

  // start a race directly
  await ev(`window.__NEONRUSH__.startQuickRace({ track: '${track}', laps: 3, rivals: 5, mode: 'race' })`);
  // skip the countdown (the probe runs on a software rasteriser)
  await ev(`(() => { window.__NEONRUSH__.countdownT = 0.05; return true; })()`);
  await wait('window.__NEONRUSH__.state === "racing"', 90000);
  // drive under AI so the car is actually moving and on track
  await ev(`(async () => {
    const g = window.__NEONRUSH__;
    const mod = await import('./js/ai.js');
    const p = { id:'clean', name:'P', aggression:0.2, skill:1, radar:0.9, taunt:['x'] };
    g.__drv = new mod.AIDriver(g.player, g.world.track.spline, p, { skill: 0.98, offset: 0 });
    g.input.vehicleInput = function () {
      return g.__drv.update(1/60, { world: g.world, player: g.player, vehicles: g.vehicles,
        rubberBand: 1, onTaunt(){}, usePower: v => g.usePower(v), onComboStep: (v,c) => g.onComboStep(v,c) });
    };
    return true;
  })()`);
  await sleep(6000);
  await shot('01-chase');
  await ev(`(() => { document.getElementById('hud').classList.add('hidden'); return true; })()`);
  await sleep(500);
  await shot('01b-nohud');
  await ev(`(() => { document.getElementById('hud').classList.remove('hidden'); return true; })()`);
  await ev(`window.__NEONRUSH__.camera.setMode('far')`); await sleep(1200); await shot('02-far');
  await ev(`window.__NEONRUSH__.camera.setMode('hood')`); await sleep(900); await shot('03-hood');
  await ev(`window.__NEONRUSH__.camera.setMode('chase')`);
  await sleep(2500);
  // force boost + drift for the VFX frame
  await ev(`(() => { const g = window.__NEONRUSH__; const p = g.player;
    p.nitro = 100; p.boosting = true; p.charge = 1;
    g.world.post.pulse(0x22e6ff, 0.3); return true; })()`);
  await sleep(600);
  await shot('04-boost');

  const stats = await ev(`(() => { const g = window.__NEONRUSH__; const r = g.world.renderer.info;
    return { fps: g.world.stats.fps, calls: r.render.calls, tris: r.render.triangles,
      kmh: Math.round(g.player.speed*3.6), place: g.player.place, lap: g.player.lap,
      exposure: g.world.renderer.toneMappingExposure, dpr: g.world.dprScale,
      ambient: g.world.ambient.intensity, fogDensity: g.world.scene.fog.density }; })()`);
  console.log('\nSTATS', JSON.stringify(stats));
  console.log('ERRORS', JSON.stringify([...new Set(errors)].slice(0, 8), null, 1));

  cdp.close(); chrome.kill(); server.kill();
  await sleep(300);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
