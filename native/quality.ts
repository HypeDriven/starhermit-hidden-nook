// The look per graphics level: the browser build's four presets and budgets
// (gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU Auto
// gave it) keyed by the runtime's quality tier (frame().quality), with the
// dust motes scaled within the tier by the level (frame().levelIndex) as the
// browser build scaled them by its hardware level. The runtime owns the rest
// of what the old Graphics panel did: Auto and the level choice, render scale
// and the pixel-ratio cap, adaptive resolution, the frame-rate limit and
// readout, and the shadow-map size and MSAA samples it holds to the level.
// The per-category overrides of the old panel are not offered (the
// runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** Lit surfaces: Lambert (no PBR), standard, or clear-coat physical on glazed and metal pieces. */
  material: "lambert" | "standard" | "physical";
  /** Wood and rug canvas texture size in px (Room detail). */
  texture: number;
  /** Round-geometry segment multiplier (rug, candle, clock). */
  segments: number;
  /** The candle's flickering glow light (Room detail). */
  candleLight: boolean;
  motes: number;
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: Preset;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  /** Room detail "detailed": wood grain and rug textures, wall trim, the print, the window, the clock face. */
  detailed: boolean;
  budget: Budget;
}

const TABLE: Record<Preset, Omit<Look, "preset" | "budget"> & { particles: "low" | "high" }> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, particles: "low", detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, particles: "high", detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particles: "high", detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particles: "high", detailed: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", texture: 64, segments: 0.5, candleLight: false, motes: 200, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", texture: 128, segments: 0.75, candleLight: false, motes: 350, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", texture: 256, segments: 1, candleLight: true, motes: 700, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", texture: 512, segments: 1.5, candleLight: true, motes: 1000, bloomRes: 1, aoRes: 1 },
};
/** gfx.js MOTE_MAX and the "low" particles cap. */
const MOTE_MAX = 2800, MOTES_LOW = 100;
/** The first level index of each tier (quantum, molecular, terrestrial, galactic). */
const TIER_FLOOR: Record<Preset, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 quantum … 9 infinite). */
export function lookFor(preset: Preset, levelIndex: number): Look {
  const { particles, ...row } = TABLE[preset];
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: the motes grow with the
  // level above the tier's first, at most four times the tier's budget.
  const k = Math.min(4, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  const motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  b.motes = particles === "low" ? Math.min(MOTES_LOW, Math.round(motes / 2)) : motes;
  return { preset, ...row, budget: b };
}
