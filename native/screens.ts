// The browser build's DOM shell (index.html + style.css + the overlays game.js
// wrote) as starhermit:ui, built every frame around the room: the top bar
// (title, status line, cloud-save line, the round timer, Pause / Help /
// Settings), the left rail (the request strip's chips with their colour
// swatch and shape tag, the wave line, the found count and progress bar),
// the right rail (score, Hint / Undo / Reset view, the scene-object list
// that is the complete non-visual board), the phone tray, the dialogs
// (title, modes, journey stages, practice, challenge, the rules card, the
// content error, the countdown, pause, settings, help, results, progress,
// score chase) and the toast. The browser's media queries are layouts picked
// by the window's logical size: desktop (three columns), compact (< 1024 px:
// the room above the two rails), phone portrait (≤ 700 px wide: the room,
// the requests, a score row with the collapsible object list, the tray) and
// short landscape (≤ 500 px tall: requests, score and tray in a left column
// beside the room).
import { frame, openMenu } from "starhermit:engine";
import { bindingLabel, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { Content as C, Rules as R } from "./classic.ts";
import { kindName, objName, pt, tr } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import {
  ACHIEVEMENTS, app, begin, canUndo, closeSub, copyInvite, currentMode, fmtTime, hint, leaveRound, level, modeName,
  nextStage, openSub, pause, play, progress, resetView, resume, retry, rulesLines, show, showScores, signIn, startChallenge,
  startDaily, startJourney, startLearn, startPractice, state, statusText, tap, themeName, toProgression, toTitle, today, undo, waveText,
} from "./main.ts";
import * as audio from "./audio.ts";
import { COLORS } from "./style.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number; portrait: boolean; shortLand: boolean; compact: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const shortLand = lw > lh && lh <= 500;
  const portrait = !shortLand && lw <= 700 && lh >= lw;
  return { lw, lh, sc, ox: sa.left / sc, oy: sa.top / sc, portrait, shortLand, compact: !shortLand && !portrait && lw < 1024 && lh > lw * 0.75 };
}
const lastHeight = new Map<string, number>();
type Cls = string | ui.Style;
const textWidth = (text: string, style: Cls | readonly Cls[], kind?: "button" | "heading"): number =>
  ui.measureText(text, { ...(kind ? { kind } : {}), style }).width / ui.preferences().scale;

interface Btn { id: string; text: string; style?: Cls[]; disabled?: boolean; act: () => void; width?: number; badge?: string }
const PLAIN: Cls[] = ["btn"];
/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null = null): void {
  const style = b.style ?? PLAIN;
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  const s: ui.Style = width != null ? { width } : {};
  const full = b.badge ? b.text + "  " + b.badge : b.text;
  if (b.badge) {
    opts.content = () => ui.row(`${b.id}-face`, () => {
      ui.label(b.text);
      ui.column(`${b.id}-badge`, () => ui.style("badge-text").label(b.badge!), { style: "badge" });
    }, { spacing: 8, align: "center" });
  } else if (width != null && textWidth(full, style, "button") + 2 > width) {
    const inner = Math.max(20, width - 20);
    opts.content = () => { ui.style({ text: { align: "center" } }).paragraph(b.text, inner); };
    s.padding = { start: 8, end: 8, top: 8, bottom: 8 };
  }
  if (ui.style(...style, s).id(b.id).button(full, opts)) { audio.play("click"); b.act(); }
}
/** Buttons at their own widths in rows that wrap at `width` (CSS flex-wrap). */
function flow(label: string, list: Btn[], width: number, gap = 9): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  for (const b of list) {
    const bw = Math.min(width, b.width ?? textWidth(b.text, b.style ?? PLAIN, "button") + 2);
    if (rows[rows.length - 1]!.length && used + gap + bw > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + bw;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button(b, b.width ?? (textWidth(b.text, b.style ?? PLAIN, "button") + 2 > width ? width : null));
    }, { spacing: gap, align: "center" }));
  }, { spacing: gap, width });
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "body", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (ui.measureText(text, { style: cls }).width / ui.preferences().scale <= width) u.label(text);
  else u.paragraph(text, width);
}
function heading(cls: string, text: string, width: number, id?: string): void {
  if (ui.measureText(text, { kind: "heading", style: cls }).width / ui.preferences().scale <= width) (id ? ui.id(id) : ui).style(cls).heading(text);
  else (id ? ui.id(id) : ui).style(cls).paragraph(text, width);
}
/** Small labelled pills (badges) wrapping at `width`. */
function badges(id: string, list: { text: string; on: boolean; tip?: string }[], width: number): void {
  const rows: (typeof list)[] = [[]];
  let used = 0;
  for (const it of list) {
    const iw = textWidth(it.text, "badge-text") + 20;
    if (rows[rows.length - 1]!.length && used + 6 + iw > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? 6 : 0) + iw;
    rows[rows.length - 1]!.push(it);
  }
  ui.column(id, () => rows.forEach((row, ri) => ui.row(`${id}-r${ri}`, () => {
    row.forEach((it, i) => ui.column(`${id}-${ri}-${i}`, () => ui.style("badge-text", it.on && { text: { color: COLORS.accent } }).label(it.text),
      { style: it.on ? "badge-unlocked" : "badge", ...(it.tip ? { tooltip: it.tip } : {}) }));
  }, { spacing: 6 })), { spacing: 6 });
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  shell(L);
  dialogs(L);
  toastView(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

// ------------------------------------------------------------------ the shell: top bar, rails, playfield, tray
const inRound = (): boolean => !!state && (app.phase === "active" || app.phase === "paused" || app.phase === "countdown" || app.phase === "resolving");
function topBar(L: Layout): number {
  const pad = L.portrait ? 10 : 14;
  const w = L.lw;
  const showPause = app.phase === "active" || app.phase === "paused";
  const timed = inRound() && state!.timeLimitMs != null;
  const btns: Btn[] = [];
  if (showPause) btns.push({ id: "btn-pause", text: tr("Pause"), style: ["btn", "btn-ghost"], act: () => pause() });
  btns.push({ id: "btn-help", text: tr("Help"), style: ["btn", "btn-ghost"], act: () => openSub("help") });
  btns.push({ id: "btn-settings", text: tr("Settings"), style: ["btn", "btn-ghost"], act: () => openSub("settings") });
  const btnW = btns.reduce((s, b) => s + textWidth(b.text, b.style!, "button") + 2, 0) + (btns.length - 1) * (L.portrait ? 5 : 8);
  const timerW = timed ? textWidth("00:00", "timer") + (L.portrait ? 10 : 30) : 0;
  const titleW = Math.max(90, w - 2 * pad - btnW - timerW - 12);
  const sync = platform.syncState();
  const r = ui.place("topbar", { anchor: "top-start", x: L.ox, y: L.oy }, () => {
    ui.row("topbar-row", () => {
      ui.column("title-block", () => {
        heading("game-title", "Hidden Nook", titleW, "game-title");
        const st = statusText();
        if (st) {
          // clamped to two lines on phones
          const lines = ui.measureText(st, { style: "status-line", width: titleW }).height / L.sc;
          if (L.portrait && lines > 36) para(st.slice(0, Math.max(10, Math.floor(st.length * 36 / lines) - 2)) + "…", titleW, "status-line", "status-line");
          else para(st, titleW, "status-line", "status-line");
        }
        if (platform.signedIn()) {
          const text = sync === "saving" ? tr("Saving…") : sync === "synced" ? tr("Cloud synced") : tr("Offline — local only");
          ui.style(sync === "synced" ? "sync-synced" : sync === "offline" ? "sync-offline" : "sync").id("sync-status").label(text);
        }
      }, { width: titleW, spacing: 2 });
      ui.spacer();
      if (timed) {
        const left = state!.timeLimitMs! - state!.elapsedMs;
        ui.style(left < 30000 ? "timer-low" : "timer").id("hud-timer").label(fmtTime(left), { tooltip: tr("Time remaining") });
        ui.spacer();
      }
      ui.row("top-actions", () => { for (const b of btns) button(b); }, { spacing: L.portrait ? 5 : 8 });
    }, { width: w - 2 * pad, align: "center", spacing: 6 });
  }, { style: "topbar", width: w, padding: { top: L.portrait ? 6 : 10, bottom: L.portrait ? 6 : 10, start: pad, end: pad } });
  return r.height / L.sc;
}

/** The request strip: chips with a swatch, the name and the shape tag (✓ when found). */
function requestChips(w: number): void {
  if (!state || !level) return;
  const wave = state.waves[state.wave] ?? [];
  const items = wave.map((idx) => {
    const it = state!.items[idx]!;
    const name = objName(it.name);
    const tag = kindName(level!.items[idx]!.kind).toUpperCase();
    const width = 14 + 8 + textWidth(name, "chip-name") + 8 + textWidth(tag, "chip-tag") + (it.found ? 8 + textWidth("✓", "chip-check") : 0) + 22;
    return { idx, it, name, tag, width: Math.min(w, width) };
  });
  const rows: (typeof items)[] = [[]];
  let used = 0;
  for (const c of items) {
    if (rows[rows.length - 1]!.length && used + 7 + c.width > w) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? 7 : 0) + c.width;
    rows[rows.length - 1]!.push(c);
  }
  ui.column("request-strip", () => rows.forEach((row, ri) => ui.row(`req-r${ri}`, () => {
    for (const c of row) {
      const color = "#" + level!.items[c.idx]!.color.toString(16).padStart(6, "0");
      // A chip too wide for the rail stacks its shape tag under the name (which wraps at words).
      const tight = c.width >= w - 0.5;
      const tagW = textWidth(c.tag, "chip-tag");
      const nameW = tight ? Math.max(30, w - 14 - 7 - 22 - (c.it.found ? 20 : 0)) : Math.max(30, c.width - 52 - tagW - (c.it.found ? 16 : 0));
      ui.row(`chip-${c.idx}`, () => {
        ui.widget(`swatch-${c.idx}`, {
          role: "none", size: { width: 14, height: 14 },
          draw: (rect) => {
            const k = ui.preferences().scale;
            draw.roundRect(rect.x, rect.y, rect.width, rect.height, 3 * k, color);
            draw.strokeRoundRect(rect.x, rect.y, rect.width, rect.height, 3 * k, "#ffffff66", 1);
          },
        });
        if (tight) {
          ui.column(`chip-${c.idx}-text`, () => { para(c.name, nameW, "chip-name", `chip-name-${c.idx}`); ui.style("chip-tag").label(c.tag); }, { spacing: 1 });
        } else {
          para(c.name, nameW, "chip-name", `chip-name-${c.idx}`);
          ui.style("chip-tag").label(c.tag);
        }
        if (c.it.found) ui.style("chip-check").label("✓");
      }, { style: c.it.found ? "chip-found" : c.it.hinted ? "chip-hinted" : "chip", spacing: 7, align: "center",
        tooltip: tr(c.it.found ? "{name}, found" : "{name}, not found", { name: c.name }) });
    }
  }, { spacing: 7 })), { spacing: 7 });
}
function leftRail(L: Layout, w: number): void {
  const inner = w;
  heading("rail-heading", tr("Requests"), inner, "rail-requests");
  if (state && level) {
    requestChips(inner);
    para(tr("Wave {n} of {total} — {wave}", { n: state.wave + 1, total: state.waves.length, wave: waveText() }), inner, "rail-hint", "objective-text");
  } else para(tr("Pick a mode to begin."), inner, "rail-hint", "objective-text");
  const found = state ? state.items.filter((i) => i.found).length : 0;
  const total = level && state ? level.items.filter((it) => it.requested).length : 0;
  para(state ? tr("{found} / {total} found", { found, total }) : tr("0 found"), inner, "rail-sub", "hud-progress");
  ui.progress(total ? found / total : 0, inner);
  void L;
}
function actionButtons(): Btn[] {
  const list: Btn[] = [{ id: "btn-hint", text: tr("Hint"), act: hint }];
  if (canUndo()) list.push({ id: "btn-undo", text: tr("Undo"), act: undo });
  list.push({ id: "btn-cam", text: tr("Reset view"), act: resetView });
  return list;
}
function scoreBlock(): void {
  ui.row("score-block", () => {
    ui.style("score-value").id("hud-score").label(String(state ? state.score : 0));
    ui.style("rail-sub").label(tr("points"));
  }, { spacing: 10, align: "end" });
}
function targetList(w: number): void {
  if (!state) return;
  state.items.forEach((it, i) => {
    const name = objName(it.name);
    const cls = it.found ? "target-found" : i === render.focusIndex ? "target-focus" : "target";
    if (ui.style(cls, { width: w }).id(`target-${i}`).button(it.found ? tr("{name}, found", { name }) : name, {
      content: () => ui.row(`target-${i}-face`, () => {
        ui.label(name);
        ui.spacer();
        if (it.found) ui.style("state-tag").label(tr("found"));
      }, { width: w - 22, align: "center" }),
    })) tap(i);
  });
}
function rightRail(L: Layout, w: number, compactRow: boolean): void {
  const inner = w;
  const playing = app.phase === "active" || app.phase === "paused";
  if (compactRow) {
    // phones: score and the collapsible object list share one row (stacked in a narrow column)
    const toggle = (): void => {
      if (state) button({ id: "btn-objects", text: (app.objectsOpen ? "▾ " : "▸ ") + tr("Scene objects"), style: ["btn", "btn-ghost"], act: () => { app.objectsOpen = !app.objectsOpen; } });
      else ui.style("rail-heading2").label(tr("Scene objects"));
    };
    const toggleW = textWidth("▾ " + tr("Scene objects"), ["btn", "btn-ghost"], "button");
    if (inner < toggleW + 110) ui.column("score-col", () => { scoreBlock(); toggle(); }, { width: inner, spacing: 6 });
    else ui.row("score-row", () => { scoreBlock(); ui.spacer(); toggle(); }, { width: inner, align: "center" });
    if (app.objectsOpen && state) targetList(inner);
    return;
  }
  scoreBlock();
  if (playing && !L.shortLand && !L.portrait) flow("action-row", actionButtons(), inner, 8);
  heading("rail-heading2", tr("Scene objects"), inner, "rail-objects");
  targetList(inner);
}
/** A rail panel at a fixed window position, its content scrolling when taller than `h`. */
function railPanel(id: string, x: number, y: number, w: number, h: number, build: (inner: number) => void, style = "rail"): void {
  const padY = style === "rail" ? 13 : 8, padX = style === "rail" ? 13 : 11;
  const contentH = lastHeight.get(id) ?? 0;
  ui.place(id, { anchor: "top-start", x, y }, () => {
    const body = (): void => {
      const inner = w - 2 * padX - 2 - (contentH > h - 2 * padY + 1 ? 14 : 0);
      const r = ui.column(`${id}-body`, () => build(inner), { spacing: 8, width: inner });
      lastHeight.set(id, r.height / ui.preferences().scale);
    };
    if (contentH > h - 2 * padY + 1) ui.scrollArea(`${id}-scroll`, { width: w - 2 * padX, height: h - 2 * padY }, body);
    else body();
  }, { style, width: w, height: h });
}
function tray(id: string, x: number, y: number, w: number, list: Btn[]): number {
  const gap = 8;
  const bw = (w - gap * (list.length - 1)) / list.length;
  const r = ui.place(id, { anchor: "top-start", x, y }, () => {
    ui.row(`${id}-row`, () => { for (const b of list) button({ ...b, style: ["btn", "btn-tray"] }, bw); }, { spacing: gap });
  }, { width: w });
  return r.height / ui.preferences().scale;
}
function shell(L: Layout): void {
  const f = frame();
  const sc = L.sc;
  const topH = lastHeight.get("topbar") ?? 64;
  const pad = L.portrait ? 9 : L.shortLand ? 8 : 14;
  const gap = L.portrait ? 8 : L.shortLand ? 8 : 14;
  const x0 = L.ox + pad, y0 = L.oy + topH + pad;
  const W = L.lw - 2 * pad, H = L.lh - topH - 2 * pad;
  const playing = app.phase === "active" || app.phase === "paused";
  let pf = { x: x0, y: y0, w: W, h: H };
  // the backdrop around the playfield (the scene shows inside it)
  const paint = (): void => {
    const px = pf.x * sc + (f.safeArea.left ? 0 : 0), py = pf.y * sc, pw = pf.w * sc, ph = pf.h * sc;
    draw.rect(0, 0, f.width, py, COLORS.main);
    draw.rect(0, py + ph, f.width, f.height - py - ph, COLORS.main);
    draw.rect(0, py, px, ph, COLORS.main);
    draw.rect(px + pw, py, f.width - px - pw, ph, COLORS.main);
    draw.strokeRoundRect(px, py, pw, ph, 10, COLORS.line, 1);
  };
  if (L.portrait) {
    const trayH = playing ? (lastHeight.get("tray") ?? 52) : 0;
    const rightH = Math.min(L.lh * (app.objectsOpen ? 0.4 : 0.2), (lastHeight.get("rail-right") ?? 50) + 18);
    const leftH = Math.min(L.lh * 0.3, (lastHeight.get("rail-left") ?? 120) + 20);
    const ph = Math.max(200, H - leftH - rightH - (trayH ? trayH + gap : 0) - 2 * gap);
    pf = { x: x0, y: y0, w: W, h: ph };
    paint();
    railPanel("rail-left", x0, y0 + ph + gap, W, leftH, (iw) => leftRail(L, iw), "rail-compact");
    railPanel("rail-right", x0, y0 + ph + gap + leftH + gap, W, rightH, (iw) => rightRail(L, iw, true), "rail-compact");
    if (playing) {
      const list = actionButtons();
      list.push({ id: "tray-pause", text: tr("Pause"), act: () => pause() });
      lastHeight.set("tray", tray("tray", x0, y0 + ph + gap + leftH + gap + rightH + gap, W, list.map((b) => ({ ...b, id: b.id.replace("btn-", "tray-") }))));
    }
  } else if (L.shortLand) {
    const cw = Math.min(300, Math.max(190, (W - gap) * 0.24));
    pf = { x: x0 + cw + gap, y: y0, w: W - cw - gap, h: H };
    paint();
    const trayH = playing ? (lastHeight.get("tray") ?? 52) : 0;
    const scoreH = Math.min(L.lh * 0.32, (lastHeight.get("rail-right") ?? 50) + 18);
    const leftH = Math.max(60, H - scoreH - (trayH ? trayH + gap : 0) - gap);
    railPanel("rail-left", x0, y0, cw, leftH, (iw) => leftRail(L, iw), "rail-compact");
    railPanel("rail-right", x0, y0 + leftH + gap, cw, scoreH, (iw) => rightRail(L, iw, true), "rail-compact");
    if (playing) {
      // the tray wraps in the narrow column (Pause stays in the top bar)
      const r = ui.place("tray", { anchor: "top-start", x: x0, y: y0 + leftH + gap + scoreH + gap }, () => {
        flow("tray-flow", actionButtons().map((b) => ({ ...b, id: b.id.replace("btn-", "tray-"), style: ["btn", "btn-tray"] })), cw, 8);
      }, { width: cw });
      lastHeight.set("tray", r.height / sc);
    }
  } else if (L.compact) {
    const leftH = Math.min(L.lh * 0.3, (lastHeight.get("rail-left") ?? 120) + 28);
    const rightH = Math.min(L.lh * 0.3, (lastHeight.get("rail-right") ?? 120) + 28);
    const ph = Math.max(L.lh * 0.46, H - leftH - rightH - 2 * gap);
    pf = { x: x0, y: y0, w: W, h: ph };
    paint();
    railPanel("rail-left", x0, y0 + ph + gap, W, leftH, (iw) => leftRail(L, iw));
    railPanel("rail-right", x0, y0 + ph + gap + leftH + gap, W, rightH, (iw) => rightRail(L, iw, false));
  } else {
    const side = Math.max(180, (W - 2 * gap) * 0.2);
    pf = { x: x0 + side + gap, y: y0, w: W - 2 * side - 2 * gap, h: H };
    paint();
    railPanel("rail-left", x0, y0, side, H, (iw) => leftRail(L, iw));
    railPanel("rail-right", x0 + W - side, y0, side, H, (iw) => rightRail(L, iw, false));
  }
  render.setRect(pf.x * sc, pf.y * sc, pf.w * sc, pf.h * sc, f.width, f.height);
  // the top bar last among the shell (over the backdrop)
  lastHeight.set("topbar", topBar(L));
}

// ------------------------------------------------------------------ dialogs
function dialogFrame(label: string, L: Layout, maxW: number, build: (w: number) => void, onClose: (() => void) | null, footer?: (w: number) => void, style?: string): void {
  const w = Math.min(maxW, L.lw * 0.94) - 44;
  const footH = footer ? (lastHeight.get(`dlg-${label}-foot`) ?? 56) + 10 : 0;
  const avail = L.lh * 0.92 - 44 - footH;
  const h = lastHeight.get(`dlg-${label}`) ?? 0;
  const body = (): void => {
    const r = ui.column(`${label}-body`, () => build(w), { spacing: 9, width: w });
    lastHeight.set(`dlg-${label}`, r.height / L.sc);
  };
  // A dialog opens at its top (heading visible), whatever it focuses.
  const fresh = frame().frame - app.openedFrame <= 4;
  const open = (style ? ui.style(style) : ui).dialog(label, "", true, () => {
    if (h > avail) ui.scrollArea(`${label}-scroll`, { width: w + 14, height: Math.max(80, avail) }, body, fresh ? { scrollTo: { top: 0 } } : undefined);
    else body();
    // the action buttons stay in view under a scrolling body
    if (footer) {
      const r = ui.column(`${label}-foot`, () => footer(w), { width: w, padding: { top: 10 } });
      lastHeight.set(`dlg-${label}-foot`, r.height / L.sc);
    }
  });
  // The Escape (or East) that opened it must not close it the same frame.
  if (!open && frame().frame !== app.openedFrame && onClose) { audio.play("click"); onClose(); }
}
function dialogs(L: Layout): void {
  if (app.sub === "settings") { settingsDialog(L); return; }
  if (app.sub === "help") { helpDialog(L); return; }
  switch (app.screen) {
    case "title": titleDialog(L); break;
    case "modes": modesDialog(L); break;
    case "journey": journeyDialog(L); break;
    case "practice": practiceDialog(L); break;
    case "challenge": challengeDialog(L); break;
    case "setup": setupDialog(L); break;
    case "error": errorDialog(L); break;
    case "countdown": countdownDialog(L); break;
    case "pause": pauseDialog(L); break;
    case "results": resultsDialog(L); break;
    case "progression": progressionDialog(L); break;
    case "scores": scoresDialog(L); break;
    default: break;
  }
}
function titleDialog(L: Layout): void {
  const p = progress();
  dialogFrame(tr("Title screen"), L, 560, (w) => {
    heading("h2", "Hidden Nook", w, "title-heading");
    para(tr("A miniature room full of small things. Find every object named in the request strip."), w, "body", "title-intro");
    const list: Btn[] = [
      { id: "btn-play", text: p.tutorialDone ? tr("Play") : tr("Play (starts with a quick lesson)"), style: ["btn", "btn-primary", "btn-menu"], act: play },
      { id: "btn-daily", text: tr("Daily challenge"), badge: today(), style: ["btn", "btn-menu"], act: startDaily },
      { id: "btn-journey", text: tr("Journey"), badge: tr("stage {n} / {total}", { n: Math.min(p.journeyUnlocked + 1, C.JOURNEY_COUNT), total: C.JOURNEY_COUNT }), style: ["btn", "btn-menu"], act: () => show("journey", "stage-0") },
      { id: "btn-practice", text: tr("Practice"), style: ["btn", "btn-menu"], act: () => show("practice", "btn-practice-go") },
      { id: "btn-challenge", text: tr("Challenge"), style: ["btn", "btn-menu"], act: () => show("challenge", "ch-speed") },
      { id: "btn-scores", text: tr("Score chase"), style: ["btn", "btn-menu"], act: showScores },
    ];
    if (p.tutorialDone) list.push({ id: "btn-learn", text: tr("Replay lesson"), style: ["btn", "btn-menu"], act: startLearn });
    // the top bar's Help and Settings sit behind this modal menu: offered here too
    list.push({ id: "btn-title-help", text: tr("Help"), style: ["btn", "btn-menu"], act: () => openSub("help") });
    list.push({ id: "btn-title-settings", text: tr("Settings"), style: ["btn", "btn-menu"], act: () => openSub("settings") });
    if (platform.signedIn() && platform.inviteLink()) list.push({ id: "btn-invite", text: pt("invite"), style: ["btn", "btn-menu"], act: copyInvite });
    if (!platform.signedIn()) list.push({ id: "btn-signin", text: pt("signIn"), style: ["btn", "btn-menu"], act: signIn });
    ui.column("title-menu", () => { for (const b of list) button(b, w); }, { spacing: L.shortLand ? 6 : 9, padding: { top: 6 } });
    heading("h3", tr("Achievements"), w, "title-ach");
    badges("title-badges", Object.keys(ACHIEVEMENTS).map((k) => {
      const got = !!p.achievements[k];
      return { text: (got ? "✓ " : "") + tr(ACHIEVEMENTS[k]!.name), on: got, tip: tr(ACHIEVEMENTS[k]!.desc) };
    }), w);
  }, null, undefined, "overlay-keyart");
}
function modesDialog(L: Layout): void {
  dialogFrame(tr("Mode select"), L, 560, (w) => {
    heading("h2", tr("Choose a mode"), w);
    ui.column("modes-menu", () => {
      button({ id: "btn-mode-journey", text: tr("Journey — authored stages, growing difficulty"), style: ["btn", "btn-primary", "btn-menu"], act: () => show("journey", "stage-0") }, w);
      button({ id: "btn-mode-daily", text: tr("Daily — one shared seed per UTC day"), style: ["btn", "btn-menu"], act: startDaily }, w);
      button({ id: "btn-mode-practice", text: tr("Practice — unrated, undo allowed"), style: ["btn", "btn-menu"], act: () => show("practice", "btn-practice-go") }, w);
      button({ id: "btn-mode-challenge", text: tr("Challenge — move limits and speed targets"), style: ["btn", "btn-menu"], act: () => show("challenge", "ch-speed") }, w);
      button({ id: "btn-mode-back", text: tr("Back"), style: ["btn", "btn-menu"], act: toTitle }, w);
    }, { spacing: 9 });
  }, toTitle);
}
function journeyDialog(L: Layout): void {
  const p = progress();
  dialogFrame(tr("Journey stages"), L, 560, (w) => {
    heading("h2", tr("Journey"), w);
    para(tr("Ranked stages. New concepts appear one at a time, then combine. Mastery stages every fifth."), w);
    const gap = 8;
    const minW = 118;
    const cols = Math.max(2, Math.min(4, Math.floor((w + gap) / (minW + gap))));
    const cw = (w - gap * (cols - 1)) / cols;
    ui.grid("journey-grid", () => {
      for (let i = 0; i < C.JOURNEY_COUNT; i++) {
        const open = i <= p.journeyUnlocked;
        const best = p.bestScores["journey-" + (i + 1)];
        const text = tr("Stage {n}", { n: i + 1 }) + (open ? "" : " 🔒");
        button({ id: `stage-${i}`, text, badge: best ? String(best.score) : undefined, disabled: !open, act: () => startJourney(i) }, cw);
      }
    }, { columns: cols, gap });
  }, () => show("modes", "btn-mode-journey"), (w) => flow("journey-foot", [{ id: "btn-journey-back", text: tr("Back"), act: () => show("modes", "btn-mode-journey") }], w));
}
function practiceDialog(L: Layout): void {
  dialogFrame(tr("Practice setup"), L, 560, (w) => {
    heading("h2", tr("Practice"), w);
    para(tr("Unrated. Undo is allowed, timers are relaxed, and ratings are unaffected."), w);
    ui.row("pf-diff-row", () => {
      para(tr("Difficulty"), w * 0.45, "body");
      ui.spacer();
      const next = ui.id("pf-diff").select(tr("Difficulty"), app.practiceDiff, [tr("Easy"), tr("Medium"), tr("Hard")]);
      if (next !== app.practiceDiff) app.practiceDiff = next;
    }, { width: w, align: "center" });
    ui.row("pf-seed-row", () => {
      para(tr("Seed (inspectable)"), w * 0.45, "body");
      ui.spacer();
      const v = ui.textField("pf-seed", app.practiceSeed, { maxChars: 9, width: 150 });
      const digits = v.replace(/\D/g, "").slice(0, 9);
      if (digits !== app.practiceSeed) app.practiceSeed = digits;
      if (ui.submitted("pf-seed")) startPractice();
    }, { width: w, align: "center" });
  }, () => show("modes", "btn-mode-practice"), (w) => flow("pf-foot", [
    { id: "btn-practice-go", text: tr("Start practice"), style: ["btn", "btn-primary"], act: startPractice },
    { id: "btn-practice-back", text: tr("Back"), act: () => show("modes", "btn-mode-practice") },
  ], w));
}
function challengeDialog(L: Layout): void {
  dialogFrame(tr("Challenge setup"), L, 560, (w) => {
    heading("h2", tr("Challenge"), w);
    para(tr("Constrained goals. No undo."), w);
    ui.column("ch-menu", () => {
      button({ id: "ch-speed", text: tr("Speed nook — 90 seconds, 8 objects"), style: ["btn", "btn-menu"], act: () => startChallenge("speed") }, w);
      button({ id: "ch-moves", text: tr("Economy — only 14 taps for 10 objects"), style: ["btn", "btn-menu"], act: () => startChallenge("moves") }, w);
      button({ id: "ch-crowded", text: tr("Crowded shelf — 14 objects, heavy decoys"), style: ["btn", "btn-menu"], act: () => startChallenge("crowded") }, w);
      button({ id: "ch-back", text: tr("Back"), style: ["btn", "btn-menu"], act: () => show("modes", "btn-mode-challenge") }, w);
    }, { spacing: 9 });
  }, () => show("modes", "btn-mode-challenge"));
}
function setupDialog(L: Layout): void {
  const lv = level;
  if (!lv) { toTitle(); return; }
  const m = currentMode();
  dialogFrame(tr("Round setup"), L, 560, (w) => {
    heading("h2", tr(modeName(m)), w, "setup-title");
    ui.column("setup-rules", () => rulesLines(lv, m).forEach((t, i) => para(t, w, "body", `setup-rule-${i}`)), { spacing: 3 });
    para(tr("Seed {seed} · content v{version} · theme {theme}", { seed: lv.seed.toString(36), version: lv.contentVersion, theme: "@t:" + themeName(lv.theme) }), w, "note", "setup-seed");
  }, toTitle, (w) => flow("setup-foot", [
    { id: "btn-begin", text: tr("Begin"), style: ["btn", "btn-primary"], act: begin },
    { id: "btn-setup-back", text: tr("Back"), act: toTitle },
  ], w));
}
function errorDialog(L: Layout): void {
  dialogFrame(tr("Content error"), L, 560, (w) => {
    heading("h2", tr("Content error"), w);
    para(tr("This stage failed validation: {errors}", { errors: app.setupError }), w);
  }, toTitle, (w) => flow("error-foot", [{ id: "btn-error-back", text: tr("Back"), act: toTitle }], w));
}
function countdownDialog(L: Layout): void {
  dialogFrame(tr("Countdown"), L, 240, (w) => {
    ui.column("countdown-col", () => ui.style("countdown").id("countdown").label(app.countdownText), { width: w, align: "center" });
  }, null);
}
function pauseDialog(L: Layout): void {
  dialogFrame(tr("Paused"), L, 420, (w) => {
    heading("h2", tr("Paused"), w, "pause-title");
    para(tr("The clock is stopped."), w, "note");
    if (app.pauseNote) para(tr("Paused automatically while the tab was hidden. The clock stopped — nothing happened while you were away."), w, "note", "pause-note");
    ui.column("pause-menu", () => {
      button({ id: "btn-resume", text: tr("Resume"), style: ["btn", "btn-primary", "btn-menu"], act: resume }, w);
      button({ id: "btn-pause-settings", text: tr("Settings"), style: ["btn", "btn-menu"], act: () => openSub("settings") }, w);
      button({ id: "btn-pause-help", text: tr("Help"), style: ["btn", "btn-menu"], act: () => openSub("help") }, w);
      button({ id: "btn-leave", text: tr("Leave round"), style: ["btn", "btn-danger", "btn-menu"], act: leaveRound }, w);
    }, { spacing: 9 });
  }, resume);
}
function section(id: string, title: string, w: number, build: () => void): void {
  ui.column(id, () => { heading("h3", title, w); build(); }, { width: w, spacing: 6 });
}
function settingsDialog(L: Layout): void {
  dialogFrame(tr("Settings"), L, 560, (w) => {
    heading("h2", tr("Settings"), w);
    section("set-audio", tr("Audio"), w, () => {
      para(tr("Music, effects and interface volumes and mute are set in the StarHermit Options (F1)."), w, "note");
      button({ id: "btn-options", text: tr("Open Options"), act: () => openMenu() });
    });
    section("set-graphics", tr("Graphics"), w, () => {
      para(tr("Graphics quality, render scale and the frame rate are set in the StarHermit Options (F1)."), w, "note");
    });
    section("set-a11y", tr("Accessibility"), w, () => {
      const next = ui.id("set-haptics").checkbox(tr("Haptics"), platform.settings.haptics);
      if (next !== platform.settings.haptics) platform.setHaptics(next);
      para(tr("Reduced motion, high contrast, text size and the language are set in the StarHermit Options (F1)."), w, "note");
    });
    section("set-controls", tr("Controls"), w, () => {
      button({ id: "btn-rebind", text: tr("Change keys and buttons"), act: () => requestRebind() });
    });
  }, closeSub, (w) => flow("settings-foot", [{ id: "btn-settings-done", text: tr("Done"), style: ["btn", "btn-primary"], act: closeSub }], w));
}
function helpDialog(L: Layout): void {
  dialogFrame(tr("Help"), L, 600, (w) => {
    heading("h2", tr("How to play"), w);
    para(tr("Inspect the miniature room. The request strip on the left names the objects to find. Select each one in the scene to mark it found; finishing the strip reveals the next set."), w);
    heading("h3", tr("Controls"), w);
    const k = (a: string): string => bindingLabel(a, "keyboard");
    const g = (a: string): string => bindingLabel(a, "gamepad");
    const rows: [string, string][] = [
      [tr("Drag / one finger"), tr("look around")],
      [tr("Wheel / pinch"), tr("zoom")],
      [tr("Tap / click"), tr("select an object")],
      [k("prev") + " · " + k("next"), tr("move between objects")],
      [k("select"), tr("select focused object")],
      [k("hint"), tr("hint")],
      [k("undo"), tr("undo (practice)")],
      [k("reset_view"), tr("reset view")],
      [k("pause"), tr("pause")],
      [tr("Gamepad") + " " + [g("next"), g("select"), g("pause"), g("hint")].filter(Boolean).join(" / "), tr("stick moves focus, A selects, B pauses, Y hints")],
    ];
    const kw = Math.min(210, w * 0.42);
    rows.forEach(([a, b], i) => ui.row(`bind-${i}`, () => {
      ui.column(`bind-${i}-k`, () => para(a, kw - 20, "badge-text"), { style: "badge", width: kw });
      para(b, w - kw - 12, "body");
    }, { spacing: 12, width: w, align: "center" }));
    heading("h3", tr("Rules"), w);
    para(tr("Only objects named in the strip count. Wrong taps cost {wrong} points; hints cost {hint}. Finishing quickly (under par {par}) adds a time bonus. Ties break on completion, then fewer wrong taps, then faster time.", {
      wrong: R.SCORE.INVALID_PENALTY, hint: R.SCORE.HINT_COST, par: level ? fmtTime(level.parSeconds * 1000) : "—",
    }), w);
  }, closeSub, (w) => flow("help-foot", [{ id: "btn-help-done", text: tr("Done"), style: ["btn", "btn-primary"], act: closeSub }], w));
}
function resultsDialog(L: Layout): void {
  const r = app.results;
  if (!r) { toTitle(); return; }
  const bd = r.bd;
  dialogFrame(tr("Results"), L, 560, (w) => {
    heading("h2", tr(r.headline), w, "results-headline");
    const rows: [string, string][] = [
      [tr("Objects found ({n})", { n: bd.found }), "+" + bd.items],
      [tr("Request strips cleared"), "+" + bd.waves],
      [tr("Time bonus"), "+" + bd.time],
      [tr("Wrong taps ({n})", { n: r.invalids }), "−" + bd.invalidPenalty],
      [tr("Hints used ({n})", { n: r.hintsUsed }), "−" + bd.hintCost],
    ];
    if (bd.undoCost) rows.push([tr("Undos"), "−" + bd.undoCost]);
    ui.column("score-table", () => {
      rows.forEach(([a, b], i) => ui.row(`score-${i}`, () => { para(a, w - 90, "score-cell"); ui.spacer(); ui.style("score-cell").label(b); }, { style: "score-row", width: w, align: "center" }));
      ui.row("score-total", () => { ui.style("score-total").label(tr("Total")); ui.spacer(); ui.style("score-total").id("results-total").label(String(bd.total)); }, { style: "score-total-row", width: w, align: "center" });
    }, { width: w, spacing: 0 });
    para(tr("Time {time} · seed {seed} · {n} left unfound", { time: fmtTime(r.elapsedMs), seed: r.seed.toString(36), n: bd.remaining }), w, "note", "results-sub");
    if (r.mode === "daily") para(tr("Daily score saved to your progress."), w);
    if (app.lb) para(app.lb.state === "lbRank" ? pt("lbRank", { rank: app.lb.rank ?? "" }) : pt(app.lb.state), w, "body", "results-lb");
    if (r.newAch.length) {
      para(tr("Achievement unlocked:"), w);
      badges("results-ach", r.newAch.map((n) => ({ text: "✓ " + tr(n), on: true })), w);
    }
  }, null, (w) => {
    const btns: Btn[] = [{ id: "btn-retry", text: tr("Retry"), style: ["btn", "btn-primary"], act: retry }];
    if (r.canNext) btns.push({ id: "btn-next", text: tr("Next stage"), act: nextStage });
    if (r.mode === "daily") btns.push({ id: "btn-board", text: tr("Leaderboard"), act: showScores });
    btns.push({ id: "btn-menu", text: tr("Menu"), act: toProgression });
    flow("results-foot", btns, w);
  });
}
function progressionDialog(L: Layout): void {
  const p = progress();
  dialogFrame(tr("Progression"), L, 560, (w) => {
    heading("h2", tr("Progress"), w);
    const next = p.journeyUnlocked < C.JOURNEY_COUNT ? tr("Next journey stage: {n}.", { n: p.journeyUnlocked + 1 }) : tr("Journey complete — mastery track finished!");
    para(next + " " + tr("Objects found all-time: {n}. Daily streak: {days} day(s).", { n: p.foundTotal, days: p.dailyStreak.count }), w, "body", "progress-text");
  }, toTitle, (w) => flow("progress-foot", [{ id: "btn-back-title", text: tr("Back to title"), style: ["btn", "btn-primary"], act: toTitle }], w));
}
function scoresDialog(L: Layout): void {
  const b = app.board;
  dialogFrame(tr("Leaderboard"), L, 560, (w) => {
    heading("h2", tr("Score chase"), w);
    if (!b) return;
    if (b.note) para(tr(b.note), w, "note", "scores-note");
    if (b.loading) { para(tr("Loading…"), w, "note"); return; }
    const c1 = 44, c3 = 80, c2 = w - c1 - c3 - 16;
    const row = (id: string, a: string, n: string, s: string, cls: string): void => { ui.row(id, () => {
      ui.column(`${id}-a`, () => ui.style(cls).label(a), { width: c1 });
      ui.column(`${id}-n`, () => para(n, c2, cls), { width: c2 });
      ui.column(`${id}-s`, () => ui.style(cls).label(s), { width: c3, align: "end" });
    }, { style: "score-row", width: w, spacing: 8, align: "center" }); };
    row("board-head", "#", tr(b.who), tr("Score"), "board-head");
    if (!b.rows.length) para(platform.signedIn() ? tr("No entries yet.") : tr("No local scores yet."), w, "body", "scores-empty");
    b.rows.forEach((e, i) => row(`board-${i}`, e.rank, e.name, String(e.score), e.you ? "board-you" : "board-cell"));
  }, () => (app.phase === "results" ? show("results", "btn-retry") : toTitle()), (w) => flow("scores-foot", [
    { id: "btn-scores-back", text: tr("Back"), act: () => (app.phase === "results" ? show("results", "btn-retry") : toTitle()) },
  ], w));
}

// ------------------------------------------------------------------ the toast
function toastView(L: Layout): void {
  const t = app.toast;
  if (!t) return;
  const w = Math.min(L.lw - 32, 520);
  const text = t.text();
  ui.place("toast", { anchor: "bottom", y: 16 }, () => {
    if (textWidth(text, "toast") + 34 <= w) ui.style("toast").id("toast").label(text);
    else ui.style("toast").id("toast").paragraph(text, w - 34);
  }, { align: "center", width: w });
}

