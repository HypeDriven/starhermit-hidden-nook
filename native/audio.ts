// Sound, as the browser build's Audio: the authored one-shots
// (sfx/<name>.opus, grouped by logical event in sfx/manifest.json; an event
// with two clips picks one from a mulberry32(variantSeed) draw, so find #4
// of a replayed round picks the same variant) and the quiet room tone (a
// two-second seeded white-noise loop through a 320 Hz lowpass).
//
// The browser build's three buses become the runtime's (Options › Audio owns
// the volumes, the mute and the voice limit): music (the win / lose / achievement
// stings) → "music", effects and the room tone → "effects", the menu tap →
// "interface"; the old default bus levels (music 0.6 × 0.5, effects 0.8,
// ambience 0.5 × 0.25) are folded into each sound's gain. The room tone is
// rendered once offline (OfflineAudioContext) into a seamless loop. The
// oscillator voices the browser build played while a clip was still loading
// are not ported: until its clip is in, an event is silent. Every clip loads
// and the room tone renders at once in onStart; the room tone starts when
// the mixer runs (in a browser, after the first press).
import { files } from "starhermit:engine";
import { context, createClip, loadClip, OfflineAudioContext, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";
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
  renderRoomTone().then((c) => { tone = c; }, (e: unknown) => console.warn(`audio: ${String(e)}`));
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
/** Two seconds of seeded white noise (±0.5) through a 320 Hz lowpass (Q 1, 0 dB in the engine's units); filtered periodic noise is periodic once settled, so no crossfade. */
async function renderRoomTone(): Promise<AudioClip> {
  const n = 2 * RATE, settle = Math.round(0.25 * RATE);
  const off = new OfflineAudioContext(1, settle + n, RATE);
  const noise = off.createNoise({ seed: 0xa1b1, seconds: 2 });
  const lp = off.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 320;
  lp.Q.value = 0;
  const g = off.createGain();
  g.gain.value = 0.5;
  noise.connect(lp).connect(g).connect(off.destination);
  noise.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
}
let tone: AudioClip | null = null;
let toneSound: Sound | null = null;

/** Each frame: the room tone's loop starts once it is rendered and the mixer runs. */
export function update(): void {
  if (context.state !== "running" || !tone || toneSound) return;
  try { toneSound = playClip(tone, { bus: "effects", gain: 0.0001, loop: true }); toneSound.fade(GAIN.ambience, 1.5); }
  catch { toneSound = null; }
}
