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
| Players | 1; asynchronous competition through the StarHermit high-score board |
| Session | 90 s (early journey stage) to ~4 min (late stage); a daily run is one round |
| Platforms | A StarHermit engine script game (engine 1.18.0, host API 1.20): natively in the StarHermit client and in desktop and mobile browsers through the engine's web runtime, portrait and landscape |
| Rendering | `starhermit:scene` (three.js-like) drawing a fully procedural scene — no meshes are loaded for gameplay geometry; every object is built at runtime from primitives in `render.ts` `buildItemMesh` |
| Persistence | The game's save (`starhermit:storage` `saves`): the checksummed progress document on the device and, signed in, in the player's cloud slot |
| Build id | `version=1.0.0` in `starhermit.txt`; content schema `CONTENT_VERSION = 2`; rules schema `SCHEMA_VERSION = 2` |

### File map

| Path | Responsibility |
|---|---|
| `starhermit.txt` | Manifest: name, owner, `server=score-script.js`, version, cover, `launch=index.html`, `engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.18.0`, `engine.minor=19`, capabilities (platform, storage, clipboard), the `control.*` keys and `engine.gamepad.*` buttons. |
| `index.html`, `starhermit-files.json` | The engine's web loader and file index, written by `npm run package` (`starhermit package --web .`); never edited by hand. |
| `native/main.ts` | Entry module: the state machine, command dispatch and events, the lesson, focus cycling, pointer / keyboard / gamepad input, progression and achievements, the fixed-step rules clock. |
| `native/screens.ts` | Every screen, rail, tray, dialog and the toast in `starhermit:ui`; picks the layout from the window's logical size. |
| `native/render.ts` | The room in `starhermit:scene`: room, decoration, items, selection rings, motes, camera rig, picking, the post effects per look. |
| `native/quality.ts` | The old graphics presets and budgets keyed by the runtime's quality tier and level. |
| `native/audio.ts` | Clips by event (seeded variant choice) and the rendered room tone on the runtime's buses. |
| `native/platform.ts` | Save, foreign-save migration, conflict merge, the haptics setting and legacy settings, player, invite, the high-score board and score posting. |
| `native/i18n.ts`, `native/classic.ts`, `native/style.ts` | Locale from the runtime's interface language; loading `js/*.js` as classic scripts with their types; theme and registered styles. |
| `js/rules.js` | Pure deterministic rules engine (UMD: `HNRules` global / `require`). Owns every state transition. |
| `js/content.js` | Versioned content (UMD: `HNContent`): object vocabulary, themes, anchors, procedural levels, the lesson script, validators. |
| `js/progress.js` | The progress document (UMD: `HNProgress`): fresh, checksum, sanitize, the browser build's save, the two-device merge. |
| `js/strings.js`, `js/i18n.js`, `js/platform-strings.js` | Translation tables and object vocabulary (`HN_STRINGS`, `HN_NAMES`), the lookup runtime (`HNI18N`: `T`, `objectName`, `kindName`, `setLocale`), and the account lines in nine locales. |
| `assets/ui-style.json` | The UI styles, converted from `tools/ui-style.css` by `npm run css` (`starhermit css`). |
| `score-script.js` | StarHermit platform script (`server=`): range-checks a finished round's total and posts it to the `high-score` board. |
| `server.js` | Local dev server (static files plus a legacy REST surface used by `test.js`); not part of the package. |
| `test.js`, `tests/` | Rules / content / server checks; progress and localization unit tests; `tests/native.mjs` and `tests/native/*.play` (§14). |
| `tools/` | `package-web.mjs`, `css.mjs`, `gen-plays.mjs` (play scripts from the rules), `browser-play.mjs` (Chrome check). |
| `sfx/`, `assets/` | 16 Opus one-shots with their manifest; the title key art and the wallpaper tile. |
| `cover.jpg`, `coverart.png`, `icon.png` | Platform art. |

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
goes straight to Learn mode (`main.ts` `startLearn`), never to a mode menu. Learn runs a real, scored
round of journey stage 0 with undo enabled, and teaches one rule at a time through the status
line (`C.TUTORIAL_STEPS`, advanced by `main.ts` `advanceTutorial`):

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

The rules engine (`js/rules.js`) is pure, has no UI or rendering dependency, and is the same module
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
`malformed-command`, `unknown-command`), which `main.ts` `explainError` maps to a spoken sentence.

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
"Nook Collector" (1000 objects found lifetime). Unlocks are idempotent and kept in the progress document (cloud-saved with it). Badges are listed on the title
screen, greyed until earned.

---

## 6. Controls and interaction

| Input | Desktop | Mobile |
|---|---|---|
| Look around | Drag with the mouse on the room (yaw ±0.75 rad, pitch 0.25–1.0 rad) | One-finger drag |
| Zoom | Wheel over the room (×1.1 / ×0.9 per notch, distance clamped 7–24) | Two-finger pinch |
| Select an object | Click it, or click its row in the scene-object list | Tap it, or tap its row (list opens from **▸ Scene objects**) |
| Move focus | `prev` / `next` (default ← ↑ / → ↓) cycle the not-yet-found items and ease the camera onto each | — |
| Confirm focus | `select` (Enter / Space) | — |
| Hint / Undo / Reset view / Pause | `hint` H, `undo` U, `reset_view` R, `pause` Escape; the rail's buttons | The tray's Hint / Undo / Reset view / Pause |
| Gamepad | Left stick, D-pad or the shoulders cycle focus, South (A) selects, East (B) or Start pauses, North (Y) hints, West (X) undoes, the right stick press resets the view | — |

The actions are declared in `starhermit.txt` and rebound in the runtime's Options (Settings →
**Change keys and buttons** opens it); Help lists the effective keys (`bindingLabel`). The old
`resetView` action is `reset_view` now (action names are lowercase), so an old custom binding of it
is not carried over. F1 belongs to the runtime (its Options).

**Tap versus drag.** A gesture on the room counts as a tap only if it moved under 8 logical px and
lasted under 400 ms. A second finger makes it a pinch, so lifting after a pinch never selects. A
press is decided after the frame's UI is built: one on a rail, the top bar or a dialog never reaches
the room. Tapping empty space is a no-op.

**Input locking.** Round actions are ignored while any dialog is open and outside the active round;
during the countdown the room can already be looked around. When no widget is focused, the arrows
are the game's focus cycling (UI focus is cleared); a focused rail button takes Enter itself.

**Feedback for every input.** A find → ring turns green, the object lifts 0.35 and slow-rotates,
chime, a 30 ms vibration (Haptics), a polite announcement, score and progress update. A wrong tap →
buzz, a 120 ms vibration, an assertive announcement naming the penalty. A hint → shimmer, pulsing
amber ring, the chip outlined, an announcement naming the object. A focus move → blip, amber ring,
the row outlined in the list and the name announced.

---

## 7. Screens and UI flow

```
title ─┬→ Play (lesson on a fresh save) ──────────────→ rules card → 3-2-1-Go → round ⇄ pause
       ├→ modes ─┬→ journey grid | practice | challenge ─↗                 ↓
       ├→ daily ──────────────────────────────────────↗          resolving → results ─┬→ rules card (retry / next stage)
       ├→ score chase                                                                  ├→ score chase (daily)
       └→ help | settings                                                              └→ progress → title
```

The shell is always drawn: the top bar (title, status line, the cloud-save line when signed in, the
round timer when timed, Pause during a round, Help, Settings), the left rail (Requests: chips with
the colour swatch, name, shape tag and ✓ when found; the wave line; "n / m found" and the progress
bar), the room, and the right rail (score, Hint / Undo / Reset view during a round, the
scene-object list of every object with its found state — the complete non-visual board). Every
other screen is a modal dialog over it (`ui.dialog`: focus trapped, first button focused, opened at
its top, scrolling inside when taller than the window with its action buttons pinned below).
Settings and Help open over the screen they came from and return to it (the pause menu, the title);
opened from the top bar during a round they pause it first. Because the title menu is modal, it
offers Help and Settings itself as well.

**Desktop (≥ 1024 px wide, or a landscape window over 500 px tall).** Three columns: request rail
(20 %, ≥ 180 px) | the room | score rail; the top bar above.

**Compact (< 1024 px wide and taller than ¾ of its width).** The room above, the two rails below it
(each at most 30 % of the height, scrolling inside).

**Phone portrait (≤ 700 px wide).** The room, the Requests rail (≤ 30 %), one row with the score and
the **▸ Scene objects** toggle (the list opens inside the rail, ≤ 40 %), then the tray of four 48 px
buttons (Hint, Undo, Reset view, Pause). The status line is clamped to two lines.

**Short landscape (≤ 500 px tall).** A left column (24 %, 190–300 px) with the Requests rail, the
score with the object toggle, and the tray (Hint / Undo / Reset view, wrapping); the room fills the
rest. Pause stays in the top bar.

The runtime's interface size and text size scale everything; the layout is computed in logical
pixels from the window less its safe area. Nothing critical is cut off: the current wave, the timer,
the score and every dialog's buttons.

---

## 8. Art direction

**Interface palette** (`tools/ui-style.css` `:root`): background `#0f1420`, panel `#1a2333`, raised panel
`#222e44`, hairline `#2c3a4f`, accent amber `#ffb84d`, success `#7dd87d`, error `#e26a6a`, text
`#f5f7fa`, dimmed text `#c3ccd8`. The runtime's high contrast forces the UI's colours.

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

**Lighting.** One dominant warm directional key at `(6, 9, 7)` aimed at `(0, 1.5, -0.5)`, whose
PCF shadow box is fitted to the room's bounds in light space (1024²/2048²/4096² by setting), a
hemisphere fill tinted by the theme, and an interior point lamp at `(0, 5.2, 1.5)` so even the Night
theme keeps the shelves legible. ACES filmic tone mapping at exposure 1.35, sRGB output, and a fog
band from 22 to 46 units that lets the room's edges fall into the case.

**Graphics.** The runtime's Options choose the graphics level (Auto by the device, or one of ten
levels); the game maps the level's quality tier (`frame().quality`) onto the browser build's four
presets (`native/quality.ts`) and its level index scales the dust motes within the tier (up to 4×).
On top of the base scene, per preset: image-based lighting from a `RoomEnvironment` PMREM as
`scene.environment` (intensity 0.45; the hemisphere fill drops to 70 %); clear-coat
`MeshPhysicalMaterial` (High/Ultra) on glazed kinds (mug, teapot, bottle, shell, button, jar, book),
metal kinds, the clock and the lacquered table; procedural canvas textures (`starhermit:canvas`) —
wood grain with knots on the floor (with plank seams), shelves, table and crates, and a woven ring
pattern on the rug; wall trim, a framed landscape print, a glowing window, a clock face with hour
ticks and (High/Ultra) a candle glow light that flickers with the flame. All decoration is
wall-mounted, never pickable and never occludes a find. Dust motes are soft additive points. The
post effects are the renderer's: ambient occlusion (`renderer.ao`, GTAO), bloom above HDR 2.2 (flames,
the lantern, the window, hot glints), the colour grade (gentle S-curve, +10 % saturation, warm
highlights / cool shadows, soft vignette) and FXAA / SMAA / MSAA.

| Preset (tier) | Shadows | AO | Bloom | Grade | AA | Reflections | Motes | Detail |
|---|---|---|---|---|---|---|---|---|
| Low | off | off | off | off | MSAA | off | ≤ 100 | plain |
| Balanced | 1024 | off | on | on | FXAA | on | 350+ | detailed |
| High | 2048 | on | on | on | SMAA | on | 700+ | detailed |
| Ultra | 4096 | high | on | on | MSAA | on | 1000+ | detailed |

Budgets: Lambert materials on Low, Standard on Balanced, Standard + clear-coat Physical on High/Ultra;
wood/rug textures 64² / 128² / 256² / 512²; round-geometry segments ×0.5 / ×0.75 / ×1 / ×1.5; bloom and
AO at half resolution below Ultra. The runtime holds shadow-map size and MSAA samples to the level and
owns render scale, the pixel-ratio cap, adaptive resolution, the frame-rate limit and the frame-rate
readout. A level change applies at once (the room is rebuilt keeping found/hinted objects and the
camera when the budget changes). The old per-category overrides are not offered.

**Typography.** System UI stack (`system-ui, -apple-system, "Segoe UI", Roboto`), 16 px base scaled
by `--hn-font-scale` (1.2 under Larger text). Numeric HUD values use tabular figures.

**The hero.** The canvas. Rails are flat, low-chroma and un-animated; nothing in the UI glows except
the amber accent, so the only bright warm things on screen are the lamp, the candle, the window
and the selection rings.

**Motion principles.** Cosmetic motion is exponential smoothing toward a target, never a scripted
keyframe: found objects lift with `lerp(dt*8)`, rings fade with `lerp(dt*10)`, unfound objects bob
±0.02 on a per-item phase, the candle flame flickers on two detuned sines, the pendulum swings at
2.2 rad/s, dust motes drift on a sine field, and (at Room detail "detailed") the candle's glow light flickers
with it. **Reduced motion** (the runtime's Options) removes the flame, pendulum, dust,
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

**Buses.** The runtime's: the win / lose / achievement stings on `music` (gain 0.3), every other
cue and the room tone on `effects` (0.8; the room tone 0.125), the menu tap on `interface` — the old
default bus levels folded into each sound's gain. Volumes, mute and the voice limit are the
runtime's Options. In browsers sound starts after the first press.

**Ambience.** A two-second seeded white-noise buffer (`mulberry32(0xa1b1)`) through a 320 Hz lowpass,
rendered once into a clip with cross-faded loop ends — a room tone, identical every session.

**Music.** There is no score. The win and lose stings and the achievement triad are the music bus.

**Clips.** `audio.ts` reads `sfx/manifest.json`, groups clip names by event and loads the clips one at
a time once the mixer runs (the lesson's first sounds first). `play(event, variantSeed)` chooses among
an event's clips from a `mulberry32(variantSeed)` draw, so find #4 of a replayed session picks the
same variant. The oscillator voices the browser build played while clips loaded are not ported
(a live synthesis graph disturbs the web runtime's clip loading): a cue is silent until its clip is in.

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

Nine locales ship: **en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT**. Every visible
string — the top bar and rails, the dialogs (title, modes, journey, practice, challenge, round
setup, countdown, pause, settings, help, results, progress, score chase), the status line,
announcements and errors, achievements, lesson prompts and theme names — is an English key in
`js/strings.js` with es-419, de-DE, fr-FR, pt-BR and it-IT translations; en-GB, es-ES and fr-CA carry
only their differences. The account lines (`js/platform-strings.js`) have their own nine-locale
table and follow the same language.

- **Object names are composed, not concatenated.** The rules keep the English "<adjective> <noun>"
  name (it is part of replays and validation); `strings.js` (`HN_NAMES`) holds each language's
  vocabulary — 20 nouns with grammatical gender, 20 adjectives with their gendered forms — and the
  word order: noun-first with agreement for Spanish, French, Portuguese and Italian ("taza de latón",
  "bougie cramoisie"), a strong-declined adjective first for German ("messingfarbener Becher",
  "hölzernes Buch"). Every one of the 400 combinations is distinct in every locale (unit-tested).
  The request chips, object list, objective line and announcements show the localized name; the
  shape tag shows the localized noun.
- **Language:** the runtime's Options › Language (the player's choice, else the account's preferred
  language, else the device's), mapped to the nearest shipped locale (`es-MX → es-419`,
  `pt-PT → pt-BR`, `en-AU → en-GB`). Every string is looked up each frame, so a change shows at once;
  the round and its clock are untouched. "Hidden Nook" and "StarHermit" are not translated.
- **Layout:** chips wrap (a chip too wide for its rail stacks the shape tag under the name), long
  labels wrap at words; German, French and Italian fit at 390 px wide.

---

## 11. Accessibility

- **Keyboard-only and gamepad-only paths are complete.** The arrows (or stick / D-pad / shoulders)
  cycle focus through every unfound object, Enter / South selects, and every dialog is navigable by
  Tab, arrows, Enter and Escape (or the D-pad, South and East). The play scripts finish whole rounds
  by keys alone.
- **Screen readers.** The runtime's accessibility tree: every widget is named; finds, hints, wave
  clears, focus moves and lesson steps are polite announcements; wrong taps, illegal-command reasons
  and the final result are assertive. The scene-object list names every object and its found state.
- **Reduced motion, high contrast, text and interface size** are the runtime's Options. Reduced
  motion removes the flame, pendulum, dust, bob and found-object rotation, snaps the lift and the
  camera ease, shortens the countdown to a single "Go" and the results delay to 100 ms.
- **Never colour-alone.** A found object is green *and* lifted *and* rotating *and* tagged "found" in
  the list *and* ✓ on its chip *and* announced. Each chip carries the shape word next to its swatch.
- **Target sizes.** Buttons are at least 44 px; the phone tray's are 48 px.
- **Haptics** (vibration on finds and wrong taps) can be turned off in Settings. There is no telemetry.

---

## 12. StarHermit integration

The game is a StarHermit engine script game (`starhermit.txt`: `engine.api=1`,
`engine.entry=native/main.ts`, `engine.version=1.18.0`, `engine.minor=19`,
`engine.capabilities=platform,storage,clipboard`), keeping `name`, `description`, `owner`,
`server=score-script.js`, `version`, `contentVersion=2` and `cover=cover.jpg`.

| Feature | How |
|---|---|
| Identity | The runtime signs the player in (natively from the client; in browsers from the platform's launch); the game reads `player()`. A guest sees **Sign in with StarHermit** on the title (`requestSignIn`). When the session ends a toast says progress keeps saving on the device. |
| Status line | "Signed in as <display name>" or "Offline mode — progress is stored locally"; lesson prompts and the daily note replace it during play. Signed in, a line under it shows Saving… / Cloud synced / Offline — local only from the save's state. |
| Cloud save | The progress document is the game's save (`saves`), on the device and in the account's slot, uploads debounced by the runtime. A conflict with another device merges: furthest journey stage, better best per level (`R.compareResults`), union of achievements (earliest unlock), larger all-time found count, the newer daily streak, lesson done if done anywhere. The browser build's cloud save (the JS SDK's zipped `save.json` in `game:<slug>`) shows as foreign: it is read when its checksum is intact, merged with the device's progress and saved over it once with `replaceForeign`. Guests' old browser `localStorage` progress cannot migrate. |
| Settings | Haptics is the game's own setting (`settings`, synced with the account). The browser build's per-player settings keys (volumes, accessibility, graphics, camera, language, sound options) are read once — haptics carries over — and removed; the runtime's Options own the rest. The dead "Left-handed controls" toggle (it changed nothing) is gone. |
| Invite | **Invite a friend** on the title (signed in) copies the platform's invite link (`clipboard`) and confirms with a toast. |
| Leaderboards | Signed in, every finished Journey or Daily round posts its total through `score-script.js` (a practice session's socket carries `{ type: 'result', scores: { 'high-score': total } }`; the script range-checks it, 0–100,000, and writes the board); the results show "Posting score to the leaderboard…", then "Leaderboard rank: #N" (or posted / not posted). Results come only from the server script. The Score chase shows the board's top 50 (names from profiles, the player's own row highlighted; the board id is kept on the device so guests can read it), else personal bests saved with progress. |
| Time | The daily's UTC day comes from the platform's clock (`serverNow()`) once it answered, else the device's. |
| Achievements | Local: unlock times inside the progress document, travelling with the cloud save. |

**Not used.** Rooms, matchmaking, chat, voice and platform achievements — a solo game. There is no
own-server traffic: `server.js` is a local development server only.

---

## 13. Technical architecture

**Layering.** `js/rules.js` (pure) ← `js/content.js` (pure, depends only on rules) ← `js/progress.js`;
the engine client loads them as classic scripts (`loadClassic`) and is all the I/O. `server.js` and the
Node tests `require` the same files.

**Simulation clock.** The runtime's fixed steps (60 a second): every 30 steps of an active round
apply a logged `tick` of 500 ms, the countdown counts 42 steps a number (18 for the reduced-motion
"Go") and the results come 36 steps (6) after the round ends. Pauses, dialogs, a hidden window and slow
frames never change a round, and play scripts replay exactly. Hiding the window pauses the round with
a note that the clock stopped.

**Rendering.** The scene fills the window; the camera's view offset (`setViewOffset`) puts the room's
picture in the playfield rectangle the UI leaves, so the camera's projection and picking match what
the player sees; the UI paints the backdrop around it. Points (dust motes) are sized for the
playfield's height. A quality change rebuilds the room only when its assets change.

**Picking.** A raycast from the pointer through the camera against the item meshes only — decoration,
motes and rings are never registered; found objects are skipped so a tap falls through to what is
behind.

**Persistence.** The engine save (schema 2) holds the progress document; settings are the game's
`settings`; the leaderboard id is a device `storage` key.

**Server.** `score-script.js` is the platform script. `server.js` (Node core only) serves the folder and
a legacy REST surface the tests exercise.

---

## 14. Testing and acceptance criteria

**`npm test`** runs:

- **`test.js`** (30 checks): initial session validity; requested vs unrequested finds; every
  illegal-command reason; idempotent duplicate ids; wave advancement and terminal reasons; time-up
  and move-limit; hint determinism; undo; score arithmetic; tie ordering; replay hashes across a seed
  sweep; envelope verification and tamper rejection; a fuzz pass; `validateLevel` over all levels;
  daily seed stability; generation determinism; v1 → v2 state migration; a pinned golden hash; and a
  `server.js` API smoke pass.
- **`tests/progress.test.mjs`**: the browser build's cloud save read when intact and refused when
  tampered or malformed, engine saves round-tripping, and the two-device merge rules (the signed-in
  paths cannot run here, so their logic is covered by these).
- **`tests/i18n.test.mjs`**: every key the client and content show is translated in every locale
  with placeholders intact and no unused rows; all 400 object names localized and unique per locale;
  locale switching; the account lines.
- **`tests/native.mjs`**: the web index matches the files, `tsc` (strict, the engine's `.d.ts`),
  `starhermit check .` with no warnings, and every `tests/native/*.play` as a signed-out render check
  driving the real UI: `lesson.play` (the whole lesson from a fresh save to results, progress and the
  title), `journey.play` (stage 1 from the grid to results and Next stage), `practice.play` (seed typed
  into the field, a wrong tap and its undo, a hint, results with the exact total, Retry) and
  `screens.play` (Settings, Help, Score chase, Challenge, the Daily round, pause menu with Help and
  Settings, Leave round). `tools/gen-plays.mjs` writes the round scripts from the rules.

**Browser check** (`npm run test:browser`, `tools/browser-play.mjs`): serves the packaged folder on
loopback and plays it in Chrome on the GPU at a desktop viewport (mouse), a phone (390×844 at DPR 3,
touch) and a phone held sideways (844×390 at DPR 3): opens the lesson by keys, looks around by
dragging (and the wheel), focuses and selects by keys, hints, pauses and resumes, failing on console
errors or warnings or the runtime's error screen.

**QA bar:** a first-time player is taught before being scored (Play routes to the lesson until it is
done); every feature is reachable by mouse, touch, keyboard and gamepad; no console errors at any
viewport; nothing clipped at 1280×800, 390×844 or 844×390 (dialogs scroll inside).

---

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/keyart-nook.webp` | Title-screen backdrop behind the menu panel (1280×720, 47 KB) | FLUX.2 klein, seed 71104, 30 steps | generated this pass, wired via the title dialog's `overlay-keyart` style |
| `assets/wall-paper.webp` | Tiling wallpaper on the room's back and left walls (512×512, 16 KB, repeat 4×2, tinted by the theme wall colour) | FLUX.2 klein, seed 71105, 30 steps | generated this pass, wired in `render.ts` `loadWallpaper` |
| `coverart.png` | Platform cover (1200×675) — the diorama render with the title set in DejaVu Serif | FLUX.2 klein seed 71104 + ffmpeg text pass | regenerated this pass (replaced a generic placeholder that read "COZY STRATEGY") |
| `icon.png` | Platform icon | authored | shipped |
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
| `sfx/countdown-tick.opus` | `countdown` | MOSS-SFX v2.0 | generated this pass, wired in the countdown |
| `sfx/timer-warning.opus` | `timer-low` | MOSS-SFX v2.0 | generated this pass, wired in the rules clock |
| `sfx/achievement-unlock.opus` | `achieve` | MOSS-SFX v2.0 | generated this pass, wired in the results |
| — | 3D models | — | not called for: gameplay geometry is procedural by design (§8), so a baked hero prop would only duplicate one of 20 kinds |
| — | Character animation | — | not called for: no humanoid appears in the game |

---

## 16. Known limitations

- **Non-requested decoys are pickable and penalised, but decoys never become requested.** A level's
  requested set is fixed at generation, so a player who memorises a daily's decoys has a small edge
  on a retry (dailies are unranked).
- **The hint is always the lowest pending index.** It is deterministic (required for replay), but a
  player who spams hints gets the wave's targets in a predictable order rather than the "hardest to
  see" one.
- **Undo does not restore the camera.** The rules snapshot is exact; the view stays where it was.
- **Anchor collisions.** Placement anchors are shuffled and jittered ±0.25, so at 30 objects two
  items can visually overlap on a shelf. They remain separately pickable (the raycast returns the
  nearest unfound item), but one can be hidden behind the other until the camera moves.
- **The wallpaper tile shows a soft seam** at the wall corner where the back and left walls meet,
  because both use the same 4×2 repeat over different world extents.
- **No music.** Only stings and room tone; the music volume controls very little.
- **Leaderboard names** resolve through the players' profiles; guests see the board only once the
  device has seen its id (signed in once), else personal bests.
- **The daily is unranked**, as before: its score goes with progress (and, signed in, to the
  high-score board like a journey round).
- **Sounds while loading.** A cue whose clip has not loaded yet is silent (the browser build played a
  synthesized stand-in).
- **Ported differences:** dialogs are window-modal (the browser build's overlays covered only the
  room), so the title menu carries Help and Settings too; the profile avatar beside the status line
  is not shown; the old graphics panel's per-category overrides, render-scale slider and frame-rate
  readout are the runtime's Options; old custom bindings of `resetView` do not carry over to
  `reset_view`; guests' browser-only progress stays in that browser.

---

## 17. Design intent not yet implemented

1. **Anchor de-collision at generation time** (a minimum separation pass in `C.generateLevel`), which
   would remove the overlap noted in §16.
