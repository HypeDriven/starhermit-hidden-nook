// Hidden Nook on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules, content, progress document and string
// tables are the browser build's js/*.js, unchanged in what they decide; this
// module is what its game.js `Game` did around them — the state machine
// (title → modes → journey / practice / challenge setup → the round's rules
// card → 3-2-1-Go → the round ⇄ paused → resolving → results → progress →
// title; the daily, the lesson and the score chase), the command dispatch and
// its events (finds, wrong taps, wave clears, hints, undo), the lesson steps,
// focus cycling, the pointer (drag to look, wheel / pinch to zoom, tap to
// pick), keyboard and gamepad input, progression, best scores and
// achievements, and posting to the high-score board. The screens and HUD are
// drawn by screens.ts (starhermit:ui), the room by render.ts
// (starhermit:scene).
//
// Time is the runtime's fixed steps (60 a second): the rules clock advances
// in 500 ms tick commands every 30 steps, the countdown and the results delay
// count steps, so pauses, a hidden window and slow frames never change a
// round and play scripts replay exactly.
import "./classic.ts";
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch, onWheel, pointer, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onPlayerChange, onSessionEnded, requestSignIn } from "starhermit:platform";
import { Content as C, Rules as R, type Cmd, type Ev, type Level, type State } from "./classic.ts";
import * as audio from "./audio.ts";
import { K, objName, onLocaleChange, pt, tr, type Vars } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { initStyles } from "./style.ts";

export type Mode = "learn" | "journey" | "daily" | "practice" | "challenge";
export type Phase = "title" | "countdown" | "active" | "paused" | "resolving" | "results";
export type Screen = "title" | "modes" | "journey" | "practice" | "challenge" | "setup" | "error" | "countdown" | "pause" | "results" | "progression" | "scores";
export type Sub = "settings" | "help";

const STEPS_PER_TICK = 30; // 500 ms of rules time at 60 steps a second

export const app = {
  phase: "title" as Phase,
  /** The dialog the game shows (null: the round is being played). */
  screen: "title" as Screen | null,
  /** Settings or Help over it (they return to it when closed). */
  sub: null as Sub | null,
  /** Frame the top dialog opened on (the press that opened it must not also act on it). */
  openedFrame: 0,
  focusNext: null as string | null,
  status: null as [string, Vars | undefined] | null,
  toast: null as { text: () => string; until: number } | null,
  countdownText: "",
  pauseNote: false,
  practiceDiff: 1,
  practiceSeed: String(Math.floor(Math.random() * 1e9)),
  setupError: "",
  results: null as Results | null,
  lb: null as { state: "lbPosting" | "lbRank" | "lbPosted" | "lbNotPosted"; rank?: number | null } | null,
  board: null as { rows: { rank: string; name: string; score: number; you: boolean }[]; note: string; who: string; loading: boolean } | null,
  objectsOpen: false,
  signedOut: false,
};
export interface Results {
  headline: string; won: boolean; mode: Mode;
  bd: ReturnType<typeof R.scoreBreakdown>; invalids: number; hintsUsed: number; elapsedMs: number; seed: number;
  newAch: string[]; canNext: boolean;
}
export let level: Level | null = null;
export let state: State | null = null;
let mode: Mode = "practice";
let sessionId = "";
let cmdSeq = 0;
let tickSteps = 0;
let countdownSteps = 0;
let countdownIdx = 0;
let resolveSteps = -1;
let timerWarned = false;
export let tutorialStep = 0;
let dailyDay: string | null = null;
const now = (): number => frame().time;

// achievement metadata (mirrors the server's set)
export const ACHIEVEMENTS: Record<string, { name: string; desc: string }> = {
  "first-completion": { name: K("First Light"), desc: K("Complete your first round.") },
  "mechanic-mastery": { name: K("Steady Eye"), desc: K("Complete a round with zero invalid taps and no hints.") },
  "daily-streak-3": { name: K("Regular Visitor"), desc: K("Finish the daily challenge three days in a row.") },
  "journey-20": { name: K("Deep Nook"), desc: K("Clear journey stage 20.") },
  "collector-1000": { name: K("Nook Collector"), desc: K("Find 1000 objects across all rounds.") },
};

// ------------------------------------------------------------------ text helpers
export function announce(text: string, assertive = false): void {
  if (text) ui.announce(text.slice(0, 500), { politeness: assertive ? "assertive" : "polite" });
}
export function toast(text: () => string): void {
  app.toast = { text, until: now() + 3.5 };
  announce(text());
}
/** The status line: a translation key (+ vars) so it follows language changes. */
export function setStatus(key: string | null, vars?: Vars): void { app.status = key ? [key, vars] : null; }
export function statusText(): string { return app.status ? tr(app.status[0], app.status[1]) : ""; }
export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
export function progress(): ReturnType<typeof platform.getDoc> { return platform.getDoc(); }
export function today(): string { return new Date(platform.nowMs()).toISOString().slice(0, 10); }
export function themeName(id: string): string { const t = C.THEMES.find((x) => x.id === id); return t ? t.name : id; }
function haptic(ms: number): void { if (platform.settings.haptics) vibrate(ms); }
export function modeName(m: Mode): string {
  return { learn: K("Lesson"), journey: K("Journey"), daily: K("Daily challenge"), practice: K("Practice"), challenge: K("Challenge") }[m];
}
export function currentMode(): Mode { return mode; }

// ------------------------------------------------------------------ dialogs
export function show(screen: Screen | null, focus: string | null = null): void {
  app.screen = screen;
  app.sub = null;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
}
export function openSub(sub: Sub): void {
  // Opened during play, they pause the round first (and return to the pause menu).
  if (app.phase === "active") pause();
  app.sub = sub;
  app.openedFrame = frame().frame;
  app.focusNext = sub === "settings" ? "btn-settings-done" : "btn-help-done";
}
export function closeSub(): void {
  app.sub = null;
  app.openedFrame = frame().frame;
  app.focusNext = app.screen === "pause" ? "btn-resume" : null;
}
export function modalOpen(): boolean { return app.screen !== null || app.sub !== null; }

// ------------------------------------------------------------------ title and menus
export function toTitle(): void {
  app.phase = "title";
  state = null;
  level = null;
  app.results = null;
  app.lb = null;
  render.load(null);
  show("title", "btn-play");
  if (app.status && app.status[0].startsWith("Lesson")) app.status = null;
  idleStatus();
}
function idleStatus(): void {
  if (platform.signedIn()) setStatus("Signed in as {name}", { name: platform.displayName() || tr("Player") });
  else setStatus("Offline mode — progress is stored locally");
}
export function play(): void {
  if (!progress().tutorialDone) startLearn();
  else show("modes", "btn-mode-journey");
}
export function startLearn(): void {
  tutorialStep = 0;
  prepare(C.tutorialLevel(), "learn");
}
export function startDaily(): void {
  const day = today();
  const lv = C.dailyLevel(day);
  // The daily is the platform's UTC day when its clock answered, else the device's; unranked.
  setStatus("Daily seed computed locally — unranked");
  dailyDay = lv.dailyDay ?? day;
  prepare(lv, "daily");
}
export function startJourney(i: number): void { prepare(C.journeyLevel(i), "journey"); }
export const PRACTICE_DIFFS = ["easy", "medium", "hard"] as const;
export function startPractice(): void {
  const seed = Math.max(0, Math.floor(Number(app.practiceSeed) || 1));
  prepare(C.practiceLevel(PRACTICE_DIFFS[app.practiceDiff] ?? "medium", seed), "practice");
}
export function startChallenge(kind: string): void { prepare(C.challengeLevel(kind, Math.floor(Math.random() * 1e9)), "challenge"); }

/** The round's rules card (or the content error). */
export function prepare(lv: Level, m: Mode): void {
  level = lv;
  mode = m;
  const v = C.validateLevel(lv);
  if (!v.ok) { app.setupError = v.errors.join("; "); show("error", "btn-error-back"); return; }
  show("setup", "btn-begin");
}
export function rulesLines(lv: Level, m: Mode): string[] {
  const n = lv.items.filter((i) => i.requested).length;
  const bits = [tr("Find {n} requested objects among {decoys} decoys.", { n, decoys: lv.items.length - n })];
  bits.push(lv.timeLimitSeconds ? tr("Time limit {time}.", { time: fmtTime(lv.timeLimitSeconds * 1000) }) : tr("No timer — unhurried."));
  if (lv.moveLimit) bits.push(tr("At most {n} taps.", { n: lv.moveLimit }));
  bits.push(lv.allowUndo ? tr("Undo allowed.") : tr("No undo."));
  bits.push(tr("Hints cost {hint} points; wrong taps cost {wrong}.", { hint: R.SCORE.HINT_COST, wrong: R.SCORE.INVALID_PENALTY }));
  bits.push(tr("Not ranked."));
  bits.push(m === "learn" ? tr("Interactive lesson: one rule at a time.") : tr("Expected duration ~{time}.", { time: fmtTime(lv.parSeconds * 1000) }));
  return bits;
}

// ------------------------------------------------------------------ countdown and the round
export function begin(): void {
  if (!level) return;
  audio.play("click");
  app.phase = "countdown";
  state = R.createSession(level, { mode });
  sessionId = mode + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
  cmdSeq = 0;
  tickSteps = 0;
  resolveSteps = -1;
  timerWarned = false;
  if (mode === "learn") tutorialStep = 0;
  render.load(level);
  app.objectsOpen = false;
  const reduced = preferences().reducedMotion;
  countdownIdx = 0;
  countdownSteps = 0;
  app.countdownText = reduced ? tr("Go") : "3";
  show("countdown");
}
function countdownStep(): void {
  const reduced = preferences().reducedMotion;
  const steps = reduced ? [tr("Go")] : ["3", "2", "1", tr("Go")];
  countdownSteps++;
  if (countdownSteps < (reduced ? 18 : 42)) return;
  countdownSteps = 0;
  countdownIdx++;
  if (countdownIdx >= steps.length) { enterActive(); return; }
  app.countdownText = steps[countdownIdx]!;
  audio.play("countdown");
}
function enterActive(): void {
  app.phase = "active";
  show(null);
  ui.setFocus(null);
  announce(tr("Round started. {wave}", { wave: waveText() }));
  if (mode === "learn") showTutorialPrompt();
}
export function waveSet(): Set<number> { return state ? R.currentWaveSet(state) : new Set(); }
export function waveText(): string {
  if (!state) return "";
  const names = Array.from(waveSet()).map((i) => objName(state!.items[i]!.name));
  return names.length ? tr("Find: {names}", { names: names.join(", ") }) : tr("All waves cleared");
}

function dispatch(cmd: Cmd): void {
  if (!state || (app.phase !== "active" && app.phase !== "resolving")) return;
  cmd.id = sessionId + ":" + (++cmdSeq);
  const r = R.applyCommand(state, cmd);
  if (r.error) {
    announce(explainError(r.error), true);
    audio.play("invalid");
    return;
  }
  const wasResolving = app.phase === "resolving";
  state = r.state;
  handleEvents(r.events);
  if (R.isTerminal(state) && !wasResolving) toResolving();
}
function explainError(err: string): string {
  switch (err) {
    case "already-found": return tr("Already found that one.");
    case "no-such-object": return tr("Nothing there.");
    case "hints-disabled": return tr("Hints are disabled in this round.");
    case "nothing-to-hint": return tr("Nothing left to hint.");
    case "undo-disabled": return tr("Undo is not allowed in this mode.");
    case "nothing-to-undo": return tr("Nothing to undo.");
    case "round-over": return tr("The round is over.");
    default: return tr("That action is not allowed: {error}", { error: err });
  }
}
function handleEvents(events: Ev[]): void {
  const s = state!;
  for (const ev of events) {
    if (ev.type === "found") {
      render.markFound(ev.index!);
      audio.play("found", s.seed + s.tick);
      announce(tr("Found: {name}", { name: objName(ev.name ?? "") }));
      haptic(30);
      if (s.mode === "learn") advanceTutorial("find");
    } else if (ev.type === "invalid") {
      audio.play("invalid");
      announce(tr("That is not on the request strip. −{n} points.", { n: R.SCORE.INVALID_PENALTY }), true);
      haptic(120);
      if (s.mode === "learn") advanceTutorial("wrong");
    } else if (ev.type === "wave-clear") {
      audio.play("wave");
      announce(tr("Request strip cleared. Next set revealed."));
      if (s.mode === "learn") advanceTutorial("wave");
    } else if (ev.type === "hint") {
      render.markHinted(ev.index!);
      audio.play("hint");
      announce(tr("Hint: look for the {name} — it is glowing.", { name: objName(ev.name ?? "") }));
      if (s.mode === "learn") advanceTutorial("hint");
    } else if (ev.type === "undo") {
      audio.play("undo");
      announce(tr("Undone."));
      for (const [i, v] of render.itemViews) {
        const it = s.items[i]!;
        if (v.found !== it.found) { if (it.found) render.markFound(i); else render.markUnfound(i); }
        // keep the hint glow in sync with the restored snapshot too
        v.hinted = !!it.hinted && !v.found;
      }
    }
  }
}
export function tap(index: number | null): void {
  if (app.phase !== "active" || modalOpen()) return;
  if (index == null) return; // tapped empty space: no penalty, no-op
  dispatch({ type: "find", index });
}
export function hint(): void { if (app.phase === "active" && !modalOpen()) dispatch({ type: "hint" }); }
export function undo(): void { if (app.phase === "active" && !modalOpen()) dispatch({ type: "undo" }); }
export function resetView(): void { render.resetCamera(); audio.play("click"); }
export function canUndo(): boolean { return !!state && state.allowUndo; }

// ------------------------------------------------------------------ resolving and results
function toResolving(): void {
  app.phase = "resolving";
  // Rules state is final; settle every found object into its exact end pose.
  render.settleFound();
  resolveSteps = preferences().reducedMotion ? 6 : 36;
}
function toResults(): void {
  const s = state!;
  const lv = level!;
  app.phase = "results";
  const bd = R.scoreBreakdown(s);
  const won = s.reason === "all-found";
  audio.play(won ? "win" : "lose");
  const p = progress();
  if (mode === "learn" && won) p.tutorialDone = true;
  p.foundTotal += s.items.filter((i) => i.found).length;
  const newAch: string[] = [];
  const grant = (key: string): void => {
    if (p.achievements[key]) return;
    p.achievements[key] = platform.nowMs();
    newAch.push(ACHIEVEMENTS[key]!.name);
  };
  if (won) grant("first-completion");
  if (won && s.invalids === 0 && s.hintsUsed === 0) grant("mechanic-mastery");
  if (mode === "journey" && won) {
    p.journeyUnlocked = Math.max(p.journeyUnlocked, lv.index + 1);
    if (lv.index + 1 >= 20) grant("journey-20");
  }
  if (p.foundTotal >= 1000) grant("collector-1000");
  if (mode === "daily" && won) {
    const day = dailyDay ?? today();
    if (p.dailyStreak.last !== day) {
      const yday = new Date(platform.nowMs() - 86400000).toISOString().slice(0, 10);
      p.dailyStreak.count = p.dailyStreak.last === yday ? p.dailyStreak.count + 1 : 1;
      p.dailyStreak.last = day;
      if (p.dailyStreak.count >= 3) grant("daily-streak-3");
    }
  }
  const result = { score: bd.total, reason: s.reason ?? "", invalids: s.invalids, elapsedMs: s.elapsedMs, sessionId };
  const best = p.bestScores[lv.id];
  if (!best || R.compareResults(result, best) < 0) p.bestScores[lv.id] = result;
  platform.persist();

  const headline = won ? K("Nook cleared!") : s.reason === "time-up" ? K("Time ran out") : s.reason === "move-limit" ? K("Out of taps") : K("Round over");
  app.results = {
    headline, won, mode, bd, invalids: s.invalids, hintsUsed: s.hintsUsed, elapsedMs: s.elapsedMs, seed: s.seed, newAch,
    canNext: mode === "journey" && won && lv.index + 1 < C.JOURNEY_COUNT,
  };
  if (newAch.length) audio.play("achieve");
  show("results", "btn-retry");
  announce(tr("{headline} Total score {score}.", { headline: "@t:" + headline, score: bd.total }), true);
  // Signed in, finished Journey and Daily rounds post their total to the
  // StarHermit high-score board; the results show the player's rank.
  app.lb = null;
  if (platform.signedIn() && (mode === "journey" || mode === "daily")) {
    const line = { state: "lbPosting" as const };
    app.lb = line;
    void platform.postLeaderboard(bd.total).then((r) => {
      if (app.lb !== line) return;
      app.lb = { state: !r.posted ? "lbNotPosted" : r.rank ? "lbRank" : "lbPosted", rank: r.rank };
    });
  }
}
export function retry(): void { audio.play("click"); if (level) prepare(level, mode); }
export function nextStage(): void { audio.play("click"); if (level) startJourney(level.index + 1); }
export function toProgression(): void { audio.play("click"); show("progression", "btn-back-title"); }

// ------------------------------------------------------------------ score chase
export function showScores(): void {
  const board: NonNullable<typeof app.board> = { rows: [], note: "", who: K("Level"), loading: true };
  app.board = board;
  show("scores", "btn-scores-back");
  const local = (note: string): void => {
    board.who = K("Level");
    board.note = note;
    board.rows = Object.entries(progress().bestScores).slice(0, 20).map(([k, v]) => ({ rank: "—", name: k, score: v.score, you: false }));
    board.loading = false;
  };
  if (!platform.signedIn()) { local(K("Personal bests on this device.")); return; }
  void platform.fetchLeaderboard().then((r) => {
    if (app.board !== board) return;
    if (r.ok) {
      board.who = K("Player");
      board.note = K("Global board — read-only on the platform. Personal bests travel with your save.");
      board.rows = r.entries.map((e) => ({ rank: String(e.rank), name: e.name, score: e.score, you: e.mine }));
      board.loading = false;
    } else local(K("No platform leaderboard — showing personal bests (saved with your progress)."));
  });
}

// ------------------------------------------------------------------ the lesson
function showTutorialPrompt(): void {
  const step = C.TUTORIAL_STEPS[tutorialStep];
  if (!step) return;
  setStatus("Lesson {n}/{total}: {text}", { n: tutorialStep + 1, total: C.TUTORIAL_STEPS.length, text: "@t:" + step.text });
  announce(tr("Lesson step {n}: {text}", { n: tutorialStep + 1, text: "@t:" + step.text }));
}
function advanceTutorial(action: string): void {
  if (!state || state.mode !== "learn") return;
  const steps = C.TUTORIAL_STEPS;
  const matches = (a: string, st: string): boolean => (st === "pan" && a === "pan")
    || (st === "find" && a === "find")
    || (st === "find-requested" && (a === "find" || a === "wrong"))
    || (st === "wave" && (a === "wave" || a === "find"))
    || (st === "hint" && a === "hint");
  // satisfy the earliest pending step this action demonstrates (never skipping ahead)
  if (tutorialStep >= steps.length || !matches(action, steps[tutorialStep]!.action)) return;
  tutorialStep++;
  audio.play("focus");
  if (tutorialStep >= steps.length) {
    progress().tutorialDone = true;
    platform.persist();
    setStatus("Lesson complete — finish the round!");
    announce(tr("Lesson complete. Finish clearing the room."));
  } else showTutorialPrompt();
}

// ------------------------------------------------------------------ pause
export function pause(auto = false): void {
  if (app.phase !== "active" && app.phase !== "paused") return;
  app.phase = "paused";
  app.pauseNote = auto;
  audio.play("pause");
  show("pause", "btn-resume");
}
export function resume(): void {
  if (app.phase !== "paused") return;
  audio.play("click");
  app.phase = "active";
  app.pauseNote = false;
  show(null);
  ui.setFocus(null);
}
export function leaveRound(): void { audio.play("click"); toTitle(); }

// ------------------------------------------------------------------ focus cycling
export function cycleFocus(dir: number): void {
  if (!state || app.phase !== "active" || modalOpen()) return;
  const idxs = R.legalActions(state).filter((a) => a.type === "find").map((a) => a.index!);
  if (!idxs.length) return;
  const cur = idxs.indexOf(render.focusIndex);
  const next = idxs[(cur + dir + idxs.length) % idxs.length]!;
  render.focusItem(next);
  audio.play("focus");
  announce(tr("Focused: {name}", { name: objName(state.items[next]!.name) }));
}

// ------------------------------------------------------------------ account
export function copyInvite(): void {
  const link = platform.inviteLink();
  let ok = false;
  if (link) { try { clipboard.writeText(link); ok = true; } catch { ok = false; } }
  toast(() => (ok ? pt("copied") : pt("copyFailed", { link: link ?? "" })));
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }

// ------------------------------------------------------------------ input: keys and pads
onAction((e) => {
  if (!e.pressed) return;
  const a = e.action;
  if (a === "pause") {
    if (app.phase === "active" && !modalOpen()) pause();
    else if (app.phase === "paused" && app.screen === "pause" && !app.sub && frame().frame !== app.openedFrame) resume();
    return;
  }
  if (app.phase !== "active" || modalOpen()) return;
  switch (a) {
    case "prev": case "next":
      ui.setFocus(null);
      cycleFocus(a === "prev" ? -1 : 1);
      break;
    // A focused widget (a rail button) takes Enter / Space / South itself.
    case "select": if (!ui.focused() && render.focusIndex >= 0) tap(render.focusIndex); break;
    case "hint": hint(); break;
    case "undo": undo(); break;
    case "reset_view": render.resetCamera(); break;
  }
});

// ------------------------------------------------------------------ input: the pointer on the playfield
// A gesture is a tap when it moved under 8 px and lasted under 400 ms; a second finger makes it a pinch.
interface Down { x: number; y: number; lx: number; ly: number; at: number; moved: boolean; touchId: number | null }
let down: Down | null = null;
let pendingDown: { x: number; y: number; touchId: number | null } | null = null;
const touches = new Map<number, { x: number; y: number }>();
let pinchD = 0;
let lastTouch = -1e9;
function canLook(): boolean { return !!level && (app.phase === "active" || app.phase === "countdown") && !modalOpen(); }
/** Decides a queued press once the UI is built: on the playfield (not a widget) it starts a gesture. */
function decidePress(): void {
  const d = pendingDown;
  pendingDown = null;
  if (!d || down || !canLook() || ui.pointerOver() || !render.inView(d.x, d.y)) return;
  down = { x: d.x, y: d.y, lx: d.x, ly: d.y, at: now(), moved: false, touchId: d.touchId };
}
function moveTo(x: number, y: number, touchId: number | null): void {
  const d = down;
  if (!d || d.touchId !== touchId) return;
  const k = Math.max(0.5, frame().scale);
  if (!d.moved && Math.hypot(x - d.x, y - d.y) / k > 8) d.moved = true;
  if (d.moved && touches.size < 2 && canLook()) render.panBy((x - d.lx) / k, (y - d.ly) / k);
  d.lx = x; d.ly = y;
}
function release(x: number, y: number, touchId: number | null, cancel: boolean): void {
  const d = down;
  if (!d || d.touchId !== touchId) return;
  down = null;
  if (cancel || d.moved || now() - d.at >= 0.4) return;
  if (app.phase === "active" && !modalOpen()) tap(render.pick(x, y));
}
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  if (e.pressed) pendingDown = { x: e.x, y: e.y, touchId: null };
  else release(e.x, e.y, null, false);
});
onPointerMove((x, y) => { if (now() - lastTouch >= 0.6) moveTo(x, y, null); });
onWheel((_dx, dy) => {
  const p = pointer();
  if (!p || !canLook() || ui.pointerOver() || !render.inView(p.x, p.y) || dy === 0) return;
  render.zoomBy(dy > 0 ? 1.1 : 0.9);
});
onTouch((e) => {
  if (e.control) return;
  lastTouch = now();
  if (e.phase === "start") {
    touches.set(e.id, { x: e.x, y: e.y });
    if (touches.size >= 2) { if (down) down.moved = true; pinchD = 0; }
    else if (e.primary) pendingDown = { x: e.x, y: e.y, touchId: e.id };
  } else if (e.phase === "move") {
    if (touches.has(e.id)) touches.set(e.id, { x: e.x, y: e.y });
    if (touches.size === 2) {
      const [a, b] = Array.from(touches.values());
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinchD > 0 && dist > 0 && canLook()) render.zoomBy(pinchD / dist);
      pinchD = dist;
    } else moveTo(e.x, e.y, e.id);
  } else {
    touches.delete(e.id);
    if (touches.size < 2) pinchD = 0;
    release(e.x, e.y, e.id, e.phase === "cancel");
  }
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  render.setOnCameraMove(() => { if (tutorialStep === 0 && app.phase === "active") advanceTutorial("pan"); });
  applyLook();
  toTitle();
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
onLocaleChange(() => { if (app.screen === "scores" && app.board && !app.board.loading) showScores(); });
onSessionEnded(() => {
  app.signedOut = true;
  toast(() => pt("signedOut"));
  setStatus("Offline mode — progress is stored locally");
});
onPlayerChange((p) => {
  if (p) app.signedOut = false;
  if (app.phase === "title") idleStatus();
});
// A hidden window pauses the round, with a note that the clock stopped.
onSuspend(() => { platform.flush(); if (app.phase === "active") pause(true); });
onResume(() => undefined);

onFixedUpdate(() => {
  if (app.phase === "countdown") { countdownStep(); return; }
  if (app.phase === "resolving") {
    if (resolveSteps > 0 && --resolveSteps === 0) toResults();
    return;
  }
  if (app.phase !== "active" || !state || state.status !== "active") return;
  if (++tickSteps < STEPS_PER_TICK) return;
  tickSteps = 0;
  const cmd: Cmd = { type: "tick", dtMs: 500, id: sessionId + ":" + (++cmdSeq) };
  const r = R.applyCommand(state, cmd);
  if (r.error) return;
  state = r.state;
  if (state.timeLimitMs != null && !timerWarned && state.timeLimitMs - state.elapsedMs < 30000) {
    // one-shot warning the first time the round crosses the 30 s mark
    timerWarned = true;
    audio.play("timer-low");
  }
  if (R.isTerminal(state)) toResolving();
});

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  audio.update();
  if (app.toast && now() > app.toast.until) app.toast = null;
});
onRender(() => {
  drawScreens();
  decidePress();
  render.update(frameDt);
});
