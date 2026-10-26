/* ============================================================
   MENU — all out-of-race screens, garage 3D preview, navigation.
   ============================================================ */
import * as THREE from 'three';
import { CARS, TRACKS, CAREER, SKILLS, SKILL_BRANCHES, ACHIEVEMENTS, DAILY_CHALLENGES, POWERS, CLASS_COLORS, DIFFICULTY, THEMES } from './config.js';
import { FEATURE_GROUPS, SIGNATURE_TEN, featureStats } from './features.js';
import { CarMesh } from './cars.js';
import { cssHex, fmtTime, fmtNum, clamp, clamp01, ordinal } from './util.js';
import { xpForLevel, levelProgress } from './save.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Menu {
  constructor(game) {
    this.game = game;
    this.container = $('screens');
    this.current = null;
    this.stack = [];
    this.garage = null;
    this._resizeHandler = null;
    this.hoverSound = true;
  }

  /* ---------------- navigation ---------------- */
  show(name, arg = null) {
    if (this.current === name && !arg) return;
    this.current = name;
    this.container.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'screen';
    screen.id = 'screen-' + name;
    this.container.appendChild(screen);
    this.screen = screen;
    const fn = this['render_' + name];
    if (fn) fn.call(this, screen, arg);
    else screen.innerHTML = `<div class="screen-head"><h2 class="screen-title">${esc(name)}</h2></div>`;
    this.bindCommon(screen);
    if (this.game.audio) this.game.audio.uiClick();
    return screen;
  }

  back() {
    if (this.stack.length) {
      const prev = this.stack.pop();
      this.show(prev.name, prev.arg);
    } else this.show('title');
  }

  push(name, arg) {
    this.stack.push({ name: this.current, arg: this.arg });
    this.arg = arg;
    this.show(name, arg);
  }

  bindCommon(root) {
    root.querySelectorAll('[data-nav]').forEach(b => {
      b.addEventListener('click', () => {
        const nav = b.dataset.nav;
        if (nav === 'back') this.back();
        else this.show(nav);
      });
      b.addEventListener('mouseenter', () => this.hoverSound && this.game.audio?.uiHover());
    });
    root.querySelectorAll('[data-sound]').forEach(b => {
      b.addEventListener('click', () => this.game.audio?.uiClick());
    });
    this._bindRanges(root);
  }

  /* ---------------- shared chrome ---------------- */
  topbar() {
    const p = this.game.save.profile;
    const lp = levelProgress(p);
    const diff = DIFFICULTY[this.game.save.settings.controls.difficulty] || DIFFICULTY.pro;
    return `
    <div class="topbar">
      <div class="lvlring" style="--p:${Math.round(lp.pct * 100)}%"><b>${p.level}</b></div>
      <div style="display:flex;flex-direction:column;gap:2px">
        <div style="font-size:13px;font-weight:800;letter-spacing:.08em">${esc(p.name)}</div>
        <div style="font-size:10px;color:var(--dim);letter-spacing:.16em">${fmtNum(lp.cur)} / ${fmtNum(lp.need)} XP · ${diff.name}</div>
      </div>
      <div class="spacer"></div>
      <div class="chip"><i>◈</i>${fmtNum(p.coins)}</div>
      <div class="chip token"><i>◆</i>${p.tokens}</div>
      <div class="chip xp"><i>✦</i>${p.skillPoints} SP</div>
      <button class="btn sm ghost" data-nav="roadmap" data-sound title="Feature roadmap">◈</button>
      <button class="btn sm ghost" data-nav="settings" data-sound>⚙</button>
      <button class="btn sm ghost" data-nav="title" data-sound>MENU</button>
    </div>`;
  }

  /* ============================================================
     TITLE
     ============================================================ */
  render_title(root) {
    const p = this.game.save.profile;
    const winRate = p.stats.races ? Math.round(p.stats.wins / p.stats.races * 100) : 0;
    root.innerHTML = `
    <div class="title-wrap">
      <div>
        <h1 class="logo-xl">NEON RUSH<small>BLUR-STYLE ARCADE RACER</small></h1>
        <div class="title-tag">NO BRAKES · NO LIMITS · NO MERCY</div>
      </div>
      <div class="title-actions">
        <button class="btn primary" data-action="career" data-sound>▶ CAREER</button>
        <button class="btn" data-action="quick" data-sound>QUICK RACE</button>
        <button class="btn" data-action="garage" data-sound>GARAGE</button>
        <button class="btn" data-action="skills" data-sound>SKILLS</button>
        <button class="btn ghost" data-action="settings" data-sound>SETTINGS</button>
        <button class="btn ghost" data-action="roadmap" data-sound>ROADMAP</button>
      </div>
      <div style="display:flex;gap:26px;flex-wrap:wrap">
        <div class="stat" style="min-width:120px"><span>LEVEL ${p.level}</span><div class="bar"><i style="width:${levelProgress(p).pct * 100}%"></i></div></div>
        <div style="font-size:11px;letter-spacing:.14em;color:var(--dim)">WIN RATE <b style="color:#fff">${winRate}%</b></div>
        <div style="font-size:11px;letter-spacing:.14em;color:var(--dim)">CARS <b style="color:#fff">${p.ownedCars.length}/${CARS.length}</b></div>
        <div style="font-size:11px;letter-spacing:.14em;color:var(--dim)">ACHIEVEMENTS <b style="color:#fff">${Object.keys(p.achievements).length}/${ACHIEVEMENTS.length}</b></div>
      </div>
      <div class="title-foot">
        <span>WASD / ARROWS DRIVE</span><span>SHIFT NITRO</span><span>SPACE DRIFT</span><span>E POWER-UP</span><span>C CAMERA</span><span>ESC PAUSE</span>
      </div>
    </div>`;
    root.querySelectorAll('[data-action]').forEach(b => {
      b.addEventListener('click', () => {
        this.game.audio?.uiClick();
        const a = b.dataset.action;
        if (a === 'career') this.show('career');
        else if (a === 'quick') this.show('quick');
        else if (a === 'garage') this.show('garage');
        else if (a === 'skills') this.show('skills');
        else if (a === 'settings') this.show('settings');
        else if (a === 'roadmap') this.show('roadmap');
      });
    });
    this.game.setMenuBackdrop('neon-district');
  }

  /* ============================================================
     CAREER
     ============================================================ */
  render_career(root) {
    const p = this.game.save.profile;
    const done = (id) => !!p.career[id];
    root.innerHTML = `
    ${this.topbar()}
    <div class="screen-head">
      <div><h2 class="screen-title">CAREER</h2>
      <div class="screen-sub">${Object.keys(p.career).length} / ${CAREER.length} EVENTS · REP ${p.reputation}</div></div>
      <button class="btn ghost" data-nav="title" data-sound>◀ BACK</button>
    </div>
    <div class="grid cards">
      ${CAREER.map((ev, i) => {
        const finished = done(ev.id);
        const prev = i === 0 ? true : done(CAREER[i - 1].id);
        const locked = !prev && !finished;
        const track = TRACKS.find(t => t.id === ev.track);
        const rec = p.career[ev.id];
        const stars = rec?.stars || 0;
        const typeName = { race: 'RACE', elimination: 'ELIMINATION', drift: 'DRIFT ATTACK', tt: 'TIME TRIAL', boss: 'BOSS' }[ev.type];
        return `<div class="card ${locked ? 'locked' : 'click'} ${ev.type === 'boss' ? 'magenta' : ev.type === 'drift' ? 'lime' : ''} ${finished ? '' : ''}"
          ${locked ? '' : `data-event="${ev.id}"`}>
          <div class="accent"></div>
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <h3>${esc(ev.name)}</h3>
            <div style="font-size:10px;color:var(--dim);letter-spacing:.1em">#${i + 1}</div>
          </div>
          <p>${esc(ev.desc)}</p>
          <div class="badges">
            <span class="badge ${ev.type === 'boss' ? 'magenta' : ''}">${typeName}</span>
            <span class="badge grey">${esc(track?.name || '')}</span>
            <span class="badge grey">◈ ${fmtNum(ev.reward)}</span>
            ${rec ? `<span class="badge lime">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>` : ''}
            ${locked ? '<span class="badge grey">LOCKED</span>' : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
    root.querySelectorAll('[data-event]').forEach(c => {
      c.addEventListener('click', () => {
        const ev = CAREER.find(e => e.id === c.dataset.event);
        this.show('briefing', ev);
      });
    });
  }

  /* ============================================================
     BRIEFING -> start event
     ============================================================ */
  render_briefing(root, ev) {
    if (!ev) return this.show('career');
    this.arg = ev;
    const track = TRACKS.find(t => t.id === ev.track);
    const theme = THEMES[track.theme];
    const car = this.game.save.carSpec();
    root.innerHTML = `
    ${this.topbar()}
    <div class="screen-head">
      <div><h2 class="screen-title">${esc(ev.name)}</h2>
      <div class="screen-sub">${esc(track.name)} · ${track.length} · ${track.weather.toUpperCase()} · ${track.time.toUpperCase()}</div></div>
      <button class="btn ghost" data-nav="career" data-sound>◀ CAREER</button>
    </div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,.9fr);gap:18px;align-items:start">
      <div class="panel" style="padding:18px">
        <p style="margin:0 0 14px;color:var(--dim);line-height:1.6;font-size:13px">${esc(ev.desc)}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;letter-spacing:.08em">
          <div class="chip">LAPS <b style="color:#fff">${ev.type === 'elimination' ? '∞' : ev.laps}</b></div>
          <div class="chip">RIVALS <b style="color:#fff">${ev.rivals}</b></div>
          <div class="chip">AI SKILL <b style="color:#fff">${Math.round(ev.ai * 100)}%</b></div>
          <div class="chip">REWARD <b style="color:var(--lime)">◈${fmtNum(ev.reward)}</b></div>
          ${ev.target ? `<div class="chip">TARGET <b style="color:#fff">${fmtNum(ev.target)}</b></div>` : ''}
          ${ev.boss ? `<div class="chip token">BOSS <b>${esc(ev.boss)}</b></div>` : ''}
        </div>
        <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn primary" data-start data-sound>▶ START EVENT</button>
          <button class="btn ghost" data-nav="garage" data-sound>GARAGE</button>
        </div>
      </div>
      <div class="garage-view" style="min-height:240px" id="brief-view"></div>
    </div>`;
    root.querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', () => this.game.startCareerEvent(ev)));
    this._mountPreview($('brief-view'));
  }

  /* ============================================================
     QUICK RACE SETUP
     ============================================================ */
  render_quick(root) {
    const s = this.game.save.settings;
    const p = this.game.save.profile;
    const state = this.game.quickSetup;
    root.innerHTML = `
    ${this.topbar()}
    <div class="screen-head">
      <div><h2 class="screen-title">QUICK RACE</h2><div class="screen-sub">PICK A CIRCUIT, SET THE HEAT</div></div>
      <button class="btn ghost" data-nav="title" data-sound>◀ BACK</button>
    </div>
    <div class="grid" style="grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);gap:18px;align-items:start">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${TRACKS.map(t => {
          const best = p.bestTimes[t.id];
          return `<div class="garage-item ${state.track === t.id ? 'sel' : ''}" data-track="${t.id}">
            <div class="swatch" style="background:linear-gradient(135deg,${THEMES[t.theme].line},${THEMES[t.theme].accent})"></div>
            <div class="meta"><b>${esc(t.name)}</b><span>${t.length} · ${t.weather.toUpperCase()} · ${t.time.toUpperCase()}${best ? ' · BEST ' + fmtTime(best) : ''}</span></div>
          </div>`;
        }).join('')}
      </div>
      <div class="panel" style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="row" style="padding:0;background:none;border:0">
          <div class="lbl"><b>LAPS</b><span>Race distance</span></div>
          <div class="seg" data-seg="laps">${[2, 3, 5].map(n => `<button data-v="${n}" class="${state.laps === n ? 'on' : ''}">${n}</button>`).join('')}</div>
        </div>
        <div class="row" style="padding:0;background:none;border:0">
          <div class="lbl"><b>RIVALS</b><span>Opponent count</span></div>
          <div class="seg" data-seg="rivals">${[3, 5, 7].map(n => `<button data-v="${n}" class="${state.rivals === n ? 'on' : ''}">${n}</button>`).join('')}</div>
        </div>
        <div class="row" style="padding:0;background:none;border:0">
          <div class="lbl"><b>MODE</b><span>Ruleset</span></div>
          <div class="seg" data-seg="mode">${['race', 'elim', 'drift', 'tt'].map(m => `<button data-v="${m}" class="${state.mode === m ? 'on' : ''}">${m.toUpperCase()}</button>`).join('')}</div>
        </div>
        <div class="row" style="padding:0;background:none;border:0">
          <div class="lbl"><b>DIFFICULTY</b><span>AI pace</span></div>
          <div class="seg" data-seg="difficulty">${Object.entries(DIFFICULTY).map(([k, v]) => `<button data-v="${k}" class="${s.controls.difficulty === k ? 'on' : ''}">${v.name}</button>`).join('')}</div>
        </div>
        <div class="row" style="padding:0;background:none;border:0">
          <div class="lbl"><b>CAR</b><span>${esc(this.game.save.carSpec().name)}</span></div>
          <button class="btn sm ghost" data-nav="garage" data-sound>CHANGE</button>
        </div>
        <button class="btn primary wide" data-start data-sound style="margin-top:6px">▶ RACE</button>
        <button class="btn ghost wide" data-timeattack data-sound>TIME ATTACK + GHOST</button>
      </div>
    </div>`;
    root.querySelectorAll('[data-track]').forEach(el => el.addEventListener('click', () => {
      state.track = el.dataset.track;
      this.game.save.settings.lastTrack = state.track;
      this.game.save.saveSettings();
      this.show('quick');
    }));
    root.querySelectorAll('[data-seg]').forEach(seg => {
      seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const key = seg.dataset.seg;
        const v = b.dataset.v;
        if (key === 'difficulty') {
          s.controls.difficulty = v; this.game.save.saveSettings();
        } else state[key] = isNaN(+v) ? v : +v;
        this.show('quick');
      }));
    });
    root.querySelector('[data-start]').addEventListener('click', () => this.game.startQuickRace(state));
    root.querySelector('[data-timeattack]').addEventListener('click', () => {
      this.game.startQuickRace({ ...state, mode: 'tt', rivals: 0, laps: 3 });
    });
    this.game.setMenuBackdrop(state.track);
  }

  /* ============================================================
     GARAGE
     ============================================================ */
  render_garage(root) {
    const save = this.game.save;
    const p = save.profile;
    const selId = p.currentCar;
    const car = save.carSpec(selId);
    const up = save.upgradesFor(selId);
    const own = save.ownsCar(selId);
    root.innerHTML = `
    ${this.topbar()}
    <div class="screen-head">
      <div><h2 class="screen-title">GARAGE</h2><div class="screen-sub">${p.ownedCars.length} / ${CARS.length} CARS OWNED</div></div>
      <button class="btn ghost" data-nav="title" data-sound>◀ BACK</button>
    </div>
    <div class="garage">
      <div style="display:flex;flex-direction:column;gap:12px;min-height:0">
        <div class="garage-view" id="garage-view"></div>
        <div class="panel" style="padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
            <div>
              <div style="font-size:18px;font-weight:900;letter-spacing:.04em">${esc(car.name)}</div>
              <div style="font-size:10px;letter-spacing:.2em;color:${CLASS_COLORS[car.cls]}">${car.cls} CLASS</div>
            </div>
            <div style="text-align:right;font-size:11px;color:var(--dim);letter-spacing:.1em">
              TOP ${Math.round(car.speed * 3.6)} KM/H
            </div>
          </div>
          <p style="margin:0 0 12px;color:var(--dim);font-size:12px;line-height:1.5">${esc(car.desc)}</p>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px">
            ${this.statBar('SPEED', car.stats[0] + up.engine * 0.04)}
            ${this.statBar('ACCEL', car.stats[1] + up.engine * 0.03)}
            ${this.statBar('HANDLING', car.stats[2] + up.tires * 0.04)}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${own
              ? `<button class="btn primary sm" data-select data-sound ${p.currentCar === selId ? 'disabled' : ''}>${p.currentCar === selId ? 'SELECTED' : 'SELECT'}</button>`
              : `<button class="btn magenta sm" data-buy data-sound ${p.coins < car.cost ? 'disabled' : ''}>BUY ◈${fmtNum(car.cost)}</button>`}
            <button class="btn ghost sm" data-nav="skills" data-sound>SKILL TREE</button>
            <button class="btn ghost sm" data-nav="livery" data-sound>LIVERY</button>
          </div>
        </div>
        <div class="panel" style="padding:12px">
          <div style="font-size:10px;letter-spacing:.22em;color:var(--dim);margin-bottom:8px">UPGRADES</div>
          <div style="display:flex;gap:8px">
            ${['engine', 'tires', 'brakes'].map(part => `
              <div style="flex:1;display:flex;flex-direction:column;gap:5px">
                <div style="font-size:10px;letter-spacing:.14em;color:var(--dim);text-transform:uppercase">${part} ${'▮'.repeat(up[part])}${'▯'.repeat(3 - up[part])}</div>
                <button class="btn sm ghost" data-up="${part}" data-sound ${up[part] >= 3 ? 'disabled' : ''}>
                  ${up[part] >= 3 ? 'MAX' : '◈' + fmtNum(save.upgradeCost(selId, part, up[part]))}
                </button>
              </div>`).join('')}
          </div>
        </div>
      </div>
      <div class="garage-list" id="garage-list">
        ${CARS.map(c => {
          const owned = save.ownsCar(c.id);
          const cUp = save.upgradesFor(c.id);
          return `<div class="garage-item ${c.id === selId ? 'sel' : ''} ${owned ? '' : 'locked'}" data-car="${c.id}">
            <div class="swatch" style="background:linear-gradient(135deg,${cssHex(c.color)},${cssHex(c.accent)})"></div>
            <div class="meta">
              <b>${esc(c.name)}</b>
              <span>${c.cls} · ${'▮'.repeat(cUp.engine)}${'▯'.repeat(3 - cUp.engine)}</span>
            </div>
            <div style="margin-left:auto;font-size:11px;font-weight:800;color:${owned ? 'var(--lime)' : 'var(--dim)'}">
              ${owned ? 'OWNED' : '◈' + fmtNum(c.cost)}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
    root.querySelectorAll('[data-car]').forEach(el => el.addEventListener('click', () => {
      this.game.save.profile.currentCar = el.dataset.car;
      this.game.save.save();
      this.show('garage');
    }));
    const sel = root.querySelector('[data-select]');
    if (sel) sel.addEventListener('click', () => {
      this.game.save.selectCar(selId); this.show('garage');
    });
    const buy = root.querySelector('[data-buy]');
    if (buy) buy.addEventListener('click', () => {
      if (this.game.save.buyCar(selId)) {
        this.game.audio?.pickup();
        this.game.toast?.('CAR UNLOCKED: ' + car.name, 'good');
        this.game.save.checkAchievements();
      } else this.game.audio?.uiError();
      this.show('garage');
    });
    root.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => {
      if (this.game.save.buyUpgrade(selId, b.dataset.up)) this.game.audio?.pickup();
      else this.game.audio?.uiError();
      this.show('garage');
    }));
    this._mountPreview($('garage-view'), selId);
  }

  statBar(label, v) {
    const pct = clamp01(v) * 100;
    return `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }

  /* ============================================================
     LIVERY
     ============================================================ */
  render_livery(root) {
    const save = this.game.save;
    const car = save.carSpec();
    const liv = save.profile.livery[car.id] || {};
    const paint = liv.paint ?? car.color;
    const accent = liv.accent ?? car.accent;
    const palette = [0x22e6ff, 0xff2bd6, 0xc6ff2b, 0xff8a1f, 0xffe36b, 0x8a5cff, 0xe8f4ff, 0xff2b4d, 0x7dffb0];
    root.innerHTML = `
    ${this.topbar()}
    <div class="screen-head">
      <div><h2 class="screen-title">LIVERY</h2><div class="screen-sub">${esc(car.name)}</div></div>
      <button class="btn ghost" data-nav="garage" data-sound>◀ GARAGE</button>
    </div>
    <div class="grid" style="grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:18px;align-items:start">
      <div class="garage-view" id="livery-view" style="min-height:300px"></div>
      <div class="panel" style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div>
          <div style="font-size:10px;letter-spacing:.22em;color:var(--dim);margin-bottom:8px">PAINT</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${palette.map(c => `<button data-paint="${c}" style="width:34px;height:34px;border-radius:8px;border:2px solid ${c === paint ? '#fff' : 'transparent'};background:${cssHex(c)};cursor:pointer"></button>`).join('')}
          </div>
        </div>
        <div>
          <div style="font-size:10px;letter-spacing:.22em;color:var(--dim);margin-bottom:8px">ACCENT / STRIPES</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${palette.map(c => `<button data-accent="${c}" style="width:34px;height:34px;border-radius:8px;border:2px solid ${c === accent ? '#fff' : 'transparent'};background:${cssHex(c)};cursor:pointer"></button>`).join('')}
          </div>
        </div>
        <button class="btn wide" data-save data-sound>SAVE LIVERY</button>
        <button class="btn ghost wide" data-reset data-sound>RESET TO STOCK</button>
      </div>
    </div>`;
    const view = $('livery-view');
    this._mountPreview(view, car.id, { paint, accent });
    root.querySelectorAll('[data-paint]').forEach(b => b.addEventListener('click', () => {
      this._setLivery(+b.dataset.paint, undefined);
    }));
    root.querySelectorAll('[data-accent]').forEach(b => b.addEventListener('click', () => {
      this._setLivery(undefined, +b.dataset.accent);
    }));
    root.querySelector('[data-save]').addEventListener('click', () => {
      this.game.save.save(); this.game.audio?.pickup(); this.show('livery');
    });
    root.querySelector('[data-reset]').addEventListener('click', () => {
      delete this.game.save.profile.livery[car.id];
      this.game.save.save(); this.show('livery');
    });
  }

  _setLivery(paint, accent) {
    const save = this.game.save;
    const car = save.carSpec();
    const liv = save.profile.livery[car.id] || {};
    if (paint !== undefined) liv.paint = paint;
    if (accent !== undefined) liv.accent = accent;
    save.profile.livery[car.id] = liv;
    this.show('livery');
  }

  /* ============================================================
     SKILLS
     ============================================================ */
  render_skills(root) {
    const save = this.game.save;
    const p = save.profile;
    root.innerHTML = `
    ${this.topbar()}
    <div class="screen-head">
      <div><h2 class="screen-title">SKILL TREE</h2><div class="screen-sub">${p.skillPoints} SKILL POINTS AVAILABLE</div></div>
      <button class="btn ghost" data-nav="title" data-sound>◀ BACK</button>
    </div>
    <div class="tree">
      ${SKILL_BRANCHES.map(br => `
        <div class="branch">
          <h4>${br}</h4>
          ${SKILLS.filter(s => s.branch === br).map(s => {
            const rank = save.skillRank(s.id);
            const reqOk = !s.req || save.skillRank(s.req) > 0;
            const can = rank === 0 && reqOk && p.skillPoints >= s.cost;
            return `<div class="skill ${rank ? 'max' : can ? 'can' : ''}" data-skill="${s.id}">
              <div class="dot"></div>
              <div class="info"><b>${esc(s.name)}</b><span>${esc(s.desc)}${s.req && !reqOk ? ' · LOCKED' : ''}</span></div>
              <div class="cost">${rank ? '✔' : s.cost + ' SP'}</div>
            </div>`;
          }).join('')}
        </div>`).join('')}
    </div>`;
    root.querySelectorAll('[data-skill]').forEach(el => el.addEventListener('click', () => {
      const sk = SKILLS.find(s => s.id === el.dataset.skill);
      const r = this.game.save.learnSkill(sk);
      if (r.ok) { this.game.audio?.pickup(); this.game.toast?.('LEARNED: ' + sk.name, 'good'); }
      else { this.game.audio?.uiError(); this.game.toast?.(r.reason, 'hot'); }
      this.show('skills');
    }));
  }

  /* ============================================================
     ACHIEVEMENTS + CHALLENGES
     ============================================================ */
  render_achievements(root) {
    const save = this.game.save;
    const p = save.profile;
    const daily = save.ensureDaily();
    root.innerHTML = `
    ${this.topbar()}
    <div class="screen-head">
      <div><h2 class="screen-title">ACHIEVEMENTS</h2><div class="screen-sub">${Object.keys(p.achievements).length} / ${ACHIEVEMENTS.length} UNLOCKED</div></div>
      <button class="btn ghost" data-nav="title" data-sound>◀ BACK</button>
    </div>
    <div class="panel" style="padding:14px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:11px;letter-spacing:.24em;color:var(--dim)">DAILY CHALLENGES · STREAK ${p.streak.days}d</div>
        <div style="font-size:10px;color:var(--dim)">RESETS DAILY</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${daily.list.map(c => {
          const prog = Math.min(c.target, c.progress || 0);
          const done = prog >= c.target;
          const claimed = p.daily.claimed[c.id];
          return `<div class="row" style="padding:10px 14px">
            <div class="lbl"><b>${esc(c.name)}</b><span>${fmtNum(prog)} / ${fmtNum(c.target)} · +${c.xp} XP · +◈${c.coins}</span></div>
            ${claimed ? '<span class="badge grey">CLAIMED</span>'
              : done ? `<button class="btn sm primary" data-claim="${c.id}" data-sound>CLAIM</button>`
              : `<div class="stat" style="min-width:110px"><div class="bar"><i style="width:${prog / c.target * 100}%"></i></div></div>`}
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="grid cards">
      ${ACHIEVEMENTS.map(a => {
        const got = !!p.achievements[a.id];
        return `<div class="card ${got ? 'lime' : 'locked'}">
          <div class="accent"></div>
          <div style="display:flex;justify-content:space-between"><h3>${esc(a.name)}</h3>${got ? '<span style="color:var(--lime)">✔</span>' : ''}</div>
          <p>${esc(a.desc)}</p>
          <div class="badges"><span class="badge">+${a.xp} XP</span><span class="badge">◈${a.coins}</span></div>
        </div>`;
      }).join('')}
    </div>`;
    root.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', () => {
      if (this.game.save.claimDaily(b.dataset.claim)) { this.game.audio?.pickup(); this.game.toast?.('REWARD CLAIMED', 'good'); }
      this.show('achievements');
    }));
  }

  /* ============================================================
     SETTINGS
     ============================================================ */
  render_settings(root) {
    const s = this.game.save.settings;
    const g = this.game;
    root.innerHTML = `
    ${this.topbar()}
    <div class="screen-head">
      <div><h2 class="screen-title">SETTINGS</h2><div class="screen-sub">AUDIO · VISUALS · CONTROLS</div></div>
      <button class="btn ghost" data-nav="title" data-sound>◀ BACK</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;align-items:start">
      <div>
        <h3 style="font-size:11px;letter-spacing:.26em;color:var(--dim);margin:0 0 10px">AUDIO</h3>
        <div class="rows">
          ${this.sliderRow('master', 'MASTER VOLUME', s.audio.master, v => { s.audio.master = v; g.audio.setMaster(v); g.save.saveSettings(); })}
          ${this.sliderRow('music', 'MUSIC', s.audio.music, v => { s.audio.music = v; g.audio.setMusic(v); g.save.saveSettings(); })}
          ${this.sliderRow('sfx', 'SFX', s.audio.sfx, v => { s.audio.sfx = v; g.audio.setSfx(v); g.save.saveSettings(); })}
          ${this.sliderRow('engine', 'ENGINE', s.audio.engine, v => { s.audio.engine = v; g.audio.setEngine(v); g.save.saveSettings(); })}
          <div class="row"><div class="lbl"><b>MUSIC TRACK</b><span>Adaptive, speed-reactive</span></div>
            <div class="seg" data-seg="musicOn">${['ON', 'OFF'].map(v => `<button data-v="${v === 'ON'}" class="${(s.audio.musicOn ? 'ON' : 'OFF') === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
        </div>
      </div>
      <div>
        <h3 style="font-size:11px;letter-spacing:.26em;color:var(--dim);margin:0 0 10px">GRAPHICS</h3>
        <div class="rows">
          <div class="row"><div class="lbl"><b>QUALITY</b><span>Bloom, shadows, resolution</span></div>
            <div class="seg" data-seg="quality">${[['auto', 'AUTO'], ['high', 'HIGH'], ['med', 'MED'], ['low', 'LOW']].map(([k, v]) => `<button data-v="${k}" class="${s.graphics.quality === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
          <div class="row"><div class="lbl"><b>SHOW FPS</b><span>Performance overlay</span></div>
            <div class="seg" data-seg="fps">${['ON', 'OFF'].map(v => `<button data-v="${v === 'ON'}" class="${(s.graphics.fps ? 'ON' : 'OFF') === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
          <div class="row"><div class="lbl"><b>ADAPTIVE RES</b><span>Auto-scale for smooth frames</span></div>
            <div class="seg" data-seg="adaptive">${['ON', 'OFF'].map(v => `<button data-v="${v === 'ON'}" class="${(g.world?.adaptive ? 'ON' : 'OFF') === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
        </div>
      </div>
      <div>
        <h3 style="font-size:11px;letter-spacing:.26em;color:var(--dim);margin:0 0 10px">CONTROLS</h3>
        <div class="rows">
          ${this.sliderRow('sens', 'STEERING SENSITIVITY', s.controls.sensitivity, v => { s.controls.sensitivity = v; g.input.sensitivity = v; g.save.saveSettings(); })}
          ${this.sliderRow('dz', 'STICK DEAD ZONE', s.controls.deadzone, v => { s.controls.deadzone = v; g.input.deadzone = v; g.save.saveSettings(); })}
          <div class="row"><div class="lbl"><b>BRAKE ASSIST</b><span>Throttle cut while braking</span></div>
            <div class="seg" data-seg="assist">${['ON', 'OFF'].map(v => `<button data-v="${v === 'ON'}" class="${(s.controls.assist ? 'ON' : 'OFF') === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
          <div class="row"><div class="lbl"><b>AUTO-ACCELERATE</b><span>Mobile-friendly</span></div>
            <div class="seg" data-seg="auto">${['ON', 'OFF'].map(v => `<button data-v="${v === 'ON'}" class="${(s.controls.autoThrottle ? 'ON' : 'OFF') === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
          <div class="row"><div class="lbl"><b>DIFFICULTY</b><span>AI pace</span></div>
            <div class="seg" data-seg="difficulty">${Object.entries(DIFFICULTY).map(([k, v]) => `<button data-v="${k}" class="${s.controls.difficulty === k ? 'on' : ''}">${v.name}</button>`).join('')}</div></div>
          <div class="row"><div class="lbl"><b>GYRO STEERING</b><span>Requires permission on iOS</span></div>
            <button class="btn sm ghost" data-gyro data-sound>${s.controls.gyro ? 'ENABLED' : 'ENABLE'}</button></div>
        </div>
      </div>
      <div>
        <h3 style="font-size:11px;letter-spacing:.26em;color:var(--dim);margin:0 0 10px">ACCESSIBILITY</h3>
        <div class="rows">
          <div class="row"><div class="lbl"><b>COLOURBLIND MODE</b><span>HUD palette</span></div>
            <div class="seg" data-seg="colorblind">${['OFF', 'DEUT', 'PROT'].map(v => `<button data-v="${v}" class="${s.accessibility.colorblind === v.toLowerCase() ? 'on' : ''}">${v}</button>`).join('')}</div></div>
          <div class="row"><div class="lbl"><b>LARGE TEXT</b><span>Bigger HUD type</span></div>
            <div class="seg" data-seg="largeText">${['ON', 'OFF'].map(v => `<button data-v="${v === 'ON'}" class="${(s.accessibility.largeText ? 'ON' : 'OFF') === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
          <div class="row"><div class="lbl"><b>REDUCE MOTION</b><span>Less blur / shake</span></div>
            <div class="seg" data-seg="reduceMotion">${['ON', 'OFF'].map(v => `<button data-v="${v === 'ON'}" class="${(s.accessibility.reduceMotion ? 'ON' : 'OFF') === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
          <div class="row"><div class="lbl"><b>HAPTICS</b><span>Controller rumble</span></div>
            <div class="seg" data-seg="haptics">${['ON', 'OFF'].map(v => `<button data-v="${v === 'ON'}" class="${(s.accessibility.haptics ? 'ON' : 'OFF') === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
          <div class="row"><div class="lbl"><b>RESET PROGRESS</b><span>Wipes all saved data</span></div>
            <button class="btn sm" data-reset data-sound style="border-color:var(--red);color:#ffb3bf">RESET</button></div>
        </div>
        <div style="margin-top:14px;font-size:10px;letter-spacing:.14em;color:var(--dim);line-height:1.8">
          NEON RUSH v1.0 · PROCEDURAL AUDIO + TEXTURES<br>
          SAVE: ${this.game.save.available ? 'LOCALSTORAGE' : 'MEMORY (no storage!)'}
        </div>
      </div>
    </div>`;
    root.querySelectorAll('[data-seg]').forEach(seg => {
      seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const key = seg.dataset.seg, v = b.dataset.v;
        const bool = v === 'true';
        switch (key) {
          case 'quality':
            s.graphics.quality = v; g.applyQuality(v); break;
          case 'fps': s.graphics.fps = bool; break;
          case 'adaptive':
            if (g.world) g.world.adaptive = bool; break;
          case 'assist': s.controls.assist = bool; g.input.assist = bool; break;
          case 'auto': s.controls.autoThrottle = bool; break;
          case 'difficulty': s.controls.difficulty = v; break;
          case 'colorblind': s.accessibility.colorblind = v.toLowerCase(); g.applyAccessibility(); break;
          case 'largeText': s.accessibility.largeText = bool; g.applyAccessibility(); break;
          case 'reduceMotion': s.accessibility.reduceMotion = bool; g.applyAccessibility(); break;
          case 'haptics': s.accessibility.haptics = bool; break;
          case 'musicOn': s.audio.musicOn = bool; bool ? g.audio.startMusic() : g.audio.stopMusic(); break;
        }
        g.save.saveSettings();
        this.show('settings');
      }));
    });
    root.querySelector('[data-gyro]').addEventListener('click', async () => {
      const ok = await g.enableGyro();
      s.controls.gyro = ok; g.save.saveSettings();
      g.toast(ok ? 'GYRO STEERING ENABLED' : 'GYRO NOT AVAILABLE', ok ? 'good' : 'hot');
      this.show('settings');
    });
    root.querySelector('[data-reset]').addEventListener('click', () => {
      if (confirm('Reset ALL progress? This cannot be undone.')) {
        g.save.reset();
        location.reload();
      }
    });
  }

  sliderRow(id, label, value, onChange) {
    this._rangeCbs = this._rangeCbs || {};
    this._rangeCbs[id] = onChange;
    return `<div class="row">
      <div class="lbl"><b>${label}</b><span class="range-val">${Math.round(value * 100)}%</span></div>
      <input type="range" min="0" max="1" step="0.01" value="${value}" data-range="${id}">
    </div>`;
  }

  _bindRanges(root) {
    root.querySelectorAll('[data-range]').forEach(inp => {
      const cb = this._rangeCbs?.[inp.dataset.range];
      const label = inp.parentElement.querySelector('.range-val');
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (label) label.textContent = Math.round(v * 100) + '%';
        cb?.(v);
      });
      // rebuild only after the drag ends, so the setting sticks visually
      inp.addEventListener('change', () => { if (this.current === 'settings') this.show('settings'); });
    });
  }

  /* ============================================================
     ROADMAP / FEATURE REGISTRY
     ============================================================ */
  render_roadmap(root) {
    const st = featureStats();
    root.innerHTML = `
    ${this.topbar()}
    <div class="screen-head">
      <div><h2 class="screen-title">FEATURE ROADMAP</h2>
      <div class="screen-sub">${st.done} SHIPPED · ${st.partial} PARTIAL · ${st.planned} PLANNED — ${st.total} TRACKED</div></div>
      <button class="btn ghost" data-nav="title" data-sound>◀ BACK</button>
    </div>
    <div class="panel" style="padding:14px;margin-bottom:14px">
      <div style="font-size:10px;letter-spacing:.24em;color:var(--dim);margin-bottom:10px">THE 10 BLUR SIGNATURE MECHANICS</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px">
        ${SIGNATURE_TEN.map(s => `<div style="display:flex;gap:8px;align-items:flex-start;font-size:11px;line-height:1.4">
          <span style="color:${s.done ? 'var(--lime)' : 'var(--red)'};font-weight:900">${s.done ? '✔' : '✘'}</span>
          <span><b style="color:#fff">${esc(s.name)}</b><br><span style="color:var(--dim)">${esc(s.where)}</span></span>
        </div>`).join('')}
      </div>
    </div>
    <div class="panel" style="padding:14px;margin-bottom:14px">
      <div class="stat"><span>IMPLEMENTATION PROGRESS (partial counts as half)</span>
        <div class="bar" style="height:10px"><i style="width:${st.pct}%"></i></div></div>
      <div style="display:flex;gap:18px;margin-top:8px;font-size:10px;letter-spacing:.16em">
        <span style="color:var(--lime)">✔ ${st.done} DONE</span>
        <span style="color:var(--orange)">◐ ${st.partial} PARTIAL</span>
        <span style="color:var(--dim)">○ ${st.planned} PLANNED</span>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px">
      ${FEATURE_GROUPS.map(g => `
        <div class="panel" style="padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div style="font-size:11px;letter-spacing:.22em;color:var(--cyan)">${g.icon} ${esc(g.title)}</div>
            <div style="font-size:10px;color:var(--dim)">${g.items.filter(i => i.status === 'done').length}/${g.items.length}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:6px">
            ${g.items.map(i => `<div style="display:flex;gap:8px;font-size:11px;line-height:1.35;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04)">
              <span style="font-weight:900;flex:none;color:${i.status === 'done' ? 'var(--lime)' : i.status === 'partial' ? 'var(--orange)' : 'rgba(140,170,200,.5)'}">
                ${i.status === 'done' ? '✔' : i.status === 'partial' ? '◐' : '○'}</span>
              <span style="flex:1"><b style="color:${i.status === 'planned' ? 'var(--dim)' : '#fff'}">${i.n}. ${esc(i.name)}</b>
              <br><span style="color:rgba(140,170,200,.75);font-size:10px">${esc(i.where)}</span></span>
            </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
  }

  /* ============================================================
     RESULTS
     ============================================================ */
  render_results(root, res) {
    if (!res) return this.show('title');
    const r = res;
    const win = r.place === 1;
    root.innerHTML = `
    <div class="results">
      <div class="result-hero">
        <div class="screen-sub" style="margin-bottom:6px">${esc(r.eventName || 'QUICK RACE')} · ${esc(r.trackName || '')}</div>
        <div class="result-pl ${win ? 'win' : 'lose'}">${ordinal(r.place)}</div>
        <div style="font-size:12px;letter-spacing:.24em;color:var(--dim)">${win ? 'VICTORY' : r.finished ? 'RACE COMPLETE' : 'DNF'}</div>
      </div>
      <div class="rewards">
        ${r.rewards?.map(x => `<div class="reward">${esc(x.label)} <b>${esc(x.value)}</b></div>`).join('') || ''}
      </div>
      <div class="reslist">
        ${r.standings.map((s, i) => `
          <div class="resrow ${s.isPlayer ? 'me' : ''}">
            <div class="p">${i + 1}</div>
            <div style="display:flex;align-items:center;gap:9px;min-width:0">
              <span style="width:8px;height:8px;border-radius:50%;background:${cssHex(s.color)};flex:none"></span>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</span>
            </div>
            <div class="t">${s.finished ? fmtTime(s.totalTime) : 'DNF'}</div>
            <div class="t">${s.bestLap ? 'BEST ' + fmtTime(s.bestLap) : ''}</div>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:8px">
        <button class="btn primary" data-again data-sound>▶ RACE AGAIN</button>
        ${r.nextEvent ? `<button class="btn magenta" data-next data-sound>NEXT EVENT ▸</button>` : ''}
        <button class="btn ghost" data-nav="career" data-sound>CAREER</button>
        <button class="btn ghost" data-nav="title" data-sound>MAIN MENU</button>
      </div>
    </div>`;
    root.querySelector('[data-again]').addEventListener('click', () => r.onAgain?.());
    const nx = root.querySelector('[data-next]');
    if (nx) nx.addEventListener('click', () => r.onNext?.());
    this.game.audio?.finish(win);
  }

  /* ============================================================
     PAUSE
     ============================================================ */
  render_pause(root) {
    root.innerHTML = `
    <div class="pause-card panel" style="padding:26px;margin:auto">
      <h2>PAUSED</h2>
      <div class="screen-sub" style="margin-bottom:12px">${esc(this.game.currentEventName || '')}</div>
      <button class="btn primary wide" data-resume data-sound>RESUME</button>
      <button class="btn wide" data-restart data-sound>RESTART</button>
      <button class="btn ghost wide" data-quit data-sound>QUIT TO MENU</button>
      <div class="screen-sub" style="margin-top:6px">ESC / P TO RESUME</div>
    </div>`;
    root.querySelector('[data-resume]').addEventListener('click', () => this.game.resume());
    root.querySelector('[data-restart]').addEventListener('click', () => this.game.restartRace());
    root.querySelector('[data-quit]').addEventListener('click', () => this.game.quitToMenu());
  }

  render_help(root) {
    root.innerHTML = `
    ${this.topbar()}
    <div class="screen-head"><div><h2 class="screen-title">HOW TO PLAY</h2><div class="screen-sub">DRIVE FAST · DRIFT HARD · HIT HARDER</div></div>
      <button class="btn ghost" data-nav="title" data-sound>◀ BACK</button></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;max-width:1100px">
      <div class="panel" style="padding:16px">
        <h3 style="font-size:12px;letter-spacing:.2em;color:var(--cyan)">DRIVING</h3>
        <p style="font-size:12px;line-height:1.7;color:var(--dim)">
        <b>W / ↑</b> throttle · <b>S / ↓</b> brake &amp; reverse<br>
        <b>A · D / ← →</b> steer · <b>SPACE</b> handbrake drift<br>
        <b>SHIFT</b> nitro · <b>E</b> fire power-up · <b>C</b> camera<br>
        <b>B</b> look back · <b>R</b> recover · <b>ESC</b> pause</p>
      </div>
      <div class="panel" style="padding:16px">
        <h3 style="font-size:12px;letter-spacing:.2em;color:var(--lime)">DRIFT &amp; NITRO</h3>
        <p style="font-size:12px;line-height:1.7;color:var(--dim)">Hold the handbrake into a corner and counter-steer. The longer you hold the slide, the higher your combo multiplier and the faster nitro fills. Bank the score before you crash — a wall hit kills the chain.</p>
      </div>
      <div class="panel" style="padding:16px">
        <h3 style="font-size:12px;letter-spacing:.2em;color:var(--magenta)">POWER-UPS</h3>
        <p style="font-size:12px;line-height:1.7;color:var(--dim)">
        ${Object.entries(POWERS).map(([k, p]) => `<b style="color:${p.color}">${p.icon} ${p.name}</b> — ${esc(p.desc)}<br>`).join('')}
        </p>
      </div>
      <div class="panel" style="padding:16px">
        <h3 style="font-size:12px;letter-spacing:.2em;color:var(--orange)">TRACKS</h3>
        <p style="font-size:12px;line-height:1.7;color:var(--dim)">Hit the glowing chevron strips for free boost. Every neon gate is a checkpoint. Ramps launch you — steer with the stick in mid-air to land straight.</p>
      </div>
    </div>`;
  }

  /* ============================================================
     GARAGE 3D PREVIEW (own renderer, lazy)
     ============================================================ */
  _mountPreview(host, carId = null, liv = null) {
    if (!host) return;
    const car = this.game.save.carSpec(carId || this.game.save.profile.currentCar);
    const lv = liv || this.game.save.profile.livery[car.id] || {};
    if (this.garage) this._disposePreview(host);
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    host.appendChild(canvas);
    const W = host.clientWidth || 480, H = host.clientHeight || 300;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch (e) { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
    cam.position.set(6.4, 3.1, 7.4);
    cam.lookAt(0, 0.9, 0);

    scene.add(new THREE.AmbientLight(0x4a5a88, 1.2));
    const key = new THREE.DirectionalLight(0xbfe6ff, 3.2); key.position.set(4, 7, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xff2bd6, 2.4); rim.position.set(-6, 2.4, -4); scene.add(rim);
    const fill = new THREE.DirectionalLight(0x22e6ff, 1.4); fill.position.set(-3, 1.2, 6); scene.add(fill);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new THREE.Scene(), 0.04);
    // build a colourful env manually
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x0a1020);
    const strip = (c, x, y, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.6), new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(x, y, z); m.lookAt(0, 0.8, 0); envScene.add(m);
    };
    strip(0x22e6ff, -7, 4, 0); strip(0xff2bd6, 7, 3, -2); strip(0xffffff, 0, 7, 2);
    const env = pmrem.fromScene(envScene, 0.02);
    scene.environment = env.texture;

    const mesh = new CarMesh(car, { color: lv.paint ?? car.color, accent: lv.accent ?? car.accent, num: 1 });
    mesh.group.position.y = 0;
    scene.add(mesh.group);

    // podium
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.18, 48),
      new THREE.MeshStandardMaterial({ color: 0x0c1220, metalness: 0.9, roughness: 0.28, envMapIntensity: 1.4 }));
    disc.position.y = -0.09; scene.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.25, 0.035, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x22e6ff, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; scene.add(ring);

    const state = { angle: 0.6, raf: 0, alive: true, host };
    const loop = () => {
      if (!state.alive) return;
      state.angle += 0.006;
      const r = 9.2;
      cam.position.set(Math.cos(state.angle) * r * 0.72, 2.6 + Math.sin(state.angle * 0.7) * 0.5, Math.sin(state.angle) * r * 0.72);
      cam.lookAt(0, 0.85, 0);
      mesh.group.rotation.y = 0;
      renderer.render(scene, cam);
      state.raf = requestAnimationFrame(loop);
    };
    loop();
    const onResize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      cam.aspect = w / h; cam.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    this.garage = { renderer, scene, cam, mesh, state, onResize, pmrem, envRT, env };
  }

  _disposePreview(host) {
    const g = this.garage;
    if (!g) return;
    g.state.alive = false;
    cancelAnimationFrame(g.state.raf);
    window.removeEventListener('resize', g.onResize);
    g.mesh.dispose();
    g.renderer.dispose();
    try { g.pmrem.dispose(); } catch (e) { }
    this.garage = null;
    if (host) { const c = host.querySelector('canvas'); if (c) c.remove(); }
  }

  dispose() {
    this._disposePreview();
    this.container.innerHTML = '';
  }
}
