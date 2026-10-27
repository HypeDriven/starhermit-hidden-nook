// Localization coverage: every English key the engine client (native/*.ts)
// and the content show is translated in every locale (en-GB → en-US,
// es-ES → es-419, fr-CA → fr-FR inherit), placeholders survive, no table
// keeps a key nothing shows, every scene object gets a unique localized name
// in every locale, and the classic js/i18n.js switches locale as
// native/i18n.ts drives it. Run: node --test tests/i18n.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { loadTables, codeKeys, audit, LOCALES } from './i18n-common.mjs';

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
  for (const f of ['js/rules.js', 'js/content.js', 'js/strings.js', 'js/i18n.js']) vm.runInContext(read(f), sandbox);
  return sandbox.HNI18N;
}

test('every used key is translated in every locale; placeholders intact; nothing unused', () => {
  assert.deepEqual(audit(loadTables(ROOT, 'js/strings.js', 'HN_STRINGS'), usedKeys()), []);
});

test('every object name (adjective + noun) is localized, uniquely, in every locale', () => {
  const I18N = boot();
  const names = I18N.names;
  for (const loc of LOCALES) {
    if (loc === 'en-US' || loc === 'en-GB') continue;
    I18N.setLocale(loc);
    const v = names[loc] || names[{ 'es-ES': 'es-419', 'fr-CA': 'fr-FR' }[loc]];
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
  assert.equal(I18N.T('Settings'), 'Einstellungen');
  assert.equal(I18N.objectName('brass mug'), 'messingfarbener Becher');
  I18N.setLocale('fr-CA');
  assert.equal(I18N.objectName('crimson candle'), 'bougie cramoisie');
  I18N.setLocale('it-IT');
  assert.equal(I18N.T('Found: {name}', { name: '@obj:tiny key' }), 'Trovato: chiave minuscola');
  assert.equal(I18N.kindName('spool'), 'rocchetto di filo');
  assert.equal(I18N.setLocale('xx-YY'), 'en-US');
});

test('account strings cover the nine locales', () => {
  require('../js/platform-strings.js');
  const P = globalThis.PlatformStrings;
  for (const l of LOCALES) assert.ok(P.ALL[l], l);
  assert.equal(P.platformStrings('de-DE').invite, 'Freund einladen');
  assert.equal(P.fmtPlatform(P.platformStrings('en-US').lbRank, { rank: 3 }), 'Leaderboard rank: #3');
});
