// Localization coverage: every English key the markup, code and content use is
// translated in every locale (en-GB → en-US, es-ES → es-419, fr-CA → fr-FR
// inherit), placeholders survive, every scene object gets a localized name in
// every locale, and the language follows sh-language.js and switches live.
// Run: node --test tests/i18n.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { loadTables, codeKeys, htmlKeys, audit, LOCALES } from './i18n-common.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const require = createRequire(import.meta.url);
const C = require('../content.js');

function usedKeys() {
  const keys = new Set(htmlKeys(read('index.html')));
  const game = read('game.js');
  codeKeys(game, ['UI.setStatus', 'setStatus']).forEach((k) => keys.add(k));
  for (const m of game.matchAll(/label: '([^']+)'/g)) keys.add(m[1]);                 // overlay aria-labels
  for (const m of game.matchAll(/I18N\.attr\('[\w-]+', '([^']+)'/g)) keys.add(m[1]);
  codeKeys(read('platform.js')).forEach((k) => keys.add(k));
  for (const s of C.TUTORIAL_STEPS) keys.add(s.text);
  for (const t of C.THEMES) keys.add(t.name);
  return [...keys].filter((k) => /[A-Za-z]/.test(k) && k !== 'Hidden Nook').sort();
}

function boot(languages) {
  const events = [];
  const doc = { documentElement: { lang: 'en' }, body: null, dispatchEvent: (e) => events.push(e.detail.lang), addEventListener() {}, querySelectorAll: () => [] };
  const sandbox = {
    document: doc, location: { search: '' }, navigator: { languages, language: languages[0] },
    localStorage: { getItem: () => null, setItem: () => {} },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o.detail; } }, URLSearchParams,
  };
  sandbox.self = sandbox; sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['sh-language.js', 'strings.js', 'rules.js', 'content.js', 'i18n.js']) vm.runInContext(read(f), sandbox);
  return { I18N: sandbox.HNI18N, events, doc };
}

test('every used key is translated in every locale; placeholders intact', () => {
  assert.deepEqual(audit(loadTables(ROOT, 'strings.js', 'HN_STRINGS'), usedKeys()), []);
});

test('every object name (adjective + noun) is localized, uniquely, in every locale', () => {
  const sandbox = { self: {} };
  vm.runInNewContext(read('strings.js'), sandbox);
  const names = sandbox.self.HN_NAMES;
  const { I18N } = boot(['en-US']);
  for (const loc of LOCALES) {
    if (loc === 'en-US' || loc === 'en-GB') continue;
    I18N.language.setChoice(loc);
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

test('the locale follows sh-language and switches live', () => {
  const { I18N, events, doc } = boot(['de-DE']);
  assert.equal(I18N.lang, 'de-DE');
  assert.equal(doc.documentElement.lang, 'de-DE');
  assert.equal(I18N.T('Settings'), 'Einstellungen');
  assert.equal(I18N.objectName('brass mug'), 'messingfarbener Becher');
  I18N.language.setChoice('fr-CA');
  assert.equal(I18N.lang, 'fr-CA');
  assert.equal(events.at(-1), 'fr-CA');
  assert.equal(I18N.objectName('crimson candle'), 'bougie cramoisie');
  I18N.language.setChoice('it-IT');
  assert.equal(I18N.T('Found: {name}', { name: '@obj:tiny key' }), 'Trovato: chiave minuscola');
});
