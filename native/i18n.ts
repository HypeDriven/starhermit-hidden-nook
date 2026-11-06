// Localization: the engine's string tables (assets/strings.json, generated from
// the browser build's tables: nine locales, English text as the key) in the
// interface language the runtime reports (the player's choice in Options ›
// Language, else the account's preferred language or the device's). The
// runtime's Options replaced the game's own Language setting (sh-language.js).
// Object names are composed in each language's word order (js/i18n.js,
// js/names.js). The account lines are the engine's `starhermit.*` keys.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { I18n } from "./classic.ts";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
function apply(locale: string): void {
  I18n.setLocale(locale);
  ui.setLanguage(locale);
}
apply(strings.locale);
strings.onChange(apply);

/** fn() after the interface language changed. */
export function onLocaleChange(fn: () => void): void { strings.onChange(() => fn()); }

export type Vars = Record<string, string | number>;
/** Var values: '@obj:<English object name>', '@kind:<kind>' and '@t:<key>' render translated. */
function value(v: string | number): string {
  const s = String(v);
  if (s.startsWith("@obj:")) return I18n.objectName(s.slice(5));
  if (s.startsWith("@kind:")) return I18n.kindName(s.slice(6));
  if (s.startsWith("@t:")) return tr(s.slice(3));
  return s;
}
/** A game string by its English key in the player's language; `{name}` placeholders from vars
 * ('@obj:', '@kind:' and '@t:' values render translated). Text with no entry passes through. */
export function tr(key: string, vars?: Vars | null): string {
  const filled = vars ? Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, value(v)])) : undefined;
  if (strings.has(key)) return strings.t(key, filled);
  return key.replace(/\{(\w+)\}/g, (m, k: string) => filled?.[k] ?? m);
}
/** Marks an English key translated with tr() where it is shown. */
export const K = (s: string): string => s;
/** A scene object's name ("brass mug") in the player's language. */
export function objName(english: string): string { return I18n.objectName(english); }
/** An object kind's noun (the shape tag). */
export function kindName(kind: string): string { return I18n.kindName(kind); }

export type PlatformKey = "signIn" | "invite" | "inviteCopied" | "inviteLink" | "signedOut" | "leaderboardPosting" | "leaderboardRank" | "leaderboardPosted" | "leaderboardNotPosted";
/** An account line (the engine's `starhermit.*` strings) in the player's language. */
export function pt(key: PlatformKey, vars?: Vars): string { return strings.t(`starhermit.${key}`, vars); }
