// Unit tests for the graphics quality model (gfx.js) and its panel strings (gfx-i18n.js).
// Run: node --test tests/gfx.test.mjs   (part of `npm test`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPreset, resolve, presetTier, choosePreset, migrateQuality, describe, PRESETS, CATEGORIES,
} from '../gfx.js';
import { GFX_LOCALES, pickLocale } from '../gfx-i18n.js';

test('detectPreset maps GPU strings to presets', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'high');
  assert.equal(detectPreset('Apple M2 Pro'), 'high');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon RX 6800 XT)'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 730'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
});

test('detectPreset caps touch/mobile devices at balanced', () => {
  assert.equal(detectPreset('Apple M1', true), 'balanced');
  assert.equal(detectPreset('SwiftShader', true), 'low');
});

test('resolve: auto follows the detected preset', () => {
  const r = resolve({}, 'low');
  assert.equal(r.preset, 'low');
  assert.equal(r.auto, true);
  assert.equal(r.shadows, 'off');
  assert.equal(r.post, false, 'Low renders without a post chain');
  assert.equal(r.cap, 1);
  assert.equal(r.adaptive, true);
  assert.equal(r.showFps, false);
});

test('resolve: explicit preset, overrides and invalid values', () => {
  const r = resolve({ preset: 'high', bloom: 'off', shadows: 'bogus', particles: 'low' }, 'low');
  assert.equal(r.preset, 'high');
  assert.equal(r.auto, false);
  assert.equal(r.bloom, 'off');
  assert.equal(r.shadows, presetTier('high', 'shadows'));
  assert.equal(r.particles, 'low');
  assert.equal(r.post, true); // AO / grade / SMAA still on
  const u = resolve({ preset: 'ultra' }, 'low');
  assert.equal(u.shadows, 'high');
  assert.equal(u.antialias, 'msaa');
});

test('resolve: render scale is clamped to 50–200% and multiplies the preset scale', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }).scale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).scale, 0.5);
  assert.equal(resolve({ preset: 'high', render_scale: 0.75 }).scale, 0.75);
  assert.equal(resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
});

test('choosePreset clears category overrides but keeps scale/adaptive/fps', () => {
  const next = choosePreset({ preset: 'high', bloom: 'off', ao: 'high', render_scale: 1.5, adaptive: false, show_fps: true }, 'low');
  assert.deepEqual(next, { preset: 'low', render_scale: 1.5, adaptive: false, show_fps: true });
  assert.equal(choosePreset({}, 'nonsense').preset, 'auto');
});

test('every preset defines every category with a valid tier', () => {
  for (const p of PRESETS) {
    for (const [cat, tiers] of Object.entries(CATEGORIES)) assert.ok(tiers.includes(presetTier(p, cat)), `${p}.${cat}`);
  }
});

test('legacy quality setting migrates to a preset', () => {
  assert.equal(migrateQuality('medium'), 'balanced');
  assert.equal(migrateQuality('high'), 'high');
  assert.equal(migrateQuality('auto'), 'auto');
});

test('describe summarises cost', () => {
  const s = describe(resolve({ preset: 'high' }), [1280, 800]);
  assert.match(s, /2048² shadows/);
  assert.match(s, /SMAA/);
  assert.match(s, /1280×800 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('panel strings exist in every locale with the same keys', () => {
  const want = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  assert.deepEqual(Object.keys(GFX_LOCALES).sort(), want.sort());
  const shape = (o) => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? shape(v).map((x) => k + '.' + x) : [k])).sort();
  const ref = shape(GFX_LOCALES['en-US']);
  for (const loc of want) assert.deepEqual(shape(GFX_LOCALES[loc]), ref, loc);
  for (const cat of Object.keys(CATEGORIES)) assert.ok(GFX_LOCALES['de-DE'].cat[cat]);
  assert.equal(pickLocale(['fr-CA']), 'fr-CA');
  assert.equal(pickLocale(['es-MX']), 'es-419');
  assert.equal(pickLocale(['pt-PT', 'en']), 'pt-BR');
  assert.equal(pickLocale(['en-GB']), 'en-GB');
  assert.equal(pickLocale(['ja-JP']), 'en-US');
});
