/* ============================================================
   CONFIG — single source of truth for tuning.
   All units: metres, seconds, radians. Speeds shown as km/h.
   ============================================================ */
export const VERSION = '1.0.0';

export const CFG = {
  track: {
    halfWidth: 13,          // road half-width (m)
    wallWidth: 1.6,
    samples: 900,           // racing-line samples
    laps: 3,
    bankingMax: 0.16,
  },
  phys: {
    g: 26.0,                // arcade gravity (m/s^2) — punchy jumps
    gripBase: 22.0,         // lateral grip accel (m/s^2) — arcade-leaning
    gripFront: 1.02,
    gripRear: 0.97,
    drag: 0.00040,          // quadratic drag coefficient
    downforce: 0.0024,
    rollResist: 0.62,
    brakeDecel: 58.0,
    reverseAccel: 18.0,
    maxSteer: 0.60,         // rad of steer angle at standstill (arcade)
    steerFalloff: 0.05,     // steering reduction per m/s
    minSteerFactor: 0.34,
    yawInertia: 4.6,
    driftYawGain: 3.0,
    handbrakeGrip: 0.30,
    handbrakeDrag: 0.30,
    airControl: 1.9,
    slipLateral: 4.2,       // m/s lateral => drift scoring starts
    scrapeSpeed: 1.6,       // m/s normal impact to trigger sparks
    weightTransfer: 0.55,
  },
  boost: {
    max: 100,
    drainPerSec: 34,
    driftGain: 15,          // per second of scoring drift
    padGain: 26,
    thrust: 26.0,           // extra forward accel while boosting
    topSpeedMul: 1.36,
    minToStart: 12,
    comboBoostMul: 1.0,     // combo adds extra thrust (set below per combo)
  },
  drift: {
    baseRate: 120,          // score per sec at entry
    angleScore: 18,         // per rad of slip beyond threshold
    speedScore: 1.6,        // per m/s
    comboStep: 3.4,         // seconds of drift per combo step
    maxCombo: 10,
    chainWindow: 1.6,       // seconds to keep the chain after ending a drift
  },
  camera: {
    fovBase: 64,
    fovMax: 88,
    fovBoost: 10,
    chaseDist: 7.4,
    chaseHeight: 3.55,
    lookAhead: 9.0,
    lag: 5.2,
    shakeDecay: 5.0,
  },
  render: {
    maxPixelRatio: 1.75,
    minPixelRatio: 0.62,
    shadowMap: 2048,
    bloomStrength: 0.46,
    bloomRadius: 0.55,
    bloomThreshold: 0.88,
    fogNear: 90,
    fogFar: 620,
  },
  ai: {
    count: 7,               // opponents (8-car grid)
    lookAheadBase: 12,
    rubberBandMax: 0.16,    // +-16% speed authority
    catchUpDist: 260,
  },
  race: {
    countdown: 3.6,
    respawnDelay: 1.1,
    respawnInvuln: 1.9,
    eliminationInterval: 22,
  },
};

/* ---- car archetypes ------------------------------------------------ */
/* speed: m/s top speed; accel: m/s^2; grip: lateral multiplier;
   handling: steering multiplier; mass: kg-ish (used for shunt force) */
export const CARS = [
  { id:'pulse',    name:'PULSAR GT',     cls:'SPORTS', speed:88,  accel:19.5, grip:1.02, handling:1.00, mass:1.00, color:0x22e6ff, accent:0xff2bd6, cost:0,     stats:[0.62,0.6,0.58], desc:'Balanced entry coupe. Forgiving drift window.' },
  { id:'vandal',   name:'VANDAL RS',     cls:'MUSCLE', speed:92,  accel:23.0, grip:0.92, handling:0.92, mass:1.16, color:0xff8a1f, accent:0xffe36b, cost:1200,  stats:[0.7,0.72,0.48], desc:'Torque-heavy muscle. Loves power slides.' },
  { id:'kite',     name:'KITE X',        cls:'SPORTS', speed:90,  accel:20.5, grip:1.10, handling:1.12, mass:0.92, color:0xc6ff2b, accent:0x22e6ff, cost:2200,  stats:[0.64,0.58,0.72], desc:'Lightweight grip monster for tight lines.' },
  { id:'spectre',  name:'SPECTRE 9',     cls:'HYPER',  speed:101, accel:25.5, grip:1.00, handling:1.04, mass:1.02, color:0xff2bd6, accent:0x22e6ff, cost:4200,  stats:[0.86,0.78,0.6],  desc:'Hypercar. Brutal top end, twitchy on exit.' },
  { id:'mammoth',  name:'MAMMOTH',       cls:'MUSCLE', speed:94,  accel:21.0, grip:0.88, handling:0.86, mass:1.42, color:0x8a5cff, accent:0xc6ff2b, cost:3600,  stats:[0.68,0.8,0.4],  desc:'Heavy bruiser. Shunts hurt twice as much.' },
  { id:'wraith',   name:'WRAITH EVO',    cls:'HYPER',  speed:98,  accel:24.0, grip:1.14, handling:1.16, mass:0.94, color:0xe8f4ff, accent:0x22e6ff, cost:6800,  stats:[0.9,0.7,0.7],   desc:'Prototype. Best all-rounder once unlocked.' },
  { id:'nova',     name:'NOVA BLADE',    cls:'HYPER',  speed:106, accel:27.0, grip:1.06, handling:1.08, mass:0.90, color:0xffe36b, accent:0xff2bd6, cost:11000, stats:[1.0,0.9,0.66],  desc:'Blur-class hypercar. Top speed record holder.' },
];

export const CLASS_COLORS = { SPORTS:'#22e6ff', MUSCLE:'#ff8a1f', HYPER:'#ff2bd6' };

/* ---- power-ups (Blur style) ---------------------------------------- */
export const POWERS = {
  nitro:  { name:'NITRO',  icon:'⚡', color:'#22e6ff', dur:4.5, desc:'Instant overboost. Stacks with drift combo.' },
  shock:  { name:'SHOCK',  icon:'☠', color:'#ff2bd6', dur:0,  desc:'Homing bolt. Fires forward at the next car.' },
  shunt:  { name:'SHUNT',  icon:'✹', color:'#ff8a1f', dur:0,  desc:'Close-range slam. Massive knockback.' },
  shield: { name:'SHIELD', icon:'◈', color:'#c6ff2b', dur:9.0, desc:'Blocks one hit and reflects shunts.' },
  bolt:   { name:'BOLT',   icon:'➤', color:'#ffe36b', dur:0,  desc:'Instant triple burst forward.' },
  repair: { name:'REPAIR', icon:'✚', color:'#7dffb0', dur:0,  desc:'Restores bodywork and clears damage.' },
};
export const POWER_KEYS = Object.keys(POWERS);
export const PICKUP_WEIGHTS = { nitro:26, shock:14, shunt:14, shield:20, bolt:14, repair:12 };

/* ---- tracks --------------------------------------------------------- */
/* control points: [x, z, y] — closed Catmull-Rom loop.
   theme drives palette, props and weather defaults. */
export const TRACKS = [
  {
    id:'neon-district', name:'NEON DISTRICT', theme:'city',
    desc:'Rain-slick downtown loop. Neon canyons, two tunnels, one big jump.',
    length:'~2.4 km',
    points:[
      [0,0,0],[160,-14,0],[300,-60,2],[360,-170,6],[300,-280,10],
      [150,-320,12],[-10,-300,14],[-120,-215,10],[-190,-90,6],
      [-260,40,2],[-230,170,0],[-90,235,-2],[70,215,0],[150,110,1],
    ],
    weather:'rain', time:'night', music:'neon', aiSkill:0.78,
  },
  {
    id:'sunset-bay', name:'SUNSET BAY', theme:'desert',
    desc:'Dusty coastal sweepers and a long flat-out straight. Grip is king.',
    length:'~2.6 km',
    points:[
      [0,0,0],[230,-10,0],[400,-70,1],[470,-200,2],[370,-320,3],
      [200,-350,4],[40,-330,5],[-60,-420,4],[-200,-430,6],
      [-320,-320,4],[-310,-170,2],[-190,-60,0],[-70,30,0],
    ],
    weather:'clear', time:'sunset', music:'sunset', aiSkill:0.80,
  },
  {
    id:'glacier-run', name:'GLACIER RUN', theme:'snow',
    desc:'Low-grip ice circuit. Drift everything, chain your combos.',
    length:'~2.2 km',
    grip:0.72, weather:'snow', time:'day', music:'ice', aiSkill:0.82,
    points:[
      [0,0,0],[140,-30,3],[230,-140,9],[190,-260,16],[60,-300,20],
      [-70,-250,18],[-120,-130,12],[-200,-40,6],[-180,90,2],
      [-60,150,0],[60,120,0],
    ],
  },
  {
    id:'inferno-pit', name:'INFERNO PIT', theme:'jungle',
    desc:'Overgrown industrial loop. Tight chicanes hidden behind neon mist.',
    length:'~2.5 km',
    grip:0.94, weather:'storm', time:'dusk', music:'inferno', aiSkill:0.88,
    points:[
      [0,0,0],[120,-40,2],[200,-150,8],[120,-240,14],[0,-260,16],
      [-120,-210,12],[-150,-90,8],[-260,-30,6],[-240,120,3],
      [-100,190,0],[40,160,0],[90,80,0],
    ],
  },
];

/* ---- career events -------------------------------------------------- */
/* type: race | elimination | drift | tt | boss */
export const CAREER = [
  { id:'c1', name:'FIRST IGNITION', track:'neon-district', type:'race',        laps:2, ai:0.68, rivals:5, reward:400,  rep:3,  desc:'Learn the line. Win to unlock Sunset Bay.' },
  { id:'c2', name:'CANYON CUT',     track:'sunset-bay',    type:'race',        laps:2, ai:0.72, rivals:5, reward:500,  rep:6,  desc:'Wide sweepers. Carry speed or lose the pack.' },
  { id:'c3', name:'DRIFT KING',     track:'glacier-run',   type:'drift',       laps:2, ai:0.66, rivals:3, reward:600,  rep:8,  target:14000, desc:'Score 14,000 drift points before the flag.' },
  { id:'c4', name:'ICE BREAKER',    track:'glacier-run',   type:'race',        laps:2, ai:0.76, rivals:5, reward:700,  rep:10, desc:'Low grip, high stakes. Tune for stability.' },
  { id:'c5', name:'ELIMINATION',    track:'neon-district', type:'elimination', laps:99, ai:0.78, rivals:6, reward:900,  rep:14, desc:'Last place is eliminated every 22s. Survive.' },
  { id:'c6', name:'TIME ATTACK',    track:'sunset-bay',    type:'tt',          laps:3, ai:0.0,  rivals:0, reward:800,  rep:12, desc:'Three laps, no traffic. Beat the phantom.' },
  { id:'c7', name:'RIVAL: KAZE',    track:'inferno-pit',   type:'boss',        laps:2, ai:0.86, rivals:3, reward:1600, rep:22, boss:'KAZE', desc:'Boss race. KAZE drives dirty and does not lift.' },
  { id:'c8', name:'NEON GAUNTLET',  track:'neon-district', type:'elimination', laps:99, ai:0.84, rivals:7, reward:1500, rep:20, desc:'Eight cars, rising heat, one survivor.' },
  { id:'c9', name:'RIVAL: VEX',     track:'glacier-run',   type:'boss',        laps:3, ai:0.90, rivals:3, reward:2400, rep:30, boss:'VEX', desc:'Boss race. VEX owns the ice. Bring a shield.' },
  { id:'c10',name:'FINAL: THE BLUR',track:'inferno-pit',   type:'boss',        laps:3, ai:0.96, rivals:7, reward:5000, rep:50, boss:'NULL', desc:'The last race. NULL has every trick you do.' },
];

/* ---- AI personalities & bosses -------------------------------------- */
export const AI_PERSONALITIES = [
  { id:'clean',    name:'CLEAN',    aggression:0.15, skill:1.00, radar:0.95, taunt:['Nice line.','See you at the flag.'] },
  { id:'aggressive',name:'AGGRO',   aggression:0.85, skill:1.02, radar:0.72, taunt:['Move over!','Out of my way!'] },
  { id:'defensive',name:'GUARD',    aggression:0.30, skill:0.98, radar:0.90, taunt:['You shall not pass.','Stay behind me.'] },
  { id:'drifter',  name:'DRIFTER',  aggression:0.45, skill:1.04, radar:0.80, taunt:['Watch this angle.','Sideways is faster.'] },
  { id:'rammer',   name:'RAMMER',   aggression:1.00, skill:0.96, radar:0.60, taunt:['Bumper first.','Feel that?'] },
];

export const BOSSES = {
  KAZE: { name:'KAZE',  car:'spectre', color:0xff2bd6, skill:1.10, aggression:0.9, taunt:['Too slow.','I own this district.'] },
  VEX:  { name:'VEX',   car:'wraith',  color:0xc6ff2b, skill:1.16, aggression:0.8, taunt:['Slide away.','Stay frozen.'] },
  NULL: { name:'NULL',  car:'nova',    color:0xe8f4ff, skill:1.24, aggression:0.95,taunt:['I am the blur.','You cannot see me.'] },
};

export const AI_NAMES = ['RAZOR','JINX','HEX','NOVA-7','TORQUE','SABLE','GHOST','VANTA','ONYX','FLUX'];

/* ---- skill tree ----------------------------------------------------- */
export const SKILLS = [
  { id:'top1', branch:'SPEED',    name:'Stage 1 Turbo', desc:'+4% top speed', cost:1, tier:1 },
  { id:'top2', branch:'SPEED',    name:'Stage 2 Turbo', desc:'+4% top speed', cost:2, tier:2, req:'top1' },
  { id:'top3', branch:'SPEED',    name:'Stage 3 Turbo', desc:'+6% top speed', cost:3, tier:3, req:'top2' },
  { id:'acc1', branch:'SPEED',    name:'Lightweight Fly', desc:'+7% acceleration', cost:1, tier:1 },
  { id:'acc2', branch:'SPEED',    name:'Launch Control',  desc:'+8% acceleration', cost:2, tier:2, req:'acc1' },
  { id:'nit1', branch:'SPEED',    name:'Big Bottle',   desc:'+20 nitro capacity', cost:1, tier:1 },
  { id:'dft1', branch:'DRIFT',    name:'Wide Angle',   desc:'+15% drift score rate', cost:1, tier:1 },
  { id:'dft2', branch:'DRIFT',    name:'Long Slide',   desc:'+12% combo time', cost:2, tier:2, req:'dft1' },
  { id:'dft3', branch:'DRIFT',    name:'Chain Master', desc:'Max combo 12', cost:3, tier:3, req:'dft2' },
  { id:'nit2', branch:'DRIFT',    name:'Recycler',     desc:'+30% drift nitro gain', cost:1, tier:1 },
  { id:'grip1',branch:'DRIFT',    name:'Sticky Rear',  desc:'+5% lateral grip', cost:1, tier:1 },
  { id:'arm1', branch:'DURABILITY',name:'Roll Cage',   desc:'-25% damage taken', cost:1, tier:1 },
  { id:'arm2', branch:'DURABILITY',name:'Panel Plating',desc:'-20% damage taken', cost:2, tier:2, req:'arm1' },
  { id:'shd1', branch:'DURABILITY',name:'Shield Battery',desc:'+3s shield duration', cost:2, tier:2 },
  { id:'rep1', branch:'DURABILITY',name:'Fast Repair', desc:'Repair heals 40% more', cost:1, tier:1 },
  { id:'sco1', branch:'DURABILITY',name:'Score Armor', desc:'Keep 50% combo on hit', cost:3, tier:3, req:'arm1' },
];
export const SKILL_BRANCHES = ['SPEED','DRIFT','DURABILITY'];

/* ---- achievements --------------------------------------------------- */
export const ACHIEVEMENTS = [
  { id:'first_win',  name:'First Blood',      desc:'Win your first race',            xp:100, coins:150 },
  { id:'first_drift',name:'Sideways',         desc:'Land a 2,500 point drift',       xp:80,  coins:100 },
  { id:'combo5',     name:'Combo Artist',     desc:'Reach a x5 drift combo',         xp:150, coins:200 },
  { id:'nitro25',    name:'Bottle Service',   desc:'Use 25 nitro boosts (career)',   xp:120, coins:180 },
  { id:'shunt5',     name:'Battering Ram',    desc:'Land 5 shunts on rivals',        xp:150, coins:220 },
  { id:'clean_lap',  name:'On Rails',         desc:'Complete a lap with no wall hits',xp:140, coins:200 },
  { id:'boss1',      name:'Giant Slayer',     desc:'Beat your first boss',           xp:300, coins:400 },
  { id:'level5',     name:'Rising Star',      desc:'Reach level 5',                  xp:200, coins:250 },
  { id:'all_cars',   name:'Collector',        desc:'Own every car',                  xp:500, coins:800 },
  { id:'survivor',   name:'Survivor',         desc:'Win an elimination event',       xp:250, coins:350 },
  { id:'airtime',    name:'Air Time',         desc:'Spend 3s airborne in one jump',  xp:100, coins:120 },
  { id:'perfect_tt', name:'Untouchable',      desc:'Set a time trial best',          xp:180, coins:240 },
];

export const DAILY_CHALLENGES = [
  { id:'d_drift',  name:'Drift 8,000 points',   type:'drift',  target:8000,  xp:120, coins:200 },
  { id:'d_win',    name:'Win 2 races',          type:'wins',   target:2,     xp:150, coins:250 },
  { id:'d_nitro',  name:'Use nitro 12 times',   type:'nitro',  target:12,    xp:100, coins:160 },
  { id:'d_shunt',  name:'Land 3 shunts',        type:'shunts', target:3,     xp:110, coins:180 },
  { id:'d_finish', name:'Finish 3 events',      type:'races',  target:3,     xp:130, coins:210 },
];

/* ---- palettes per theme --------------------------------------------- */
export const THEMES = {
  city:    { road:'#1a1d28', line:'#22e6ff', accent:'#ff2bd6', fog:'#0b1024', env:'#0a1226', wall:'#22e6ff' },
  desert:  { road:'#3a3126', line:'#ffd27a', accent:'#ff8a1f', fog:'#c98b5a', env:'#33241a', wall:'#ffb347' },
  snow:    { road:'#c9d8e8', line:'#8fe9ff', accent:'#22e6ff', fog:'#dcecff', env:'#a8c4dd', wall:'#7ad9ff' },
  jungle:  { road:'#20241c', line:'#c6ff2b', accent:'#7dffb0', fog:'#16301f', env:'#0d1a12', wall:'#c6ff2b' },
};

export const TIMES = {
  night:  { sun:0.55, ambient:0.70,  bg:'#0a1024', hemi:'#25406e', dir:'#7f9dff', fogMul:0.55 },
  day:    { sun:2.05, ambient:0.95,  bg:'#8fb8e8', hemi:'#cfe6ff', dir:'#ffffff', fogMul:1.00 },
  sunset: { sun:1.45, ambient:0.72,  bg:'#2a1a2e', hemi:'#ff8a5a', dir:'#ffb347', fogMul:0.80 },
  dusk:   { sun:0.85, ambient:0.58,  bg:'#150c24', hemi:'#8a4fff', dir:'#ff2bd6', fogMul:0.70 },
};

export const WEATHER = {
  clear:  { particles:0,    gripMul:1.00, fogMul:1.00, wetness:0.0, music:'clear' },
  rain:   { particles:1400, gripMul:0.92, fogMul:1.15, wetness:0.8, music:'rain' },
  snow:   { particles:900,  gripMul:0.78, fogMul:1.30, wetness:0.4, music:'snow' },
  storm:  { particles:2000, gripMul:0.86, fogMul:1.35, wetness:0.9, music:'storm', lightning:true },
};

export const DIFFICULTY = {
  rookie:   { ai:0.82, assist:true,  name:'ROOKIE' },
  pro:      { ai:1.00, assist:false, name:'PRO' },
  blur:     { ai:1.14, assist:false, name:'BLUR' },
};
