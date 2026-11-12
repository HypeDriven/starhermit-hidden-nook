// Localization coverage: every English key the engine client (native/*.ts)
// and the content show is translated in every locale (en-GB → en-US,
// es-ES → es-419, fr-CA → fr-FR inherit), placeholders survive, no table
// keeps a key nothing shows, every scene object gets a unique localized name
// in every locale. Tables: assets/strings.json. Run: node --test tests/i18n.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { codeKeys, audit, LOCALES } from './i18n-common.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const require = createRequire(import.meta.url);
const C = require('../js/content.js');

export function usedKeys() {
  const keys = new Set();
  for (const f of readdirSync(new URL('native/', ROOT)).filter((n) => n.endsWith('.ts'))) codeKeys(read('native/' + f), ['setStatus', 'K']).forEach((k) => keys.add(k));
  for (const s of C.TUTORIAL_STEPS) keys.add(s.text);
  for (const t of C.THEMES) keys.add(t.name);
  return [...keys].filter((k) => /[A-Za-z]/.test(k) && k !== 'Hidden Nook').sort();
}

function boot() {
  const sandbox = {};
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const f of ['js/rules.js', 'js/content.js', 'js/names.js', 'js/i18n.js']) vm.runInContext(read(f), sandbox);
  return sandbox.HNI18N;
}

test('every used key is translated in every locale; placeholders intact; nothing unused', () => {
  assert.deepEqual(audit(JSON.parse(read('assets/strings.json')), usedKeys()), []);
});

test('every object name (adjective + noun) is localized, uniquely, in every locale', () => {
  const I18N = boot();
  for (const loc of new Set([...Object.keys(JSON.parse(read('assets/strings.json'))), ...Object.keys(I18N.names)])) {
    if (loc.startsWith('en-')) continue;
    I18N.setLocale(loc);
    assert.equal(I18N.lang, loc, 'locale recognized: ' + loc);
    const v = I18N.vocabulary;
    assert.ok(v, 'vocabulary for ' + loc);
    for (const d of C.OBJECT_DEFS) assert.ok(v.noun[d.label], `${loc} noun: ${d.label}`);
    for (const a of C.ADJECTIVES) assert.ok(v.adj[a], `${loc} adjective: ${a}`);
    const seen = new Set();
    for (const a of C.ADJECTIVES) for (const d of C.OBJECT_DEFS) {
      const n = I18N.objectName(a + ' ' + d.label);
      assert.notEqual(n, a + ' ' + d.label, `${loc} untranslated ${a} ${d.label}`);
      assert.ok(!seen.has(n), `${loc} duplicate name ${n}`);
      seen.add(n);
    }
  }
});

test('the locale switches as the engine client sets it, with the regional tables', () => {
  const I18N = boot();
  assert.equal(I18N.lang, 'en-US');
  assert.equal(I18N.setLocale('de-DE'), 'de-DE');
  assert.equal(I18N.objectName('brass mug'), 'messingfarbener Becher');
  I18N.setLocale('fr-CA');
  assert.equal(I18N.objectName('crimson candle'), 'bougie cramoisie');
  I18N.setLocale('it-IT');
  assert.equal(I18N.objectName('tiny key'), 'chiave minuscola');
  assert.equal(I18N.kindName('spool'), 'rocchetto di filo');
  assert.equal(I18N.setLocale('xx-YY'), 'en-US');
});


test('reviewed vocabulary preserves plurality, material complements, and distinct inventory labels', () => {
  const I18N = boot();
  I18N.setLocale('ru-FI');
  assert.equal(I18N.objectName('wooden pocket watch'), 'деревянные карманные часы');
  I18N.setLocale('da-DE');
  assert.equal(I18N.objectName('wooden book'), 'bog af træ');
  I18N.setLocale('lb-BE');
  assert.equal(I18N.objectName('crimson bottle'), 'Fläsch (Karminrout)');
  assert.notEqual(I18N.kindName('bottle'), I18N.kindName('jar'));
  I18N.setLocale('km-VN');
  assert.equal(I18N.objectName('porcelain jar'), 'ក្រឡ (ធ្វើពីប៉សឺឡែន)');
  assert.notEqual(I18N.objectName('porcelain jar'), I18N.objectName('ceramic jar'));
});
