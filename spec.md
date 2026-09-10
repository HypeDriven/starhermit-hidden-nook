# Hidden Nook — Game Design Document

Running spec. Everything below describes what the shipped game does today, in present
tense. Deliberate design that the code does not yet do is collected in
[§17 Design intent not yet implemented](#17-design-intent-not-yet-implemented) and nowhere else.

---

## 1. Overview

**Pitch.** A lamplit miniature room, packed with tiny objects; a strip of names on the left;
find the *brass mug*, the *speckled acorn*, the *chipped thimble* — one wave at a time, before the
candle burns down.

| | |
|---|---|
| Genre | Observation / hidden-object puzzle, single player |
| Players | 1; asynchronous competition through the daily leaderboard |
| Session | 90 s (early journey stage) to ~4 min (late stage); a daily run is one round |
| Platforms | Desktop and mobile browsers, portrait and landscape; WebGL2 required |
| Rendering | Three.js (`vendor/three.module.js`, r-series ES module) drawing a fully procedural scene — no meshes, textures or sprites are loaded for gameplay geometry; every object is built at runtime from primitives in `NookRenderer.buildItemMesh` |
| Persistence | `localStorage` (checksummed), plus optional cloud save through the game's own `server.js` |
| Build id | `BUILD = '1.0.0'` in `game.js`; content schema `CONTENT_VERSION = 2`; rules schema `SCHEMA_VERSION = 2` |

### File map

| Path | Responsibility |
|---|---|
| `index.html` | Static shell: topbar, left rail (requests + progress), canvas holder, right rail (score + actions + object list), bottom tray, two ARIA live regions. Loads `rules.js` and `content.js` as classic scripts, then `game.js` as a module. |
| `style.css` | All presentation: token palette, three responsive layouts, high-contrast / large-text / reduced-motion variants, safe-area insets. |
| `rules.js` | Pure deterministic rules engine (UMD → `window.HNRules` / `require`). Owns every state transition. |
| `content.js` | Versioned content (UMD → `window.HNContent`): object vocabulary, themes, anchors, procedural level generation, tutorial script, offline validators. |
| `game.js` | Client: `Platform`, `Settings`, `Progress`, `Audio`, `NookRenderer`, `UI`, `Game` state machine. |
| `server.js` | Static file server plus the game's REST surface (time, daily, submit, leaderboard, save, achievements, telemetry). |
| `test.js` | `npm test` — 30 checks: rules legality, scoring, replay determinism, fuzz, content validation, migration, golden hashes, server API. |
| `tests/e2e.mjs` | `npm run test:e2e` — Playwright playthrough of the real UI at desktop and mobile viewports. |
| `sfx/` | 16 Opus one-shots, `manifest.txt` (canonical), `manifest.json` (generator input), `manifest.md` (generated table). |
| `assets/` | `keyart-nook.webp` (title backdrop), `wall-paper.webp` (room wall tile). |
| `data/store.json` | Server-side durable store: daily boards, saves, achievements. Never served. |
| `coverart.png`, `icon.png`, `favicon.svg` | Platform art. |
| `starhermit.txt` | Platform manifest: name, launch, owner, server, version, contentVersion, cover. |

---

## 2. Vision and design pillars

**1. The room is the puzzle, not the interface.**
Difficulty comes from *visual density and camera occlusion* — a thimble behind a crate, a coin
lost in the rug — never from obscured rules or hidden state. This rules in crowded shelves,
overlapping silhouettes, and objects that only become visible after you orbit. It rules out
timed puzzles you cannot see, randomised object positions mid-round, and anything that would
make an object unreachable from some camera angle: the right rail lists **every** object as a
button, so any target is always selectable without moving the camera at all.

**2. Name it, then see it.**
The request strip names objects in plain adjective+noun English ("crimson teapot"), backed by a
colour swatch and the shape word. The player's work is the perceptual leap from a word to a
silhouette. This rules in an original 20-kind × 20-adjective vocabulary with guaranteed-unique
names per level; it rules out icon-only requests, silhouette-matching, and any request the
screen-reader path cannot state as a sentence.

**3. A cost for guessing, never a wall.**
Tapping a wrong object costs 25 points and is announced; it never ends the round, never hides
the object, never locks input. Hints cost 50 points and are always available while any wave
target remains. This rules out lives, fail-on-mistake, and ad-gated hints; it rules in a scoring
model where a careless clear still beats a quit.

**4. Deterministic to the last point.**
Every level is a pure function of `(index, seed)`; every score is reproducible by replaying the
command log. The seed is printed on the setup screen and typeable in Practice. This rules in
replay-validated daily leaderboards and golden-hash tests; it rules out unseeded shuffles,
wall-clock-derived randomness during a round, and any client-side score the server takes on trust.

**5. Cozy, not frantic.**
Warm amber key light, dust motes, a candle flame, a swinging pendulum. Timers exist only from
journey stage 11 onward and in Challenge. This rules in an unhurried default and a hard 30-second
warning cue rather than an escalating heartbeat; it rules out jump scares, screen shake and
red-flash failure states.

---

## 3. Player experience

**Target player.** Someone who likes looking carefully — an I-Spy or seek-and-find reader — plus
the score chaser who returns for the daily and wants the same board everyone else got.

**First 60 seconds.** A fresh player's Play button reads *"Play (starts with a quick lesson)"* and
goes straight to Learn mode (`Game.startLearn`), never to a mode menu. Learn runs a real, scored
round of journey stage 0 with undo enabled, and teaches one rule at a time through the status
line (`C.TUTORIAL_STEPS`, advanced by `Game.advanceTutorial`):

| # | Prompt | Satisfied by |
|---|---|---|
| 1 | Drag to look around the room. Find the glowing marker. | Any camera motion — including a keyboard focus move, so keyboard-only players are never stuck here |
| 2 | Tap the object named in the request strip. | Any `found` event |
| 3 | Only requested objects count. Tapping others costs points. | A `found` **or** an `invalid` event (learning by success or by mistake) |
| 4 | Finish the strip to reveal the next set. | A `wave-clear`, or another find |
| 5 | Stuck? Use a hint — it costs points but marks a target. | A `hint` |

Steps are matched in order and never skipped ahead more than the earliest pending step the action
demonstrates. Completing them sets `tutorialDone`; the player then finishes the round normally and
the title screen switches to a plain **Play** plus a **Replay lesson** entry.

**Session shape.** Title → mode → a one-screen rules card that states object count, decoy count,
timer, tap limit, undo, hint cost, ranked-or-not, and the seed → 3-2-1-Go → the round → a
line-by-line score breakdown → progression. Retry and Next stage are one click from results.

**The emotional beat.** The half-second between *"…where is the copper spool"* and the ring
snapping on under it. Everything else — the lift-and-slow-rotate of a found object, the wave
arpeggio, the green ring — exists to punctuate that beat and then get out of the way.

---

## 4. Core loop and rules contract

The rules engine (`rules.js`) is pure, has no DOM or Three.js dependency, and is the same module
the server uses to validate submissions. No other module mutates session state.

### Entities

A **level** (from `content.js`) is `{ id, contentVersion, index, seed, items[], waves[][],
parSeconds, timeLimitSeconds|null, moveLimit|null, allowUndo, allowHints, theme, tutorial,
difficulty }`.

An **item** is `{ id, name, kind, color, requested, pos[3], rotY, scale, bobPhase }`. `kind` is one
of 20 procedural shapes (mug, key, book, candle, spool, acorn, bottle, clock, teapot, shell, bell,
thimble, feather, coin, button, pencil, lantern, pinecone, jar, ribbon); `name` is
`adjective + ' ' + label` drawn from 20 adjectives, de-duplicated within the level.

A **session** (`R.createSession`) carries `items[{found,hinted}]`, `waves`, `wave`, `score`,
`invalids`, `hintsUsed`, `undoCount`, `elapsedMs`, `status`, `reason`, the applied-command `log`,
and an undo `history` of snapshots.

### Legal actions — `R.legalActions(state)`

`find(index)` for every not-yet-found item (the descriptor carries `requested`, so hints and the
tutorial ask the same API play uses); `hint` while hints are enabled and the wave is non-empty;
`undo` while undo is enabled and history is non-empty; `tick(dtMs)`. `R.explainIllegal` returns the
machine reason for anything else (`already-found`, `no-such-object`, `hints-disabled`,
`nothing-to-hint`, `undo-disabled`, `nothing-to-undo`, `round-over`, `bad-dt`,
`malformed-command`, `unknown-command`), which `Game.explainError` maps to a spoken sentence.

### Resolution order — `R.applyCommand(state, cmd)`

1. Malformed command → error, state unchanged.
2. **Idempotency**: a `cmd.id` already in the log returns the *same object* with a `duplicate`
   event and no error. Command ids are `sessionId + ':' + seq`.
3. Legality check; on failure the state object is returned unchanged with an error string.
4. Clone, `tick += 1`, then apply:
   - **tick** — `dtMs` quantised to the nearest 100 ms and clamped to 60 000, added to `elapsedMs`;
     crossing `timeLimitMs` terminates with reason `time-up`.
   - **find** — push an undo snapshot when undo is allowed. If the index is in the current wave
     set: mark found, `+100`, emit `found`. If that empties the wave, either advance the wave and
     add `+150`, or (last wave) add `+150`, add the time bonus, and terminate with reason
     `all-found`. If the index is *not* in the wave set: `invalids += 1`, `−25` (floored at 0),
     emit `invalid`. Then, if a move limit exists and finds ≥ limit while requested items remain,
     terminate with reason `move-limit`.
   - **hint** — mark the *lowest* index in the current wave set as hinted (deterministic, never
     random), `hintsUsed += 1`, `−50`.
   - **undo** — pop the snapshot, restore it while preserving `history`, `log` and the incremented
     tick, `−10`, set `undoUsed`.
5. Append the command to `log` and return `{ state, events, error }`.

### Scoring — `R.SCORE` and `R.scoreBreakdown`

```
items        = foundCount * 100
waves        = wave * 150  + (reason === 'all-found' ? 150 : 0)
timeBonus    = round(600 * (1 - min(1, max(0, elapsedMs - parMs) / parMs)))   // only on all-found
penalties    = invalids * 25 + hintsUsed * 50 + undoCount * 10
total        = max(0, items + waves + timeBonus - penalties)
```

**Worked example** — journey stage 1 (6 requested items, 2 decoys, 3 waves of 2, par 90 s).
A player finds all 6, taps one decoy, spends one hint, and finishes in 108 s:
`items = 600`; waves = 2 completed advances (`300`) + 150 for the final clear = `450`;
time bonus = `600 * (1 − 18/90) = 480`; penalties = `25 + 50 = 75`.
**Total = 600 + 450 + 480 − 75 = 1455.**

### Terminal states and tie-breaks

`status` is `active` or `complete`; `reason` is `all-found`, `time-up` or `move-limit`. Only
`all-found` earns a time bonus, unlocks the next journey stage, or counts toward the daily streak.
`R.compareResults` orders results by, in this order: completion (`all-found` first), higher score,
fewer invalids, lower elapsed ms, then lexical session id — total and stable.

### RNG, seeding and replay

`mulberry32` streams and an FNV-1a `hashString` are the only randomness. Level generation draws
from `mulberry32(seed ^ index*0x9e3779b9)` with a second decorative stream for bob phases, so the
scene's cosmetic motion never touches the gameplay stream. `R.serializeState` produces a canonical
JSON projection with no volatile fields; `R.hashState` hashes it. `R.makeReplayEnvelope` packages
`{schema, build, contentVersion, levelId, seed, mode, commands, terminalHash, result}`;
`R.verifyReplay` re-runs the log against a fresh session and rejects on `hash-mismatch`. `test.js`
pins a golden hash for an easy session so a rules change cannot silently pass.

### Undo and hints

Undo exists only where `level.allowUndo` — journey stages 1–10, all Practice, and Learn. It is a
full snapshot restore, so it also reverses invalid-tap penalties and wave advances. Hints are
always on (`allowHints: true` for every generated level) and always mark the lowest-index pending
target, which makes a hinted round replay identically.

---

## 5. Modes and progression

| Mode | Content | Timer | Taps | Undo | Ranked | Notes |
|---|---|---|---|---|---|---|
| **Learn** | `C.tutorialLevel()` — stage 0 at seed `0x70f7` | none | — | yes | no | Five scripted lessons over a real round. Auto-entered on first Play. |
| **Journey** | 40 stages, `C.journeyLevel(i)`, seed `0x5eed000 + i*7919` | from stage 11 | from stage 21 | stages 1–10 | no (local bests) | Stage grid; stage *n* unlocks after clearing *n−1*. |
| **Daily** | `C.dailyLevel(day)` — seed `hash('hidden-nook-daily:' + YYYY-MM-DD)`, stage index and theme also derived from the day | per stage tier | per tier | no | **yes** | One shared level worldwide per UTC day; replay-validated submission. |
| **Practice** | `C.practiceLevel(diff, seed)` at stage index 2 / 12 / 27 | tier default | tier default | always | no | Seed field is editable and inspectable. |
| **Challenge** | Speed (stage 12, 90 s), Economy (stage 20, 14 taps), Crowded (stage 30, heavy decoys) | per kind | per kind | no | no | Random seed per attempt. |

### Difficulty curve — `C.tierFor(index)`

| Stages | Requested | Decoys | Wave | Par | Time limit | Tap limit |
|---|---|---|---|---|---|---|
| 1–5 | 6 | 2 | 2 | 90 s | — | — |
| 6–10 | 8 | 4 | 3 | 120 s | — | — |
| 11–15 | 10 | 6 | 3 | 150 s | 300 s | — |
| 16–20 | 10 | 8 | 4 | 150 s | 240 s | — |
| 21–25 | 12 | 8 | 4 | 180 s | 240 s | 24 |
| 26–30 | 12 | 10 | 4 | 180 s | 210 s | 22 |
| 31–35 | 14 | 12 | 5 | 210 s | 200 s | 22 |
| 36–40 | 16 | 14 | 5 | 240 s | 180 s | 20 |

One pressure is introduced per band: object count, then decoy density, then the clock, then wave
width, then the tap budget — and undo is withdrawn after stage 10, which is the real difficulty
cliff.

### Unlocks and achievements — `ACTION_ACHIEVEMENTS`

`first-completion` "First Light", `mechanic-mastery` "Steady Eye" (clear with zero invalid taps and
zero hints), `daily-streak-3` "Regular Visitor", `journey-20` "Deep Nook", `collector-1000`
"Nook Collector" (1000 objects found lifetime). Unlocks are idempotent locally and, when hosted,
POSTed to the server, which keeps its own copy of the same set. Badges are listed on the title
screen, greyed until earned.

---

## 6. Controls and interaction

| Input | Desktop | Mobile |
|---|---|---|
| Look around | Drag with the mouse (yaw ±1.1 rad, pitch 0.25–1.25 rad) | One-finger drag |
| Zoom | Wheel (×1.1 / ×0.9 per notch, distance clamped 7–24) | Two-finger pinch |
| Select an object | Click it, or click its row in the right-rail list | Tap it, or tap its row |
| Move focus | `←` `→` `↑` `↓` cycle the not-yet-found items and ease the camera onto each | — (the rail list is the touch equivalent) |
| Confirm focus | `Enter` / `Space` | — |
| Hint | `H`, `#btn-hint`, or `#tray-hint` | Bottom tray **Hint** |
| Undo | `U` or `#btn-undo` (hidden when the mode forbids undo) | Right-rail **Undo** |
| Reset view | `R`, `#btn-cam`, `#tray-cam` | Bottom tray **Reset view** |
| Pause | `Esc`, `#btn-pause`, `#tray-pause` | Bottom tray **Pause** |
| Gamepad | Left stick / LB / RB cycle focus, A selects, B pauses, Y hints (polled at 10 Hz) | — |

**Tap versus drag.** A pointer gesture counts as a tap only if it moved under 8 px and lasted under
400 ms. A second finger sets `moved`, so lifting after a pinch never selects an object by accident.
Tapping empty space is a deliberate no-op: no penalty, no sound, no announcement.

**Input locking.** Keyboard shortcuts are ignored whenever an overlay is open (only `Esc` to leave
the pause menu passes through) and whenever `phase !== 'active'`. `dispatch` refuses commands
outside `active`/`resolving`. There is no lockout during resolution: `toResolving` immediately
settles every found object into its exact deterministic end pose and then shows results after
600 ms (100 ms with reduced motion).

**Feedback for every input.** A find → ring turns green, object lifts 0.35 and slow-rotates, chime,
30 ms haptic pulse, polite live-region announcement, score and progress bar update. An invalid tap →
buzz, `[40,40,40]` haptic pattern, **assertive** announcement naming the penalty. A hint → shimmer,
pulsing amber ring, announcement naming the object. A focus move → focus blip and the name spoken.

---

## 7. Screens and UI flow

```
boot → title ─┬→ mode-select ─┬→ (journey grid | practice setup | challenge setup)
              │               └→ preparing → countdown → active ⇄ paused
              ├→ daily ────────────────────────→ preparing → …
              └→ scores (leaderboard)                          ↓
                                                    resolving → results ─┬→ preparing (retry / next)
                                                                         ├→ scores
                                                                         └→ progression → title
```

Every non-play screen is one modal `.hn-overlay` inside `#overlay-root`, with
`role="dialog" aria-modal="true"`, a Tab focus trap, first-element autofocus, and focus restored to
the previously focused element on close. The pause menu is re-entrant: Settings and Help opened from
it return to it when Done is pressed, rather than dumping the player into the round.

**Desktop (≥1024 px).** Three columns: 240 px request rail | flexible canvas | 240 px score rail;
topbar above, bottom tray hidden.

**Mobile portrait (≤700 px).** Single column: topbar, request strip becomes a horizontal scrolling
row above the canvas, canvas takes the remaining height, bottom tray of three 44 px targets pinned
above `env(safe-area-inset-bottom)`. The right rail's score value moves into the topbar area and the
scene-object list is reachable by scrolling.

**Mobile landscape (≤500 px tall).** Rails compress; the bottom tray stays, the topbar shrinks so
the canvas keeps the majority of the viewport.

**Must never be cut off:** the request strip's current wave, the timer when a round is timed, the
score value, and every overlay's primary button. Overlays are capped at `max-height: 92%` with
internal scrolling, and the journey grid at `max-height: 46vh`, so a 40-stage list never pushes the
Back button off-screen. All four `env(safe-area-inset-*)` values are applied on the shell.

---

## 8. Art direction

**Interface palette** (`style.css` `:root`): background `#0f1420`, panel `#1a2333`, raised panel
`#222e44`, hairline `#2c3a4f`, accent amber `#ffb84d`, success `#7dd87d`, error `#e26a6a`, text
`#f5f7fa`, dimmed text `#c3ccd8`. High contrast swaps to pure `#000000` / `#ffffff` with a `#ffd400`
accent and a `#888888` hairline.

**Scene themes** (`C.THEMES`, one per journey stage cycling through five):

| Theme | Wall | Floor | Key light | Fill | Ambient | Fog |
|---|---|---|---|---|---|---|
| Dawn | `#3a3348` | `#4a3f35` | `#ffd9a0` | `#8a7ba8` | 0.55 | `#241f30` |
| Day | `#6d7f8e` | `#7a6748` | `#fff3d6` | `#aec6d8` | 0.80 | `#3a4550` |
| Dusk | `#4a3040` | `#54382a` | `#ff9a5c` | `#6a4a72` | 0.50 | `#2a1a26` |
| Night | `#1c2438` | `#2c241c` | `#9fb8ff` | `#33406a` | 0.35 | `#10141f` |
| Autumn | `#5a4130` | `#4c3a24` | `#ffc46b` | `#8a5a3a` | 0.60 | `#2e2118` |

Object colours come from 20 named adjectives (`C.ADJ_COLORS`), e.g. brass `#b08d57`,
crimson `#b22234`, teal `#2a8a8a`, indigo `#3f4a8c` — the same hex is used for the mesh material and
for the swatch on the request chip, so the word, the swatch and the object always agree.

**Shape language.** Everything in the room is built from boxes, cylinders, cones, spheres, torus and
ring primitives at miniature scale (0.8–1.3× per item). Rounded, chunky, hand-made — no sharp
photoreal detail, so a 60-px object on a phone still reads as "teapot".

**Lighting.** One dominant warm directional key at `(6, 9, 7)` with a 1024² PCF shadow map, a
hemisphere fill tinted by the theme, and an interior point lamp at `(0, 5.2, 1.5)` so even the Night
theme keeps the shelves legible. ACES filmic tone mapping at exposure 1.35, sRGB output, and a fog
band from 22 to 46 units that lets the room's edges fall into the case.

**Typography.** System UI stack (`system-ui, -apple-system, "Segoe UI", Roboto`), 16 px base scaled
by `--hn-font-scale` (1.2 under Larger text). Numeric HUD values use tabular figures.

**The hero.** The canvas. Rails are flat, low-chroma and un-animated; nothing in the UI glows except
the amber accent, so the only bright warm things on screen are the lamp, the candle and the
selection rings.

**Motion principles.** Cosmetic motion is exponential smoothing toward a target, never a scripted
keyframe: found objects lift with `lerp(dt*8)`, rings fade with `lerp(dt*10)`, unfound objects bob
±0.02 on a per-item phase, the candle flame flickers on two detuned sines, the pendulum swings at
2.2 rad/s, and dust motes drift on a sine field. **Reduced motion** (`Settings.reducedMotion`, also
auto-detected from `prefers-reduced-motion` on a first visit) removes the flame, pendulum, dust,
bob, and found-object rotation, snaps the lift and the camera ease to their end state in one frame,
and shortens the countdown to a single "Go" and the results delay to 100 ms. Gameplay legibility is
identical with all of it off.

**Visual assets the design calls for.** Two, both shipped: a title-screen key art render of the
diorama, and a subtle wallpaper tile for the room's two walls. Gameplay objects stay procedural on
purpose — a fixed sprite set would cap the vocabulary at whatever was drawn.

---

## 9. Audio direction

**Mix philosophy.** The room is quiet. Nothing loops loudly, nothing ducks, nothing sidechains. The
find chime is the loudest thing the player hears and it is short.

**Buses** (`Audio.buses`, all straight to destination): `music` at `setting × 0.5`, `sfx` at
`setting × 1.0`, `ambience` at `setting × 0.25`. Defaults 0.6 / 0.8 / 0.5. The context is created
lazily on the first pointer-down or menu interaction, so no autoplay warning is ever emitted.

**Ambience.** A two-second seeded white-noise buffer (`mulberry32(0xa1b1)`) looped through a 320 Hz
lowpass — a room tone, not a music bed. It is identical every session by construction.

**Music.** There is no score. The win and lose stings are the only music-bus material, plus the
achievement triad.

**Clips and fallbacks.** `Audio.loadSamples` fetches `sfx/manifest.json` after the audio unlock,
groups clip names by event id, and decodes each one. `Audio.play(event, variantSeed)` prefers a
decoded clip — choosing among that event's clips from a `mulberry32(variantSeed)` draw, so find #4
in a replayed session picks the same variant — and falls back to the oscillator voice for that event
while clips are still loading or if any fetch failed. The game is therefore fully audible with the
`sfx/` folder entirely absent.

### SFX event table

This table is the source for `sfx/manifest.txt`.

| Event id | File(s) | Description | Usage context |
|---|---|---|---|
| `click` | `ui-click.opus`, `ui-click-soft.opus` | Short dry wooden button tap / muted plastic key press | Every overlay and HUD button press; two variants so menu runs don't machine-gun |
| `focus` | `ui-focus.opus`, `ui-focus-alt.opus` | Tiny sine blip / breathy tick with a felt thud | Keyboard or gamepad focus moves between objects; each tutorial step advance |
| `found` | `object-found.opus`, `object-found-chime.opus` | Two-note brass bell ding / warm glockenspiel chime | A requested object is found — the core reward beat |
| `invalid` | `wrong-pick.opus` | Low dull buzz, muted descending thud on wood | Tapping a real but unrequested object (−25); also any rejected command |
| `wave` | `wave-clear.opus` | Rising three-note harp arpeggio with a sparkling finish | The request strip empties and the next wave appears |
| `win` | `round-win.opus` | Warm four-note marimba fanfare with a shimmering tail | Results after `all-found`; music bus |
| `lose` | `round-lose.opus` | Soft descending three-note felt-piano phrase | Results after `time-up` or `move-limit`; music bus |
| `hint` | `hint-reveal.opus` | Airy shimmer, glockenspiel glissando like dust sparkling | A hint is spent (−50); the target starts pulsing |
| `undo` | `undo-step.opus` | Reversed paper-slide swoosh, a page flipping backward | Undo in Practice / Learn |
| `pause` | `pause-tock.opus` | Soft muted kalimba pluck | Pause menu opens, including the automatic background pause |
| `countdown` | `countdown-tick.opus` | Hollow wooden metronome tick, dry, close-mic | Each 3-2-1-Go step of the pre-round countdown |
| `timer-low` | `timer-warning.opus` | Soft urgent double tick on a muted woodblock | Once per timed round, when the clock first drops under 30 s |
| `achieve` | `achievement-unlock.opus` | Rising three-note celeste triad with a golden tail | An achievement is granted on the results screen; music bus |

All clips are 48 kHz mono Opus, 96 kbps VBR, loudness-normalised to −20 LUFS with a −2 dBTP ceiling,
generated with MOSS-SoundEffect v2.0 at 100 inference steps.

---

## 10. Localization

**Ships today:** `en-US` only. Every visible string is an English literal inside `game.js`,
`content.js` (object labels, adjectives, tutorial prompts) and `index.html`; `<html lang="en">` is
fixed. The nine required locales — en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT —
are **not** implemented; see §17. What the design commits to when they land:

- Strings live in `data/i18n/<locale>.json`, one flat key space, loaded by `server.js` as static
  data and fetched once at boot with `en-US` as the always-bundled fallback.
- Language is chosen by, in order: an explicit Settings picker persisted in `hn-settings-v1`; the
  StarHermit launch profile locale; `navigator.languages`; then `en-US`. Region variants fall back
  to their base language before falling back to English.
- Object names are the hard part and are composed, not concatenated: the vocabulary ships as
  `{ adjective, noun }` keys plus a per-locale pattern (`"{adj} {noun}"` for English,
  `"{noun} {adj}"` with gender agreement for the Romance locales), so "crimson teapot" localises
  correctly rather than word-by-word.
- Layout allowance: rails and chips are sized for +40% string growth (German), the request strip
  wraps rather than truncates, and no string is baked into an image — `coverart.png` is the sole
  exception and is platform art, not in-game text.

---

## 11. Accessibility

- **Keyboard-only path is complete.** Arrows cycle focus through every unfound object (the same
  `legalActions` list the rules expose), Enter/Space selects, H/U/R/Esc cover hint, undo, reset view
  and pause; every overlay traps Tab and autofocuses its first control. A player can finish a whole
  round without touching the canvas — the e2e test proves this by falling back to keyboard selection
  whenever a canvas tap misses.
- **Screen readers.** Two live regions: polite (`#live-region`) for finds, hints, wave clears, focus
  moves and lesson steps; assertive (`#live-assertive`) for invalid taps, illegal-command reasons
  and the final result. The right rail is a real `<ul>` of `<button>`s naming every object and its
  found state — a complete non-visual representation of the board. The canvas holder is
  `role="application"` with an instructional `aria-label`.
- **Contrast.** Body text `#f5f7fa` on `#0f1420` is ~16:1; dimmed text `#c3ccd8` on `#1a2333` is
  ~10:1; the amber accent on panel is ~7:1. High contrast mode raises everything to black/white with
  `#ffd400`.
- **Reduced motion** as described in §8, auto-detected on first run.
- **Larger text** scales the whole interface by 1.2 via one custom property; no layout is pinned in
  px that cannot grow.
- **Never colour-alone.** A found object is green *and* lifted *and* rotating *and* tagged "found"
  in the rail *and* announced. The request chip carries the shape word next to the colour swatch.
- **Target sizes.** All buttons have `min-height: 44px`; the bottom tray on mobile is three
  full-width targets above the safe-area inset.
- **Haptics** (mobile) can be turned off; **telemetry** is opt-in and off by default.

---

## 12. StarHermit integration

`starhermit.txt` declares `name`, `launch=index.html`, `owner`, `server=server.js`, `version`,
`contentVersion=2` and `cover=coverart.png`, per https://wiki.starhermit.com/ conventions.

**Used.**

| Feature | How |
|---|---|
| Identity | A `launch_token` / `token` query parameter is read once at boot, kept in memory only (never persisted) and sent as `X-Launch-Token`. Without one the client mints a local `hn-guest-id` and sends `X-Guest-Id`. |
| Server script | `server.js` is the declared authoritative script and serves both the static bundle and `/api/v1/*`. |
| Time sync | `GET /api/v1/time` at boot; the round-trip midpoint sets `Platform.timeOffsetMs` so the daily rollover and streak logic use platform time, not the device clock. |
| Daily content | `GET /api/v1/daily` returns the authoritative day and an `excluded` flag; a defective day is played unranked instead of being hidden. |
| Leaderboards | `POST /api/v1/daily/submit` with the full replay envelope; the server re-runs the command log through the same `rules.js` and rejects `hash-mismatch` or implausible scores. `GET /api/v1/leaderboard?scope=global&day=` renders the Score chase screen; offline it falls back to local bests. |
| Achievements | `POST /api/v1/achievements` mirrors each local unlock; the server keeps an idempotent set. |
| Cloud save | `PUT /api/v1/save` with a SHA-256 checksum over the document; on a non-descendant conflict the server returns `kept`, both snapshots survive, and the status line says which one won. `GET /api/v1/save` loads it back. |
| Telemetry | `navigator.sendBeacon('/api/v1/telemetry')` for `round-start`, `round-end`, `round-quit`, `tutorial-step` and `settings-change` — only when hosted **and** consented. |

**Deliberately not used.** Presence, real-time sessions, matchmaking, parties, chat, friends graphs
and in-app purchase. Hidden Nook is solo; its only social surface is the asynchronous daily board.
Every network call degrades to a local behaviour, so the game is fully playable from `file://` or
offline — `Platform.hosted` gates all of it.

---

## 13. Technical architecture

**Layering.** `rules.js` (pure, no globals) ← `content.js` (pure, depends only on rules) ←
`game.js` (all I/O). `server.js` requires the same `rules.js` and `content.js`, which is what makes
server-side replay validation exact rather than approximate.

**Simulation clock.** The render loop is `requestAnimationFrame` with `dt` clamped to 100 ms; the
rules clock advances in fixed 500 ms `tick` commands drained from an accumulator, and every tick is
a logged command. Frame rate therefore cannot change the score. Backgrounding the tab pauses the
round and posts a note in the pause overlay explaining that nothing happened while away.

**Determinism and replay.** Command ids, the canonical serialization, the terminal hash and
`verifyReplay` are described in §4. Cosmetic state (bob phases, dust positions, camera easing) is
drawn from a separate stream and is never serialized.

**Persistence.** `hn-settings-v1` (settings) and `hn-progress-v2` (progress, FNV-checksummed;
a v1 document is migrated, a corrupt one is discarded for a fresh doc rather than crashing). Rules
state has its own `R.migrateState` for v1 → v2. All writes are try/caught for quota-full private
modes.

**Rendering budget.** Quality tiers pick DPR, shadows, particle count and antialias:
high `dpr 2.0 / 800 motes`, medium `1.5 / 300`, low `1.0 / 100 / no shadows`. `auto` chooses medium
when the viewport is under 800 px wide or `hardwareConcurrency ≤ 4`. Target: 60 fps desktop, 30 fps
mobile, ≤ 40 pickable meshes in the worst level (16 requested + 14 decoys), one draw call per
primitive with no post-processing. Materials and geometries are tracked in a `disposables` list and
released on every scene load; the renderer survives `webglcontextlost` by pausing the frame body
until restore.

**Picking.** A single raycast against `pickables` only — decorative meshes, particles and rings are
never registered, so a dust mote can never eat a tap. Already-found objects are skipped, so a stray
tap on a cleared item falls through to whatever is behind it.

**Server.** Node core modules only. `data/store.json` is the durable store; rate limiting is per
identity; request bodies are size-limited; `data/`, `tests/`, `tools/`, `node_modules/` and any
dotfile path are refused by the static handler.

**How the e2e test drives the real UI.** `tests/e2e.mjs` launches system Chrome through
`playwright-core` with SwiftShader, boots `server.js` on an ephemeral port, and clicks the actual
DOM: the title's Practice button, the difficulty `<select>`, the seed `<input>` (fixed to 424242),
Begin, Escape to pause, the Settings quality select, the hint and reset-view buttons. To find an
object it projects the item's world position through the live camera and issues a real
`page.mouse.click` on the canvas; if the ray misses it falls back to arrow-key focus plus Enter —
both are player-reachable paths. It asserts no page errors at all, runs the whole script twice
(1280×800 and a 390×844 touch profile) and screenshots every step.

---

## 14. Testing and acceptance criteria

**`npm test` (`test.js`, 30 checks)** verifies: initial session validity; requested vs unrequested
find outcomes; every illegal-command reason string; idempotent duplicate command ids; wave
advancement and terminal reasons; time-up and move-limit termination; hint determinism; undo
restoring the exact prior snapshot; the score breakdown arithmetic; tie ordering; identical state
hashes across a seed sweep of replays; envelope verification plus rejection of a tampered envelope;
a fuzz pass of malformed commands with no throws, hangs or NaN; `validateLevel` over all 40 journey
levels and the daily; daily seed stability per day and variation across days; level-generation
determinism; v1 → v2 migration; a pinned golden hash for an easy session; and a server API smoke
pass (static serving, time, daily, validated submit, rejection of an impossible score, leaderboard,
cloud-save round-trip, achievement idempotency, submission guards).

**`npm run test:e2e` (`tests/e2e.mjs`)** drives the real UI as described in §13 and fails on any
console/page error at either viewport.

**QA bar as checkable statements** (per `agents/qa.md`):

1. A first-time player is taught before being scored — Play routes to Learn until `tutorialDone`.
2. Every implemented feature is reachable by mouse, by touch, and by keyboard alone.
3. Zero console errors or warnings during a full playthrough at both viewports (asserted).
4. No text or control is clipped at 1280×800, 390×844 portrait, or a 844×390 landscape; overlays
   scroll internally rather than overflowing.
5. Nothing critical sits under browser chrome or a display cutout — safe-area insets are applied on
   all four edges.
6. The game is playable with WebGL absent (a plain-language message, settings and progress intact),
   with `sfx/` absent (synth fallbacks), with `assets/` absent (flat walls, plain title panel), and
   with the server absent (offline mode, local bests).

---

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/keyart-nook.webp` | Title-screen backdrop behind the menu panel (1280×720, 47 KB) | FLUX.2 klein, seed 71104, 30 steps | generated this pass, wired via `.hn-overlay-keyart` |
| `assets/wall-paper.webp` | Tiling wallpaper on the room's back and left walls (512×512, 16 KB, repeat 4×2, tinted by the theme wall colour) | FLUX.2 klein, seed 71105, 30 steps | generated this pass, wired in `NookRenderer.applyWallpaper` |
| `coverart.png` | Platform cover (1200×675) — the diorama render with the title set in DejaVu Serif | FLUX.2 klein seed 71104 + ffmpeg text pass | regenerated this pass (replaced a generic placeholder that read "COZY STRATEGY") |
| `icon.png`, `favicon.svg` | Platform icon and tab icon | authored | shipped |
| `sfx/ui-click.opus`, `ui-click-soft.opus` | `click` | MOSS-SFX v2.0 | shipped |
| `sfx/ui-focus.opus` | `focus` | MOSS-SFX v2.0 | shipped |
| `sfx/ui-focus-alt.opus` | `focus` variant | MOSS-SFX v2.0 | generated this pass |
| `sfx/object-found.opus`, `object-found-chime.opus` | `found` | MOSS-SFX v2.0 | shipped |
| `sfx/wrong-pick.opus` | `invalid` | MOSS-SFX v2.0 | shipped |
| `sfx/wave-clear.opus` | `wave` | MOSS-SFX v2.0 | shipped |
| `sfx/round-win.opus`, `round-lose.opus` | `win` / `lose` | MOSS-SFX v2.0 | shipped |
| `sfx/hint-reveal.opus` | `hint` | MOSS-SFX v2.0 | shipped |
| `sfx/undo-step.opus` | `undo` | MOSS-SFX v2.0 | shipped |
| `sfx/pause-tock.opus` | `pause` | MOSS-SFX v2.0 | shipped |
| `sfx/countdown-tick.opus` | `countdown` | MOSS-SFX v2.0 | generated this pass, wired in `Game.countdown` |
| `sfx/timer-warning.opus` | `timer-low` | MOSS-SFX v2.0 | generated this pass, wired in `Game.refreshTimer` |
| `sfx/achievement-unlock.opus` | `achieve` | MOSS-SFX v2.0 | generated this pass, wired in `Game.toResults` |
| `vendor/three.module.js`, `three.core.js` | Renderer | three.js (MIT) | shipped |
| — | 3D models | — | not called for: gameplay geometry is procedural by design (§8), so a baked hero prop would only duplicate one of 20 kinds |
| — | Character animation | — | not called for: no humanoid appears in the game |

---

## 16. Known limitations

- **English only.** See §10 and §17; the nine-locale requirement is unmet.
- **Non-requested decoys are pickable and penalised, but decoys never become requested.** A level's
  requested set is fixed at generation, so a player who memorises a daily's decoys has a small edge
  on a retry. Only the first daily submission is ranked, which limits the exposure.
- **The hint is always the lowest pending index.** It is deterministic (required for replay), but a
  player who spams hints gets the wave's targets in a predictable order rather than the "hardest to
  see" one.
- **Undo does not restore the camera.** The rules snapshot is exact; the view stays where it was.
- **Anchor collisions.** Placement anchors are shuffled and jittered ±0.25, so at 30 objects two
  items can visually overlap on a shelf. They remain separately pickable (the raycast returns the
  nearest unfound item), but one can be hidden behind the other until the camera moves.
- **The wallpaper tile shows a soft seam** at the wall corner where the back and left walls meet,
  because both use the same 4×2 repeat over different world extents.
- **No music.** Only stings and room tone; the `music` bus and its volume slider control very
  little.
- **Gamepad support is unbindable** and polls at a fixed 10 Hz.
- **The daily leaderboard shows truncated guest ids** (`guest-` plus six characters) rather than
  platform display names.

---

## 17. Design intent not yet implemented

1. **Localization into the nine required locales.** The loading, selection and composed-name design
   in §10 is decided but no locale files or lookup layer exist; every string is currently an English
   literal in `game.js` / `content.js`.
2. **A settings language picker**, which §10 assumes as the first source of the locale choice.
3. **Platform display names on the leaderboard** — the submission already carries the identity
   header, but the client sends and the board renders a truncated guest id.
4. **Anchor de-collision at generation time** (a minimum separation pass in `C.generateLevel`), which
   would remove the overlap noted in §16.
