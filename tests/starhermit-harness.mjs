// Test harness: loads starhermit-sdk.js plus the game's platform adapter into a
// fake browser context with a stubbed fetch and launch hash.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

export const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const makeToken = (claims) => 'h.' + b64u(Object.assign({ sub: 'user-123456789', game_scope: 'gid-1', exp: Math.floor(Date.now() / 1000) + 3600 }, claims || {})) + '.s';

/** In-memory StarHermit backend; records every call. */
export function makeBackend() {
  const calls = [];
  const saves = {};
  const settings = {};
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body, auth: init.headers && init.headers.Authorization });
    const r = (s, b) => new Response(b, { status: s });
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (path.includes('/cloud-saves/')) {
      const key = decodeURIComponent(path.split('/cloud-saves/')[1].split('?')[0]);
      if (method === 'PUT') { saves[key] = Buffer.from(body.dataBase64, 'base64'); return r(200, '{}'); }
      return saves[key] ? r(200, saves[key]) : r(404, '');
    }
    if (path.endsWith('/profile')) return r(200, JSON.stringify({ username: 'pk-1', nickname: 'Al' }));
    if (path.endsWith('/avatar')) return r(404, '');
    if (/\/settings$/.test(path)) {
      if (method === 'PATCH') { Object.assign(settings, body.settings); return r(200, JSON.stringify({ settings })); }
      return r(200, JSON.stringify({ settings }));
    }
    if (path.endsWith('/controls')) return r(200, JSON.stringify({ actions: [] }));
    if (path.endsWith('/launch-token')) return r(200, JSON.stringify({ token: makeToken() }));
    return r(404, '');
  };
  return { calls, saves, settings, fetch };
}

/** Fake window/document; scripts run in order. Returns the vm context (= window). */
export function loadScripts(files, { hash = '', search = '', hostname = 'localhost', fetch, extra = {} } = {}) {
  const listeners = {};
  let replaced = null;
  const storage = new Map();
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, setAttribute() {}, removeAttribute() {}, appendChild() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
  const ctx = {
    console, URL, URLSearchParams, TextEncoder, TextDecoder, Response, Blob, atob, btoa, Uint8Array, DataView, Map, Promise, JSON,
    DecompressionStream: globalThis.DecompressionStream,
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; },
    clearTimeout, setInterval: (fn, ms) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); return t; }, clearInterval,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    fetch: fetch || (async () => { throw new Error('unexpected fetch'); }),
    location: { hash, search, pathname: '/', hostname, origin: 'https://' + hostname, href: 'https://' + hostname + '/' + search + hash, assign() {} },
    history: { state: null, replaceState: (a, b, u) => { replaced = u; } },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    navigator: { language: 'en-US', languages: ['en-US'], clipboard: { writeText: async (s) => { ctx.__clipboard = s; } } },
    document: { readyState: 'complete', visibilityState: 'visible', body: el(), documentElement: el(), createElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: (t, f) => (listeners['doc:' + t] = listeners['doc:' + t] || []).push(f) },
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    __listeners: listeners,
    get __replaced() { return replaced; },
  };
  Object.assign(ctx, extra);
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(readFileSync(f, 'utf8'), ctx, { filename: f });
  return ctx;
}

export const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
export const plain = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x))); // cross-realm objects -> host objects
