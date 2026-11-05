// Sound, as the browser build's Audio: the authored one-shots
// (sfx/<name>.opus, grouped by logical event in sfx/manifest.json; an event
// with two clips picks one from a mulberry32(variantSeed) draw, so find #4
// of a replayed round picks the same variant) and the quiet room tone (a
// two-second seeded white-noise buffer, mulberry32(0xa1b1), looped through a
// 320 Hz lowpass).
//
// The browser build's three buses become the runtime's (Options › Audio owns
// the volumes, the mute and the voice limit): music (the win / lose / achievement
// stings) → "music", effects and the room tone → "effects", the menu tap →
// "interface"; the old default bus levels (music 0.6 × 0.5, effects 0.8,
// ambience 0.5 × 0.25) are folded into each sound's gain. The room tone is
// rendered once into a clip (createClip), its loop ends cross-faded. The
// oscillator voices the browser build played while a clip was still loading
// are not ported (the engine's web runtime drops clip loads while a
// synthesis graph runs): until its clip is in, an event is silent. Every clip
// loads at once in onStart; the room tone still waits for the mixer to run
// (in a browser, after the first press).
import { files } from "starhermit:engine";
import { context, createClip, loadClip, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";
import { Rules as R } from "./classic.ts";

const GAIN = { music: 0.6 * 0.5, effects: 0.8, ambience: 0.5 * 0.25 };
const MUSIC = new Set(["win", "lose", "achieve"]);

const eventFiles = new Map<string, string[]>();
const clips = new Map<string, AudioClip>();
/** Reads the manifest and loads every clip at once (onStart); an event whose clip is still loading is silent. */
export function loadSfx(): void {
  try {
    const list = files.readJson("sfx/manifest.json") as unknown as { name?: string; event?: string }[];
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || typeof e.name !== "string" || typeof e.event !== "string") continue;
      const l = eventFiles.get(e.event) ?? [];
      l.push(e.name);
      eventFiles.set(e.event, l);
    }
  } catch (e) { console.warn(`sfx manifest: ${String(e)}`); }
  for (const name of new Set([...eventFiles.values()].flat())) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`));
  }
}

/** Plays a logical event's clip (a seeded choice among its variants); silent while it loads. */
export function play(event: string, variantSeed = 1): void {
  const names = eventFiles.get(event);
  if (!names) return;
  const rng = R.mulberry32((variantSeed || 1) >>> 0);
  rng(); // the browser build drew its pitch variant first
  const ready = names.filter((n) => clips.has(n));
  if (!ready.length) return;
  const name = ready[Math.floor(rng() * ready.length)]!;
  const bus: Bus = event === "click" ? "interface" : MUSIC.has(event) ? "music" : "effects";
  try { playClip(clips.get(name)!, { bus, gain: MUSIC.has(event) ? GAIN.music : GAIN.effects }); }
  catch { /* the mixer is full this frame: skip it */ }
}

// -- the room tone --------------------------------------------------------------------------
const RATE = 22050;
/** Two seconds of seeded white noise (±0.5) through a 320 Hz lowpass, its loop ends cross-faded. */
function roomToneClip(): AudioClip {
  const n = 2 * RATE, fade = Math.round(0.25 * RATE);
  const raw = new Float32Array(n + fade);
  const rng = R.mulberry32(0xa1b1);
  for (let i = 0; i < raw.length; i++) raw[i] = (rng() * 2 - 1) * 0.5;
  // RBJ biquad lowpass at 320 Hz, Q 1 (the browser build's BiquadFilter default)
  const w0 = (2 * Math.PI * 320) / RATE, alpha = Math.sin(w0) / 2, c = Math.cos(w0), a0 = 1 + alpha;
  const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = b0, a1 = (-2 * c) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < raw.length; i++) {
    const x0 = raw[i]!;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    raw[i] = y0;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = raw[i]!;
    if (i < fade) { const k = i / fade; v = v * k + raw[n + i]! * (1 - k); }
    out[i] = Math.max(-1, Math.min(1, v));
  }
  return createClip([out], RATE);
}
let tone: AudioClip | null = null;
let toneSound: Sound | null = null;

/** Each frame: once the mixer runs, the room tone (rendered on a frame of its own) and its loop. */
export function update(): void {
  if (context.state !== "running") return;
  if (!tone) { try { tone = roomToneClip(); } catch (e) { console.warn(`audio: ${String(e)}`); } return; }
  if (!toneSound) {
    try { toneSound = playClip(tone, { bus: "effects", gain: 0.0001, loop: true }); toneSound.fade(GAIN.ambience, 1.5); }
    catch { toneSound = null; }
  }
}
