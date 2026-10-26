/* ============================================================
   SAVE — profile, progression, settings, achievements.
   localStorage with an in-memory fallback, versioned.
   ============================================================ */
import { CARS, ACHIEVEMENTS, DAILY_CHALLENGES } from './config.js';
import { clamp, randInt, clamp01, shuffle } from './util.js';

const KEY = 'neonrush.profile.v1';
const SET_KEY = 'neonrush.settings.v1';

export function xpForLevel(level) {
  // level 1 -> 2 needs 900, growing ~18%
  return Math.round(900 * Math.pow(1.18, level - 1));
}
export function levelProgress(profile) {
  const need = xpForLevel(profile.level);
  return { need, cur: profile.xp, pct: clamp01(profile.xp / need) };
}
export function totalXpToLevel(xp) {
  let lvl = 1, rem = xp;
  while (rem >= xpForLevel(lvl) && lvl < 70) { rem -= xpForLevel(lvl); lvl++; }
  return { level: lvl, rem };
}

export function defaultProfile() {
  return {
    v: 1,
    created: Date.now(),
    name: 'DRIVER',
    coins: 2500,
    tokens: 5,
    xp: 0,
    level: 1,
    skillPoints: 3,
    reputation: 0,
    ownedCars: ['pulse'],
    currentCar: 'pulse',
    carUpgrades: {},          // { carId: {engine:0..3, tires:0..3, brakes:0..3} }
    livery: {},               // { carId: {paint, accent, rim} }
    skillRanks: {},           // { skillId: rank }
    career: {},               // { eventId: {stars, bestTime, wins} }
    achievements: {},         // { id: timestamp }
    stats: {
      races: 0, wins: 0, podiums: 0, driftTotal: 0, bestDrift: 0, nitroUses: 0,
      shunts: 0, hitsTaken: 0, distance: 0, bestCombo: 1, topSpeed: 0,
      playTime: 0, bossWins: 0, bossBeaten: [], eliminationsWon: 0, airTime: 0,
      cleanLaps: 0, laps: 0, carsOwned: 1, eventsDone: 0,
    },
    daily: { date: '', list: [], claimed: {} },
    streak: { days: 0, last: '' },
    settings: null,          // stored separately but mirrored
    tutorialSeen: {},
    garageViewed: [],
    season: { xp: 0, tier: 0, claimed: {} },
    bestTimes: {},           // { trackId: seconds }
    ghost: null,             // last TT ghost samples
  };
}

export function defaultSettings() {
  return {
    audio: { master: 0.85, sfx: 0.9, music: 0.42, engine: 0.32, muted: false, musicOn: true },
    graphics: { quality: 'auto', bloom: true, shadows: true, dprCap: 1.75, fps: false },
    controls: {
      sensitivity: 1, deadzone: 0.14, assist: false, autoThrottle: false,
      touchMode: 'auto', leftHanded: false, gyro: false, camMode: 'chase',
      binds: null, difficulty: 'pro',
    },
    accessibility: { colorblind: 'off', largeText: false, reduceMotion: false, haptics: true },
    lastTrack: 'neon-district',
    lastMode: 'quick',
    playerName: 'DRIVER',
  };
}

export class Save {
  constructor() {
    this.available = true;
    this.mem = {};
    try {
      const t = '__nr_test__';
      localStorage.setItem(t, '1');
      localStorage.removeItem(t);
    } catch (e) { this.available = false; }

    this.profile = this.load();
    this.settings = this.loadSettings();
  }

  _read(key) {
    try {
      const raw = (this.available ? localStorage.getItem(key) : this.mem[key]);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  _write(key, val) {
    const raw = JSON.stringify(val);
    try {
      if (this.available) localStorage.setItem(key, raw);
      else this.mem[key] = raw;
    } catch (e) {
      // quota: try again after trimming the ghost
      try { this.profile.ghost = null; localStorage.setItem(key, JSON.stringify(this.profile)); } catch (e2) { /* ignore */ }
    }
  }

  load() {
    const d = defaultProfile();
    const saved = this._read(KEY);
    if (!saved) return d;
    // merge shallow + deep for forward compatibility
    const merged = { ...d, ...saved };
    merged.stats = { ...d.stats, ...(saved.stats || {}) };
    merged.daily = { ...d.daily, ...(saved.daily || {}) };
    merged.skillRanks = { ...(saved.skillRanks || {}) };
    merged.career = { ...(saved.career || {}) };
    merged.achievements = { ...(saved.achievements || {}) };
    merged.bestTimes = { ...(saved.bestTimes || {}) };
    merged.livery = { ...(saved.livery || {}) };
    merged.carUpgrades = { ...(saved.carUpgrades || {}) };
    return merged;
  }

  loadSettings() {
    const d = defaultSettings();
    const s = this._read(SET_KEY) || {};
    return {
      ...d, ...s,
      audio: { ...d.audio, ...(s.audio || {}) },
      graphics: { ...d.graphics, ...(s.graphics || {}) },
      controls: { ...d.controls, ...(s.controls || {}) },
      accessibility: { ...d.accessibility, ...(s.accessibility || {}) },
    };
  }

  save() { this._write(KEY, this.profile); }
  saveSettings() { this._write(SET_KEY, this.settings); }

  reset() {
    this.profile = defaultProfile();
    this.settings = defaultSettings();
    this.save();
    this.saveSettings();
  }

  /* ---------------- progression ---------------- */
  addXp(n) {
    const p = this.profile;
    p.xp += n;
    let leveled = 0;
    while (p.xp >= xpForLevel(p.level) && p.level < 70) {
      p.xp -= xpForLevel(p.level);
      p.level++;
      p.skillPoints++;
      leveled++;
      p.tokens += 1;
    }
    this.save();
    return leveled;
  }
  addCoins(n) { this.profile.coins = Math.max(0, this.profile.coins + n); this.save(); }
  spendCoins(n) {
    if (this.profile.coins < n) return false;
    this.profile.coins -= n; this.save(); return true;
  }
  addTokens(n) { this.profile.tokens = Math.max(0, this.profile.tokens + n); this.save(); }

  ownsCar(id) { return this.profile.ownedCars.includes(id); }
  buyCar(id) {
    const car = CARS.find(c => c.id === id);
    if (!car || this.ownsCar(id)) return false;
    if (!this.spendCoins(car.cost)) return false;
    this.profile.ownedCars.push(id);
    this.profile.stats.carsOwned = this.profile.ownedCars.length;
    this.save();
    return true;
  }
  selectCar(id) {
    if (!this.ownsCar(id)) return false;
    this.profile.currentCar = id;
    this.save();
    return true;
  }
  carSpec(id = this.profile.currentCar) { return CARS.find(c => c.id === id) || CARS[0]; }

  upgradesFor(id) {
    if (!this.profile.carUpgrades[id]) this.profile.carUpgrades[id] = { engine: 0, tires: 0, brakes: 0 };
    return this.profile.carUpgrades[id];
  }
  upgradeCost(id, part, rank) { return Math.round(600 * Math.pow(1.9, rank) * (1 + CARS.findIndex(c => c.id === id) * 0.12)); }
  buyUpgrade(id, part) {
    const u = this.upgradesFor(id);
    if (u[part] >= 3) return false;
    const cost = this.upgradeCost(id, part, u[part]);
    if (!this.spendCoins(cost)) return false;
    u[part]++;
    this.save();
    return true;
  }

  skillRank(id) { return this.profile.skillRanks[id] || 0; }
  learnSkill(skill) {
    const p = this.profile;
    if (skill.req && this.skillRank(skill.req) < 1) return { ok: false, reason: 'Requires previous tier' };
    if (this.skillRank(skill.id) > 0) return { ok: false, reason: 'Already learned' };
    if (p.skillPoints < skill.cost) return { ok: false, reason: 'Not enough skill points' };
    p.skillPoints -= skill.cost;
    p.skillRanks[skill.id] = 1;
    this.save();
    return { ok: true };
  }

  /* ---------------- achievements ---------------- */
  award(id) {
    if (this.profile.achievements[id]) return null;
    const a = ACHIEVEMENTS.find(x => x.id === id);
    if (!a) return null;
    this.profile.achievements[id] = Date.now();
    this.addXp(a.xp);
    this.addCoins(a.coins);
    this.save();
    return a;
  }
  checkAchievements(game) {
    const p = this.profile, s = p.stats;
    const got = [];
    const tryAward = (id) => { const a = this.award(id); if (a) got.push(a); };
    if (s.wins >= 1) tryAward('first_win');
    if (s.bestDrift >= 2500) tryAward('first_drift');
    if (s.bestCombo >= 5) tryAward('combo5');
    if (s.nitroUses >= 25) tryAward('nitro25');
    if (s.shunts >= 5) tryAward('shunt5');
    if (s.cleanLaps >= 1) tryAward('clean_lap');
    if (s.bossWins >= 1) tryAward('boss1');
    if (p.level >= 5) tryAward('level5');
    if (p.ownedCars.length >= CARS.length) tryAward('all_cars');
    if (s.eliminationsWon >= 1) tryAward('survivor');
    if (s.airTime >= 3) tryAward('airtime');
    return got;
  }

  /* ---------------- daily challenges ---------------- */
  ensureDaily() {
    const p = this.profile;
    const today = new Date().toISOString().slice(0, 10);
    if (p.daily.date === today) return p.daily;
    // streak
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (p.streak.last === y) p.streak.days++;
    else p.streak.days = 1;
    p.streak.last = today;
    const list = shuffle(DAILY_CHALLENGES).slice(0, 3).map(c => ({ ...c }));
    p.daily = { date: today, list, claimed: {} };
    this.save();
    return p.daily;
  }
  dailyProgress(type, amount) {
    const d = this.ensureDaily();
    for (const c of d.list) {
      if (c.type === type && !d.claimed[c.id]) {
        c.progress = Math.min(c.target, (c.progress || 0) + amount);
      }
    }
  }
  claimDaily(id) {
    const d = this.ensureDaily();
    const c = d.list.find(x => x.id === id);
    if (!c || d.claimed[id]) return false;
    if ((c.progress || 0) < c.target) return false;
    d.claimed[id] = true;
    this.addXp(c.xp); this.addCoins(c.coins);
    this.save();
    return true;
  }

  /* ---------------- season pass ---------------- */
  addSeasonXp(n) {
    this.profile.season.xp += n;
    const tiers = Math.floor(this.profile.season.xp / 1000);
    if (tiers > this.profile.season.tier) {
      this.profile.season.tier = Math.min(30, tiers);
      this.save();
    }
  }

  /* ---------------- times / ghosts ---------------- */
  recordTime(trackId, time) {
    const p = this.profile;
    const prev = p.bestTimes[trackId];
    if (!prev || time < prev) { p.bestTimes[trackId] = time; this.save(); return true; }
    return false;
  }
  saveGhost(trackId, samples) {
    this.profile.ghost = { trackId, samples: samples.slice(0, 2400), t: Date.now() };
    this.save();
  }
  loadGhost(trackId) {
    const g = this.profile.ghost;
    return g && g.trackId === trackId ? g : null;
  }
}
