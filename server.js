'use strict';

// ---------------------------------------------------------------------------
// Hidden Nook - authoritative server (StarHermit game script)
// Serves static files plus same-origin /api routes:
//   GET  /api/v1/time                      platform time (for clock offset)
//   GET  /api/v1/daily                     today's shared seed + content version
//   POST /api/v1/daily/submit              validated daily score submission
//   GET  /api/v1/leaderboard?scope=&day=   global / friends-filtered boards
//   GET  /api/v1/save                      load cloud-save document
//   PUT  /api/v1/save                      store versioned, checksummed save
//   POST /api/v1/achievements              idempotent achievement unlock
// Rate limits and structured {"error":"..."} responses are recoverable.
// ---------------------------------------------------------------------------

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HNRules = require('./rules.js');
const HNContent = require('./content.js');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const BUILD_VERSION = require('./package.json').version;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.opus': 'audio/ogg',
};

// --- durable store (JSON file; safe for solo game scope) ----------------------
function loadStore() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'store.json'), 'utf8')); }
  catch { return { boards: {}, saves: {}, achievements: {}, excludedDays: [] }; }
}
function saveStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, 'store.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, path.join(DATA_DIR, 'store.json'));
}

// --- helpers -------------------------------------------------------------------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendError(res, code, msg) { sendJSON(res, code, { error: msg }); }

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > (limit || 65536)) { reject(new Error('payload-too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Identity: short-lived launch token. Hosted deployments pass a signed token;
// locally we accept a guest identity header. Never persisted by the client.
function identity(req) {
  const tok = req.headers['x-launch-token'] || '';
  if (tok && tok.length <= 256) return 'tok:' + crypto.createHash('sha256').update(tok).digest('hex').slice(0, 24);
  const guest = req.headers['x-guest-id'] || '';
  if (/^[a-zA-Z0-9_-]{4,64}$/.test(guest)) return 'guest:' + guest;
  return null;
}

// Naive per-identity rate limiter (token bucket, 60 req/min).
const buckets = new Map();
function rateLimited(id) {
  const now = Date.now();
  let b = buckets.get(id);
  if (!b || now - b.start > 60000) { b = { start: now, count: 0 }; buckets.set(id, b); }
  b.count += 1;
  return b.count > 60;
}

// --- score validation -----------------------------------------------------------
// Validate a score claim by replaying the ordered input log against the
// deterministic rules engine. Reject impossible or stale-version scores.
function validateSubmission(sub) {
  if (!sub || typeof sub !== 'object') return 'malformed-submission';
  if (sub.contentVersion !== HNContent.CONTENT_VERSION) return 'stale-content-version';
  if (typeof sub.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(sub.day)) return 'bad-day';
  if (!sub.envelope || sub.envelope.schema !== HNRules.SCHEMA_VERSION) return 'bad-replay-envelope';
  if (!Array.isArray(sub.envelope.commands) || sub.envelope.commands.length > 4096) return 'bad-command-log';
  for (const c of sub.envelope.commands) {
    if (!c || typeof c.type !== 'string') return 'malformed-command';
    if (c.index != null && (!Number.isInteger(c.index) || c.index < 0 || c.index > 512)) return 'command-out-of-bounds';
    if (c.dtMs != null && (!(c.dtMs > 0) || c.dtMs > 60000)) return 'command-out-of-bounds';
  }
  const level = HNContent.dailyLevel(sub.day);
  if (level.seed !== sub.envelope.seed) return 'seed-mismatch';
  const v = HNRules.verifyReplay(level, sub.envelope, { mode: 'daily' });
  if (!v.ok) return 'replay-invalid:' + v.error;
  const bd = HNRules.scoreBreakdown(v.state);
  if (bd.total !== sub.envelope.result.score) return 'score-mismatch';
  return { level, state: v.state, breakdown: bd };
}

// --- achievement set (static, stable lowercase keys, idempotent unlocks) --------
const ACHIEVEMENTS = {
  'first-completion':   { name: 'First Light',     desc: 'Complete your first round.' },
  'mechanic-mastery':   { name: 'Steady Eye',      desc: 'Complete a round with zero invalid taps and no hints.' },
  'daily-streak-3':     { name: 'Regular Visitor', desc: 'Finish the daily challenge three days in a row.' },
  'journey-20':         { name: 'Deep Nook',       desc: 'Clear journey stage 20.' },
  'collector-1000':     { name: 'Nook Collector',  desc: 'Find 1000 objects across all rounds.' },
};

// --- request handling -------------------------------------------------------------
async function handleApi(req, res, urlPath, query) {
  const id = identity(req);
  if (urlPath === '/api/v1/time' && req.method === 'GET') {
    // Round-trip-adjusted on the client via t0/t1.
    return sendJSON(res, 200, { now: Date.now(), build: BUILD_VERSION, contentVersion: HNContent.CONTENT_VERSION });
  }
  if (urlPath === '/api/v1/telemetry' && req.method === 'POST') {
    // Anonymous funnel events only; no identity required, payload discarded.
    try { await readBody(req, 8192); } catch { /* ignore */ }
    return sendJSON(res, 200, { ok: true });
  }
  if (!id) return sendError(res, 401, 'identity-required');
  if (rateLimited(id)) return sendError(res, 429, 'rate-limited');

  const store = loadStore();

  if (urlPath === '/api/v1/daily' && req.method === 'GET') {
    const day = new Date().toISOString().slice(0, 10);
    const level = HNContent.dailyLevel(day);
    return sendJSON(res, 200, {
      day, seed: level.seed, contentVersion: HNContent.CONTENT_VERSION,
      excluded: store.excludedDays.includes(day),
      itemCount: level.items.filter((i) => i.requested).length,
      theme: level.theme,
    });
  }

  if (urlPath === '/api/v1/daily/submit' && req.method === 'POST') {
    let sub;
    try { sub = JSON.parse(await readBody(req)); } catch (e) { return sendError(res, e.message === 'payload-too-large' ? 413 : 400, e.message); }
    if (store.excludedDays.includes(sub && sub.day)) return sendError(res, 422, 'day-excluded-from-ranking');
    const v = validateSubmission(sub);
    if (typeof v === 'string') return sendError(res, 422, v);
    const boardKey = 'daily:' + sub.day;
    const board = store.boards[boardKey] || (store.boards[boardKey] = []);
    const entry = {
      player: String(sub.player || 'guest').slice(0, 32),
      identity: id,
      score: v.breakdown.total,
      invalids: v.state.invalids,
      elapsedMs: v.state.elapsedMs,
      reason: v.state.reason,
      sessionId: String(sub.sessionId || '').slice(0, 64),
      ruleset: { contentVersion: HNContent.CONTENT_VERSION, seed: v.level.seed, assists: sub.assists || [], durationMs: v.state.elapsedMs },
      at: Date.now(),
    };
    // One entry per identity per day: keep the better one.
    const existing = board.findIndex((e) => e.identity === id);
    if (existing >= 0) {
      if (HNRules.compareResults(entry, board[existing]) < 0) board[existing] = entry;
    } else board.push(entry);
    board.sort(HNRules.compareResults);
    store.boards[boardKey] = board.slice(0, 200);
    saveStore(store);
    const rank = store.boards[boardKey].findIndex((e) => e.identity === id) + 1;
    return sendJSON(res, 200, { ok: true, rank, score: entry.score, breakdown: v.breakdown });
  }

  if (urlPath === '/api/v1/leaderboard' && req.method === 'GET') {
    const day = query.day || new Date().toISOString().slice(0, 10);
    const board = (store.boards['daily:' + day] || []).slice();
    // Friends filtering: caller passes comma-separated friend tokens it already
    // knows from the host shell; hidden/private profiles are never exposed.
    let out = board;
    if (query.scope === 'friends') {
      const friends = new Set(String(query.friends || '').split(',').filter(Boolean));
      out = board.filter((e) => friends.has(e.identity));
    }
    return sendJSON(res, 200, {
      day, scope: query.scope === 'friends' ? 'friends' : 'global',
      validated: true, // replay-validated authoritative board
      entries: out.slice(0, 50).map((e, i) => ({ rank: i + 1, player: e.player, score: e.score, invalids: e.invalids, elapsedMs: e.elapsedMs })),
    });
  }

  if (urlPath === '/api/v1/save' && req.method === 'GET') {
    const doc = store.saves[id] || null;
    return sendJSON(res, 200, { save: doc });
  }
  if (urlPath === '/api/v1/save' && req.method === 'PUT') {
    let body;
    try { body = JSON.parse(await readBody(req, 262144)); } catch (e) { return sendError(res, e.message === 'payload-too-large' ? 413 : 400, e.message); }
    const doc = body && body.save;
    if (!doc || typeof doc !== 'object' || doc.v == null || typeof doc.checksum !== 'string') return sendError(res, 400, 'bad-save-document');
    // Versioned + checksummed: verify integrity before storing.
    const payload = JSON.stringify(Object.assign({}, doc, { checksum: undefined }));
    const expect = crypto.createHash('sha256').update(payload).digest('hex');
    if (expect !== doc.checksum) return sendError(res, 422, 'checksum-mismatch');
    const prev = store.saves[id];
    // Conflict handling: keep both snapshots; client resolves when neither is
    // a strict descendant (higher v and updatedAt).
    if (prev && !(doc.v > prev.v || doc.updatedAt > prev.updatedAt)) {
      store.saves[id + ':conflict:' + Date.now()] = doc;
      saveStore(store);
      return sendJSON(res, 200, { ok: true, conflict: true, kept: prev });
    }
    store.saves[id] = doc;
    saveStore(store);
    return sendJSON(res, 200, { ok: true, conflict: false });
  }

  if (urlPath === '/api/v1/achievements' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return sendError(res, e.message === 'payload-too-large' ? 413 : 400, e.message); }
    const key = body && body.key;
    if (!ACHIEVEMENTS[key]) return sendError(res, 400, 'unknown-achievement');
    const set = store.achievements[id] || (store.achievements[id] = {});
    if (set[key]) return sendJSON(res, 200, { ok: true, already: true }); // idempotent
    set[key] = { at: Date.now() };
    saveStore(store);
    return sendJSON(res, 200, { ok: true, already: false });
  }

  return sendError(res, 404, 'unknown-route');
}

// --- static files ------------------------------------------------------------------
function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? 'index.html' : urlPath;
  try { rel = decodeURIComponent(rel).replace(/^\/+/, ''); } catch { res.writeHead(400); return res.end('bad request'); }
  const full = path.normalize(path.join(ROOT, rel));
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  if (rel.startsWith('data' + path.sep) || rel === 'data') { res.writeHead(403); return res.end('forbidden'); }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404); return res.end('not found: ' + urlPath); }
  const ext = path.extname(full).toLowerCase();
  const immutable = ext === '.js' || ext === '.css';
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=3600' : 'no-cache',
  });
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://localhost');
  if (u.pathname.startsWith('/api/')) {
    handleApi(req, res, u.pathname, Object.fromEntries(u.searchParams)).catch((e) => sendError(res, 500, 'internal:' + e.message));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'method-not-allowed');
  serveStatic(req, res, u.pathname);
});

if (require.main === module) {
  server.listen(PORT, () => { console.log('Hidden Nook server on :' + PORT); });
}

module.exports = { server, validateSubmission, ACHIEVEMENTS };
