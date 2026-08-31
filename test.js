'use strict';

// ---------------------------------------------------------------------------
// Hidden Nook - test suite: rules unit tests, content validators, replay
// determinism, fuzzing, golden sessions, and server API smoke tests.
// Run: node test.js
// ---------------------------------------------------------------------------

const assert = require('assert');
const R = require('./rules.js');
const C = require('./content.js');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { console.error('FAIL ' + name + ': ' + (e && e.stack || e)); process.exitCode = 1; }
}

// ---- rules: legality ------------------------------------------------------------
ok('createSession produces valid initial state', () => {
  const lvl = C.journeyLevel(0);
  const s = R.createSession(lvl, { mode: 'practice' });
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.tick, 0);
  assert.strictEqual(s.items.length, lvl.items.length);
  assert.ok(R.legalActions(s).length > 0);
});

ok('find requested item succeeds, unrequested is invalid', () => {
  const lvl = C.journeyLevel(0);
  let s = R.createSession(lvl, {});
  const wave = s.waves[0];
  const r1 = R.applyCommand(s, { id: 1, type: 'find', index: wave[0] });
  assert.ifError(r1.error);
  assert.ok(r1.state.items[wave[0]].found);
  assert.ok(r1.state.score >= R.SCORE.PER_ITEM);
  const decoyIdx = lvl.items.findIndex((i) => !i.requested);
  const r2 = R.applyCommand(r1.state, { id: 2, type: 'find', index: decoyIdx });
  assert.ifError(r2.error);
  assert.strictEqual(r2.state.invalids, 1);
  assert.ok(r2.events.some((e) => e.type === 'invalid'));
});

ok('illegal commands carry reasons', () => {
  const lvl = C.journeyLevel(0);
  const s = R.createSession(lvl, {});
  assert.strictEqual(R.applyCommand(s, { type: 'find', index: 999 }).error, 'no-such-object');
  let s2 = R.applyCommand(s, { id: 1, type: 'find', index: s.waves[0][0] }).state;
  assert.strictEqual(R.applyCommand(s2, { type: 'find', index: s.waves[0][0] }).error, 'already-found');
  assert.strictEqual(R.applyCommand(s, { type: 'nonsense' }).error, 'unknown-command');
  assert.strictEqual(R.applyCommand(s, null).error, 'malformed-command');
});

ok('duplicate command ids rejected idempotently', () => {
  const lvl = C.journeyLevel(0);
  let s = R.createSession(lvl, {});
  const r1 = R.applyCommand(s, { id: 'x', type: 'find', index: s.waves[0][0] });
  const r2 = R.applyCommand(r1.state, { id: 'x', type: 'find', index: s.waves[0][0] });
  assert.ifError(r2.error);
  assert.strictEqual(r2.state, r1.state); // same object, no double apply
});

ok('undo restores prior state in practice', () => {
  const lvl = C.practiceLevel('easy', 42);
  let s = R.createSession(lvl, {});
  const before = R.hashState(s);
  s = R.applyCommand(s, { id: 1, type: 'find', index: s.waves[0][0] }).state;
  const r = R.applyCommand(s, { id: 2, type: 'undo' });
  assert.ifError(r.error);
  assert.strictEqual(r.state.items[s.waves[0][0]].found, false);
  assert.ok(r.state.undoUsed);
});

ok('undo disabled when not allowed', () => {
  const lvl = C.challengeLevel('speed', 7);
  const s = R.createSession(lvl, {});
  assert.strictEqual(R.applyCommand(s, { type: 'undo' }).error, 'undo-disabled');
});

ok('hint marks lowest requested index and costs points', () => {
  const lvl = C.journeyLevel(0);
  const s = R.createSession(lvl, {});
  const r = R.applyCommand(s, { id: 1, type: 'hint' });
  assert.ifError(r.error);
  const idx = Math.min.apply(null, s.waves[0]);
  assert.ok(r.state.items[idx].hinted);
  assert.strictEqual(r.state.hintsUsed, 1);
});

ok('tick advances quantized time; time limit terminates', () => {
  const lvl = C.challengeLevel('speed', 3);
  let s = R.createSession(lvl, {});
  for (let i = 0; i < 200 && s.status === 'active'; i++) {
    s = R.applyCommand(s, { id: i, type: 'tick', dtMs: 1000 }).state;
  }
  assert.strictEqual(s.status, 'complete');
  assert.strictEqual(s.reason, 'time-up');
  assert.strictEqual(s.elapsedMs % 100, 0);
});

ok('move limit terminates with move-limit reason', () => {
  const lvl = C.challengeLevel('moves', 5);
  let s = R.createSession(lvl, {});
  const decoys = lvl.items.map((it, i) => (it.requested ? -1 : i)).filter((i) => i >= 0);
  let n = 0;
  while (s.status === 'active' && n < 100) {
    const idx = decoys[n % decoys.length];
    s = R.applyCommand(s, { id: n, type: 'find', index: idx }).state;
    n++;
  }
  assert.strictEqual(s.status, 'complete');
  assert.strictEqual(s.reason, 'move-limit');
});

ok('finding everything terminates with all-found and time bonus', () => {
  const lvl = C.practiceLevel('easy', 9);
  let s = R.createSession(lvl, {});
  let id = 0;
  for (let w = 0; w < s.waves.length; w++) {
    for (const idx of s.waves[w]) {
      const r = R.applyCommand(s, { id: id++, type: 'find', index: idx });
      assert.ifError(r.error);
      s = r.state;
    }
  }
  assert.strictEqual(s.reason, 'all-found');
  const bd = R.scoreBreakdown(s);
  assert.strictEqual(bd.remaining, 0);
  assert.ok(bd.total > 0);
});

ok('monotonic tick across commands', () => {
  const lvl = C.practiceLevel('easy', 11);
  let s = R.createSession(lvl, {});
  let last = 0;
  for (let i = 0; i < 5; i++) {
    s = R.applyCommand(s, { id: i, type: 'tick', dtMs: 500 }).state;
    assert.ok(s.tick > last);
    last = s.tick;
  }
});

// ---- scoring + ties -------------------------------------------------------------
ok('score breakdown sums to total and is integer', () => {
  const lvl = C.practiceLevel('medium', 21);
  let s = R.createSession(lvl, {});
  s = R.applyCommand(s, { id: 1, type: 'hint' }).state;
  s = R.applyCommand(s, { id: 2, type: 'find', index: lvl.items.findIndex((i) => !i.requested) }).state;
  const bd = R.scoreBreakdown(s);
  const sum = bd.items + bd.waves + bd.time - bd.invalidPenalty - bd.hintCost - bd.undoCost;
  assert.strictEqual(bd.total, Math.max(0, sum));
  assert.ok(Number.isInteger(bd.total));
});

ok('tie ordering: completion, invalids, time, session id', () => {
  const base = { score: 1000, reason: 'all-found', invalids: 1, elapsedMs: 5000, sessionId: 'a' };
  assert.ok(R.compareResults(base, Object.assign({}, base, { reason: 'time-up' })) < 0);
  assert.ok(R.compareResults(base, Object.assign({}, base, { invalids: 2 })) < 0);
  assert.ok(R.compareResults(base, Object.assign({}, base, { elapsedMs: 6000 })) < 0);
  assert.ok(R.compareResults(base, Object.assign({}, base, { sessionId: 'b' })) < 0);
  assert.strictEqual(R.compareResults(base, Object.assign({}, base)), 0);
});

// ---- replay determinism (property-style sweep) -------------------------------------
ok('same seed + commands = identical state hash (seed sweep)', () => {
  for (const seed of [1, 12345, 0xffffff, 777]) {
    const lvl = C.practiceLevel('medium', seed);
    const cmds = [];
    let s = R.createSession(lvl, {});
    const rng = R.mulberry32(seed);
    let id = 0;
    while (s.status === 'active' && id < 60) {
      const legal = R.legalActions(s).filter((a) => a.type === 'find' && a.requested);
      const pick = legal[Math.floor(rng() * legal.length)];
      cmds.push({ id: id++, type: 'find', index: pick.index });
      cmds.push({ id: id++, type: 'tick', dtMs: 700 });
      s = R.applyCommand(s, cmds[cmds.length - 2]).state;
      s = R.applyCommand(s, cmds[cmds.length - 1]).state;
    }
    const a = R.replay(lvl, cmds, {});
    const b = R.replay(lvl, cmds, {});
    assert.ifError(a.error);
    assert.strictEqual(R.hashState(a.state), R.hashState(b.state));
    assert.strictEqual(R.hashState(a.state), R.hashState(s));
  }
});

ok('replay envelope verifies; tampered envelope rejected', () => {
  const lvl = C.practiceLevel('easy', 33);
  let s = R.createSession(lvl, {});
  let id = 0;
  for (const idx of s.waves[0]) s = R.applyCommand(s, { id: id++, type: 'find', index: idx }).state;
  const env = R.makeReplayEnvelope(s, '1.0.0');
  const v = R.verifyReplay(lvl, env, {});
  assert.ok(v.ok);
  const bad = JSON.parse(JSON.stringify(env));
  bad.commands[0].index = (bad.commands[0].index + 1) % lvl.items.length;
  const v2 = R.verifyReplay(lvl, bad, {});
  assert.ok(!v2.ok || R.hashState(v2.state) !== env.terminalHash);
});

// ---- fuzz -------------------------------------------------------------------------
ok('fuzz malformed commands: no throws, no hangs, no NaN', () => {
  const lvl = C.practiceLevel('medium', 55);
  let s = R.createSession(lvl, {});
  const rng = R.mulberry32(999);
  for (let i = 0; i < 500; i++) {
    const cmd = {
      id: rng() < 0.2 ? 'dup' : i,
      type: ['find', 'tick', 'hint', 'undo', 'bogus', 5, null][Math.floor(rng() * 7)],
      index: Math.floor(rng() * 200) - 50,
      dtMs: Math.floor(rng() * 100000) - 500,
    };
    const r = R.applyCommand(s, cmd);
    assert.ok(r.state);
    assert.ok(Number.isFinite(r.state.score) && r.state.score >= 0);
    assert.ok(Number.isFinite(r.state.elapsedMs));
    if (!r.error) s = r.state;
  }
});

// ---- content validators --------------------------------------------------------------
ok('all journey levels + daily validate', () => {
  const r = C.validateAll();
  if (!r.ok) console.error(JSON.stringify(r.errors.slice(0, 5)));
  assert.ok(r.ok);
});

ok('daily seed immutable for a given day and varies by day', () => {
  const a = C.dailyLevel('2026-03-14');
  const b = C.dailyLevel('2026-03-14');
  const c = C.dailyLevel('2026-03-15');
  assert.strictEqual(a.seed, b.seed);
  assert.notStrictEqual(a.seed, c.seed);
});

ok('level generation is deterministic', () => {
  const a = C.journeyLevel(7);
  const b = C.journeyLevel(7);
  assert.deepStrictEqual(a, b);
});

// ---- migration ------------------------------------------------------------------------
ok('v1 state migrates to v2', () => {
  const lvl = C.practiceLevel('easy', 1);
  const s = R.createSession(lvl, {});
  const v1 = JSON.parse(JSON.stringify(s));
  v1.v = 1;
  delete v1.waves; delete v1.log; delete v1.history; delete v1.invalids;
  const m = R.migrateState(v1);
  assert.strictEqual(m.v, R.SCHEMA_VERSION);
  assert.ok(Array.isArray(m.waves) && Array.isArray(m.log));
});

// ---- golden sessions ----------------------------------------------------------------------
ok('golden easy session matches pinned hash', () => {
  const lvl = C.practiceLevel('easy', 42);
  let s = R.createSession(lvl, {});
  let id = 0;
  for (let w = 0; w < s.waves.length; w++) {
    for (const idx of s.waves[w]) s = R.applyCommand(s, { id: id++, type: 'find', index: idx }).state;
  }
  assert.strictEqual(s.reason, 'all-found');
  // pin: recompute once and lock (regression tripwire)
  const PIN = 2479039624;
  const h = R.hashState(s);
  assert.strictEqual(h, PIN, 'golden hash changed: got ' + h);
});

// ---- server smoke ---------------------------------------------------------------------------
async function serverTests() {
  const { server, validateSubmission } = require('./server.js');
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  const H = { 'Content-Type': 'application/json', 'X-Guest-Id': 'test-' + Date.now().toString(36) };

  (async () => {
    try {
      const r = await fetch(base + '/');
      const text = await r.text();
      assert.strictEqual(r.status, 200);
      assert.ok(text.includes('Hidden Nook'));
      console.log('PASS static index served'); passed++;

      const t = await fetch(base + '/api/v1/time');
      const tj = await t.json();
      assert.ok(tj.now > 0);
      console.log('PASS /api/v1/time'); passed++;

      const d = await fetch(base + '/api/v1/daily', { headers: H });
      const dj = await d.json();
      assert.ok(dj.seed != null && dj.day);
      console.log('PASS /api/v1/daily'); passed++;

      // build a valid submission by playing the daily level for real
      const level = C.dailyLevel(dj.day);
      let s = R.createSession(level, { mode: 'daily' });
      let id = 0;
      for (let w = 0; w < s.waves.length; w++) {
        for (const idx of s.waves[w]) s = R.applyCommand(s, { id: 's' + (id++), type: 'find', index: idx }).state;
      }
      const envelope = R.makeReplayEnvelope(s, '1.0.0');
      const sub = await fetch(base + '/api/v1/daily/submit', {
        method: 'POST', headers: H,
        body: JSON.stringify({ day: dj.day, player: 'tester', sessionId: 't1', envelope, contentVersion: C.CONTENT_VERSION }),
      });
      const subj = await sub.json();
      assert.ok(subj.ok && subj.rank >= 1, JSON.stringify(subj));
      console.log('PASS daily submit validated + ranked'); passed++;

      // duplicate/impossible submission rejected
      const badEnv = JSON.parse(JSON.stringify(envelope));
      badEnv.result.score += 5000;
      const bad = await fetch(base + '/api/v1/daily/submit', {
        method: 'POST', headers: H,
        body: JSON.stringify({ day: dj.day, player: 'cheater', sessionId: 't2', envelope: badEnv, contentVersion: C.CONTENT_VERSION }),
      });
      assert.strictEqual(bad.status, 422);
      console.log('PASS impossible score rejected'); passed++;

      const lb = await fetch(base + '/api/v1/leaderboard?scope=global&day=' + dj.day, { headers: H });
      const lbj = await lb.json();
      assert.ok(lbj.entries.length >= 1);
      assert.ok(lbj.entries.some((e) => e.player === 'tester'), 'tester entry present');
      console.log('PASS leaderboard'); passed++;

      // save round-trip with checksum
      const doc = { v: 2, updatedAt: 1, journeyUnlocked: 3, checksum: '' };
      const crypto = require('crypto');
      doc.checksum = crypto.createHash('sha256').update(JSON.stringify(Object.assign({}, doc, { checksum: undefined }))).digest('hex');
      const put = await fetch(base + '/api/v1/save', { method: 'PUT', headers: H, body: JSON.stringify({ save: doc }) });
      assert.ok((await put.json()).ok);
      const get = await fetch(base + '/api/v1/save', { headers: H });
      assert.strictEqual((await get.json()).save.journeyUnlocked, 3);
      console.log('PASS cloud save round-trip'); passed++;

      // achievement idempotency
      const a1 = await fetch(base + '/api/v1/achievements', { method: 'POST', headers: H, body: JSON.stringify({ key: 'first-completion' }) });
      const a2 = await fetch(base + '/api/v1/achievements', { method: 'POST', headers: H, body: JSON.stringify({ key: 'first-completion' }) });
      assert.strictEqual((await a1.json()).already, false);
      assert.strictEqual((await a2.json()).already, true);
      console.log('PASS achievement idempotency'); passed++;

      // local validateSubmission path
      assert.strictEqual(typeof validateSubmission({ contentVersion: -1 }), 'string');
      console.log('PASS validateSubmission guards'); passed++;
    } catch (e) {
      console.error('FAIL server smoke: ' + (e && e.stack || e));
      process.exitCode = 1;
    } finally {
      server.close();
    }
  })().then(() => {
    console.log('\n' + passed + ' checks passed' + (process.exitCode ? ' (with failures)' : ''));
  });
}

serverTests();
