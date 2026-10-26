/* Entry point — boots the game and exposes it for debugging/tests. */
import { Game } from './game.js';

const game = new Game();
window.__NEONRUSH__ = game;
window.__NEONRUSH_BOOTED__ = true;
game.boot().catch(err => {
  console.error('[boot failed]', err);
  const el = document.getElementById('loadtext');
  if (el) { el.textContent = 'BOOT FAILED: ' + (err?.message || err); el.style.color = '#ff2b4d'; }
});

window.addEventListener('error', (e) => console.error('[error]', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[rejection]', e.reason));
