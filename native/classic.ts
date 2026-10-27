// The browser build's pure game scripts, shared with the Node tests and the
// replay-validating server.js: the rules (sessions, legality, scoring,
// replays), the content (themes, anchors, procedural levels, the lesson,
// validators), the progress document, the string tables and the account
// lines (js/*.js, UMD), evaluated as classic scripts so their globals are
// this module's exports.
import { loadClassic } from "starhermit:script";

for (const f of ["js/rules.js", "js/content.js", "js/progress.js", "js/strings.js", "js/i18n.js", "js/platform-strings.js"]) loadClassic(f);

// -- The shapes this client reads -------------------------------------------------
export interface Item {
  id: string; name: string; kind: string; color: number; requested: boolean;
  pos: [number, number, number]; rotY: number; scale: number; bobPhase: number;
}
export interface Level {
  id: string; contentVersion: number; index: number; seed: number; items: Item[]; waves: number[][];
  parSeconds: number; timeLimitSeconds: number | null; moveLimit: number | null; allowUndo: boolean; allowHints: boolean;
  theme: string; tutorial: boolean; dailyDay?: string;
}
export interface SessionItem { id: string; name: string; requested: boolean; found: boolean; hinted: boolean }
export interface State {
  v: number; levelId: string; contentVersion: number; mode: string; seed: number; tick: number;
  items: SessionItem[]; waves: number[][]; wave: number; score: number; invalids: number; hintsUsed: number;
  undoCount?: number; undoUsed: boolean; elapsedMs: number; moveLimit: number | null; timeLimitMs: number | null;
  parMs: number; allowUndo: boolean; allowHints: boolean; status: "active" | "complete"; reason: string | null;
}
export interface Cmd { type: string; index?: number; dtMs?: number; id?: string }
export interface Ev { type: string; index?: number; name?: string; reason?: string; wave?: number }
export interface Applied { state: State; events: Ev[]; error: string | null }
export interface Breakdown { items: number; waves: number; time: number; invalidPenalty: number; hintCost: number; undoCost: number; total: number; found: number; remaining: number }
export interface Result { score: number; reason: string; invalids: number; elapsedMs: number; sessionId: string }
export interface Theme { id: string; name: string; wall: number; floor: number; key: number; fill: number; ambient: number; fog: number }
export interface TutorialStep { id: string; text: string; action: string }
export interface Doc {
  v: number; updatedAt: number; journeyUnlocked: number; bestScores: Record<string, Result>;
  achievements: Record<string, number>; foundTotal: number; dailyStreak: { last: string | null; count: number };
  tutorialDone: boolean; checksum: string;
}

interface RulesApi {
  SCORE: { PER_ITEM: number; WAVE_CLEAR: number; INVALID_PENALTY: number; HINT_COST: number; UNDO_COST: number };
  mulberry32(seed: number): () => number;
  hashString(s: string): number;
  createSession(level: Level, opts: { mode: string }): State;
  legalActions(s: State): { type: string; index?: number; requested?: boolean }[];
  currentWaveSet(s: State): Set<number>;
  applyCommand(s: State, cmd: Cmd): Applied;
  isTerminal(s: State): boolean;
  scoreBreakdown(s: State): Breakdown;
  compareResults(a: Result, b: Result): number;
}
interface ContentApi {
  THEMES: Theme[]; JOURNEY_COUNT: number; TUTORIAL_STEPS: TutorialStep[];
  journeyLevel(i: number): Level;
  dailyLevel(day: string): Level;
  practiceLevel(diff: string, seed: number): Level;
  challengeLevel(kind: string, seed: number): Level;
  tutorialLevel(): Level;
  validateLevel(l: Level): { ok: boolean; errors: string[] };
}
interface ProgressApi {
  fresh(): Doc;
  seal(d: Doc): Doc;
  docFromSave(data: unknown): Doc | null;
  fromBrowserSave(text: string | null): Doc | null;
  merge(local: Doc | null, remote: Doc | null): Doc;
  sameProgress(a: Doc, b: Doc): boolean;
}
interface I18nApi {
  T(key: string, vars?: Record<string, string | number> | null): string;
  objectName(english: string): string;
  kindName(kind: string): string;
  setLocale(tag: string): string;
  readonly lang: string;
  locales: string[];
}
interface PlatformStringsApi {
  platformStrings(lang: string): Record<string, string>;
  fmtPlatform(s: string, vars?: Record<string, string | number>): string;
}

const g = globalThis as unknown as {
  HNRules: RulesApi; HNContent: ContentApi; HNProgress: ProgressApi; HNI18N: I18nApi; PlatformStrings: PlatformStringsApi;
};
export const Rules = g.HNRules;
export const Content = g.HNContent;
export const Progress = g.HNProgress;
export const I18n = g.HNI18N;
export const PlatformStrings = g.PlatformStrings;
