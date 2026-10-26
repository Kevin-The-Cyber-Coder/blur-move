/* NEON RUSH service worker — offline play with network-first app code.
   Strategy:
     - app shell (html/js/css/json): network-first, fall back to cache offline
     - vendor / assets: cache-first (they are large and immutable)
   This means updates are picked up on the next load while offline still works.
*/
const VERSION = 'neonrush-v3';
const CORE = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './assets/icon.svg',
  './js/boot.js',
  './js/game.js',
  './js/config.js',
  './js/util.js',
  './js/features.js',
  './js/world.js',
  './js/track.js',
  './js/cars.js',
  './js/physics.js',
  './js/ai.js',
  './js/powerups.js',
  './js/camera.js',
  './js/input.js',
  './js/audio.js',
  './js/hud.js',
  './js/menu.js',
  './js/save.js',
  './js/particles.js',
  './js/post.js',
  './js/textures.js',
  './vendor/three/three.module.js',
  './vendor/three/addons/postprocessing/EffectComposer.js',
  './vendor/three/addons/postprocessing/RenderPass.js',
  './vendor/three/addons/postprocessing/ShaderPass.js',
  './vendor/three/addons/postprocessing/UnrealBloomPass.js',
  './vendor/three/addons/postprocessing/OutputPass.js',
  './vendor/three/addons/postprocessing/MaskPass.js',
  './vendor/three/addons/postprocessing/Pass.js',
  './vendor/three/addons/shaders/CopyShader.js',
  './vendor/three/addons/shaders/LuminosityHighPassShader.js',
  './vendor/three/addons/shaders/OutputShader.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()).catch(() => { }));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const isImmutable = (url) =>
  url.pathname.includes('/vendor/') || url.pathname.includes('/assets/');

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  if (isImmutable(url)) {
    // cache-first for vendor bundles and images
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy)).catch(() => { });
      return res;
    }).catch(() => caches.match('./index.html'))));
    return;
  }

  // network-first for the app shell so updates land immediately
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy)).catch(() => { });
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
  );
});
