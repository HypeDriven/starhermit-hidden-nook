// The game's data and the StarHermit platform, on the runtime's modules:
// - progress (journey unlocks, best scores per level, achievements, the
//   all-time found count, the daily streak, the lesson) is the game's save
//   (starhermit:storage `saves`): the browser build's checksummed progress
//   document (js/progress.js) on the device and in the player's cloud slot,
//   two devices' copies merged on a conflict (furthest journey, better best
//   per level, union of achievements, …). The slot the browser build wrote
//   (the JS SDK's zipped save.json holding the same document, key
//   game:<slug>) shows as foreign and is merged in and replaced once;
// - the game's own setting (haptics) is `settings` (game.haptics, synced
//   with the account); the browser build's per-player settings are
//   migrated (haptics), then removed. Volumes, mute, graphics, reduced
//   motion, high contrast, text size, language and key bindings are the
//   runtime's Options;
// - the player's name, the invite link, the high-score board's rows,
//   posting a finished round's total through score-script.js (a practice
//   session whose socket carries { type: 'result', scores }, as the JS SDK's
//   submitScores did; score-script.js range-checks it and writes the board),
//   and the platform's clock for the daily's date.
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, profile, serverNow, serverTime, sessions,
} from "starhermit:platform";
import { saves, settings as store, storage } from "starhermit:storage";
import { Progress as P, type Doc } from "./classic.ts";
import { tr } from "./i18n.ts";

// --- the save ------------------------------------------------------------------------------
let doc: Doc = P.fresh();
let lastSavedAt = 0;
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onProgressMerged(fn: () => void): void { mergedListeners.add(fn); }
function merged(): void { for (const fn of mergedListeners) fn(); }

export function getDoc(): Doc { return doc; }
/** Stamps and writes the save (device at once, the account debounced by the runtime). */
export function persist(): void {
  doc.updatedAt = nowMs();
  P.seal(doc);
  try { saves.save(doc as unknown as JsonValue, { schema: 2 }); }
  catch (e) { console.warn(`save: ${String(e)}`); }
}

/** Takes another document's progress in (merged with this device's); whether it changed. */
function adopt(other: Doc | null): boolean {
  if (!other) return false;
  const next = P.merge(doc, other);
  if (P.sameProgress(next, doc)) return false;
  doc = next;
  return true;
}

saves.onConflict((local, remote) => {
  const a = P.docFromSave(local?.data), b = P.docFromSave(remote.data);
  return { merged: P.merge(a, b) as unknown as JsonValue };
});
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  // The account's save replaced the device's (another device saved last): merge it in.
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(P.docFromSave(cur.data))) { persist(); merged(); }
  }
});

/** The browser build's cloud save: merged with this device's progress, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const changed = adopt(P.fromBrowserSave(old.text));
  P.seal(doc);
  try { saves.save(doc as unknown as JsonValue, { schema: 2, replaceForeign: true }); }
  catch (e) { console.warn(`save migration: ${String(e)}`); }
  if (changed) merged();
}
export function flush(): void { void saves.flush().catch(() => undefined); }
/** The cloud save's state for the sync line under the status line. */
export function syncState(): "offline" | "saving" | "synced" {
  if (!player()) return "offline";
  try {
    const st = saves.state();
    if (st === "error" || st === "read-blocked") return "offline";
    if (st === "loading" || st === "uploading" || st === "foreign" || saves.status() === "pending") return "saving";
    return "synced";
  } catch { return "offline"; }
}

// --- the game's settings -------------------------------------------------------------------
export const settings = { haptics: true };
const GAME_KEYS = ["haptics"] as const;
/** The browser build's per-player settings keys (hn-settings-v1 mirrored by patchSettings, and game-options.js's). */
const BROWSER_KEYS = new Set(["music", "sfx", "ambience", "reducedMotion", "highContrast", "largeText", "leftHanded", "holdToPan",
  "haptics", "graphics", "cameraPreset", "quality", "audio.options", "ui.language"]);
function readSettings(): void {
  try { const v = store.get("haptics"); if (typeof v === "boolean") settings.haptics = v; } catch { /* default */ }
}
export function setHaptics(on: boolean): void {
  settings.haptics = on;
  try { store.set("haptics", on); } catch (e) { console.warn(`setting haptics: ${String(e)}`); }
}
// Haptics carries over (unless this game set it since); every browser key is then removed.
function importLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  for (const key of keys) {
    if (!BROWSER_KEYS.has(key) && !key.startsWith("graphics.")) continue;
    if (key === "haptics") {
      const v = store.legacy(key);
      if (typeof v === "boolean" && store.get("haptics") === undefined) setHaptics(v);
    }
    try { store.removeLegacy(key); } catch { /* next start */ }
  }
}

/** Reads the device's save and the game's settings (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  const d = P.docFromSave(cur?.data);
  if (d) doc = d;
  readSettings();
  store.onChange((key) => { if ((GAME_KEYS as readonly string[]).includes(key)) readSettings(); });
  store.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  refreshPlayer();
  void serverTime().catch(() => undefined);
}

// --- the player ----------------------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
  void highScoreBoard().catch(() => null);
}
onPlayerChange(() => refreshPlayer());

/** Now in ms by the platform's clock when it has answered, else the device's. */
export function nowMs(): number { return serverNow() ?? Date.now(); }
/** Whether the platform's clock has answered (the daily is then the platform's day). */
export function serverClock(): boolean { return serverNow() != null; }

// --- the StarHermit leaderboards -----------------------------------------------------------
const BOARD_KEY = "hiddennook.board-id";
let boardId: string | null = null;
/** The high-score board's id: listed signed in, then kept on the device so a guest can read it. */
async function highScoreBoard(): Promise<string | null> {
  if (boardId) return boardId;
  if (player()) {
    try {
      const list = await leaderboards.list();
      const b = list.find((x) => x.key === "high-score") ?? list[0];
      if (b) { boardId = b.id; try { storage.set(BOARD_KEY, b.id); } catch { /* full */ } }
    } catch { /* offline */ }
  }
  if (!boardId) { try { boardId = storage.getText(BOARD_KEY); } catch { boardId = null; } }
  return boardId;
}
export interface BoardRow { rank: number; name: string; score: number; mine: boolean }
/** The high-score board's top 50 (names from the players' profiles); ok false when it cannot be read. */
export async function fetchLeaderboard(): Promise<{ ok: boolean; entries: BoardRow[] }> {
  const me = player();
  try {
    const id = await highScoreBoard();
    if (!id) return { ok: false, entries: [] };
    const page = await leaderboards.entries(id, { pageSize: 50 });
    const entries = await Promise.all(page.items.map(async (e, i) => {
      let name = e.username || tr("Player {id}", { id: e.userId.slice(0, 6) });
      if (me && e.userId === me.userId) name = me.displayName || name;
      else { try { name = (await profile(e.userId)).displayName; } catch { /* the username */ } }
      return { rank: e.rank ?? i + 1, name, score: Math.floor(Number(e.score) || 0), mine: !!me && e.userId === me.userId };
    }));
    return { ok: true, entries };
  } catch { return { ok: false, entries: [] }; }
}

/** Signed in only: post a finished round's total through score-script.js; { posted, rank }. Never rejects. */
export async function postLeaderboard(total: number): Promise<{ posted: boolean; rank: number | null }> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const id = await highScoreBoard();
    if (!id) return { posted: true, rank: null };
    const r = await leaderboards.entries(id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
