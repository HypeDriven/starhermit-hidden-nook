// The progress document (js/progress.js) the engine client saves: the
// browser build's cloud save (save.json text, checksummed as its Progress
// wrote it) is read as a foreign save and merged; two devices' documents
// merge to the best of both (the browser build's mergeRemote rules).
// The signed-in paths (foreign save, legacy settings, score posting) cannot
// run here, so their logic is covered by these unit tests.
// Run: node --test tests/progress.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../js/rules.js');
const P = require('../js/progress.js');

/** A document as the browser build's Progress.save() wrote it (its own checksum code). */
function browserDoc(fields) {
  const doc = Object.assign({ v: 2, updatedAt: 0, journeyUnlocked: 0, bestScores: {}, achievements: {}, foundTotal: 0, dailyStreak: { last: null, count: 0 }, tutorialDone: false, checksum: '' }, fields);
  doc.checksum = R.hashString(JSON.stringify(Object.assign({}, doc, { checksum: undefined }))).toString(16);
  return doc;
}

test('a fresh document is sealed and intact', () => {
  const d = P.seal(P.fresh());
  assert.ok(P.intact(d));
  assert.equal(d.journeyUnlocked, 0);
});

test('the browser build\'s cloud save is read when intact, refused when tampered or malformed', () => {
  const old = browserDoc({ updatedAt: 1700000000000, journeyUnlocked: 7, foundTotal: 321, tutorialDone: true,
    bestScores: { 'journey-3': { score: 1455, reason: 'all-found', invalids: 1, elapsedMs: 108000, sessionId: 'journey-x' } },
    achievements: { 'first-completion': 1690000000000 }, dailyStreak: { last: '2026-10-01', count: 2 } });
  const d = P.fromBrowserSave(JSON.stringify(old));
  assert.ok(d);
  assert.equal(d.journeyUnlocked, 7);
  assert.equal(d.foundTotal, 321);
  assert.equal(d.bestScores['journey-3'].score, 1455);
  assert.equal(d.achievements['first-completion'], 1690000000000);
  assert.deepEqual(d.dailyStreak, { last: '2026-10-01', count: 2 });
  assert.equal(d.tutorialDone, true);
  assert.ok(P.intact(d));
  const tampered = JSON.parse(JSON.stringify(old)); tampered.journeyUnlocked = 40;
  assert.equal(P.fromBrowserSave(JSON.stringify(tampered)), null);
  assert.equal(P.fromBrowserSave('not json'), null);
  assert.equal(P.fromBrowserSave(null), null);
});

test('an engine save round-trips through docFromSave; junk is refused', () => {
  const d = P.seal(Object.assign(P.fresh(), { journeyUnlocked: 4, foundTotal: 12 }));
  const back = P.docFromSave(JSON.parse(JSON.stringify(d)));
  assert.equal(back.journeyUnlocked, 4);
  assert.equal(back.foundTotal, 12);
  assert.equal(P.docFromSave(null), null);
  assert.equal(P.docFromSave({ v: 1 }), null);
  assert.equal(P.docFromSave([1, 2]), null);
});

test('two devices merge to the best of both', () => {
  const a = P.seal(Object.assign(P.fresh(), {
    updatedAt: 5, journeyUnlocked: 3, foundTotal: 50, tutorialDone: false,
    bestScores: { 'journey-1': { score: 900, reason: 'all-found', invalids: 0, elapsedMs: 60000, sessionId: 'a' },
      'journey-2': { score: 700, reason: 'time-up', invalids: 0, elapsedMs: 60000, sessionId: 'a2' } },
    achievements: { 'first-completion': 300 }, dailyStreak: { last: '2026-10-20', count: 1 },
  }));
  const b = P.seal(Object.assign(P.fresh(), {
    updatedAt: 9, journeyUnlocked: 6, foundTotal: 40, tutorialDone: true,
    bestScores: { 'journey-1': { score: 800, reason: 'all-found', invalids: 0, elapsedMs: 60000, sessionId: 'b' },
      'journey-2': { score: 650, reason: 'all-found', invalids: 2, elapsedMs: 90000, sessionId: 'b2' } },
    achievements: { 'first-completion': 200, 'journey-20': 400 }, dailyStreak: { last: '2026-10-22', count: 3 },
  }));
  const m = P.merge(a, b);
  assert.equal(m.journeyUnlocked, 6);
  assert.equal(m.foundTotal, 50);
  assert.equal(m.tutorialDone, true);
  assert.equal(m.bestScores['journey-1'].sessionId, 'a');           // higher score
  assert.equal(m.bestScores['journey-2'].sessionId, 'b2');          // completion beats score
  assert.deepEqual(m.achievements, { 'first-completion': 200, 'journey-20': 400 }); // union, earliest unlock
  assert.deepEqual(m.dailyStreak, { last: '2026-10-22', count: 3 }); // the newer streak
  assert.equal(m.updatedAt, 9);
  assert.ok(P.intact(m));
  assert.ok(P.sameProgress(P.merge(m, a), m));
  assert.ok(!P.sameProgress(a, m));
  assert.ok(P.sameProgress(P.merge(a, null), a));
});
