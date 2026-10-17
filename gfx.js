// Graphics quality model: presets, per-category overrides, hardware-level detection, per-preset
// budgets and a cost summary.
// Pure (no three.js, no DOM), so the Settings panel, the renderer and the unit tests agree on
// what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],
  particles: ['low', 'high'],
  detail: ['plain', 'detailed'],
};

// Each preset is a row of tiers, a render scale (multiplies the capped device pixel ratio) and a
// pixel-ratio cap so Low never renders more pixels than the game did before presets existed.
const TABLE = {
  low: { scale: 1, cap: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', particles: 'low', detail: 'plain' },
  balanced: { scale: 1, cap: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', particles: 'high', detail: 'detailed' },
  high: { scale: 1, cap: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', particles: 'high', detail: 'detailed' },
  ultra: { scale: 1.25, cap: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', particles: 'high', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };
export const PARTICLE_COUNT = { low: 100, high: 700 };

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX
// 5090; gpu-level.js → window.StarHermitGpu, a classic script loaded before game.js): Low from 0, Balanced
// from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are capped at level 9 (Balanced).
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  if (!G) return LEVELS.balanced;
  return G.detectLevel({ webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || '') });
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (the hardware level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, typeof system === 'boolean' ? { mobile: system } : system));
}

/*
 * Per-preset asset and effect budget. Each preset is tuned to hold 60 FPS on the weakest GPU Auto gives
 * it (Low → level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Gameplay is
 * identical on every preset — finds, positions and hit areas never change, only visuals.
 *   material     room/item surfaces: 'lambert' | 'standard'; glazed/metal pieces get clearcoat 'physical'
 *                only on High+ (with Scene detail on)
 *   texture      procedural wood/rug canvas texture size in px (Scene detail: detailed)
 *   segments     round-geometry LOD multiplier for room props (rug, candle, clock); items keep their
 *                authored shapes so every hit area is identical on every preset
 *   candleLight  flickering candle point light (an extra light in every lit shader) — High/Ultra
 *   motes        dust motes at the floor level (Particles low: half, at most 100)
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 */
export const BUDGETS = {
  low: { material: 'lambert', texture: 64, segments: 0.5, candleLight: false, motes: 200, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', texture: 128, segments: 0.75, candleLight: false, motes: 350, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: 'physical', texture: 256, segments: 1, candleLight: true, motes: 700, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: 'physical', texture: 512, segments: 1.5, candleLight: true, motes: 1000, bloomRes: 1, aoRes: 1 },
};
export const MOTE_MAX = 2800;

/** A preset's concrete budget for a hardware level and Particles tier (counts scale ≤ 4× within the preset). */
export function budgetFor(preset, level, particles) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const motes = Math.min(MOTE_MAX, Math.round(b.motes * (G ? G.scaleBudget(1, lv, floor) : 1)));
  b.motes = particles === 'low' ? Math.min(PARTICLE_COUNT.low, Math.round(motes / 2)) : motes;
  return b;
}

/** Map the pre-preset `quality` setting (auto | high | medium | low) onto a preset. */
export function migrateQuality(q) {
  return { high: 'high', medium: 'balanced', low: 'low' }[q] || 'auto';
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: tier }.
 * A category that is missing or not a valid tier follows the preset.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const userScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, cap: row.cap, userScale, scale: row.scale * userScale };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level, out.particles);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas MSAA is used.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset] ? TABLE[preset][cat] : undefined;
}

/** A new saved object for a chosen preset: category overrides are cleared. */
export function choosePreset(saved, preset) {
  const s = saved || {};
  const out = { preset: preset === 'auto' || PRESETS.includes(preset) ? preset : 'auto' };
  for (const k of ['render_scale', 'adaptive', 'show_fps']) if (k in s) out[k] = s[k];
  return out;
}

const EN_WORDS = {
  noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
  bloom: 'bloom', reflections: 'reflections', noAa: 'no anti-aliasing', motes: 'motes',
};

/** Cost summary, e.g. "2048² shadows · ambient occlusion · bloom · SMAA · 700 motes · 1280×800 px". */
export function describe(r, pixels, words) {
  const w = Object.assign({}, EN_WORDS, words || {});
  const parts = [
    r.shadows === 'off' ? w.noShadows : `${SHADOW_MAP[r.shadows]}² ${w.shadows}`,
    r.ao === 'off' ? null : r.ao === 'high' ? w.aoHigh : w.ao,
    r.bloom === 'on' ? w.bloom : null,
    r.reflections === 'on' ? w.reflections : null,
    r.antialias === 'off' ? w.noAa : r.antialias.toUpperCase(),
    `${r.budget ? r.budget.motes : PARTICLE_COUNT[r.particles]} ${w.motes}`,
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
