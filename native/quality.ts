// The look per graphics level. The engine-owned effects (shadows and their
// map size, ambient occlusion, bloom, the grade, anti-aliasing) are the
// level's own (levelSettings(): the same table every StarHermit game reads).
// The game's art (materials, the wood and rug textures, round-geometry LOD,
// the candle's glow light, reflections, room detail, the dust motes) is the
// browser build's four presets and budgets (gfx.js TABLE / BUDGETS) keyed by
// the level's quality tier, with the motes scaled within the tier by the
// level's particle budget against the tier's anchor level (quantum,
// molecular, terrestrial, galactic), at most four times the tier's. The
// runtime owns the rest of what the old Graphics panel did: Auto and the
// level choice, render scale and the pixel-ratio cap, adaptive resolution,
// the frame-rate limit and readout. The per-category overrides of the old
// panel are not offered (the runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
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
}
export interface Look {
  preset: Preset;
  /** The level's key-light shadow map size, 0 when the level draws no shadows. */
  shadows: number;
  /** The level's ambient occlusion (null: off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null: off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  /** Room detail "detailed": wood grain and rug textures, wall trim, the print, the window, the clock face. */
  detailed: boolean;
  budget: Budget;
}

const ART: Record<Preset, Pick<Look, "reflections" | "detailed"> & { particles: "low" | "high" }> = {
  low: { reflections: false, particles: "low", detailed: false },
  balanced: { reflections: true, particles: "high", detailed: true },
  high: { reflections: true, particles: "high", detailed: true },
  ultra: { reflections: true, particles: "high", detailed: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", texture: 64, segments: 0.5, candleLight: false, motes: 200 },
  balanced: { material: "standard", texture: 128, segments: 0.75, candleLight: false, motes: 350 },
  high: { material: "physical", texture: 256, segments: 1, candleLight: true, motes: 700 },
  ultra: { material: "physical", texture: 512, segments: 1.5, candleLight: true, motes: 1000 },
};
/** gfx.js MOTE_MAX and the "low" particles cap. */
const MOTE_MAX = 2800, MOTES_LOW = 100;
/** The level whose settings are each tier's preset. */
const ANCHOR: Record<Preset, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level (the frame's by default). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const { particles, ...art } = ART[preset];
  const b = { ...BUDGETS[preset] };
  // The motes grow with the level's particle budget above the tier's anchor, at most 4×.
  const k = Math.min(4, s.particles / levelSettings(ANCHOR[preset]).particles);
  const motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  b.motes = particles === "low" ? Math.min(MOTES_LOW, Math.round(motes / 2)) : motes;
  b.texture = Math.min(b.texture, s.maxTextureSize);
  return {
    preset, ...art,
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    // Engine 1.36.1 bug: antialias "off" recolours fog, haze and translucent overlays; the old Low's MSAA
    // stays until engine 1.36.2 (drop this clamp when pinning 1.36.2+).
    antialias: s.antialias === "off" ? "msaa" : s.antialias,
    budget: b,
  };
}
