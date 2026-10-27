/* Hidden Nook — the progress document (classic script, global HNProgress;
 * module.exports in Node). The browser build's `Progress` without its I/O:
 *
 *   { v: 2, updatedAt, journeyUnlocked, bestScores: { levelId: result },
 *     achievements: { key: unlockedAtMs }, foundTotal,
 *     dailyStreak: { last: 'YYYY-MM-DD' | null, count }, tutorialDone, checksum }
 *
 * checksummed with the rules' FNV-1a hash. The engine client keeps it as the
 * game's save (starhermit:storage `saves`, device and cloud slot); the
 * browser build kept the same document in localStorage and in the cloud slot
 * game:<slug> (the JS SDK's zipped save.json), which the client reads once as
 * a foreign save (fromBrowserSave) and merges in.
 */
(function (root, factory) {
  var rules = (typeof module === 'object' && module.exports) ? require('./rules.js') : root.HNRules;
  if (typeof module === 'object' && module.exports) module.exports = factory(rules);
  else root.HNProgress = factory(rules);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  function fresh() {
    return {
      v: 2, updatedAt: 0,
      journeyUnlocked: 0,            // highest completed journey index + 1
      bestScores: {},                // levelId -> {score, reason, elapsedMs, invalids, sessionId}
      achievements: {},              // key -> timestamp
      foundTotal: 0,
      dailyStreak: { last: null, count: 0 },
      tutorialDone: false,
      checksum: '',
    };
  }
  function checksumOf(doc) {
    // As the browser build's Object.assign({}, doc, { checksum: undefined }): key order kept,
    // the undefined checksum dropped by JSON.stringify.
    return R.hashString(JSON.stringify(withoutChecksum(doc))).toString(16);
  }
  function withoutChecksum(doc) { var o = {}; for (var k in doc) o[k] = k === 'checksum' ? undefined : doc[k]; return o; }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  /** An intact v2 document (checksum matches). */
  function intact(doc) { return isObj(doc) && doc.v === 2 && doc.checksum === checksumOf(doc); }
  /** Stamps the checksum (in place) and returns the document. */
  function seal(doc) { doc.checksum = checksumOf(doc); return doc; }

  /** A save's document when it is a usable progress document (sanitized copy), else null. */
  function sanitize(doc) {
    if (!isObj(doc) || doc.v !== 2) return null;
    var d = fresh();
    d.updatedAt = Number(doc.updatedAt) || 0;
    d.journeyUnlocked = Math.max(0, Math.floor(Number(doc.journeyUnlocked) || 0));
    if (isObj(doc.bestScores)) for (var k in doc.bestScores) {
      var b = doc.bestScores[k];
      if (isObj(b) && typeof b.score === 'number') d.bestScores[k] = {
        score: b.score, reason: String(b.reason || ''), invalids: Number(b.invalids) || 0,
        elapsedMs: Number(b.elapsedMs) || 0, sessionId: String(b.sessionId || ''),
      };
    }
    if (isObj(doc.achievements)) for (var a in doc.achievements) if (typeof doc.achievements[a] === 'number') d.achievements[a] = doc.achievements[a];
    d.foundTotal = Math.max(0, Math.floor(Number(doc.foundTotal) || 0));
    if (isObj(doc.dailyStreak)) d.dailyStreak = { last: typeof doc.dailyStreak.last === 'string' ? doc.dailyStreak.last : null, count: Math.max(0, Math.floor(Number(doc.dailyStreak.count) || 0)) };
    d.tutorialDone = !!doc.tutorialDone;
    return seal(d);
  }
  /** The engine save's data as a document (null when none or unusable). */
  function docFromSave(data) { return sanitize(data); }
  /** The browser build's cloud save (its save.json text): the document when intact, else null. */
  function fromBrowserSave(text) {
    var raw = null;
    try { raw = typeof text === 'string' ? JSON.parse(text) : null; } catch (e) { raw = null; }
    if (!intact(raw)) return null;
    return sanitize(raw);
  }

  /** Two devices' progress: furthest journey stage, better best score per level,
   * union of achievements (earliest unlock), larger all-time found count, the
   * newer daily streak, lesson done if done anywhere (the browser build's
   * mergeRemote). Returns a new sealed document; updatedAt is the newer. */
  function merge(local, remote) {
    var d = sanitize(local) || fresh();
    var r = sanitize(remote);
    if (!r) return seal(d);
    d.journeyUnlocked = Math.max(d.journeyUnlocked, r.journeyUnlocked);
    for (var k in r.bestScores) {
      var v = r.bestScores[k];
      if (!d.bestScores[k] || R.compareResults(v, d.bestScores[k]) < 0) d.bestScores[k] = v;
    }
    for (var a in r.achievements) {
      var t = r.achievements[a];
      d.achievements[a] = d.achievements[a] ? Math.min(d.achievements[a], t) : t;
    }
    d.foundTotal = Math.max(d.foundTotal, r.foundTotal);
    var rs = r.dailyStreak, ls = d.dailyStreak;
    if ((rs.last || '') > (ls.last || '') || (rs.last === ls.last && rs.count > ls.count)) d.dailyStreak = { last: rs.last, count: rs.count };
    d.tutorialDone = d.tutorialDone || r.tutorialDone;
    d.updatedAt = Math.max(d.updatedAt, r.updatedAt);
    return seal(d);
  }
  /** Whether two documents hold the same progress (ignoring updatedAt and checksum). */
  function sameProgress(a, b) {
    var x = sanitize(a), y = sanitize(b);
    if (!x || !y) return false;
    x.updatedAt = y.updatedAt = 0; x.checksum = y.checksum = '';
    return JSON.stringify(x) === JSON.stringify(y);
  }

  return {
    fresh: fresh, checksumOf: checksumOf, intact: intact, seal: seal, sanitize: sanitize,
    docFromSave: docFromSave, fromBrowserSave: fromBrowserSave, merge: merge, sameProgress: sameProgress,
  };
});
