// Hidden Nook - StarHermit platform adapter (window.HNPlatform), a classic
// script loaded after starhermit-sdk.js and before game.js.
// The SDK (window.StarHermit) owns the launch token (#game_token= or the
// #access_token= sign-in return; stripped from the URL), its renewal, and
// every platform call made here: profile, the cloud-save slot game:<slug>,
// the per-player settings KV, key bindings, the invite link and the read-only
// leaderboard. This file adds the server clock (GET /api/v1/time, signed in
// only). Without a token no request of any kind —
// platform or own-server — is ever made; the local clock is used.
(function (root) {
  'use strict';
  const SH = root.StarHermit || null;

  const Platform = {
    sh: SH,
    sub: null,         // user id from the token
    gameKey: null,     // game slug from game_scope (cloud-save slot, board lookup)
    nickname: null,
    avatar: null,      // object URL of the account avatar
    hosted: false,     // true while the SDK holds a launch token
    timeOffsetMs: 0,   // serverNow - clientNow
    onAuth: null,      // fn(signedIn) after the SDK signs in/out

    get token() { return SH && SH.token || null; },

    _adopt() {
      this.hosted = !!(SH && SH.signedIn);
      this.sub = this.hosted ? String(SH.userId) : null;
      this.gameKey = SH ? SH.slug : null;
      if (!this.hosted) { this.nickname = null; this.avatar = null; }
    },

    init() {
      if (SH) {
        SH.init();
        SH.on('auth', (a) => { this._adopt(); if (this.onAuth) this.onAuth(a.signedIn); });
      }
      this._adopt();
    },

    canSignIn() { return !!(SH && SH.canSignIn()); },
    signIn() { return !!(SH && SH.signIn()); },

    headers() {
      const h = { 'Content-Type': 'application/json' };
      if (this.token) h['Authorization'] = 'Bearer ' + this.token;
      return h;
    },

    /** JSON call to this game's own server (signed in: /api/v1/time only). */
    async fetchJSON(path, opts, retries) {
      const n = retries == null ? 1 : retries;
      for (let i = 0; i <= n; i++) {
        try {
          const res = await fetch(path, Object.assign({ headers: this.headers() }, opts));
          const body = await res.json().catch(() => ({}));
          if (res.status === 429 && i < n) { await new Promise((r) => setTimeout(r, 800 * (i + 1))); continue; }
          if (!res.ok) return { error: body.error || ('http-' + res.status), status: res.status };
          return body;
        } catch (e) {
          if (i === n) return { error: 'offline' };
          await new Promise((r) => setTimeout(r, 400 * (i + 1)));
        }
      }
      return { error: 'offline' };
    },

    refreshToken() { return SH ? SH.refresh() : Promise.resolve(null); },

    async loadProfile() {
      if (!this.hosted) return;
      const p = await SH.profile();
      this.nickname = p ? p.displayName : 'Player ' + String(this.sub).slice(0, 6);
      SH.avatarUrl().then((url) => { this.avatar = url; });
    },

    async nicknameFor(userId) {
      const p = this.hosted ? await SH.profile(userId) : null;
      return p ? p.displayName : 'Player ' + String(userId).slice(0, 6);
    },

    async syncTime() {
      // GET /api/v1/time is allowed only with a launch token; standalone play
      // makes no own-server requests and keeps the local clock.
      this.timeOffsetMs = 0;
      if (!this.hosted) return false;
      const t0 = Date.now();
      const r = await this.fetchJSON('/api/v1/time', {}, 0);
      const t1 = Date.now();
      if (r && typeof r.now === 'number') this.timeOffsetMs = r.now - Math.round((t0 + t1) / 2);
      return true;
    },

    now() { return Date.now() + this.timeOffsetMs; },

    // ---- platform features (all no-ops without a token) -------------------------
    /** Remote save doc, or null. */
    loadCloud() { return this.hosted ? SH.loadJSON() : Promise.resolve(null); },
    /** Debounced cloud write; flushCloud() forces it (keepalive on pagehide). */
    saveCloud(doc, delayMs) { if (this.hosted) SH.saveJSON(doc, delayMs); },
    flushCloud(keepalive) { return this.hosted ? SH.flushSave(keepalive === true) : Promise.resolve(false); },
    onSaved(fn) { if (SH) SH.on('saved', fn); },
    getSettings() { return this.hosted ? SH.getSettings() : Promise.resolve({}); },
    patchSettings(obj) { if (this.hosted) SH.patchSettings(obj); },
    loadBindings(defaults) {
      return this.hosted ? SH.loadBindings(defaults) : Promise.resolve(JSON.parse(JSON.stringify(defaults)));
    },
    inviteLink() { return this.hosted ? SH.inviteLink() : null; },
    /** Read-only platform board: { entries:[{rank,name,score,you}] } or null when there is none. */
    async leaderboard(pageSize) {
      if (!this.hosted) return null;
      const r = await SH.leaderboard(null, { pageSize: pageSize || 50 });
      if (!r || !r.board) return null;
      const items = r.items || [];
      const names = await Promise.all(items.map((e) => this.nicknameFor(e.userId)));
      return { entries: items.map((e, i) => ({ rank: e.rank != null ? e.rank : i + 1, name: names[i], score: e.score, you: String(e.userId) === this.sub })) };
    },
  };

  root.HNPlatform = Platform;
})(typeof self !== 'undefined' ? self : this);
