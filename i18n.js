// Hidden Nook - localization runtime (classic script, window.HNI18N).
//
// Nine locales: en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.
// English source strings are the keys; strings.js holds the tables (en-GB,
// es-ES and fr-CA carry only their differences from en-US, es-419 and fr-FR)
// plus the object vocabulary (nouns with gender, adjective forms) used to name
// the scene's objects. The locale comes from the game's Language setting
// through sh-language.js (explicit choice -> StarHermit account preference ->
// navigator.languages -> en-US); ?lang= forces one for the page load (QA links).
//
// Markup is translated in place: static text in index.html (text nodes and
// aria-label/title whose English text is a key) and every element carrying
// data-i18n="key" (optional data-i18n-vars JSON; data-i18n-aria / -title for
// attributes). Overlay templates emit such elements through h(), so a language
// change re-renders open screens without rebuilding them. `hn-language` fires
// on document after every change.
(function (root) {
  'use strict';

  const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  const PARENT = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
  const TABLES = root.HN_STRINGS || {};
  const NAMES = root.HN_NAMES || {};
  const hasOwn = Object.prototype.hasOwnProperty;
  let lang = 'en-US';

  function lookup(key) {
    for (let l = lang; l; l = PARENT[l]) {
      const t = TABLES[l];
      if (t && hasOwn.call(t, key)) return t[key];
    }
    return key;
  }
  // Var values: '@obj:<English object name>' and '@t:<key>' render translated.
  function value(v) {
    const s = String(v);
    if (s.startsWith('@obj:')) return objectName(s.slice(5));
    if (s.startsWith('@kind:')) return kindName(s.slice(6));
    if (s.startsWith('@t:')) return T(s.slice(3));
    return s;
  }
  /** Translate an English source string; {name} placeholders come from vars. */
  function T(key, vars) {
    let s = lookup(String(key));
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (hasOwn.call(vars, k) ? value(vars[k]) : m));
    return s;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  /** Translated text as an element that follows later language changes (for innerHTML templates). */
  function h(key, vars, tag) {
    const t = tag || 'span';
    const v = vars ? ` data-i18n-vars="${esc(JSON.stringify(vars))}"` : '';
    return `<${t} data-i18n="${esc(key)}"${v}>${esc(T(key, vars))}</${t}>`;
  }
  /** Attribute markup that follows language changes: attr('aria-label', key, vars). */
  function attr(name, key, vars) {
    const v = vars ? ` data-i18n-vars="${esc(JSON.stringify(vars))}"` : '';
    const slot = name === 'aria-label' ? 'aria' : name;
    return `${name}="${esc(T(key, vars))}" data-i18n-${slot}="${esc(key)}"${v}`;
  }

  // ---- object names: "<adjective> <noun>" in each language's word order ----
  function vocab() {
    for (let l = lang; l; l = PARENT[l]) if (NAMES[l]) return NAMES[l];
    return null;
  }
  /** The scene object's display name, e.g. "brass mug" → "taza de latón". */
  function objectName(english) {
    const v = vocab();
    const name = String(english);
    if (!v) return name;
    const adj = Object.keys(v.adj).sort((a, b) => b.length - a.length).find((a) => name.startsWith(a + ' '));
    if (!adj) return name;
    const noun = v.noun[name.slice(adj.length + 1)];
    if (!noun) return name;
    const [word, gender] = noun;
    const forms = v.adj[adj];
    const a = typeof forms === 'string' ? forms : (forms[gender] || forms.m);
    return v.order === 'adj-noun' ? a + ' ' + word : word + ' ' + a;
  }
  /** Localized object kind (the shape tag): the noun of the kind's label. */
  function kindName(kind) {
    const label = (root.HNContent && root.HNContent.OBJECT_DEFS || []).find((d) => d.kind === kind);
    const v = vocab();
    if (!label || !v || !v.noun[label.label]) return label ? label.label : kind;
    return v.noun[label.label][0];
  }

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  // ---- static markup + data-i18n elements ----------------------------------
  const texts = [];
  const attrs = [];
  let scanned = false;
  function scan() {
    if (scanned || !document.body) return;
    scanned = true;
    const skip = (el) => { for (let n = el; n && n !== document.body; n = n.parentNode) if (n.nodeType === 1 && (n.hasAttribute('data-i18n-skip') || n.id === 'overlay-root' || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.tagName))) return true; return false; };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const key = norm(node.nodeValue);
      if (!/[A-Za-z]/.test(key) || skip(node.parentNode) || !hasOwn.call(TABLES['es-419'] || {}, key)) continue;
      const m = /^(\s*)[\s\S]*?(\s*)$/.exec(node.nodeValue);
      texts.push({ node, key, pre: m[1], post: m[2], last: node.nodeValue });
    }
    for (const el of document.body.querySelectorAll('[aria-label],[title]')) {
      if (skip(el)) continue;
      for (const a of ['aria-label', 'title']) {
        const v = el.getAttribute(a);
        if (v && /[A-Za-z]/.test(v) && hasOwn.call(TABLES['es-419'] || {}, norm(v))) attrs.push({ el, attr: a, key: norm(v), last: v });
      }
    }
  }
  function varsOf(el) {
    const raw = el.getAttribute('data-i18n-vars');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  /** Re-apply the current language to static markup and every data-i18n element. */
  function applyAll() {
    if (typeof document === 'undefined' || !document.body) return;
    scan();
    for (const t of texts) {
      if (!t.node.parentNode || t.node.nodeValue !== t.last) continue;
      t.last = t.node.nodeValue = t.pre + T(t.key) + t.post;
    }
    for (const a of attrs) {
      if (a.el.getAttribute(a.attr) !== a.last) continue;
      a.last = T(a.key);
      a.el.setAttribute(a.attr, a.last);
    }
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = T(el.getAttribute('data-i18n'), varsOf(el));
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', T(el.getAttribute('data-i18n-aria'), varsOf(el)));
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', T(el.getAttribute('data-i18n-title'), varsOf(el)));
  }

  function setLocale(next) {
    lang = LOCALES.indexOf(next) >= 0 ? next : 'en-US';
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang;
    applyAll();
    document.dispatchEvent(new CustomEvent('hn-language', { detail: { lang } }));
  }

  let forced = null;
  try { forced = new URLSearchParams(root.location.search).get('lang'); } catch (e) { /* opaque origin */ }
  const SL = root.StarHermitLanguage;
  const forcedLocale = forced && SL ? SL.match(forced, LOCALES) : null;
  const language = SL ? SL.create({
    game: 'hidden-nook', supported: LOCALES, panel: !forcedLocale,
    apply: (locale) => setLocale(forcedLocale || locale),
  }) : null;
  if (!language) setLocale('en-US');
  if (typeof document !== 'undefined' && !document.body) document.addEventListener('DOMContentLoaded', applyAll);

  root.HNI18N = {
    T, h, attr, esc, objectName, kindName, applyAll,
    get lang() { return lang; },
    locales: LOCALES, language, tables: TABLES, names: NAMES,
  };
})(typeof self !== 'undefined' ? self : this);
