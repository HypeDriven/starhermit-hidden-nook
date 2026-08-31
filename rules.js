'use strict';

// ---------------------------------------------------------------------------
// Hidden Nook - rules engine (pure, deterministic, rendering-independent)
// UMD: usable from Node (server/tests) and the browser (window.HNRules).
// No module outside this file may mutate rules state except through
// validated commands applied with applyCommand().
// ---------------------------------------------------------------------------

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HNRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const SCHEMA_VERSION = 2;

  // --- seeded random stream (mulberry32) -----------------------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Stable FNV-1a hash over the canonical serialized state.
  function hashState(state) {
    return hashString(serializeState(state));
  }

  function serializeState(state) {
    // Canonical: no volatile fields, stable key order.
    const s = {
      v: state.v, seed: state.seed, tick: state.tick,
      found: state.items.map((it) => (it.found ? 1 : 0)).join(''),
      hinted: state.items.map((it) => (it.hinted ? 1 : 0)).join(''),
      wave: state.wave, score: state.score, invalids: state.invalids,
      hints: state.hintsUsed, elapsed: state.elapsedMs,
      status: state.status, reason: state.reason || '',
      undoUsed: state.undoUsed ? 1 : 0,
    };
    return JSON.stringify(s);
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // --- scoring constants (integers; formatting is presentation-only) -------
  const SCORE = {
    PER_ITEM: 100,
    WAVE_CLEAR: 150,
    INVALID_PENALTY: 25,     // subtracted per invalid action
    HINT_COST: 50,           // subtracted per hint
    UNDO_COST: 10,
    TIME_BONUS_MAX: 600,     // decays to 0 at par*2
  };

  // --- session creation ------------------------------------------------------
  // level: content-level definition (see content.js):
  //   { id, seed, items:[{id,name,...}], waves:[[itemIndex...]], parSeconds,
  //     moveLimit|null, timeLimitSeconds|null, allowUndo, allowHints }
  // options: { mode, seedOverride, assists:[] }
  function createSession(level, options) {
    const opts = options || {};
    const items = level.items.map((it) => ({
      id: it.id, name: it.name, requested: !!it.requested, found: false, hinted: false,
    }));
    return {
      v: SCHEMA_VERSION,
      levelId: level.id,
      contentVersion: level.contentVersion || 1,
      mode: opts.mode || 'practice',
      seed: (opts.seedOverride != null ? opts.seedOverride : level.seed) >>> 0,
      tick: 0,
      items,
      waves: clone(level.waves),
      wave: 0,
      score: 0,
      invalids: 0,
      hintsUsed: 0,
      undoUsed: false,
      elapsedMs: 0,
      moveLimit: level.moveLimit || null,
      timeLimitMs: level.timeLimitSeconds ? level.timeLimitSeconds * 1000 : null,
      parMs: (level.parSeconds || 120) * 1000,
      allowUndo: !!level.allowUndo,
      allowHints: level.allowHints !== false,
      status: 'active',
      reason: null,
      log: [],          // ordered applied commands (replay input log)
      history: [],      // snapshots for undo (practice only)
    };
  }

  // --- legal-action API (also used by tutorials and hints) ------------------
  // Returns array of legal action descriptors.
  function legalActions(state) {
    if (state.status !== 'active') return [];
    const out = [];
    const waveSet = currentWaveSet(state);
    for (let i = 0; i < state.items.length; i++) {
      if (state.items[i].found) continue;
      out.push({ type: 'find', index: i, requested: waveSet.has(i) });
    }
    if (state.allowHints && waveSet.size > 0) {
      out.push({ type: 'hint' });
    }
    if (state.allowUndo && state.history.length > 0) {
      out.push({ type: 'undo' });
    }
    out.push({ type: 'tick', dtMs: 100 });
    return out;
  }

  function currentWaveSet(state) {
    const set = new Set();
    const w = state.waves[state.wave] || [];
    for (const idx of w) if (!state.items[idx].found) set.add(idx);
    return set;
  }

  // Why is this command illegal? Returns null when legal.
  function explainIllegal(state, cmd) {
    if (state.status !== 'active') return 'round-over';
    if (!cmd || typeof cmd.type !== 'string') return 'malformed-command';
    if (cmd.type === 'find') {
      const it = state.items[cmd.index];
      if (!it) return 'no-such-object';
      if (it.found) return 'already-found';
      return null;
    }
    if (cmd.type === 'hint') {
      if (!state.allowHints) return 'hints-disabled';
      if (currentWaveSet(state).size === 0) return 'nothing-to-hint';
      return null;
    }
    if (cmd.type === 'undo') {
      if (!state.allowUndo) return 'undo-disabled';
      if (state.history.length === 0) return 'nothing-to-undo';
      return null;
    }
    if (cmd.type === 'tick') {
      if (!(cmd.dtMs > 0) || cmd.dtMs > 60000) return 'bad-dt';
      return null;
    }
    return 'unknown-command';
  }

  // --- command application ----------------------------------------------------
  // cmd: { id, type, index?, dtMs?, atMs? } — id makes commits idempotent.
  // Returns { state, events, error } — state is a NEW object (or same on error).
  function applyCommand(state, cmd) {
    if (!cmd || typeof cmd !== 'object') {
      return { state, events: [], error: 'malformed-command' };
    }
    // Idempotent duplicate rejection by command id.
    if (cmd.id != null && state.log.some((c) => c.id === cmd.id)) {
      return { state, events: [{ type: 'duplicate', id: cmd.id }], error: null };
    }
    const illegal = explainIllegal(state, cmd);
    if (illegal) {
      return { state, events: [], error: illegal };
    }

    const next = clone(state);
    next.tick += 1;
    const events = [];

    if (cmd.type === 'tick') {
      // Quantized authoritative time advance.
      const dt = Math.min(60000, Math.max(1, Math.round(cmd.dtMs / 100) * 100));
      next.elapsedMs += dt;
      if (next.timeLimitMs != null && next.elapsedMs >= next.timeLimitMs) {
        next.status = 'complete';
        next.reason = 'time-up';
        events.push({ type: 'terminal', reason: 'time-up' });
      }
    } else if (cmd.type === 'find') {
      const waveSet = currentWaveSet(next);
      const it = next.items[cmd.index];
      // Push undo snapshot before mutation.
      if (next.allowUndo) next.history.push(snapshotForUndo(state));
      if (waveSet.has(cmd.index)) {
        it.found = true;
        next.score += SCORE.PER_ITEM;
        events.push({ type: 'found', index: cmd.index, name: it.name });
        if (currentWaveSet(next).size === 0) {
          if (next.wave < next.waves.length - 1) {
            next.wave += 1;
            next.score += SCORE.WAVE_CLEAR;
            events.push({ type: 'wave-clear', wave: next.wave });
          } else {
            next.score += SCORE.WAVE_CLEAR;
            next.score += timeBonus(next);
            next.status = 'complete';
            next.reason = 'all-found';
            events.push({ type: 'terminal', reason: 'all-found' });
          }
        }
      } else {
        // Tapped a real but unrequested object: invalid action, penalty.
        next.invalids += 1;
        next.score = Math.max(0, next.score - SCORE.INVALID_PENALTY);
        events.push({ type: 'invalid', index: cmd.index, reason: 'not-requested' });
      }
      if (next.moveLimit != null && next.status === 'active') {
        const moves = next.log.filter((c) => c.type === 'find').length + 1;
        if (moves >= next.moveLimit) {
          const remaining = countRemaining(next);
          if (remaining > 0) {
            next.status = 'complete';
            next.reason = 'move-limit';
            events.push({ type: 'terminal', reason: 'move-limit' });
          }
        }
      }
    } else if (cmd.type === 'hint') {
      const waveSet = currentWaveSet(next);
      // Deterministic hint choice: lowest index in the wave.
      const idx = Math.min.apply(null, Array.from(waveSet));
      next.items[idx].hinted = true;
      next.hintsUsed += 1;
      next.score = Math.max(0, next.score - SCORE.HINT_COST);
      events.push({ type: 'hint', index: idx, name: next.items[idx].name });
    } else if (cmd.type === 'undo') {
      const snap = next.history.pop();
      const hist = next.history;
      const log = next.log.slice();
      const undoCount = (next.undoCount || 0) + 1;
      Object.assign(next, clone(snap));
      next.history = hist;
      next.log = log;
      next.undoCount = undoCount;
      next.undoUsed = true;
      next.tick = state.tick + 1;
      next.score = Math.max(0, next.score - SCORE.UNDO_COST);
      events.push({ type: 'undo' });
    }

    next.log.push({ id: cmd.id != null ? cmd.id : next.tick, type: cmd.type, index: cmd.index, dtMs: cmd.dtMs });
    return { state: next, events, error: null };
  }

  function snapshotForUndo(state) {
    const s = clone(state);
    s.history = [];
    return s;
  }

  function countRemaining(state) {
    let n = 0;
    for (const it of state.items) if (!it.found && it.requested) n += 1;
    return n;
  }

  function timeBonus(state) {
    const par = Math.max(1, state.parMs);
    const over = Math.max(0, state.elapsedMs - par);
    const frac = Math.min(1, over / par); // 0 at par, 1 at 2*par
    return Math.round(SCORE.TIME_BONUS_MAX * (1 - frac));
  }

  function isTerminal(state) { return state.status !== 'active'; }

  // --- score breakdown (integers in, integers out) ---------------------------
  function scoreBreakdown(state) {
    const found = state.items.filter((i) => i.found).length;
    const items = found * SCORE.PER_ITEM;
    const waves = state.wave * SCORE.WAVE_CLEAR + (state.reason === 'all-found' ? SCORE.WAVE_CLEAR : 0);
    const time = state.status === 'complete' && state.reason === 'all-found' ? timeBonus(state) : 0;
    const invalidPenalty = state.invalids * SCORE.INVALID_PENALTY;
    const hintCost = state.hintsUsed * SCORE.HINT_COST;
    const undoCost = (state.undoCount || 0) * SCORE.UNDO_COST;
    const total = Math.max(0, items + waves + time - invalidPenalty - hintCost - undoCost);
    return { items, waves, time, invalidPenalty, hintCost, undoCost, total, found, remaining: countRemaining(state) };
  }

  // --- tie-break ordering -----------------------------------------------------
  // Returns negative when a ranks above b.
  function compareResults(a, b) {
    // primary objective completion
    const ca = a.reason === 'all-found' ? 1 : 0;
    const cb = b.reason === 'all-found' ? 1 : 0;
    if (ca !== cb) return cb - ca;
    if (a.score !== b.score) return b.score - a.score;
    if (a.invalids !== b.invalids) return a.invalids - b.invalids;
    if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
    const sa = String(a.sessionId || '');
    const sb = String(b.sessionId || '');
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  // --- replay envelope ---------------------------------------------------------
  function makeReplayEnvelope(session, buildVersion) {
    return {
      schema: SCHEMA_VERSION,
      build: buildVersion || '1.0.0',
      contentVersion: session.contentVersion,
      levelId: session.levelId,
      seed: session.seed,
      mode: session.mode,
      initialHash: null, // filled by caller with hashState(initialState)
      commands: clone(session.log),
      terminalHash: hashState(session),
      result: {
        score: scoreBreakdown(session).total,
        reason: session.reason,
        invalids: session.invalids,
        elapsedMs: session.elapsedMs,
      },
    };
  }

  // Re-apply a command log against a fresh session; returns final state.
  function replay(level, commands, options) {
    let state = createSession(level, options);
    for (const cmd of commands || []) {
      const r = applyCommand(state, cmd);
      if (r.error) {
        if (r.error === 'round-over') continue; // tolerate trailing ticks after terminal
        return { state, error: r.error, at: cmd };
      }
      state = r.state;
    }
    return { state, error: null };
  }

  function verifyReplay(level, envelope, options) {
    const r = replay(level, envelope.commands, options);
    if (r.error) return { ok: false, error: r.error };
    const h = hashState(r.state);
    if (h !== envelope.terminalHash) return { ok: false, error: 'hash-mismatch', expected: envelope.terminalHash, actual: h };
    return { ok: true, state: r.state };
  }

  // --- migration ----------------------------------------------------------------
  function migrateState(state) {
    if (!state || typeof state !== 'object') return null;
    if (state.v === SCHEMA_VERSION) return state;
    if (state.v === 1) {
      // v1 -> v2: add waves/log/history fields.
      const s = clone(state);
      s.v = 2;
      s.waves = s.waves || [s.items.map((_, i) => i)];
      s.wave = s.wave || 0;
      s.log = s.log || [];
      s.history = s.history || [];
      s.invalids = s.invalids || 0;
      s.hintsUsed = s.hintsUsed || 0;
      s.elapsedMs = s.elapsedMs || 0;
      return s;
    }
    return null;
  }

  return {
    SCHEMA_VERSION, SCORE,
    mulberry32, hashString, hashState, serializeState,
    createSession, legalActions, currentWaveSet, explainIllegal, applyCommand,
    isTerminal, countRemaining, timeBonus, scoreBreakdown, compareResults,
    makeReplayEnvelope, replay, verifyReplay, migrateState,
  };
});
