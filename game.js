'use strict';

// ---------------------------------------------------------------------------
// Hidden Nook - client: bootstrap, session, render, ui, audio, platform
// Rendering consumes immutable rules snapshots; simulation only advances via
// validated commands through HNRules.applyCommand.
// ---------------------------------------------------------------------------

import * as THREE from './vendor/three.module.js';
import { detectPreset, resolve, describe, presetTier, choosePreset, migrateQuality, PRESETS, CATEGORIES, SHADOW_MAP, PARTICLE_COUNT } from './gfx.js';
import { gfxStrings, pickLocale } from './gfx-i18n.js';

const R = window.HNRules;
const C = window.HNContent;

const $ = (id) => document.getElementById(id);

// ===========================================================================
// platform: StarHermit adapter (platform.js over starhermit-sdk.js) plus this
// game's own-dev-server surfaces; every platform call is a no-op without a token
// ===========================================================================
const Platform = window.HNPlatform;

// keyboard bindings: defaults mirror the control.* lines in starhermit.txt;
// StarHermit.loadBindings applies the player's platform overrides
const DEFAULT_BINDINGS = {
  pause: ['Escape'], prev: ['ArrowLeft', 'ArrowUp'], next: ['ArrowRight', 'ArrowDown'],
  select: ['Enter', 'Space'], hint: ['KeyH'], undo: ['KeyU'], resetView: ['KeyR'],
};
let bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
function actionFor(code) {
  for (const a of Object.keys(bindings)) if (bindings[a].includes(code)) return a;
  return null;
}
function keyNames(action) {
  const names = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Space: 'Space', Enter: 'Enter' };
  return (bindings[action] || []).map((c) => names[c] || c.replace(/^Key/, '').replace(/^Digit/, '')).join(' / ');
}

// StarHermit account strings (sign-in, invite, toasts) in the nine locales
const SH_TEXT = (() => {
  const all = {
 "en-US": {
  "signIn": "Sign in with StarHermit",
  "invite": "Invite a friend",
  "copied": "Invite link copied to clipboard.",
  "copyFailed": "Could not copy the invite link: {link}",
  "signedOut": "Signed out of StarHermit. Progress keeps saving on this device."
 },
 "en-GB": {
  "signIn": "Sign in with StarHermit",
  "invite": "Invite a friend",
  "copied": "Invite link copied to clipboard.",
  "copyFailed": "Could not copy the invite link: {link}",
  "signedOut": "Signed out of StarHermit. Progress keeps saving on this device."
 },
 "es-419": {
  "signIn": "Iniciar sesión con StarHermit",
  "invite": "Invitar a un amigo",
  "copied": "Enlace de invitación copiado al portapapeles.",
  "copyFailed": "No se pudo copiar el enlace de invitación: {link}",
  "signedOut": "Sesión de StarHermit cerrada. El progreso se sigue guardando en este dispositivo."
 },
 "es-ES": {
  "signIn": "Iniciar sesión con StarHermit",
  "invite": "Invitar a un amigo",
  "copied": "Enlace de invitación copiado al portapapeles.",
  "copyFailed": "No se ha podido copiar el enlace de invitación: {link}",
  "signedOut": "Se ha cerrado la sesión de StarHermit. El progreso se sigue guardando en este dispositivo."
 },
 "de-DE": {
  "signIn": "Mit StarHermit anmelden",
  "invite": "Freund einladen",
  "copied": "Einladungslink in die Zwischenablage kopiert.",
  "copyFailed": "Einladungslink konnte nicht kopiert werden: {link}",
  "signedOut": "Von StarHermit abgemeldet. Der Fortschritt wird weiter auf diesem Gerät gespeichert."
 },
 "fr-FR": {
  "signIn": "Se connecter avec StarHermit",
  "invite": "Inviter un ami",
  "copied": "Lien d’invitation copié dans le presse-papiers.",
  "copyFailed": "Impossible de copier le lien d’invitation : {link}",
  "signedOut": "Déconnecté de StarHermit. La progression reste enregistrée sur cet appareil."
 },
 "fr-CA": {
  "signIn": "Se connecter avec StarHermit",
  "invite": "Inviter un ami",
  "copied": "Lien d’invitation copié dans le presse-papiers.",
  "copyFailed": "Impossible de copier le lien d’invitation : {link}",
  "signedOut": "Déconnecté de StarHermit. La progression reste enregistrée sur cet appareil."
 },
 "pt-BR": {
  "signIn": "Entrar com StarHermit",
  "invite": "Convidar um amigo",
  "copied": "Link de convite copiado para a área de transferência.",
  "copyFailed": "Não foi possível copiar o link de convite: {link}",
  "signedOut": "Você saiu do StarHermit. O progresso continua salvo neste dispositivo."
 },
 "it-IT": {
  "signIn": "Accedi con StarHermit",
  "invite": "Invita un amico",
  "copied": "Link di invito copiato negli appunti.",
  "copyFailed": "Impossibile copiare il link di invito: {link}",
  "signedOut": "Disconnesso da StarHermit. I progressi restano salvati su questo dispositivo."
 }
};
  return all[pickLocale(navigator.languages || [navigator.language])] || all['en-US'];
})();

// ===========================================================================
// settings: persisted per-game preferences
// ===========================================================================
const SETTINGS_DEFAULTS = {
  music: 0.6, sfx: 0.8, ambience: 0.5,
  reducedMotion: false, highContrast: false, largeText: false,
  leftHanded: false, holdToPan: false, haptics: true,
  graphics: {}, // gfx.js saved object: { preset, render_scale, adaptive, show_fps, <category> }
  cameraPreset: 'default',
};

const Settings = {
  data: Object.assign({}, SETTINGS_DEFAULTS),
  load() {
    try {
      const raw = localStorage.getItem('hn-settings-v1');
      if (raw) this.data = Object.assign({}, SETTINGS_DEFAULTS, JSON.parse(raw));
    } catch { /* defaults */ }
    // pre-preset saves stored a bare quality tier; carry it over once
    if ('quality' in this.data) {
      if (!this.data.graphics || !this.data.graphics.preset) this.data.graphics = { preset: migrateQuality(this.data.quality) };
      delete this.data.quality;
    }
    if (!this.data.graphics || typeof this.data.graphics !== 'object') this.data.graphics = {};
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches && !localStorage.getItem('hn-settings-v1')) {
      this.data.reducedMotion = true;
    }
    this.apply();
  },
  get(k) { return this.data[k]; },
  set(k, v) {
    this.data[k] = v;
    try { localStorage.setItem('hn-settings-v1', JSON.stringify(this.data)); } catch { /* full */ }
    this.apply();
    // per-player settings KV mirror (debounced: sliders fire per tick)
    clearTimeout(this._kvTimer);
    this._kvTimer = setTimeout(() => Platform.patchSettings(this.data), 600);
  },
  /** Platform settings win over local values when signed in. */
  adopt(remote) {
    if (!remote || typeof remote !== 'object' || !Object.keys(remote).length) return;
    for (const k of Object.keys(SETTINGS_DEFAULTS)) if (k in remote) this.data[k] = remote[k];
    if (!this.data.graphics || typeof this.data.graphics !== 'object') this.data.graphics = {};
    try { localStorage.setItem('hn-settings-v1', JSON.stringify(this.data)); } catch { /* full */ }
    this.apply();
  },
  apply() {
    document.body.classList.toggle('hn-high-contrast', !!this.data.highContrast);
    document.body.classList.toggle('hn-large-text', !!this.data.largeText);
    document.body.classList.toggle('hn-reduced-motion', !!this.data.reducedMotion);
    Audio.applyVolumes();
    if (window.__hnRenderer) window.__hnRenderer.setGraphics(this.data.graphics);
  },
};

// ===========================================================================
// progress: versioned, checksummed local save (offline cache) + platform
// cloud-save mirror in one slot
// ===========================================================================
const Progress = {
  doc: null,
  cloudReady: false, // gate pushes until the remote snapshot has been considered
  _cloudTimer: null,
  fresh() {
    return {
      v: 2, updatedAt: 0,
      journeyUnlocked: 0,            // highest completed journey index + 1
      bestScores: {},                // levelId -> {score, reason, elapsedMs, invalids}
      achievements: {},              // key -> timestamp (local; rides in the cloud doc)
      foundTotal: 0,
      dailyStreak: { last: null, count: 0 },
      tutorialDone: false,
      checksum: '',
    };
  },
  checksumOf(doc) {
    return R.hashString(JSON.stringify(Object.assign({}, doc, { checksum: undefined }))).toString(16);
  },
  load() {
    let doc = null;
    try { doc = JSON.parse(localStorage.getItem('hn-progress-v2') || 'null'); } catch { doc = null; }
    if (!doc || doc.v !== 2 || doc.checksum !== this.checksumOf(doc)) {
      // migrate v1 if present
      try {
        const v1 = JSON.parse(localStorage.getItem('hn-progress-v1') || 'null');
        doc = this.fresh();
        if (v1 && typeof v1 === 'object') {
          doc.journeyUnlocked = v1.journeyUnlocked | 0;
          doc.updatedAt = Date.now();
        }
      } catch { doc = this.fresh(); }
    }
    this.doc = doc;
    this.save();
  },
  save() {
    this.doc.updatedAt = Platform.now();
    this.doc.checksum = this.checksumOf(this.doc);
    try { localStorage.setItem('hn-progress-v2', JSON.stringify(this.doc)); } catch { /* full */ }
    this.scheduleCloudPush();
  },
  scheduleCloudPush() {
    if (!Platform.hosted || !this.cloudReady) return;
    UI.setSync('saving');
    Platform.saveCloud(this.doc); // SDK debounces ~2 s
  },
  flushCloud() {
    if (Platform.hosted && this.cloudReady) Platform.flushCloud(true);
  },
  async cloudPull() {
    if (!Platform.hosted) { this.cloudReady = true; return; }
    UI.setSync('saving');
    let remote = null;
    try { remote = await Platform.loadCloud(); } catch { remote = null; }
    // Conflict resolution: prefer the remote snapshot when it is newer and
    // intact; localStorage already holds the offline cache either way.
    if (remote && remote.v === 2 && remote.checksum === this.checksumOf(remote)
        && (!this.doc || (remote.updatedAt || 0) > (this.doc.updatedAt || 0))) {
      this.doc = remote;
      try { localStorage.setItem('hn-progress-v2', JSON.stringify(this.doc)); } catch { /* full */ }
    }
    this.cloudReady = true;
    UI.setSync('synced');
  },
  unlock(key) {
    if (this.doc.achievements[key]) return false;
    this.doc.achievements[key] = Date.now();
    this.save(); // local unlock; the cloud-saved doc mirrors it on next push
    return true;
  },
};

// ===========================================================================
// audio: synthesized original transients on independent buses
// ===========================================================================
const Audio = {
  ctx: null, buses: {},
  samples: {},      // clip basename -> AudioBuffer | 'loading' | 'error'
  sampleEvents: {}, // event name -> [clip basenames]
  _samplesStarted: false,
  ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      for (const name of ['music', 'sfx', 'ambience']) {
        const g = this.ctx.createGain();
        g.connect(this.ctx.destination);
        this.buses[name] = g;
      }
      this.applyVolumes();
      this.startAmbience();
      this.loadSamples();
      return true;
    } catch { return false; }
  },
  // lazy-fetch/decode/cache authored one-shots after the user-gesture unlock
  async loadSamples() {
    if (this._samplesStarted || !this.ctx) return;
    this._samplesStarted = true;
    try {
      const res = await fetch('sfx/manifest.json');
      if (!res.ok) return;
      const list = await res.json();
      for (const item of list) {
        if (!item || !item.name || !item.event) continue;
        (this.sampleEvents[item.event] = this.sampleEvents[item.event] || []).push(item.name);
        this.loadSample(item.name);
      }
    } catch { /* manifest unavailable: synthesis fallback stays */ }
  },
  async loadSample(name) {
    if (this.samples[name]) return;
    this.samples[name] = 'loading';
    try {
      const res = await fetch('sfx/' + name + '.opus');
      if (!res.ok) throw new Error('http ' + res.status);
      this.samples[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch { this.samples[name] = 'error'; }
  },
  playSample(name) {
    const buf = this.samples[name];
    if (!buf || typeof buf === 'string') return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.buses.sfx);
    src.start();
    return true;
  },
  applyVolumes() {
    if (!this.ctx) return;
    this.buses.music.gain.value = Settings.get('music') * 0.5;
    this.buses.sfx.gain.value = Settings.get('sfx');
    this.buses.ambience.gain.value = Settings.get('ambience') * 0.25;
  },
  tone(bus, freq, dur, type, gain, when) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (when || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.buses[bus]);
    o.start(t); o.stop(t + dur + 0.05);
  },
  startAmbience() {
    if (!this.ctx || this._amb) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    const rng = R.mulberry32(0xa1b1);
    for (let i = 0; i < len; i++) d[i] = (rng() * 2 - 1) * 0.5;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 320;
    src.connect(f); f.connect(this.buses.ambience);
    src.start();
    this._amb = true;
  },
  // event-mapped one-shots (seeded pitch variant for replay consistency)
  play(name, variantSeed) {
    if (!this.ensure()) return;
    const rng = R.mulberry32((variantSeed || 1) >>> 0);
    const v = rng() * 40 - 20;
    // prefer a decoded authored sample; synthesize only while loading/on failure
    const clips = this.sampleEvents[name];
    if (clips) {
      const ready = clips.filter(c => this.samples[c] && typeof this.samples[c] !== 'string');
      if (ready.length && this.playSample(ready[Math.floor(rng() * ready.length)])) return;
    }
    switch (name) {
      case 'click':   this.tone('sfx', 660 + v, 0.07, 'triangle', 0.12); break;
      case 'focus':   this.tone('sfx', 440 + v, 0.05, 'sine', 0.07); break;
      case 'found':   this.tone('sfx', 523, 0.16, 'sine', 0.22); this.tone('sfx', 784 + v, 0.22, 'sine', 0.18, 0.07); break;
      case 'invalid': this.tone('sfx', 160, 0.18, 'sawtooth', 0.12); break;
      case 'wave':    [523, 659, 784].forEach((f, i) => this.tone('sfx', f + v, 0.18, 'triangle', 0.16, i * 0.08)); break;
      case 'win':     [523, 659, 784, 1047].forEach((f, i) => this.tone('music', f, 0.4, 'triangle', 0.2, i * 0.12)); break;
      case 'lose':    [392, 330, 262].forEach((f, i) => this.tone('music', f, 0.35, 'sine', 0.16, i * 0.12)); break;
      case 'hint':    this.tone('sfx', 880 + v, 0.25, 'sine', 0.14); break;
      case 'undo':    this.tone('sfx', 330, 0.12, 'triangle', 0.12); break;
      case 'pause':   this.tone('sfx', 294, 0.1, 'sine', 0.1); break;
      case 'countdown': this.tone('sfx', 392, 0.09, 'triangle', 0.13); break;
      case 'achieve': [659, 880, 1175].forEach((f, i) => this.tone('music', f, 0.32, 'triangle', 0.17, i * 0.09)); break;
      case 'timer-low': this.tone('sfx', 220, 0.07, 'square', 0.09); this.tone('sfx', 220, 0.07, 'square', 0.09, 0.14); break;
    }
  },
};

// ===========================================================================
// renderer: Three.js scene, camera rig, picking, VFX, quality tiers
// ===========================================================================
// Post-processing grade, applied after tone mapping (display space): gentle S-curve contrast,
// a touch of saturation, warm highlights / cool shadows and a soft vignette. Mid-tones and the
// found/hint colours keep their contrast; only the frame edge darkens.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.24 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.97, 0.99, 1.04), vec3(1.04, 1.0, 0.95), smoothstep(0.25, 0.8, l));
      c = mix(c, s, uAmount);
      float d = length((vUv - 0.5) * vec2(1.1, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.38, 0.85, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

// three.js addons (same r185 release as vendor/three.*.js), loaded on first need so the Low
// preset never downloads or compiles them.
let addonsPromise = null;
function loadAddons() {
  if (!addonsPromise) {
    addonsPromise = Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/ShaderPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
      import('three/addons/postprocessing/GTAOPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/SMAAPass.js'),
      import('three/addons/shaders/FXAAShader.js'),
      import('three/addons/environments/RoomEnvironment.js'),
    ]).then((m) => Object.assign({}, ...m));
  }
  return addonsPromise;
}

function isMobileDevice() {
  try {
    return (navigator.maxTouchPoints || 0) > 0 && window.matchMedia('(pointer: coarse)').matches;
  } catch { return false; }
}

// Procedural canvas textures for the "detailed" room (tileable, near-white so the authored
// material colour still decides the hue).
function woodTexture(seed, planks) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const rng = R.mulberry32(seed);
  g.fillStyle = '#e6e6e6';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 160; i++) {
    const y = rng() * 256;
    const v = 170 + Math.floor(rng() * 70);
    g.strokeStyle = `rgba(${v},${v},${v},${0.25 + rng() * 0.35})`;
    g.lineWidth = 0.6 + rng() * 2.2;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x * 0.03 + i) * (1 + rng() * 2.5));
    g.stroke();
  }
  for (let i = 0; i < 5; i++) { // knots
    const x = rng() * 256, y = rng() * 256;
    const grd = g.createRadialGradient(x, y, 0, x, y, 6 + rng() * 6);
    grd.addColorStop(0, 'rgba(120,120,120,0.55)');
    grd.addColorStop(1, 'rgba(200,200,200,0)');
    g.fillStyle = grd;
    g.fillRect(x - 14, y - 14, 28, 28);
  }
  if (planks) {
    g.fillStyle = 'rgba(90,90,90,0.55)';
    for (let i = 0; i < planks; i++) g.fillRect(0, Math.round((i * 256) / planks), 256, 2);
  }
  return c;
}

function rugTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  const ring = (r, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke(); };
  ring(118, 10, '#e8c98a');
  ring(104, 4, '#b8a8a0');
  ring(80, 12, '#d9b079');
  ring(56, 3, '#c9b8b0');
  for (let i = 0; i < 16; i++) { // woven diamond band
    const a = (i / 16) * Math.PI * 2;
    g.save();
    g.translate(128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92);
    g.rotate(a + Math.PI / 4);
    g.fillStyle = '#e0bf85';
    g.fillRect(-5, -5, 10, 10);
    g.restore();
  }
  ring(26, 8, '#e8c98a');
  const img = g.getImageData(0, 0, 256, 256); // fibre noise
  const rng = R.mulberry32(0x5eed);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng() - 0.5) * 34;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function moteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return c;
}

class NookRenderer {
  constructor(holder) {
    this.holder = holder;
    this.canvas = document.createElement('canvas');
    holder.appendChild(this.canvas);
    let ctxAttribs = { canvas: this.canvas, antialias: true, powerPreference: 'high-performance' };
    try {
      this.renderer = new THREE.WebGLRenderer(ctxAttribs);
    } catch (e) {
      throw new Error('webgl-unavailable');
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.gpu = NookRenderer.gpuName(this.renderer);
    this.detected = detectPreset(this.gpu, isMobileDevice());

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    // authored camera rig: orbit target + yaw/pitch/distance
    this.rig = { yaw: 0, pitch: 0.62, dist: 15, target: new THREE.Vector3(0, 1.6, -1) };
    this.rigHome = JSON.stringify({ yaw: 0, pitch: 0.62, dist: 15 });
    this.raycaster = new THREE.Raycaster();
    this.pickables = [];      // gameplay layer only; particles/decoration never raycast
    this.itemViews = new Map(); // index -> {group, ring, baseY, bobPhase}
    this.clockT = 0;
    this.focusIndex = -1;
    this.levelSeed = 1;
    this.reduced = false;
    this.disposables = [];
    this.particles = null;
    this.flame = null;
    this.pendulum = null;
    this.candleLight = null;
    this.markerPulse = 0;
    this.onTap = null; // (index|null)
    this.onCameraMove = null;
    // graphics state (gfx.js): resolved tiers, adaptive scale, post chain
    this.q = null;
    this.adaptiveScale = 1;
    this._frames = [];
    this.fps = 0;
    this.pixelRatio = 0;
    this.composer = null;
    this.postKey = null;
    this.postFailed = false;
    this.addons = null;
    this.envTex = null;
    this._bindInput();
    this.setGraphics(Settings.get('graphics'));
  }

  static gpuName(r) {
    try {
      const gl = r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    } catch { return ''; }
  }

  // ---- graphics settings ---------------------------------------------------
  /** Apply saved graphics settings live (gfx.js shape; `{}` = Auto). */
  setGraphics(saved) {
    const json = JSON.stringify(saved || {});
    if (json === this._gfxJson) return;
    this._gfxJson = json;
    const prev = this.q;
    const g = resolve(saved || {}, this.detected);
    this.q = g;
    document.body.dataset.gfxPreset = g.preset;
    this.canvas.dataset.gfxPreset = g.preset;
    this.renderer.shadowMap.enabled = SHADOW_MAP[g.shadows] > 0;
    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null; // rebuild the post chain on the next frame
    this._fpsVisible(g.showFps);
    if (g.post || g.reflections === 'on') this._ensureAddons();
    const rebuild = prev && this.level && (prev.particles !== g.particles || prev.detail !== g.detail);
    if (rebuild) this.rebuild();
    else {
      this._applyShadows();
      this._applyEnv();
      this._touchMaterials();
    }
  }

  /** What the Graphics panel shows: GPU, auto choice, resolved tiers, cost, frame rate. */
  graphicsInfo(words) {
    const px = [Math.round((this._w || 1) * (this.pixelRatio || 1)), Math.round((this._h || 1) * (this.pixelRatio || 1))];
    return {
      gpu: this.gpu,
      detected: this.detected,
      resolved: this.q,
      summary: describe(this.q, px, words),
      fps: Math.round(this.fps || 0),
      adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed,
    };
  }

  _ensureAddons() {
    if (this.addons || this._addonsLoading) return;
    this._addonsLoading = true;
    loadAddons().then((a) => {
      this.addons = a;
      this.postKey = null;
      this._applyEnv();
      this._touchMaterials();
    }, () => {
      this.postFailed = true; // render directly; the Graphics panel says so
    });
  }

  _applyShadows() {
    const key = this.keyLight;
    if (!key) return;
    const size = SHADOW_MAP[this.q.shadows];
    key.castShadow = size > 0;
    if (size > 0 && key.shadow.mapSize.x !== size) {
      key.shadow.mapSize.set(size, size);
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    }
    key.shadow.radius = this.q.shadows === 'low' ? 2 : 3;
  }

  _applyEnv() {
    const on = this.q.reflections === 'on' && this.addons;
    if (on && !this.envTex) {
      try {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const room = new this.addons.RoomEnvironment();
        this.envTex = pmrem.fromScene(room, 0.04).texture;
        room.dispose && room.dispose();
        pmrem.dispose();
      } catch { this.envTex = null; }
    }
    this.scene.environment = on ? this.envTex : null;
    this.scene.environmentIntensity = 0.45;
    // image-based light takes over part of the flat hemisphere fill
    if (this.hemi) this.hemi.intensity = this.hemiBase * (on ? 0.7 : 1);
  }

  _touchMaterials() {
    this.scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
    });
  }

  _fpsVisible(on) {
    let el = document.getElementById('gfx-fps');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'gfx-fps';
      el.className = 'hn-fps';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  _postKey() {
    const g = this.q;
    if (!g.post || !this.addons || this.postFailed || !(this._w > 1 && this._h > 1)) return 'none';
    return [g.ao, g.bloom, g.grade, g.antialias, this._w, this._h, this.pixelRatio].join('|');
  }

  _buildPost() {
    const g = this.q;
    if (this.composer) {
      for (const p of this.composer.passes) if (p.dispose) p.dispose();
      this.composer.dispose();
    }
    this.composer = null;
    if (!g.post || !this.addons || this.postFailed) return;
    const A = this.addons;
    const w = this._w, h = this._h, pr = this.pixelRatio;
    try {
      const target = new THREE.WebGLRenderTarget(Math.round(w * pr), Math.round(h * pr), {
        type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0,
      });
      const composer = new A.EffectComposer(this.renderer, target);
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      composer.addPass(new A.RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const ao = new A.GTAOPass(this.scene, this.camera, Math.round(w * pr), Math.round(h * pr));
        ao.output = A.GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.85;
        ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.0, scale: 1.0, samples: g.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === 'high' ? 6 : 4, rings: 2, samples: g.ao === 'high' ? 16 : 8 });
        composer.addPass(ao);
      }
      if (g.bloom === 'on') {
        // The threshold is on pre-tone-mapping HDR values (exposure 1.35): lit surfaces stay
        // below it, only the flames, the lantern, the window and hot specular glints bloom.
        composer.addPass(new A.UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.45, 2.2));
      }
      composer.addPass(new A.OutputPass());
      if (g.grade === 'on') composer.addPass(new A.ShaderPass(GradeShader));
      if (g.antialias === 'smaa') composer.addPass(new A.SMAAPass(Math.round(w * pr), Math.round(h * pr)));
      if (g.antialias === 'fxaa') {
        const fxaa = new A.ShaderPass(A.FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch {
      // Post-processing is an enhancement: render directly if the chain cannot be built.
      this.postFailed = true;
      this.composer = null;
    }
  }

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  _adapt(ms) {
    const f = this._frames;
    f.push(ms);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = document.getElementById('gfx-fps');
    if (el && !el.hidden) el.textContent = `${Math.round(this.fps)} fps · ${Math.round(this.pixelRatio * 100) / 100}×`;
    if (!this.q.adaptive) return false;
    const before = this.adaptiveScale;
    if (avg > 26) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.1);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
    return before !== this.adaptiveScale;
  }

  /** Render one frame: pixel ratio = min(dpr, preset cap) × preset/user scale × adaptive. */
  draw(dt) {
    if (!this._w) this.resize();
    this._adapt(dt * 1000);
    const dpr = window.devicePixelRatio || 1;
    // The canvas sits inside the zoomed page (style.css), so its layout size is
    // its on-screen size / UIScale; the backing store multiplies that back in.
    const ui = (window.UIScale && window.UIScale.value) || 1;
    const ratio = clamp(Math.min(dpr, this.q.cap) * ui * this.q.scale * this.adaptiveScale, 0.5, 3);
    if (Math.abs(ratio - this.pixelRatio) > 1e-3) {
      this.pixelRatio = ratio;
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(this._w || 1, this._h || 1, false);
    }
    const key = this._postKey();
    if (key !== this.postKey) {
      this.postKey = key;
      this._buildPost();
    }
    if (this.composer) {
      try { this.composer.render(dt); return; } catch { this.postFailed = true; this.postKey = null; this.composer = null; }
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Rebuild the room for the current tiers, keeping item/camera state. */
  rebuild() {
    if (!this.level) return;
    const states = [];
    for (const [i, v] of this.itemViews) states.push([i, v.found, v.hinted, v.lift, v.group.rotation.y]);
    const rig = { yaw: this.rig.yaw, pitch: this.rig.pitch, dist: this.rig.dist, target: this.rig.target.clone() };
    const focus = this.focusIndex;
    this.load(this.level);
    for (const [i, found, hinted, lift, rot] of states) {
      const v = this.itemViews.get(i);
      if (!v) continue;
      Object.assign(v, { found, hinted, lift });
      v.group.rotation.y = rot;
    }
    Object.assign(this.rig, { yaw: rig.yaw, pitch: rig.pitch, dist: rig.dist });
    this.rig.target.copy(rig.target);
    this.focusIndex = focus;
  }

  // ---- scene construction -------------------------------------------------
  disposeScene() {
    for (const d of this.disposables) { if (d.dispose) d.dispose(); }
    this.disposables = [];
    this.pickables = [];
    this.itemViews.clear();
    this.scene.clear();
    this.particles = null; this.flame = null; this.pendulum = null; this.candleLight = null;
    this.keyLight = null; this.hemi = null;
  }

  track(...objs) { for (const o of objs) this.disposables.push(o); return objs[0]; }

  mat(color, rough, metal, extra) {
    return this.track(new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough != null ? rough : 0.7, metalness: metal || 0.05 }, extra)));
  }
  // Glossy pieces (glazed ceramic, polished metal, lacquer) get a clearcoat at "detailed".
  gloss(color, rough, metal, coat) {
    if (this.q.detail !== 'detailed') return this.mat(color, rough, metal);
    return this.track(new THREE.MeshPhysicalMaterial({
      color, roughness: rough, metalness: metal || 0.05, clearcoat: coat != null ? coat : 0.7, clearcoatRoughness: 0.18,
    }));
  }
  geo(g) { return this.track(g); }
  // Shared procedural texture (tracked so it is released with the scene).
  canvasTex(canvas, repeatX, repeatY, color) {
    const tex = this.track(new THREE.CanvasTexture(canvas));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    if (color) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Fit the key light's orthographic shadow box tightly around the room's bounds.
  fitShadow(light, min, max) {
    const cam = new THREE.OrthographicCamera();
    cam.position.copy(light.position);
    cam.lookAt(light.target.position);
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse;
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(inv);
      lo.min(v); hi.max(v);
    }
    const sc = light.shadow.camera;
    sc.left = lo.x - 0.2; sc.right = hi.x + 0.2; sc.bottom = lo.y - 0.2; sc.top = hi.y + 0.2;
    sc.near = Math.max(0.1, -hi.z - 0.5); sc.far = -lo.z + 0.5;
    sc.updateProjectionMatrix();
  }

  buildRoom(theme, decoSeed) {
    const t = theme;
    const detailed = this.q.detail === 'detailed';
    this.scene.background = new THREE.Color(t.fog);
    this.scene.fog = new THREE.Fog(t.fog, 22, 46);

    // lighting: one dominant warm key + soft fill + hemisphere ambience
    const hemi = new THREE.HemisphereLight(t.fill, 0x4a3a28, t.ambient * 1.6);
    this.scene.add(hemi);
    this.hemi = hemi;
    this.hemiBase = hemi.intensity;
    const key = new THREE.DirectionalLight(t.key, 2.4);
    key.position.set(6, 9, 7);
    key.target.position.set(0, 1.5, -0.5);
    this.scene.add(key.target);
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.02;
    this.fitShadow(key, new THREE.Vector3(-6.5, -0.3, -4.5), new THREE.Vector3(6.5, 6.4, 4.5));
    this.scene.add(key);
    this.keyLight = key;
    this._applyShadows();
    // warm interior fill so the miniature room reads even on dim themes
    const lamp = new THREE.PointLight(0xffe0b0, 30, 30, 1.8);
    lamp.position.set(0, 5.2, 1.5);
    this.scene.add(lamp);

    const rng = R.mulberry32(decoSeed);
    const woodA = detailed ? this.canvasTex(woodTexture(decoSeed ^ 0x51, 0), 2, 1, true) : null;
    const floorTex = detailed ? this.canvasTex(woodTexture(decoSeed ^ 0xf1, 4), 3, 2, true) : null;

    // floor + two walls (miniature room, open dollhouse front)
    const floor = new THREE.Mesh(this.geo(new THREE.BoxGeometry(13, 0.3, 9)), this.mat(t.floor, detailed ? 0.72 : 0.9, 0.05, floorTex ? { map: floorTex } : null));
    floor.position.y = -0.15; floor.receiveShadow = true;
    this.scene.add(floor);
    const back = new THREE.Mesh(this.geo(new THREE.BoxGeometry(13, 6.4, 0.3)), this.mat(t.wall, 0.95));
    back.position.set(0, 3.2, -4.35); back.receiveShadow = true;
    this.scene.add(back);
    const left = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.3, 6.4, 9)), this.mat(t.wall, 0.95));
    left.position.set(-6.35, 3.2, 0); left.receiveShadow = true;
    this.scene.add(left);
    // authored wallpaper tile, tinted by the theme wall colour; if the file is
    // missing or fails to decode the walls simply stay flat-coloured.
    this.applyWallpaper([back.material, left.material]);

    // plank grooves on floor
    const plankMat = this.mat(new THREE.Color(t.floor).multiplyScalar(0.8).getHex(), 0.95);
    for (let i = 0; i < 6; i++) {
      const groove = new THREE.Mesh(this.geo(new THREE.BoxGeometry(13, 0.02, 0.05)), plankMat);
      groove.position.set(0, 0.005, -4 + i * 1.6);
      this.scene.add(groove);
    }

    // back-wall shelves
    const woodExtra = woodA ? { map: woodA } : null;
    const shelfMat = this.mat(0x6b4a2f, detailed ? 0.62 : 0.8, 0.05, woodExtra);
    for (const y of [2.2, 3.6]) {
      const shelf = new THREE.Mesh(this.geo(new THREE.BoxGeometry(11, 0.16, 1.2)), shelfMat);
      shelf.position.set(0, y - 0.55, -3.6);
      shelf.castShadow = shelf.receiveShadow = true;
      this.scene.add(shelf);
    }
    // side table + crates + rug
    const table = new THREE.Mesh(this.geo(new THREE.BoxGeometry(6.4, 0.18, 1.8)),
      detailed ? this.track(new THREE.MeshPhysicalMaterial({ color: 0x74543a, roughness: 0.55, metalness: 0.02, clearcoat: 0.35, clearcoatRoughness: 0.35, map: woodA }))
        : this.mat(0x74543a, 0.75));
    table.position.set(0, 0.82, 0.6); table.castShadow = table.receiveShadow = true;
    this.scene.add(table);
    for (const x of [-2.6, 2.6]) {
      const leg = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.22, 0.82, 0.22)), shelfMat);
      leg.position.set(x, 0.41, 0.6);
      leg.castShadow = detailed;
      this.scene.add(leg);
    }
    const crateTex = detailed ? this.canvasTex(woodTexture(decoSeed ^ 0xc7, 3), 1, 1, true) : null;
    const crateMat = this.mat(0x7a5c3a, 0.85, 0.05, crateTex ? { map: crateTex } : null);
    for (let i = 0; i < 3; i++) {
      const crate = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.1, 0.9, 1.1)), crateMat);
      crate.position.set(-2 + i * 2, 0.45, -0.2);
      crate.rotation.y = (rng() - 0.5) * 0.4;
      crate.castShadow = crate.receiveShadow = true;
      this.scene.add(crate);
    }
    const rugTex = detailed ? this.canvasTex(rugTexture(), 1, 1, true) : null;
    const rug = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(2.6, 2.6, 0.04, detailed ? 64 : 40)),
      this.mat(0x7a3a44, 0.98, 0, rugTex ? { map: rugTex } : null));
    rug.position.set(0, 0.02, 1.8);
    rug.receiveShadow = true;
    this.scene.add(rug);

    if (detailed) this.buildTrim(t);

    // animated details: candle flame, wall-clock pendulum, dust motes
    const candle = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 12)), this.mat(0xf0e6c8, 0.6));
    candle.position.set(5.4, 4.0, -3.6);
    this.scene.add(candle);
    // flame colour above 1.0 so the bloom pass picks it up (tone mapping keeps it warm)
    this.flame = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.06, 0.2, 10)),
      this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc65c).multiplyScalar(detailed ? 6 : 1) })));
    this.flame.position.set(5.4, 4.36, -3.6);
    this.scene.add(this.flame);
    if (detailed) {
      // candle glow that flickers with the flame
      this.candleLight = new THREE.PointLight(0xffb45a, 4, 5, 2);
      this.candleLight.position.set(5.4, 4.5, -3.3);
      this.scene.add(this.candleLight);
    }
    const clockBody = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 24)), this.gloss(0x8a6a3a, 0.45, 0.3, 0.5));
    clockBody.rotation.x = Math.PI / 2;
    clockBody.position.set(-5.2, 4.6, -4.1);
    this.scene.add(clockBody);
    if (detailed) {
      const face = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.4, 32)), this.mat(0xf2ead6, 0.5));
      face.position.set(-5.2, 4.6, -4.03);
      this.scene.add(face);
      const tickMat = this.mat(0x2b2118, 0.6);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const tick = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.03, k % 3 ? 0.05 : 0.09, 0.01)), tickMat);
        tick.position.set(-5.2 + Math.sin(a) * 0.33, 4.6 + Math.cos(a) * 0.33, -4.02);
        tick.rotation.z = -a;
        this.scene.add(tick);
      }
    }
    this.pendulum = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.05, 0.8, 0.05)), this.gloss(0xd4af37, 0.3, 0.8, 0.4));
    this.pendulum.geometry.translate(0, -0.4, 0);
    this.pendulum.position.set(-5.2, 4.2, -4.05);
    this.scene.add(this.pendulum);

    // dust particles (cosmetic layer — never raycastable): soft additive motes
    const n = PARTICLE_COUNT[this.q.particles];
    const pos = new Float32Array(n * 3);
    const prng = R.mulberry32(decoSeed ^ 0xd157);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (prng() - 0.5) * 12;
      pos[i * 3 + 1] = prng() * 6;
      pos[i * 3 + 2] = (prng() - 0.5) * 8;
    }
    const pgeo = this.track(new THREE.BufferGeometry());
    pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const moteTex = this.track(new THREE.CanvasTexture(moteTexture()));
    this.particles = new THREE.Points(pgeo, this.track(new THREE.PointsMaterial({
      color: 0xffeccc, size: 0.09, map: moteTex, transparent: true, opacity: 0.4, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    })));
    this.particles.userData.base = pos.slice();
    this.scene.add(this.particles);
  }

  // "detailed" room trim: skirting boards, a picture rail, a framed print and a small window.
  // Wall-mounted only, above or beside every item anchor, so nothing new occludes a find.
  buildTrim(t) {
    const trimMat = this.mat(new THREE.Color(t.wall).lerp(new THREE.Color(0xf0e2c8), 0.55).getHex(), 0.55);
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(this.geo(geo), mat); m.position.set(x, y, z); m.receiveShadow = true; this.scene.add(m); return m; };
    add(new THREE.BoxGeometry(13, 0.32, 0.08), trimMat, 0, 0.16, -4.18);          // back skirting
    add(new THREE.BoxGeometry(0.08, 0.32, 9), trimMat, -6.18, 0.16, 0);           // left skirting
    add(new THREE.BoxGeometry(13, 0.1, 0.07), trimMat, 0, 4.25, -4.18);            // picture rail
    add(new THREE.BoxGeometry(0.07, 0.1, 9), trimMat, -6.18, 4.25, 0);
    add(new THREE.BoxGeometry(13, 0.22, 0.14), trimMat, 0, 6.29, -4.14);          // crown
    // framed print above the shelves
    const frame = this.gloss(0x5a3b22, 0.4, 0.1, 0.5);
    add(new THREE.BoxGeometry(2.3, 1.35, 0.06), frame, 1.4, 5.15, -4.17);
    const art = this.canvasTex((() => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 76;
      const g = c.getContext('2d');
      const sky = g.createLinearGradient(0, 0, 0, 76);
      sky.addColorStop(0, '#f3d9a8'); sky.addColorStop(1, '#c98f6a');
      g.fillStyle = sky; g.fillRect(0, 0, 128, 76);
      g.fillStyle = '#7d6a8a'; g.beginPath(); g.moveTo(0, 60); g.lineTo(34, 30); g.lineTo(62, 52); g.lineTo(92, 24); g.lineTo(128, 56); g.lineTo(128, 76); g.lineTo(0, 76); g.fill();
      g.fillStyle = '#4c5a48'; g.fillRect(0, 62, 128, 14);
      g.fillStyle = '#fff4d8'; g.beginPath(); g.arc(98, 18, 7, 0, Math.PI * 2); g.fill();
      return c;
    })(), 1, 1, true);
    art.wrapS = art.wrapT = THREE.ClampToEdgeWrapping;
    add(new THREE.PlaneGeometry(2.05, 1.12), this.mat(0xffffff, 0.8, 0, { map: art }), 1.4, 5.15, -4.13);
    // small window on the left wall: frame, glowing pane and sill
    const pane = this.track(new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, emissive: new THREE.Color(t.key).lerp(new THREE.Color(t.fill), 0.35), emissiveIntensity: 2.4, roughness: 0.2,
    }));
    const win = add(new THREE.PlaneGeometry(1.8, 1.5), pane, -6.19, 5.1, 1.2);
    win.rotation.y = Math.PI / 2;
    add(new THREE.BoxGeometry(0.1, 1.64, 0.08), frame, -6.16, 5.1, 1.2);        // mullion
    add(new THREE.BoxGeometry(0.1, 0.08, 1.9), frame, -6.16, 5.1, 1.2);         // transom
    add(new THREE.BoxGeometry(0.1, 1.66, 0.1), frame, -6.16, 5.1, 0.25);
    add(new THREE.BoxGeometry(0.1, 1.66, 0.1), frame, -6.16, 5.1, 2.15);
    add(new THREE.BoxGeometry(0.1, 0.1, 2.0), frame, -6.16, 5.9, 1.2);
    add(new THREE.BoxGeometry(0.26, 0.08, 2.1), trimMat, -6.1, 4.32, 1.2);       // sill
  }

  // Async, best-effort: a decoded wallpaper tile multiplies the flat wall colour.
  applyWallpaper(materials) {
    const img = new Image();
    img.onload = () => {
      try {
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(4, 2);
        tex.needsUpdate = true;
        this.disposables.push(tex);
        for (const m of materials) { m.map = tex; m.needsUpdate = true; }
      } catch { /* keep the flat walls */ }
    };
    img.onerror = () => { /* keep the flat walls */ };
    img.src = 'assets/wall-paper.webp';
  }

  // ---- procedural item meshes ------------------------------------------------
  buildItemMesh(kind, color, scale) {
    const g = new THREE.Group();
    const m = (geo, mat, x, y, z, rx, ry, rz) => {
      const mesh = new THREE.Mesh(this.geo(geo), mat);
      mesh.position.set(x || 0, y || 0, z || 0);
      mesh.rotation.set(rx || 0, ry || 0, rz || 0);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    // glazed / lacquered kinds get a clearcoat at "detailed"; metal kinds a polished coat
    const glazed = /^(mug|teapot|bottle|shell|button|jar|book)$/.test(kind);
    const body = glazed ? this.gloss(color, 0.42, 0.05, 0.8) : this.mat(color, 0.55, 0.15);
    const dark = this.mat(new THREE.Color(color).multiplyScalar(0.55).getHex(), 0.7, 0.1);
    const metal = this.gloss(color, 0.3, 0.75, 0.35);
    switch (kind) {
      case 'mug':
        m(new THREE.CylinderGeometry(0.32, 0.28, 0.55, 20), body, 0, 0.28, 0);
        m(new THREE.TorusGeometry(0.2, 0.05, 10, 20, Math.PI), dark, 0.34, 0.3, 0, 0, 0, -Math.PI / 2);
        break;
      case 'key':
        m(new THREE.TorusGeometry(0.2, 0.06, 10, 20), metal, 0, 0.1, 0, Math.PI / 2);
        m(new THREE.BoxGeometry(0.5, 0.07, 0.07), metal, 0.42, 0.1, 0);
        m(new THREE.BoxGeometry(0.1, 0.07, 0.16), metal, 0.6, 0.1, 0.05);
        break;
      case 'book':
        m(new THREE.BoxGeometry(0.55, 0.14, 0.75), body, 0, 0.07, 0);
        m(new THREE.BoxGeometry(0.5, 0.12, 0.7), this.mat(0xf0ead8, 0.9), 0.03, 0.074, 0); // pages sit under the cover (no coplanar z-fight)
        break;
      case 'candle':
        m(new THREE.CylinderGeometry(0.14, 0.16, 0.6, 14), body, 0, 0.3, 0);
        m(new THREE.ConeGeometry(0.05, 0.14, 8), this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc65c).multiplyScalar(this.q.detail === 'detailed' ? 5 : 1) })), 0, 0.66, 0);
        break;
      case 'spool':
        m(new THREE.CylinderGeometry(0.16, 0.16, 0.34, 14), body, 0, 0.2, 0);
        m(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 14), dark, 0, 0.4, 0);
        m(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 14), dark, 0, 0.03, 0);
        break;
      case 'acorn':
        m(new THREE.SphereGeometry(0.24, 16, 12), body, 0, 0.2, 0);
        m(new THREE.SphereGeometry(0.26, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), dark, 0, 0.3, 0);
        break;
      case 'bottle':
        m(new THREE.CylinderGeometry(0.2, 0.24, 0.6, 16), body, 0, 0.3, 0);
        m(new THREE.CylinderGeometry(0.07, 0.12, 0.3, 12), body, 0, 0.72, 0);
        break;
      case 'clock':
        m(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 24), metal, 0, 0.3, 0, Math.PI / 2.3);
        m(new THREE.TorusGeometry(0.08, 0.03, 8, 16), metal, 0, 0.62, -0.13);
        break;
      case 'teapot':
        m(new THREE.SphereGeometry(0.32, 18, 14), body, 0, 0.32, 0);
        m(new THREE.CylinderGeometry(0.05, 0.1, 0.35, 10), body, 0.36, 0.4, 0, 0, 0, -0.7);
        m(new THREE.TorusGeometry(0.18, 0.04, 8, 18, Math.PI), dark, -0.32, 0.4, 0, 0, 0, Math.PI / 2);
        m(new THREE.CylinderGeometry(0.1, 0.14, 0.1, 12), dark, 0, 0.62, 0);
        break;
      case 'shell':
        m(new THREE.SphereGeometry(0.3, 16, 12, 0, Math.PI), body, 0, 0.1, 0, 0, 0, Math.PI / 2);
        m(new THREE.TorusGeometry(0.14, 0.05, 8, 14), dark, 0.1, 0.12, 0, Math.PI / 2);
        break;
      case 'bell':
        m(new THREE.ConeGeometry(0.26, 0.4, 16), metal, 0, 0.28, 0);
        m(new THREE.SphereGeometry(0.07, 10, 8), dark, 0, 0.06, 0);
        break;
      case 'thimble':
        m(new THREE.CylinderGeometry(0.16, 0.22, 0.36, 14), metal, 0, 0.18, 0);
        break;
      case 'feather':
        m(new THREE.ConeGeometry(0.1, 0.7, 8), body, 0, 0.35, 0, 0, 0, 0.5);
        m(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), dark, -0.12, 0.25, 0, 0, 0, 0.5);
        break;
      case 'coin':
        m(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 24), metal, 0, 0.05, 0, 0.3, 0, 0.1);
        break;
      case 'button':
        m(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 20), body, 0, 0.05, 0);
        m(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), dark, 0.06, 0.05, 0.05);
        m(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), dark, -0.06, 0.05, -0.05);
        break;
      case 'pencil':
        m(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8), body, 0, 0.06, 0, 0, 0, Math.PI / 2);
        m(new THREE.ConeGeometry(0.05, 0.15, 8), this.mat(0xd8b98a, 0.8), 0.47, 0.06, 0, 0, 0, -Math.PI / 2);
        break;
      case 'lantern':
        m(new THREE.CylinderGeometry(0.2, 0.24, 0.4, 8), dark, 0, 0.28, 0);
        m(new THREE.CylinderGeometry(0.14, 0.14, 0.24, 8), this.track(new THREE.MeshStandardMaterial({ color: 0xffd98a, emissive: 0xffb84a, emissiveIntensity: this.q.detail === 'detailed' ? 3.5 : 0.55, roughness: 0.4 })), 0, 0.28, 0);
        m(new THREE.TorusGeometry(0.12, 0.025, 8, 14, Math.PI), metal, 0, 0.52, 0);
        break;
      case 'pinecone':
        m(new THREE.ConeGeometry(0.22, 0.5, 10), body, 0, 0.26, 0);
        m(new THREE.ConeGeometry(0.16, 0.3, 8), dark, 0, 0.4, 0);
        break;
      case 'jar':
        m(new THREE.CylinderGeometry(0.24, 0.2, 0.5, 16), this.track(new THREE.MeshStandardMaterial({ color, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.75 })), 0, 0.26, 0);
        m(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 14), dark, 0, 0.54, 0);
        break;
      case 'ribbon':
        m(new THREE.TorusGeometry(0.2, 0.07, 8, 18), body, -0.12, 0.12, 0, Math.PI / 2);
        m(new THREE.TorusGeometry(0.2, 0.07, 8, 18), body, 0.12, 0.12, 0, Math.PI / 2);
        break;
      default:
        m(new THREE.SphereGeometry(0.28, 16, 12), body, 0, 0.28, 0);
    }
    g.scale.setScalar(scale || 1);
    return g;
  }

  buildItems(level) {
    for (let i = 0; i < level.items.length; i++) {
      const it = level.items[i];
      const group = this.buildItemMesh(it.kind, it.color, it.scale);
      group.position.set(it.pos[0], it.pos[1], it.pos[2]);
      group.rotation.y = it.rotY || 0;
      group.userData.itemIndex = i;
      // grounded selection ring marker
      const ring = new THREE.Mesh(
        this.geo(new THREE.RingGeometry(0.42, 0.55, 28)),
        this.track(new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }))
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(it.pos[0], Math.max(0.03, it.pos[1] + 0.02), it.pos[2]);
      this.scene.add(ring);
      // mark all child meshes pickable
      group.traverse((o) => { if (o.isMesh) { o.userData.itemIndex = i; this.pickables.push(o); } });
      this.scene.add(group);
      this.itemViews.set(i, { group, ring, baseY: it.pos[1], bobPhase: it.bobPhase || 0, found: false, hinted: false, lift: 0 });
    }
  }

  load(level) {
    this.disposeScene();
    const theme = C.THEMES.find((t) => t.id === level.theme) || C.THEMES[0];
    this.level = level;
    this.levelSeed = level.seed;
    this.reduced = Settings.get('reducedMotion');
    this.buildRoom(theme, level.seed ^ 0xdec0);
    this.buildItems(level);
    this.resetCamera();
    this.resize();
  }

  // ---- per-frame update -----------------------------------------------------
  update(dt) {
    this.clockT += dt;
    const t = this.clockT;
    // decorative animation from simulation time, disabled by reduced motion/hidden
    if (!this.reduced && !document.hidden) {
      if (this.flame) {
        this.flame.scale.set(1 + Math.sin(t * 11) * 0.15, 1 + Math.sin(t * 13.7) * 0.25, 1);
      }
      if (this.pendulum) this.pendulum.rotation.z = Math.sin(t * 2.2) * 0.35;
      if (this.candleLight) this.candleLight.intensity = 4 + Math.sin(t * 11) * 0.6 + Math.sin(t * 23.3) * 0.4;
      if (this.particles) {
        const p = this.particles.geometry.attributes.position;
        const base = this.particles.userData.base;
        for (let i = 0; i < p.count; i++) {
          p.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.4 + i) * 0.25;
          p.array[i * 3] = base[i * 3] + Math.sin(t * 0.2 + i * 1.7) * 0.15;
        }
        p.needsUpdate = true;
      }
    }
    // selection/hint/found presentation (lift + rim + grounded marker)
    for (const [i, v] of this.itemViews) {
      const targetLift = v.found ? 0.35 : 0;
      v.lift += (targetLift - v.lift) * Math.min(1, dt * (this.reduced ? 100 : 8));
      const bob = (!this.reduced && !v.found) ? Math.sin(t * 1.6 + v.bobPhase) * 0.02 : 0;
      v.group.position.y = v.baseY + v.lift + bob;
      const isFocus = i === this.focusIndex;
      const want = v.found ? 0.9 : (v.hinted ? 0.55 + Math.sin(t * 5) * 0.3 : (isFocus ? 0.75 : 0));
      v.ring.material.opacity += (want - v.ring.material.opacity) * Math.min(1, dt * 10);
      // a faded ring must not reach the depth/normal buffers (AO would draw a dark halo)
      v.ring.visible = v.ring.material.opacity > 0.01;
      v.ring.material.color.setHex(v.found ? 0x7dd87d : 0xffb84d);
      if (v.found) v.group.rotation.y += this.reduced ? 0 : dt * 0.6;
    }
    this.applyCamera();
    this.draw(dt);
  }

  // ---- camera ----------------------------------------------------------------
  applyCamera() {
    const r = this.rig;
    const cp = Math.cos(r.pitch), sp = Math.sin(r.pitch);
    this.camera.position.set(
      r.target.x + Math.sin(r.yaw) * cp * r.dist,
      r.target.y + sp * r.dist,
      r.target.z + Math.cos(r.yaw) * cp * r.dist
    );
    this.camera.lookAt(r.target);
  }
  resetCamera() {
    const h = JSON.parse(this.rigHome);
    this.rig.yaw = h.yaw; this.rig.pitch = h.pitch; this.rig.dist = h.dist;
    this.rig.target.set(0, 1.6, -1);
    this.focusIndex = -1;
  }
  panBy(dx, dy) {
    // Orbit stays on the open face of the diorama: beyond ±0.75 rad yaw or
    // above ~1.0 rad pitch the side/back walls come between camera and room.
    this.rig.yaw = clamp(this.rig.yaw - dx * 0.005, -0.75, 0.75);
    this.rig.pitch = clamp(this.rig.pitch + dy * 0.004, 0.25, 1.0);
    if (this.onCameraMove) this.onCameraMove();
  }
  zoomBy(f) {
    this.rig.dist = clamp(this.rig.dist * f, 7, 24);
    if (this.onCameraMove) this.onCameraMove();
  }
  focusItem(i) {
    const v = this.itemViews.get(i);
    if (!v) return;
    this.focusIndex = i;
    // ease camera target toward item (critically damped-ish, interruptible)
    const dest = v.group.position.clone();
    dest.y += 0.3;
    this._camAnim = { from: this.rig.target.clone(), to: dest, t: 0, dur: this.reduced ? 0.01 : 0.35 };
    // focusing moves the camera; report it so keyboard-only players can
    // satisfy the tutorial's look-around step without dragging
    if (this.onCameraMove) this.onCameraMove();
  }
  stepCameraAnim(dt) {
    const a = this._camAnim;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / a.dur);
    const e = 1 - Math.pow(1 - a.t, 3);
    this.rig.target.lerpVectors(a.from, a.to, e);
    if (a.t >= 1) this._camAnim = null;
  }

  // ---- input ------------------------------------------------------------------
  _bindInput() {
    const el = this.canvas;
    el.style.touchAction = 'none';
    let down = null; // {x,y,t,id,moved}
    el.addEventListener('pointerdown', (ev) => {
      el.setPointerCapture(ev.pointerId);
      down = { x: ev.clientX, y: ev.clientY, t: performance.now(), id: ev.pointerId, moved: false };
      Audio.ensure();
    });
    el.addEventListener('pointermove', (ev) => {
      if (!down || ev.pointerId !== down.id) return;
      const dx = ev.clientX - down.x, dy = ev.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > 8) down.moved = true;
      if (down.moved) {
        this.panBy(ev.movementX || dx - (down.lx || 0), ev.movementY || dy - (down.ly || 0));
        down.lx = dx; down.ly = dy;
      }
    });
    const up = (ev) => {
      if (!down || ev.pointerId !== down.id) return;
      const dtms = performance.now() - down.t;
      const wasTap = !down.moved && dtms < 400;
      const x = down.x, y = down.y;
      down = null;
      if (wasTap && this.onTap) this.onTap(this.pick(x, y));
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => { down = null; });
    el.addEventListener('wheel', (ev) => { ev.preventDefault(); this.zoomBy(ev.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });
    // pinch zoom
    const touches = new Map();
    el.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'touch') return;
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      // a second finger means pinch, not tap: cancel any pending tap so
      // lifting fingers after a pinch never selects an object by accident
      if (touches.size >= 2 && down) down.moved = true;
    });
    el.addEventListener('pointermove', (ev) => {
      if (ev.pointerType !== 'touch' || !touches.has(ev.pointerId)) return;
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size === 2) {
        const pts = Array.from(touches.values());
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this._pinchD) this.zoomBy(this._pinchD / d);
        this._pinchD = d;
      }
    });
    const clearTouch = (ev) => { touches.delete(ev.pointerId); if (touches.size < 2) this._pinchD = null; };
    el.addEventListener('pointerup', clearTouch);
    el.addEventListener('pointercancel', clearTouch);
    this.canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); this._ctxLost = true; });
    this.canvas.addEventListener('webglcontextrestored', () => { this._ctxLost = false; this.renderer.render(this.scene, this.camera); });
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = {
      x: ((clientX - rect.left) / Math.max(1e-6, rect.width)) * 2 - 1,
      y: -(((clientY - rect.top) / Math.max(1e-6, rect.height)) * 2 - 1),
    };
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const h of hits) {
      const idx = h.object.userData.itemIndex;
      const v = this.itemViews.get(idx);
      if (v && !v.found) return idx;
    }
    return null;
  }

  markFound(i) { const v = this.itemViews.get(i); if (v) { v.found = true; v.hinted = false; } }
  markHinted(i) { const v = this.itemViews.get(i); if (v) v.hinted = true; }
  markUnfound(i) { const v = this.itemViews.get(i); if (v) { v.found = false; v.lift = 0; v.group.rotation.y = 0; } }

  resize() {
    const w = Math.max(1, Math.floor(this.holder.clientWidth));
    const h = Math.max(1, Math.floor(this.holder.clientHeight));
    if (w === this._w && h === this._h) return;
    this._w = w; this._h = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    // Narrow viewports: the home distance grows so the whole room width fits
    // (the authored 15 assumes a ~1.3 aspect); the user-zoom clamp follows.
    const homeDist = Math.min(24, 15 * Math.max(1, 1.3 / this.camera.aspect));
    const wasHome = Math.abs(this.rig.dist - JSON.parse(this.rigHome).dist) < 0.01;
    this.rigHome = JSON.stringify({ yaw: 0, pitch: 0.62, dist: homeDist });
    if (wasHome) this.rig.dist = homeDist;
  }

  dispose() {
    this.disposeScene();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// ===========================================================================
// UI helpers: overlays, live announcements, HUD
// ===========================================================================
const UI = {
  overlayStack: [],
  lastFocus: null,

  announce(msg, assertive) {
    const el = $(assertive ? 'live-assertive' : 'live-region');
    el.textContent = '';
    // re-set next tick so repeated messages are announced
    setTimeout(() => { el.textContent = msg; }, 30);
  },
  setStatus(msg) { $('status-line').textContent = msg || ''; },
  setAvatar(url) {
    let img = $('hn-avatar');
    if (!url) { if (img) img.remove(); return; }
    if (!img) {
      img = document.createElement('img');
      img.id = 'hn-avatar';
      img.className = 'hn-avatar';
      img.alt = '';
      $('status-line').before(img);
    }
    img.src = url;
  },
  toast(msg) {
    let el = $('hn-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hn-toast';
      el.className = 'hn-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.hidden = true; }, 3500);
  },
  setSync(state) {
    const el = $('sync-status');
    if (!el) return;
    if (!Platform.hosted) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = { saving: 'Saving…', synced: 'Cloud synced', offline: 'Offline — local only' }[state] || state;
    el.dataset.state = state;
  },

  showOverlay(html, opts) {
    const root = $('overlay-root');
    root.hidden = false;
    this.lastFocus = document.activeElement;
    root.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'hn-overlay';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    if (opts && opts.label) panel.setAttribute('aria-label', opts.label);
    panel.innerHTML = html;
    root.appendChild(panel);
    const first = panel.querySelector('button, input, select, [tabindex]');
    if (first) first.focus();
    // simple focus trap
    panel.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Tab') return;
      const focusables = Array.from(panel.querySelectorAll('button, input, select, [tabindex]')).filter((b) => !b.disabled);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
    return panel;
  },
  closeOverlay() {
    const root = $('overlay-root');
    root.hidden = true;
    root.innerHTML = '';
    if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus();
  },
  overlayOpen() { return !$('overlay-root').hidden; },

  esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  fmtTime(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  },
};

// ===========================================================================
// session controller: state machine + round runner
// boot → title → mode-select → preparing → countdown → active ↔ paused
//   → resolving → results → progression
// ===========================================================================
const Game = {
  phase: 'boot',
  level: null,
  state: null,
  renderer: null,
  cmdSeq: 0,
  sessionId: null,
  tickAccum: 0,
  lastFrame: 0,
  pausedByBackground: false,
  tutorialStep: 0,
  dailyInfo: null,
  pendingMode: null,

  // ---- lifecycle ----------------------------------------------------------
  async boot() {
    Settings.load();
    Platform.init();
    Platform.onSaved((ok) => UI.setSync(ok ? 'synced' : 'offline'));
    Platform.onAuth = (signedIn) => {
      UI.setSync(signedIn ? 'synced' : 'offline');
      if (!signedIn) { UI.toast(SH_TEXT.signedOut); UI.setStatus('Offline mode — progress is stored locally'); }
      Platform.syncTime();
      if (this.phase === 'title') this.toTitle();
    };
    Platform.loadBindings(DEFAULT_BINDINGS).then((b) => { bindings = b; });
    Progress.load();
    UI.setStatus('Loading…');
    try {
      this.renderer = new NookRenderer($('canvas-holder'));
      window.__hnRenderer = this.renderer;
    } catch (e) {
      $('canvas-holder').innerHTML = '<p style="padding:2rem;max-width:46ch">This device or browser does not support WebGL, which Hidden Nook needs to draw the room. Your settings and progress are preserved.</p>';
      UI.setStatus('WebGL unavailable');
      return;
    }
    this.renderer.setGraphics(Settings.get('graphics'));
    this.renderer.onTap = (idx) => this.handleTap(idx);
    this.renderer.onCameraMove = () => { if (this.tutorialStep === 0 && this.phase === 'active') this.advanceTutorial('pan'); };

    await Platform.syncTime();
    if (Platform.hosted) {
      UI.setStatus('Connecting…');
      await Promise.all([Platform.loadProfile(), Progress.cloudPull(),
        Platform.getSettings().then((st) => Settings.adopt(st))]);
      UI.setStatus('Signed in as ' + (Platform.nickname || 'Player'));
      UI.setAvatar(Platform.avatar);
    } else {
      UI.setStatus('Offline mode — progress is stored locally');
    }

    this.bindGlobalInput();
    this.bindHudButtons();
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('pagehide', () => Progress.flushCloud());
    document.addEventListener('visibilitychange', () => this.onVisibility());

    this.lastFrame = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      if (!document.hidden) {
        this.frame(dt);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    this.toTitle();
  },

  toTitle() {
    this.phase = 'title';
    $('btn-pause').hidden = true;
    $('action-row').hidden = true;
    $('bottom-tray').hidden = true;
    const p = Progress.doc;
    const dailyDay = new Date(Platform.now()).toISOString().slice(0, 10);
    const panel = UI.showOverlay(`
      <h2>Hidden Nook</h2>
      <p>A miniature room full of small things. Find every object named in the request strip.</p>
      <div class="hn-menu">
        <button class="hn-btn hn-btn-primary" data-act="play">${p.tutorialDone ? 'Play' : 'Play (starts with a quick lesson)'}</button>
        <button class="hn-btn" data-act="daily">Daily challenge <span class="hn-badge">${UI.esc(dailyDay)}</span></button>
        <button class="hn-btn" data-act="journey">Journey <span class="hn-badge">stage ${Math.min(p.journeyUnlocked + 1, C.JOURNEY_COUNT)} / ${C.JOURNEY_COUNT}</span></button>
        <button class="hn-btn" data-act="practice">Practice</button>
        <button class="hn-btn" data-act="challenge">Challenge</button>
        <button class="hn-btn" data-act="scores">Score chase</button>
        ${p.tutorialDone ? '<button class="hn-btn" data-act="learn">Replay lesson</button>' : ''}
        ${Platform.hosted ? `<button class="hn-btn" data-act="invite" id="btn-invite">${UI.esc(SH_TEXT.invite)}</button>` : ''}
        ${Platform.canSignIn() ? `<button class="hn-btn" data-act="signin" id="btn-signin">${UI.esc(SH_TEXT.signIn)}</button>` : ''}
      </div>
      <h3>Achievements</h3>
      <div>${Object.keys(ACTION_ACHIEVEMENTS).map((k) => {
        const a = ACTION_ACHIEVEMENTS[k];
        const got = !!p.achievements[k];
        return `<span class="hn-badge ${got ? 'unlocked' : ''}" title="${UI.esc(a.desc)}">${got ? '✓ ' : ''}${UI.esc(a.name)}</span>`;
      }).join('')}</div>
    `, { label: 'Title screen' });
    panel.classList.add('hn-overlay-keyart');
    panel.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      Audio.play('click');
      const act = b.dataset.act;
      if (act === 'play') {
        if (!Progress.doc.tutorialDone) this.startLearn();
        else this.toModeSelect();
      }
      else if (act === 'daily') this.startDaily();
      else if (act === 'journey') this.toJourneySelect();
      else if (act === 'practice') this.toPracticeSetup();
      else if (act === 'challenge') this.toChallengeSetup();
      else if (act === 'scores') this.showScores();
      else if (act === 'learn') this.startLearn();
      else if (act === 'invite') this.inviteFriend();
      else if (act === 'signin') Platform.signIn();
    });
  },

  inviteFriend() {
    const link = Platform.inviteLink();
    if (!link) return;
    const done = (ok) => UI.toast(ok ? SH_TEXT.copied : SH_TEXT.copyFailed.replace('{link}', link));
    try { navigator.clipboard.writeText(link).then(() => done(true), () => done(false)); } catch { done(false); }
  },

  toModeSelect() {
    this.phase = 'mode-select';
    const panel = UI.showOverlay(`
      <h2>Choose a mode</h2>
      <div class="hn-menu">
        <button class="hn-btn hn-btn-primary" data-act="journey">Journey — authored stages, growing difficulty</button>
        <button class="hn-btn" data-act="daily">Daily — one shared seed per UTC day</button>
        <button class="hn-btn" data-act="practice">Practice — unrated, undo allowed</button>
        <button class="hn-btn" data-act="challenge">Challenge — move limits and speed targets</button>
        <button class="hn-btn" data-act="back">Back</button>
      </div>
    `, { label: 'Mode select' });
    panel.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      Audio.play('click');
      const act = b.dataset.act;
      if (act === 'journey') this.toJourneySelect();
      else if (act === 'daily') this.startDaily();
      else if (act === 'practice') this.toPracticeSetup();
      else if (act === 'challenge') this.toChallengeSetup();
      else this.toTitle();
    });
  },

  toJourneySelect() {
    this.phase = 'mode-select';
    const unlocked = Progress.doc.journeyUnlocked;
    let cells = '';
    for (let i = 0; i < C.JOURNEY_COUNT; i++) {
      const open = i <= unlocked;
      const best = Progress.doc.bestScores['journey-' + (i + 1)];
      cells += `<button class="hn-btn" data-stage="${i}" ${open ? '' : 'disabled'}>
        Stage ${i + 1}${best ? ` <span class="hn-badge">${best.score}</span>` : ''}${open ? '' : ' 🔒'}</button>`;
    }
    const panel = UI.showOverlay(`
      <h2>Journey</h2>
      <p>Ranked stages. New concepts appear one at a time, then combine. Mastery stages every fifth.</p>
      <div class="hn-menu" style="max-height:46vh;overflow-y:auto">${cells}</div>
      <div class="hn-btn-row"><button class="hn-btn" data-act="back">Back</button></div>
    `, { label: 'Journey stages' });
    panel.addEventListener('click', (ev) => {
      const s = ev.target.closest('[data-stage]');
      const back = ev.target.closest('[data-act="back"]');
      if (s && !s.disabled) { Audio.play('click'); this.prepare(C.journeyLevel(Number(s.dataset.stage)), 'journey'); }
      else if (back) { Audio.play('click'); this.toModeSelect(); }
    });
  },

  toPracticeSetup() {
    this.phase = 'mode-select';
    const panel = UI.showOverlay(`
      <h2>Practice</h2>
      <p>Unrated. Undo is allowed, timers are relaxed, and ratings are unaffected.</p>
      <div class="hn-field"><label for="pf-diff">Difficulty</label>
        <select id="pf-diff"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select></div>
      <div class="hn-field"><label for="pf-seed">Seed (inspectable)</label>
        <input id="pf-seed" type="number" min="0" max="999999999" value="${Math.floor(Math.random() * 1e9)}" style="width:150px;background:var(--hn-panel2);color:inherit;border:1px solid var(--hn-line);border-radius:6px;padding:0.35rem;min-height:40px" /></div>
      <div class="hn-btn-row">
        <button class="hn-btn hn-btn-primary" data-act="go">Start practice</button>
        <button class="hn-btn" data-act="back">Back</button>
      </div>
    `, { label: 'Practice setup' });
    panel.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      Audio.play('click');
      if (b.dataset.act === 'go') {
        const diff = panel.querySelector('#pf-diff').value;
        const seed = Math.max(0, Math.floor(Number(panel.querySelector('#pf-seed').value) || 1));
        this.prepare(C.practiceLevel(diff, seed), 'practice');
      } else this.toModeSelect();
    });
  },

  toChallengeSetup() {
    this.phase = 'mode-select';
    const panel = UI.showOverlay(`
      <h2>Challenge</h2>
      <p>Constrained goals. No undo.</p>
      <div class="hn-menu">
        <button class="hn-btn" data-ch="speed">Speed nook — 90 seconds, 8 objects</button>
        <button class="hn-btn" data-ch="moves">Economy — only 14 taps for 10 objects</button>
        <button class="hn-btn" data-ch="crowded">Crowded shelf — 14 objects, heavy decoys</button>
        <button class="hn-btn" data-act="back">Back</button>
      </div>
    `, { label: 'Challenge setup' });
    panel.addEventListener('click', (ev) => {
      const ch = ev.target.closest('[data-ch]');
      const back = ev.target.closest('[data-act="back"]');
      if (ch) { Audio.play('click'); this.prepare(C.challengeLevel(ch.dataset.ch, Math.floor(Math.random() * 1e9)), 'challenge'); }
      else if (back) { Audio.play('click'); this.toModeSelect(); }
    });
  },

  async startDaily() {
    this.phase = 'mode-select';
    // The daily seed is computed from the UTC day (local clock standalone,
    // server-offset clock when signed in) and played unranked.
    const day = new Date(Platform.now()).toISOString().slice(0, 10);
    const level = C.dailyLevel(day);
    UI.setStatus('Daily seed computed locally — unranked');
    this.dailyInfo = { day: level.dailyDay, ranked: false };
    this.prepare(level, 'daily');
  },

  startLearn() {
    this.tutorialStep = 0;
    this.prepare(C.tutorialLevel(), 'learn');
  },

  // ---- preparing / countdown --------------------------------------------------
  prepare(level, mode) {
    this.phase = 'preparing';
    this.level = level;
    const v = C.validateLevel(level);
    if (!v.ok) {
      UI.showOverlay(`<h2>Content error</h2><p>This stage failed validation: ${UI.esc(v.errors.join('; '))}</p>
        <div class="hn-btn-row"><button class="hn-btn" id="ce-back">Back</button></div>`, { label: 'Content error' });
      $('ce-back').addEventListener('click', () => this.toTitle());
      return;
    }
    const rulesText = this.describeRules(level, mode);
    const panel = UI.showOverlay(`
      <h2>${UI.esc(this.modeName(mode))}</h2>
      ${rulesText}
      <p class="rail-sub">Seed <code>${level.seed.toString(36)}</code> · content v${level.contentVersion} · theme ${UI.esc(level.theme)}</p>
      <div class="hn-btn-row">
        <button class="hn-btn hn-btn-primary" data-act="go">Begin</button>
        <button class="hn-btn" data-act="back">Back</button>
      </div>
    `, { label: 'Round setup' });
    panel.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      Audio.play('click');
      if (b.dataset.act === 'go') this.countdown(mode);
      else this.toTitle();
    });
  },

  modeName(mode) {
    return { learn: 'Lesson', journey: 'Journey', daily: 'Daily challenge', practice: 'Practice', challenge: 'Challenge' }[mode] || mode;
  },
  describeRules(level, mode) {
    const n = level.items.filter((i) => i.requested).length;
    const bits = [`Find <strong>${n}</strong> requested objects among ${level.items.length - n} decoys.`];
    if (level.timeLimitSeconds) bits.push(`Time limit ${UI.fmtTime(level.timeLimitSeconds * 1000)}.`);
    else bits.push('No timer — unhurried.');
    if (level.moveLimit) bits.push(`At most ${level.moveLimit} taps.`);
    bits.push(level.allowUndo ? 'Undo allowed.' : 'No undo.');
    bits.push(`Hints cost ${R.SCORE.HINT_COST} points; wrong taps cost ${R.SCORE.INVALID_PENALTY}.`);
    bits.push(mode === 'daily' && this.dailyInfo && this.dailyInfo.ranked ? 'Ranked: score is validated by replay.' : 'Not ranked.');
    bits.push(mode === 'learn' ? 'Interactive lesson: one rule at a time.' : `Expected duration ~${UI.fmtTime(level.parSeconds * 1000)}.`);
    return '<p>' + bits.join('<br>') + '</p>';
  },

  countdown(mode) {
    this.phase = 'countdown';
    // build session + scene
    this.state = R.createSession(this.level, { mode });
    this.sessionId = mode + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    this.cmdSeq = 0;
    this.renderer.load(this.level);
    this.buildHud();
    if (mode === 'learn') this.tutorialStep = 0;
    this._timerWarned = false;
    const reduced = Settings.get('reducedMotion');
    const steps = reduced ? ['Go'] : ['3', '2', '1', 'Go'];
    let i = 0;
    const panel = UI.showOverlay('<div class="hn-countdown" role="timer" aria-label="Countdown">3</div>', { label: 'Countdown' });
    const div = panel.querySelector('.hn-countdown');
    const iv = setInterval(() => {
      i += 1;
      if (i >= steps.length) {
        clearInterval(iv);
        UI.closeOverlay();
        this.enterActive();
      } else {
        div.textContent = steps[i];
        Audio.play('countdown');
      }
    }, reduced ? 300 : 700);
    div.textContent = steps[0];
  },

  enterActive() {
    this.phase = 'active';
    $('btn-pause').hidden = false;
    $('action-row').hidden = false;
    $('bottom-tray').hidden = false;
    // phones start with the object list collapsed (expand from its heading)
    const objects = document.querySelector('.hn-objects');
    if (objects && matchMedia('(max-width: 700px) and (orientation: portrait), (max-height: 500px) and (orientation: landscape)').matches) objects.open = false;
    $('btn-undo').hidden = !this.state.allowUndo;
    $('tray-undo').hidden = !this.state.allowUndo;
    $('hud-timer').hidden = !this.state.timeLimitMs;
    UI.announce('Round started. ' + this.waveText());
    if (this.state.mode === 'learn') this.showTutorialPrompt();
  },

  // ---- HUD -----------------------------------------------------------------
  buildHud() {
    this.refreshRequestStrip();
    this.refreshTargetList();
    this.refreshScore();
  },
  waveText() {
    const set = R.currentWaveSet(this.state);
    const names = Array.from(set).map((i) => this.state.items[i].name);
    return names.length ? 'Find: ' + names.join(', ') : 'All waves cleared';
  },
  refreshRequestStrip() {
    const ul = $('request-strip');
    ul.innerHTML = '';
    const set = R.currentWaveSet(this.state);
    const wave = this.state.waves[this.state.wave] || [];
    for (const idx of wave) {
      const it = this.state.items[idx];
      const li = document.createElement('li');
      li.className = 'hn-request-chip' + (it.found ? ' found' : '') + (it.hinted ? ' hinted' : '');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = '#' + new THREE.Color(this.level.items[idx].color).getHexString();
      li.appendChild(sw);
      const nm = document.createElement('span');
      nm.textContent = it.name;
      li.appendChild(nm);
      const tag = document.createElement('span');
      tag.className = 'shape-tag';
      tag.textContent = this.level.items[idx].kind;
      li.appendChild(tag);
      li.setAttribute('aria-label', it.name + (it.found ? ', found' : ', not found'));
      ul.appendChild(li);
    }
    $('objective-text').textContent = 'Wave ' + (this.state.wave + 1) + ' of ' + this.state.waves.length + ' — ' + this.waveText();
  },
  refreshTargetList() {
    const ul = $('sr-target-list');
    ul.innerHTML = '';
    this.state.items.forEach((it, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hn-target-item' + (it.found ? ' found' : '');
      b.dataset.index = i;
      b.innerHTML = `<span>${UI.esc(it.name)}</span><span class="state-tag">${it.found ? 'found' : ''}</span>`;
      b.setAttribute('aria-label', it.name + (it.found ? ', found' : ''));
      b.addEventListener('click', () => this.handleTap(i));
      li.appendChild(b);
      ul.appendChild(li);
    });
  },
  refreshScore() {
    $('hud-score').textContent = String(this.state.score);
    const found = this.state.items.filter((i) => i.found).length;
    const total = this.level.items.filter((it) => it.requested).length;
    $('hud-progress').textContent = found + ' / ' + total + ' found';
    const pct = total ? Math.round((found / total) * 100) : 0;
    $('progressbar-fill').style.width = pct + '%';
    $('progressbar').setAttribute('aria-valuenow', String(pct));
  },
  refreshTimer() {
    if (this.state.timeLimitMs == null) return;
    const left = this.state.timeLimitMs - this.state.elapsedMs;
    const el = $('hud-timer');
    el.textContent = UI.fmtTime(left);
    const low = left < 30000;
    el.classList.toggle('hn-timer-low', low);
    // one-shot warning the first time the round crosses the 30 s mark
    if (low && !this._timerWarned) { this._timerWarned = true; Audio.play('timer-low'); }
  },

  // ---- command dispatch -------------------------------------------------------
  dispatch(cmd) {
    if (this.phase !== 'active' && this.phase !== 'resolving') return null;
    cmd.id = this.sessionId + ':' + (++this.cmdSeq);
    const r = R.applyCommand(this.state, cmd);
    if (r.error) {
      UI.announce(this.explainError(r.error), true);
      Audio.play('invalid');
      return r;
    }
    const wasResolving = this.phase === 'resolving';
    this.state = r.state;
    this.handleEvents(r.events);
    this.buildHud();
    if (R.isTerminal(this.state) && !wasResolving) this.toResolving();
    return r;
  },

  explainError(err) {
    return {
      'already-found': 'Already found that one.',
      'no-such-object': 'Nothing there.',
      'hints-disabled': 'Hints are disabled in this round.',
      'nothing-to-hint': 'Nothing left to hint.',
      'undo-disabled': 'Undo is not allowed in this mode.',
      'nothing-to-undo': 'Nothing to undo.',
      'round-over': 'The round is over.',
    }[err] || 'That action is not allowed: ' + err;
  },

  handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'found') {
        this.renderer.markFound(ev.index);
        Audio.play('found', this.state.seed + this.state.tick);
        UI.announce('Found: ' + ev.name);
        this.vibrate(30);
        if (this.state.mode === 'learn') this.advanceTutorial('find');
      } else if (ev.type === 'invalid') {
        Audio.play('invalid');
        UI.announce('That is not on the request strip. −' + R.SCORE.INVALID_PENALTY + ' points.', true);
        this.vibrate([40, 40, 40]);
        if (this.state.mode === 'learn') this.advanceTutorial('wrong');
      } else if (ev.type === 'wave-clear') {
        Audio.play('wave');
        UI.announce('Request strip cleared. Next set revealed.');
        if (this.state.mode === 'learn') this.advanceTutorial('wave');
      } else if (ev.type === 'hint') {
        this.renderer.markHinted(ev.index);
        Audio.play('hint');
        UI.announce('Hint: look for the ' + ev.name + ' — it is glowing.');
        if (this.state.mode === 'learn') this.advanceTutorial('hint');
      } else if (ev.type === 'undo') {
        Audio.play('undo');
        UI.announce('Undone.');
        for (const [i, v] of this.renderer.itemViews) {
          if (v.found !== this.state.items[i].found) {
            if (this.state.items[i].found) this.renderer.markFound(i);
            else this.renderer.markUnfound(i);
          }
          // keep the hint glow in sync with the restored snapshot too
          v.hinted = !!this.state.items[i].hinted && !v.found;
        }
      } else if (ev.type === 'terminal') {
        // handled by toResolving
      }
    }
  },

  vibrate(p) {
    if (Settings.get('haptics') && navigator.vibrate) { try { navigator.vibrate(p); } catch { /* no */ } }
  },

  handleTap(index) {
    if (this.phase !== 'active') return;
    if (index == null) return; // tapped empty space: no penalty, no-op
    this.dispatch({ type: 'find', index });
  },

  hint() { this.dispatch({ type: 'hint' }); },
  undo() { this.dispatch({ type: 'undo' }); },

  // ---- resolving / results ------------------------------------------------------
  toResolving() {
    this.phase = 'resolving';
    // Rules state is final immediately; cosmetic animations may still settle.
    // Fast-forward: settle every object into its exact deterministic end state.
    for (const [i, v] of this.renderer.itemViews) {
      if (this.state.items[i].found) { v.found = true; v.lift = 0.35; v.group.position.y = v.baseY + 0.35; }
    }
    setTimeout(() => this.toResults(), Settings.get('reducedMotion') ? 100 : 600);
  },

  async toResults() {
    this.phase = 'results';
    $('btn-pause').hidden = true;
    $('action-row').hidden = true;
    $('bottom-tray').hidden = true;
    const s = this.state;
    const bd = R.scoreBreakdown(s);
    const won = s.reason === 'all-found';
    Audio.play(won ? 'win' : 'lose');

    // progress updates
    const p = Progress.doc;
    if (s.mode === 'learn' && won) p.tutorialDone = true;
    p.foundTotal += s.items.filter((i) => i.found).length;
    const newAch = [];
    const grant = (key) => { if (Progress.unlock(key)) newAch.push(ACTION_ACHIEVEMENTS[key].name); };
    if (won) grant('first-completion');
    if (won && s.invalids === 0 && s.hintsUsed === 0) grant('mechanic-mastery');
    if (s.mode === 'journey' && won) {
      p.journeyUnlocked = Math.max(p.journeyUnlocked, this.level.index + 1);
      if (this.level.index + 1 >= 20) grant('journey-20');
    }
    if (p.foundTotal >= 1000) grant('collector-1000');
    if (s.mode === 'daily' && won) {
      const day = this.dailyInfo ? this.dailyInfo.day : new Date(Platform.now()).toISOString().slice(0, 10);
      if (p.dailyStreak.last === day) { /* already counted today */ }
      else {
        const yday = new Date(Platform.now() - 86400000).toISOString().slice(0, 10);
        p.dailyStreak.count = (p.dailyStreak.last === yday) ? p.dailyStreak.count + 1 : 1;
        p.dailyStreak.last = day;
        if (p.dailyStreak.count >= 3) grant('daily-streak-3');
      }
    }
    const best = p.bestScores[this.level.id];
    if (!best || R.compareResults({ score: bd.total, reason: s.reason, invalids: s.invalids, elapsedMs: s.elapsedMs, sessionId: this.sessionId }, best) < 0) {
      p.bestScores[this.level.id] = { score: bd.total, reason: s.reason, invalids: s.invalids, elapsedMs: s.elapsedMs, sessionId: this.sessionId };
    }
    Progress.save();

    // Dailies are unranked: the score is kept with local (and cloud) progress.
    const submitHtml = s.mode === 'daily' ? '<p>Daily score saved to your progress.</p>' : '';

    const headline = won ? 'Nook cleared!' : (s.reason === 'time-up' ? 'Time ran out' : s.reason === 'move-limit' ? 'Out of taps' : 'Round over');
    const panel = UI.showOverlay(`
      <h2>${headline}</h2>
      <table class="hn-score-table" aria-label="Score breakdown">
        <tr><td>Objects found (${bd.found})</td><td>+${bd.items}</td></tr>
        <tr><td>Request strips cleared</td><td>+${bd.waves}</td></tr>
        <tr><td>Time bonus</td><td>+${bd.time}</td></tr>
        <tr><td>Wrong taps (${s.invalids})</td><td>−${bd.invalidPenalty}</td></tr>
        <tr><td>Hints used (${s.hintsUsed})</td><td>−${bd.hintCost}</td></tr>
        ${bd.undoCost ? `<tr><td>Undos</td><td>−${bd.undoCost}</td></tr>` : ''}
        <tr class="total"><td>Total</td><td>${bd.total}</td></tr>
      </table>
      <p class="rail-sub">Time ${UI.fmtTime(s.elapsedMs)} · seed <code>${s.seed.toString(36)}</code> · ${bd.remaining} left unfound</p>
      ${submitHtml}
      ${newAch.length ? `<p>Achievement unlocked: ${newAch.map((n) => `<span class="hn-badge unlocked">✓ ${UI.esc(n)}</span>`).join(' ')}</p>` : ''}
      <div class="hn-btn-row">
        <button class="hn-btn hn-btn-primary" data-act="retry">Retry</button>
        ${s.mode === 'journey' && won && this.level.index + 1 < C.JOURNEY_COUNT ? '<button class="hn-btn" data-act="next">Next stage</button>' : ''}
        ${s.mode === 'daily' ? '<button class="hn-btn" data-act="board">Leaderboard</button>' : ''}
        <button class="hn-btn" data-act="menu">Menu</button>
      </div>
    `, { label: 'Results' });
    if (newAch.length) Audio.play('achieve');
    UI.announce(headline + ' Total score ' + bd.total + '.', true);
    panel.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      Audio.play('click');
      const act = b.dataset.act;
      if (act === 'retry') this.prepare(this.level, s.mode);
      else if (act === 'next') this.prepare(C.journeyLevel(this.level.index + 1), 'journey');
      else if (act === 'board') this.showScores();
      else { this.toProgression(); }
    });
  },

  toProgression() {
    this.phase = 'progression';
    const p = Progress.doc;
    const nextUnlock = p.journeyUnlocked < C.JOURNEY_COUNT
      ? `Next journey stage: ${p.journeyUnlocked + 1}.`
      : 'Journey complete — mastery track finished!';
    const panel = UI.showOverlay(`
      <h2>Progress</h2>
      <p>${nextUnlock} Objects found all-time: <strong>${p.foundTotal}</strong>. Daily streak: <strong>${p.dailyStreak.count}</strong> day(s).</p>
      <div class="hn-btn-row">
        <button class="hn-btn hn-btn-primary" data-act="menu">Back to title</button>
      </div>
    `, { label: 'Progression' });
    panel.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-act="menu"]')) { Audio.play('click'); this.toTitle(); }
    });
  },

  // ---- score chase ---------------------------------------------------------------
  async showScores() {
    let rows = '';
    let note = '';
    let who = 'Level';
    if (Platform.hosted) {
      // Platform board is read-only (server-owned); nicknames via the profile route.
      let r = null;
      try { r = await Platform.leaderboard(50); } catch { r = { error: 'offline' }; }
      if (r && r.entries) {
        who = 'Player';
        rows = r.entries.map((e) => `<tr${e.you ? ' class="hn-you"' : ''}><td>${e.rank}</td><td>${UI.esc(e.name)}</td><td>${e.score}</td></tr>`).join('')
          || '<tr><td colspan="3">No entries yet.</td></tr>';
        note = 'Global board — read-only on the platform. Personal bests travel with your save.';
      }
    }
    if (!rows) {
      // No board available (offline, or the platform has no leaderboardId):
      // personal bests are kept locally and cloud-saved with progress.
      note = note || (Platform.hosted ? 'No platform leaderboard — showing personal bests (saved with your progress).' : 'Personal bests on this device.');
      rows = Object.entries(Progress.doc.bestScores).slice(0, 20)
        .map(([k, v]) => `<tr><td>—</td><td>${UI.esc(k)}</td><td>${v.score}</td></tr>`).join('')
        || '<tr><td colspan="3">No local scores yet.</td></tr>';
    }
    const panel = UI.showOverlay(`
      <h2>Score chase</h2>
      <p class="rail-sub">${note}</p>
      <table class="hn-board"><thead><tr><th>#</th><th>${who}</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="hn-btn-row"><button class="hn-btn" data-act="back">Back</button></div>
    `, { label: 'Leaderboard' });
    panel.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-act="back"]')) { Audio.play('click'); this.toTitle(); }
    });
  },

  // ---- tutorial ---------------------------------------------------------------------
  showTutorialPrompt() {
    const step = C.TUTORIAL_STEPS[this.tutorialStep];
    if (!step) return;
    UI.setStatus('Lesson ' + (this.tutorialStep + 1) + '/' + C.TUTORIAL_STEPS.length + ': ' + step.text);
    UI.announce('Lesson step ' + (this.tutorialStep + 1) + ': ' + step.text);
  },
  advanceTutorial(action) {
    if (this.state.mode !== 'learn') return;
    const steps = C.TUTORIAL_STEPS;
    const matches = (st, a) => (st.action === 'pan' && a === 'pan')
      || (st.action === 'find' && a === 'find')
      || (st.action === 'find-requested' && (a === 'find' || a === 'wrong'))
      || (st.action === 'wave' && (a === 'wave' || a === 'find'))
      || (st.action === 'hint' && a === 'hint');
    // satisfy the earliest pending step this action demonstrates (skip-ahead safe)
    let hit = -1;
    for (let i = this.tutorialStep; i < steps.length; i++) {
      if (matches(steps[i], action)) { hit = i; break; }
      if (i === this.tutorialStep) break; // never skip the very next step unless it matches
    }
    if (hit < 0) return;
    this.tutorialStep = hit + 1;
    Audio.play('focus');
    if (this.tutorialStep >= C.TUTORIAL_STEPS.length) {
      Progress.doc.tutorialDone = true;
      Progress.save();
      UI.setStatus('Lesson complete — finish the round!');
      UI.announce('Lesson complete. Finish clearing the room.');
    } else this.showTutorialPrompt();
  },

  // ---- pause / settings / help ------------------------------------------------------
  pause() {
    // Re-entry while already paused re-renders the pause menu; this is how
    // Settings/Help opened from the pause menu return to it via Done.
    if (this.phase !== 'active' && this.phase !== 'paused') return;
    this.phase = 'paused';
    Audio.play('pause');
    const panel = UI.showOverlay(`
      <h2>Paused</h2>
      <p class="rail-sub">The clock is stopped.</p>
      <div class="hn-menu">
        <button class="hn-btn hn-btn-primary" data-act="resume">Resume</button>
        <button class="hn-btn" data-act="settings">Settings</button>
        <button class="hn-btn" data-act="help">Help</button>
        <button class="hn-btn hn-btn-danger" data-act="leave">Leave round</button>
      </div>
    `, { label: 'Paused' });
    panel.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      Audio.play('click');
      const act = b.dataset.act;
      if (act === 'resume') { UI.closeOverlay(); this.phase = 'active'; }
      else if (act === 'settings') this.showSettings(true);
      else if (act === 'help') this.showHelp(true);
      else if (act === 'leave') { UI.closeOverlay(); this.toTitle(); }
    });
  },

  showSettings(inRound) {
    const s = Settings.data;
    const panel = UI.showOverlay(`
      <h2>Settings</h2>
      <h3>Audio</h3>
      <div class="hn-field"><label for="set-music">Music</label><input id="set-music" type="range" min="0" max="1" step="0.05" value="${s.music}"></div>
      <div class="hn-field"><label for="set-sfx">Effects</label><input id="set-sfx" type="range" min="0" max="1" step="0.05" value="${s.sfx}"></div>
      <div class="hn-field"><label for="set-amb">Ambience</label><input id="set-amb" type="range" min="0" max="1" step="0.05" value="${s.ambience}"></div>
      <section id="gfx-section" class="hn-gfx" aria-labelledby="gfx-heading">${this.gfxSectionHtml()}</section>
      <h3>Accessibility</h3>
      <div class="hn-field"><label for="set-rm">Reduced motion</label><input id="set-rm" type="checkbox" ${s.reducedMotion ? 'checked' : ''}></div>
      <div class="hn-field"><label for="set-hc">High contrast</label><input id="set-hc" type="checkbox" ${s.highContrast ? 'checked' : ''}></div>
      <div class="hn-field"><label for="set-lt">Larger text</label><input id="set-lt" type="checkbox" ${s.largeText ? 'checked' : ''}></div>
      <div class="hn-field"><label for="set-lh">Left-handed controls</label><input id="set-lh" type="checkbox" ${s.leftHanded ? 'checked' : ''}></div>
      <div class="hn-field"><label for="set-hap">Haptics</label><input id="set-hap" type="checkbox" ${s.haptics ? 'checked' : ''}></div>
      <div class="hn-btn-row"><button class="hn-btn hn-btn-primary" data-act="done">Done</button></div>
    `, { label: 'Settings' });
    const bind = (id, key, isCheck) => {
      panel.querySelector('#' + id).addEventListener(isCheck ? 'change' : 'input', (ev) => {
        Settings.set(key, isCheck ? ev.target.checked : Number(ev.target.value));
        if (key === 'reducedMotion') this.renderer.reduced = Settings.get('reducedMotion');
      });
    };
    bind('set-music', 'music'); bind('set-sfx', 'sfx'); bind('set-amb', 'ambience');
    this.bindGfxSection(panel);
    bind('set-rm', 'reducedMotion', true); bind('set-hc', 'highContrast', true);
    bind('set-lt', 'largeText', true); bind('set-lh', 'leftHanded', true);
    bind('set-hap', 'haptics', true);
    panel.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-act="done"]')) {
        Audio.play('click');
        if (inRound) this.pause(); // back to pause menu
        else if (this.phase === 'title') this.toTitle(); // back to the main menu, not an empty room
        else UI.closeOverlay();
      }
    });
  },

  // ---- Settings → Graphics (gfx.js model; strings from gfx-i18n.js) ---------------
  gfxSectionHtml() {
    const L = gfxStrings(navigator.languages || [navigator.language]);
    const saved = Settings.get('graphics') || {};
    const r = this.renderer;
    const g = resolve(saved, r.detected);
    const esc = UI.esc;
    const presetOpts = [['auto', L.auto.replace('{tier}', L[r.detected])]]
      .concat(PRESETS.map((p) => [p, L[p]]))
      .map(([v, label]) => `<option value="${v}" ${(saved.preset || 'auto') === v ? 'selected' : ''}>${esc(label)}</option>`).join('');
    const scale = Math.round(g.userScale * 100);
    const cats = Object.entries(CATEGORIES).map(([cat, tiers]) => {
      const cur = tiers.includes(saved[cat]) ? saved[cat] : 'preset';
      const opts = [['preset', L.fromPreset.replace('{tier}', L.tier[presetTier(g.preset, cat)])]]
        .concat(tiers.map((tv) => [tv, L.tier[tv]]))
        .map(([v, label]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${esc(label)}</option>`).join('');
      return `<div class="hn-field"><label for="set-gfx-${cat}">${esc(L.cat[cat])}</label><select id="set-gfx-${cat}" data-gfx-cat="${cat}">${opts}</select></div>`;
    }).join('');
    return `
      <h3 id="gfx-heading">${esc(L.graphics)}</h3>
      <div class="hn-field"><label for="set-quality">${esc(L.quality)}</label><select id="set-quality" data-gfx="preset">${presetOpts}</select></div>
      <div class="hn-field hn-field-range"><label for="set-gfx-scale">${esc(L.renderScale)}</label>
        <span class="hn-range-wrap"><input id="set-gfx-scale" data-gfx="render_scale" type="range" min="50" max="200" step="5" value="${scale}"><output id="set-gfx-scale-val" for="set-gfx-scale">${scale}%</output></span></div>
      ${cats}
      <div class="hn-field"><label for="set-gfx-adaptive">${esc(L.adaptive)}</label><input id="set-gfx-adaptive" data-gfx="adaptive" type="checkbox" ${g.adaptive ? 'checked' : ''}></div>
      <div class="hn-field"><label for="set-gfx-fps">${esc(L.showFps)}</label><input id="set-gfx-fps" data-gfx="show_fps" type="checkbox" ${g.showFps ? 'checked' : ''}></div>
      <p id="gfx-summary" class="hn-gfx-summary rail-sub" aria-live="off"></p>
      <p id="gfx-post-note" class="hn-gfx-note" hidden>${esc(L.postUnavailable)}</p>`;
  },

  bindGfxSection(panel) {
    const sec = panel.querySelector('#gfx-section');
    if (!sec) return;
    const L = gfxStrings(navigator.languages || [navigator.language]);
    const save = (next) => Settings.set('graphics', next);
    const refreshInfo = () => {
      const sum = document.getElementById('gfx-summary');
      if (!sum) { clearInterval(this._gfxTimer); this._gfxTimer = null; return; }
      const info = this.renderer.graphicsInfo(L.words);
      const text = `${info.gpu || L.unknownGpu} · ${info.summary}`;
      if (sum.textContent !== text) sum.textContent = text;
      document.getElementById('gfx-post-note').hidden = !info.postFailed;
    };
    sec.addEventListener('change', (ev) => {
      const el = ev.target;
      const saved = Object.assign({}, Settings.get('graphics') || {});
      if (el.id === 'set-quality') {
        // choosing a preset clears per-category overrides; re-render the "From preset" labels
        save(choosePreset(saved, el.value));
        sec.innerHTML = this.gfxSectionHtml();
        sec.querySelector('#set-quality').focus();
      } else if (el.dataset.gfxCat) {
        if (el.value === 'preset') delete saved[el.dataset.gfxCat];
        else saved[el.dataset.gfxCat] = el.value;
        save(saved);
      } else if (el.dataset.gfx === 'adaptive' || el.dataset.gfx === 'show_fps') {
        saved[el.dataset.gfx] = el.checked;
        save(saved);
      } else if (el.dataset.gfx === 'render_scale') {
        saved.render_scale = Number(el.value) / 100;
        save(saved);
      }
      refreshInfo();
    });
    sec.addEventListener('input', (ev) => {
      if (ev.target.id === 'set-gfx-scale') sec.querySelector('#set-gfx-scale-val').textContent = ev.target.value + '%';
    });
    clearInterval(this._gfxTimer);
    this._gfxTimer = setInterval(refreshInfo, 500);
    requestAnimationFrame(refreshInfo);
  },

  showHelp(inRound) {
    const panel = UI.showOverlay(`
      <h2>How to play</h2>
      <p>Inspect the miniature room. The <strong>request strip</strong> on the left names the objects to find. Select each one in the scene to mark it found; finishing the strip reveals the next set.</p>
      <h3>Controls</h3>
      <p>
        <span class="hn-badge">Drag / one finger</span> look around
        <span class="hn-badge">Wheel / pinch</span> zoom
        <span class="hn-badge">Tap / click</span> select an object<br>
        <span class="hn-badge">${UI.esc(keyNames('prev'))} · ${UI.esc(keyNames('next'))}</span> move between objects
        <span class="hn-badge">${UI.esc(keyNames('select'))}</span> select focused object
        <span class="hn-badge">${UI.esc(keyNames('hint'))}</span> hint <span class="hn-badge">${UI.esc(keyNames('undo'))}</span> undo (practice)
        <span class="hn-badge">${UI.esc(keyNames('resetView'))}</span> reset view <span class="hn-badge">${UI.esc(keyNames('pause'))}</span> pause<br>
        <span class="hn-badge">Gamepad</span> stick moves focus, A selects, B pauses, Y hints
      </p>
      <h3>Rules</h3>
      <p>Only objects named in the strip count. Wrong taps cost ${R.SCORE.INVALID_PENALTY} points; hints cost ${R.SCORE.HINT_COST}. Finishing quickly (under par ${this.level ? UI.fmtTime(this.level.parSeconds * 1000) : '—'}) adds a time bonus. Ties break on completion, then fewer wrong taps, then faster time.</p>
      <div class="hn-btn-row"><button class="hn-btn hn-btn-primary" data-act="done">Done</button></div>
    `, { label: 'Help' });
    panel.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-act="done"]')) {
        Audio.play('click');
        if (inRound) this.pause();
        else if (this.phase === 'title') this.toTitle();
        else UI.closeOverlay();
      }
    });
  },

  // ---- input bindings ------------------------------------------------------------
  bindHudButtons() {
    $('btn-pause').addEventListener('click', () => this.pause());
    $('tray-pause').addEventListener('click', () => this.pause());
    $('btn-hint').addEventListener('click', () => this.hint());
    $('tray-hint').addEventListener('click', () => this.hint());
    $('tray-undo').addEventListener('click', () => this.undo());
    $('btn-undo').addEventListener('click', () => this.undo());
    $('btn-cam').addEventListener('click', () => { this.renderer.resetCamera(); Audio.play('click'); });
    $('tray-cam').addEventListener('click', () => { this.renderer.resetCamera(); Audio.play('click'); });
    $('btn-settings').addEventListener('click', () => { Audio.ensure(); this.showSettings(false); });
    $('btn-help').addEventListener('click', () => { Audio.ensure(); this.showHelp(false); });
  },

  bindGlobalInput() {
    document.addEventListener('keydown', (ev) => {
      if (UI.overlayOpen()) {
        if (actionFor(ev.code) === 'pause' && this.phase === 'paused') { UI.closeOverlay(); this.phase = 'active'; }
        return;
      }
      if (this.phase !== 'active') return;
      const k = actionFor(ev.code);
      if (k === 'pause') { ev.preventDefault(); this.pause(); }
      else if (k === 'prev' || k === 'next') {
        ev.preventDefault();
        this.cycleFocus(k === 'prev' ? -1 : 1);
      } else if (k === 'select') {
        ev.preventDefault();
        if (this.renderer.focusIndex >= 0) this.handleTap(this.renderer.focusIndex);
      } else if (k === 'hint') this.hint();
      else if (k === 'undo') this.undo();
      else if (k === 'resetView') this.renderer.resetCamera();
    });

    // gamepad polling
    this._padPrev = {};
    this._padTimer = setInterval(() => this.pollGamepad(), 100);
  },

  cycleFocus(dir) {
    const legal = R.legalActions(this.state).filter((a) => a.type === 'find');
    if (!legal.length) return;
    const idxs = legal.map((a) => a.index);
    const cur = idxs.indexOf(this.renderer.focusIndex);
    const next = idxs[(cur + dir + idxs.length) % idxs.length];
    this.renderer.focusItem(next);
    Audio.play('focus');
    UI.announce('Focused: ' + this.state.items[next].name);
  },

  pollGamepad() {
    if (this.phase !== 'active' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const gp of pads) {
      if (!gp) continue;
      const pressed = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const once = (name, cond, fn) => {
        if (cond && !this._padPrev[name]) fn();
        this._padPrev[name] = cond;
      };
      once('a', pressed(0), () => { if (this.renderer.focusIndex >= 0) this.handleTap(this.renderer.focusIndex); });
      once('b', pressed(1), () => this.pause());
      once('y', pressed(3), () => this.hint());
      once('lb', pressed(4), () => this.cycleFocus(-1));
      once('rb', pressed(5), () => this.cycleFocus(1));
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.6) { if (!this._padPrev.stick) this.cycleFocus(ax > 0 ? 1 : -1); this._padPrev.stick = true; }
      else this._padPrev.stick = false;
      break;
    }
  },

  onVisibility() {
    if (document.hidden) Progress.flushCloud(); // best-effort cloud flush on hide
    if (document.hidden && this.phase === 'active') {
      // backgrounding pauses solo simulation
      this.pausedByBackground = true;
      this.pause();
      const pl = document.querySelector('.hn-overlay .hn-menu');
      if (pl && !pl.querySelector('.hn-auto-pause-note')) {
        const note = document.createElement('p');
        note.className = 'rail-sub hn-auto-pause-note';
        note.textContent = 'Paused automatically while the tab was hidden. The clock stopped — nothing happened while you were away.';
        pl.prepend(note);
      }
    }
  },

  // ---- main loop ---------------------------------------------------------------------
  frame(dt) {
    if (this.renderer._ctxLost) return;
    // fixed-step simulation clock: advance rules time in quantized 500ms ticks
    if (this.phase === 'active' && this.state && this.state.status === 'active') {
      this.tickAccum += dt * 1000;
      while (this.tickAccum >= 500) {
        this.tickAccum -= 500;
        const cmd = { type: 'tick', dtMs: 500 };
        cmd.id = this.sessionId + ':' + (++this.cmdSeq);
        const r = R.applyCommand(this.state, cmd);
        if (!r.error) {
          this.state = r.state;
          if (R.isTerminal(this.state)) { this.toResolving(); break; }
        }
      }
      this.refreshTimer();
      this.refreshScore();
    }
    this.renderer.stepCameraAnim(dt);
    this.renderer.update(dt);
  },
};

// achievement metadata (mirrors server set)
const ACTION_ACHIEVEMENTS = {
  'first-completion': { name: 'First Light', desc: 'Complete your first round.' },
  'mechanic-mastery': { name: 'Steady Eye', desc: 'Complete a round with zero invalid taps and no hints.' },
  'daily-streak-3': { name: 'Regular Visitor', desc: 'Finish the daily challenge three days in a row.' },
  'journey-20': { name: 'Deep Nook', desc: 'Clear journey stage 20.' },
  'collector-1000': { name: 'Nook Collector', desc: 'Find 1000 objects across all rounds.' },
};

// ---- bootstrap -------------------------------------------------------------------
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Game.boot());
} else {
  Game.boot();
}

export { Game, Settings, Progress, Platform, Audio };
