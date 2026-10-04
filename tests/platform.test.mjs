// HNPlatform over the shared StarHermit SDK: token, profile, cloud save,
// settings KV, bindings, invite link and the standalone no-network guarantee.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScripts, makeBackend, makeToken, plain, settle } from './starhermit-harness.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILES = [path.join(ROOT, 'starhermit-sdk.js'), path.join(ROOT, 'platform.js')];

test('launch token: profile, cloud save game:<slug>, settings, bindings, invite', async () => {
  const be = makeBackend();
  const w = loadScripts(FILES, { hash: '#game_token=' + makeToken() + '&session_id=s1', fetch: be.fetch });
  const P = w.HNPlatform;
  P.init();
  assert.equal(P.hosted, true);
  assert.equal(P.gameKey, 'gid-1');
  assert.equal(P.sub, 'user-123456789');
  assert.equal(w.__replaced, '/');
  await P.loadProfile();
  assert.equal(P.nickname, 'Al');
  assert.equal(await P.syncTime(), true);                // signed in: GET /api/v1/time (Bearer)
  assert.ok(be.calls.some((c) => c.url === '/api/v1/time'));

  P.saveCloud({ v: 2, journeyUnlocked: 4 });
  await P.flushCloud();
  const put = be.calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/v1/me/cloud-saves/' + encodeURIComponent('game:gid-1'));
  assert.deepEqual(plain(await P.loadCloud()), { v: 2, journeyUnlocked: 4 });

  P.patchSettings({ music: 0.2, leftHanded: true });
  await settle();
  const patch = be.calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.url, '/api/v1/games/gid-1/settings');
  assert.deepEqual(patch.body, { settings: { music: 0.2, leftHanded: true } });
  assert.equal((await P.getSettings()).music, 0.2);

  assert.deepEqual(plain(await P.loadBindings({ hint: ['KeyH'] })), { hint: ['KeyH'] });
  assert.ok(P.inviteLink().endsWith('/game-invite/user-123456789/gid-1'));
  assert.equal(await P.leaderboard(), null);              // no board declared
  assert.ok(be.calls.every((c) => c.auth === 'Bearer ' + P.token));
  // signed in: the only own-server call is GET /api/v1/time (Bearer)
  assert.ok(be.calls.every((c) => !c.url.startsWith('/api/') || /^\/api\/v1\/(time|games|users|me|leaderboards)\b/.test(c.url)));
});

test('standalone: no token, no platform calls', async () => {
  const urls = [];
  const w = loadScripts(FILES, { fetch: async (u) => { urls.push(u); throw new Error('no network'); } });
  const P = w.HNPlatform;
  P.init();
  assert.equal(P.hosted, false);
  assert.equal(P.canSignIn(), false);
  assert.equal(await P.loadCloud(), null);
  P.saveCloud({ v: 2 });
  await P.flushCloud();
  P.patchSettings({ music: 1 });
  await P.loadProfile();
  assert.deepEqual(plain(await P.getSettings()), {});
  assert.deepEqual(plain(await P.loadBindings({ hint: ['KeyH'] })), { hint: ['KeyH'] });
  assert.equal(P.inviteLink(), null);
  assert.equal(await P.leaderboard(), null);
  assert.equal(await P.syncTime(), false);               // standalone: local clock, no request
  assert.equal(P.timeOffsetMs, 0);
  await settle();
  assert.deepEqual(urls, []);
});

test('hosted without token offers sign-in', () => {
  const w = loadScripts(FILES, { hostname: 'gid-1.starhermit.com' });
  w.HNPlatform.init();
  assert.equal(w.HNPlatform.canSignIn(), true);
});
