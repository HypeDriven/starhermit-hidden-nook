'use strict';

// ---------------------------------------------------------------------------
// Hidden Nook - versioned content: items, themes, levels, tutorials,
// offline validators. UMD (Node + browser window.HNContent).
// All content is original and procedurally assembled from seeded streams.
// ---------------------------------------------------------------------------

(function (root, factory) {
  const rules = (typeof module === 'object' && module.exports) ? require('./rules.js') : root.HNRules;
  if (typeof module === 'object' && module.exports) module.exports = factory(rules);
  else root.HNContent = factory(rules);
})(typeof self !== 'undefined' ? self : this, function (HNRules) {

  const CONTENT_VERSION = 2;

  // --- original item vocabulary ---------------------------------------------
  // kind maps to procedural geometry in the renderer.
  const OBJECT_DEFS = [
    { kind: 'mug',      label: 'mug' },
    { kind: 'key',      label: 'key' },
    { kind: 'book',     label: 'book' },
    { kind: 'candle',   label: 'candle' },
    { kind: 'spool',    label: 'spool of thread' },
    { kind: 'acorn',    label: 'acorn' },
    { kind: 'bottle',   label: 'bottle' },
    { kind: 'clock',    label: 'pocket watch' },
    { kind: 'teapot',   label: 'teapot' },
    { kind: 'shell',    label: 'seashell' },
    { kind: 'bell',     label: 'bell' },
    { kind: 'thimble',  label: 'thimble' },
    { kind: 'feather',  label: 'feather' },
    { kind: 'coin',     label: 'coin' },
    { kind: 'button',   label: 'button' },
    { kind: 'pencil',   label: 'pencil' },
    { kind: 'lantern',  label: 'lantern' },
    { kind: 'pinecone', label: 'pinecone' },
    { kind: 'jar',      label: 'jar' },
    { kind: 'ribbon',   label: 'ribbon' },
  ];

  const ADJECTIVES = [
    'brass', 'copper', 'ivory', 'crimson', 'teal', 'amber', 'moss-green',
    'violet', 'striped', 'speckled', 'tiny', 'chipped', 'silver', 'wooden',
    'ceramic', 'faded', 'golden', 'indigo', 'rusty', 'porcelain',
  ];

  const ADJ_COLORS = {
    brass: 0xb08d57, copper: 0xb87333, ivory: 0xfffff0, crimson: 0xb22234,
    teal: 0x2a8a8a, amber: 0xd9962b, 'moss-green': 0x6b8e4e, violet: 0x7c5cbf,
    striped: 0xc94f6d, speckled: 0x9c8a70, tiny: 0x8fbcd4, chipped: 0xa0896a,
    silver: 0xbfc7cc, wooden: 0x8a5a33, ceramic: 0xdde4e6, faded: 0x9aa5b1,
    golden: 0xd4af37, indigo: 0x3f4a8c, rusty: 0x96422a, porcelain: 0xf2f0ea,
  };

  // --- five visual themes ------------------------------------------------------
  const THEMES = [
    { id: 'dawn',   name: 'Dawn',   wall: 0x3a3348, floor: 0x4a3f35, key: 0xffd9a0, fill: 0x8a7ba8, ambient: 0.55, fog: 0x241f30 },
    { id: 'day',    name: 'Day',    wall: 0x6d7f8e, floor: 0x7a6748, key: 0xfff3d6, fill: 0xaec6d8, ambient: 0.8,  fog: 0x3a4550 },
    { id: 'dusk',   name: 'Dusk',   wall: 0x4a3040, floor: 0x54382a, key: 0xff9a5c, fill: 0x6a4a72, ambient: 0.5,  fog: 0x2a1a26 },
    { id: 'night',  name: 'Night',  wall: 0x1c2438, floor: 0x2c241c, key: 0x9fb8ff, fill: 0x33406a, ambient: 0.35, fog: 0x10141f },
    { id: 'autumn', name: 'Autumn', wall: 0x5a4130, floor: 0x4c3a24, key: 0xffc46b, fill: 0x8a5a3a, ambient: 0.6,  fog: 0x2e2118 },
  ];

  // Placement anchors inside the miniature room (deterministic per seed).
  const ANCHORS = [];
  (function buildAnchors() {
    // shelves rows, floor spots, tabletop spots — authored coordinate set
    const rows = [
      { y: 2.2, z: -3.6, n: 6, x0: -4.5, dx: 1.8 },  // back shelf low
      { y: 3.6, z: -3.6, n: 5, x0: -3.6, dx: 1.8 },  // back shelf high
      { y: 0.0, z: -1.0, n: 5, x0: -4.0, dx: 2.0 },  // floor front
      { y: 0.9, z: 0.6,  n: 4, x0: -2.7, dx: 1.8 },  // tabletop
      { y: 0.0, z: 1.8,  n: 4, x0: -3.0, dx: 2.0 },  // rug area
      { y: 1.5, z: -0.2, n: 3, x0: -2.0, dx: 2.0 },  // crate tops
    ];
    for (const r of rows) {
      for (let i = 0; i < r.n; i++) {
        ANCHORS.push({ x: r.x0 + i * r.dx, y: r.y, z: r.z });
      }
    }
  })();

  // --- level generation ---------------------------------------------------------
  // difficulty tiers: item count, decoys, wave size, time pressure
  function tierFor(index) {
    if (index < 5)  return { items: 6,  decoys: 2, waveSize: 2, parSeconds: 90,  timeLimit: null, moveLimit: null };
    if (index < 10) return { items: 8,  decoys: 4, waveSize: 3, parSeconds: 120, timeLimit: null, moveLimit: null };
    if (index < 15) return { items: 10, decoys: 6, waveSize: 3, parSeconds: 150, timeLimit: 300, moveLimit: null };
    if (index < 20) return { items: 10, decoys: 8, waveSize: 4, parSeconds: 150, timeLimit: 240, moveLimit: null };
    if (index < 25) return { items: 12, decoys: 8, waveSize: 4, parSeconds: 180, timeLimit: 240, moveLimit: 24 };
    if (index < 30) return { items: 12, decoys: 10, waveSize: 4, parSeconds: 180, timeLimit: 210, moveLimit: 22 };
    if (index < 35) return { items: 14, decoys: 12, waveSize: 5, parSeconds: 210, timeLimit: 200, moveLimit: 22 };
    return { items: 16, decoys: 14, waveSize: 5, parSeconds: 240, timeLimit: 180, moveLimit: 20 };
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Generate a deterministic level from (index, seed).
  function generateLevel(index, seed, opts) {
    const o = opts || {};
    const tier = tierFor(index);
    const rng = HNRules.mulberry32((seed >>> 0) ^ (index * 0x9e3779b9));
    const decoRng = HNRules.mulberry32(((seed >>> 0) ^ 0xdec0de) + index);

    const totalWanted = tier.items;
    const total = totalWanted + tier.decoys;
    const kinds = shuffle(OBJECT_DEFS.map((_, i) => i), rng);
    const adjs = shuffle(ADJECTIVES.map((_, i) => i), rng);
    const anchors = shuffle(ANCHORS.map((_, i) => i), rng);

    const items = [];
    const usedNames = new Set();
    for (let i = 0; i < total; i++) {
      const def = OBJECT_DEFS[kinds[i % kinds.length]];
      const adj = ADJECTIVES[adjs[i % adjs.length]];
      let name = adj + ' ' + def.label;
      let guard = 0;
      while (usedNames.has(name) && guard++ < 40) {
        name = ADJECTIVES[adjs[(i + guard) % adjs.length]] + ' ' + def.label;
      }
      usedNames.add(name);
      const a = ANCHORS[anchors[i % anchors.length]];
      items.push({
        id: 'it' + i,
        name,
        kind: def.kind,
        color: ADJ_COLORS[adj] || 0x999999,
        requested: i < totalWanted,
        pos: [
          Math.round((a.x + (rng() - 0.5) * 0.5) * 100) / 100,
          Math.round(a.y * 100) / 100,
          Math.round((a.z + (rng() - 0.5) * 0.5) * 100) / 100,
        ],
        rotY: Math.round(rng() * Math.PI * 2 * 100) / 100,
        scale: Math.round((0.8 + rng() * 0.5) * 100) / 100,
        bobPhase: Math.round(decoRng() * 6.28 * 100) / 100,
      });
    }

    // Waves: shuffled requested indices chunked by wave size.
    const reqIdx = shuffle(items.map((it, i) => (it.requested ? i : -1)).filter((i) => i >= 0), rng);
    const waves = [];
    for (let i = 0; i < reqIdx.length; i += tier.waveSize) waves.push(reqIdx.slice(i, i + tier.waveSize));

    return {
      id: o.id || ('journey-' + (index + 1)),
      contentVersion: CONTENT_VERSION,
      index,
      seed: seed >>> 0,
      items,
      waves,
      parSeconds: tier.parSeconds,
      timeLimitSeconds: o.timeLimitSeconds != null ? o.timeLimitSeconds : tier.timeLimit,
      moveLimit: o.moveLimit != null ? o.moveLimit : tier.moveLimit,
      allowUndo: o.allowUndo != null ? o.allowUndo : index < 10,
      allowHints: true,
      theme: THEMES[(o.themeIndex != null ? o.themeIndex : index) % THEMES.length].id,
      tutorial: index === 0,
      difficulty: {
        solutionDepth: totalWanted,
        branchingFactor: total,
        timePressure: tier.timeLimit ? 2 : 0,
        motorPrecision: 1,
        hiddenInformation: 0,
        recovery: (o.allowUndo != null ? o.allowUndo : index < 10) ? 1 : 0,
      },
    };
  }

  const JOURNEY_COUNT = 40;

  function journeyLevel(index) {
    return generateLevel(index, 0x5eed000 + index * 7919);
  }

  // One shared seed + ruleset per UTC day.
  function dailyLevel(dateISO, serverTimeMs) {
    const day = dateISO || new Date(serverTimeMs || Date.now()).toISOString().slice(0, 10);
    const seed = HNRules.hashString('hidden-nook-daily:' + day);
    const lvl = generateLevel(HNRules.hashString(day) % JOURNEY_COUNT, seed, {
      id: 'daily-' + day,
      themeIndex: HNRules.hashString('theme:' + day) % THEMES.length,
    });
    lvl.dailyDay = day;
    return lvl;
  }

  function practiceLevel(difficulty, seed) {
    const idx = { easy: 2, medium: 12, hard: 27 }[difficulty] != null ? { easy: 2, medium: 12, hard: 27 }[difficulty] : 12;
    return generateLevel(idx, seed >>> 0, { id: 'practice-' + difficulty + '-' + (seed >>> 0).toString(36), allowUndo: true });
  }

  function challengeLevel(kind, seed) {
    if (kind === 'speed') {
      return generateLevel(12, seed >>> 0, { id: 'challenge-speed-' + (seed >>> 0).toString(36), timeLimitSeconds: 90, allowUndo: false });
    }
    if (kind === 'moves') {
      return generateLevel(20, seed >>> 0, { id: 'challenge-moves-' + (seed >>> 0).toString(36), moveLimit: 14, timeLimitSeconds: null, allowUndo: false });
    }
    return generateLevel(30, seed >>> 0, { id: 'challenge-crowded-' + (seed >>> 0).toString(36), allowUndo: false });
  }

  // Learn mode: scripted one-rule-at-a-time lessons.
  const TUTORIAL_STEPS = [
    { id: 'pan',    text: 'Drag to look around the room. Find the glowing marker.', action: 'pan' },
    { id: 'find',   text: 'Tap the object named in the request strip.', action: 'find' },
    { id: 'wrong',  text: 'Only requested objects count. Tapping others costs points.', action: 'find-requested' },
    { id: 'wave',   text: 'Finish the strip to reveal the next set.', action: 'wave' },
    { id: 'hint',   text: 'Stuck? Use a hint — it costs points but marks a target.', action: 'hint' },
  ];

  function tutorialLevel() {
    const lvl = generateLevel(0, 0x70f7, { id: 'tutorial', allowUndo: true });
    lvl.tutorial = true;
    return lvl;
  }

  // --- offline validators -------------------------------------------------------
  // Prove basic legality, reachable goals, bounded duration, no soft locks.
  function validateLevel(level) {
    const errors = [];
    if (!level.id || typeof level.id !== 'string') errors.push('missing id');
    if (!(level.seed >>> 0) && level.seed !== 0) errors.push('bad seed');
    if (!Array.isArray(level.items) || level.items.length === 0) errors.push('no items');
    const names = new Set();
    let requested = 0;
    (level.items || []).forEach((it, i) => {
      if (!it.name) errors.push('item ' + i + ' missing name');
      if (names.has(it.name)) errors.push('duplicate name: ' + it.name);
      names.add(it.name);
      if (it.requested) requested++;
      if (!Array.isArray(it.pos) || it.pos.length !== 3 || it.pos.some((v) => !isFinite(v))) errors.push('item ' + i + ' bad pos');
      if (Math.abs(it.pos[0]) > 8 || it.pos[1] < -0.1 || it.pos[1] > 6 || Math.abs(it.pos[2]) > 6) errors.push('item ' + i + ' out of bounds');
    });
    const inWaves = new Set();
    (level.waves || []).forEach((w) => w.forEach((i) => {
      if (i < 0 || i >= level.items.length) errors.push('wave index out of range: ' + i);
      if (inWaves.has(i)) errors.push('item ' + i + ' in two waves');
      inWaves.add(i);
      if (!level.items[i].requested) errors.push('non-requested item ' + i + ' in a wave');
    }));
    if (inWaves.size !== requested) errors.push('waves do not cover all requested items (' + inWaves.size + '/' + requested + ')');
    if (requested === 0) errors.push('no requested items: unreachable goal');
    if (!(level.parSeconds > 0)) errors.push('bad parSeconds');
    if (level.timeLimitSeconds != null && level.timeLimitSeconds < requested) errors.push('time limit below one second per item');
    if (level.moveLimit != null && level.moveLimit < requested) errors.push('move limit below requested count: soft lock');
    if (!THEMES.some((t) => t.id === level.theme)) errors.push('unknown theme: ' + level.theme);
    return { ok: errors.length === 0, errors };
  }

  function validateAll() {
    const errors = [];
    for (let i = 0; i < JOURNEY_COUNT; i++) {
      const r = validateLevel(journeyLevel(i));
      if (!r.ok) errors.push({ level: i, errors: r.errors });
    }
    const d = validateLevel(dailyLevel('2026-01-01'));
    if (!d.ok) errors.push({ level: 'daily', errors: d.errors });
    return { ok: errors.length === 0, errors };
  }

  return {
    CONTENT_VERSION, OBJECT_DEFS, ADJECTIVES, ADJ_COLORS, THEMES, ANCHORS,
    JOURNEY_COUNT, TUTORIAL_STEPS,
    generateLevel, journeyLevel, dailyLevel, practiceLevel, challengeLevel, tutorialLevel,
    validateLevel, validateAll, tierFor,
  };
});
