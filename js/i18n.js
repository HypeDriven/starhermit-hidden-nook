/* Hidden Nook — localization runtime (classic script, global HNI18N).
 *
 * Nine locales: en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.
 * English source strings are the keys; js/strings.js holds the tables (en-GB,
 * es-ES and fr-CA carry only their differences from en-US, es-419 and fr-FR)
 * plus the object vocabulary (nouns with gender, adjective forms) used to name
 * the scene's objects in each language's word order. The engine client
 * (native/i18n.ts) picks the locale from the runtime's interface language and
 * calls setLocale; every string drawn is looked up each frame, so a change
 * shows at once. Loaded with loadClassic natively and through vm in the Node
 * tests.
 */
(function (root) {
  'use strict';

  var LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  var PARENT = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
  var hasOwn = Object.prototype.hasOwnProperty;
  var lang = 'en-US';

  function lookup(key) {
    var tables = root.HN_STRINGS || {};
    for (var l = lang; l; l = PARENT[l]) {
      var t = tables[l];
      if (t && hasOwn.call(t, key)) return t[key];
    }
    return key;
  }
  // Var values: '@obj:<English object name>', '@kind:<kind>' and '@t:<key>' render translated.
  function value(v) {
    var s = String(v);
    if (s.indexOf('@obj:') === 0) return objectName(s.slice(5));
    if (s.indexOf('@kind:') === 0) return kindName(s.slice(6));
    if (s.indexOf('@t:') === 0) return T(s.slice(3));
    return s;
  }
  /** Translate an English source string; {name} placeholders come from vars. */
  function T(key, vars) {
    var s = lookup(String(key));
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return hasOwn.call(vars, k) ? value(vars[k]) : m; });
    return s;
  }

  // ---- object names: "<adjective> <noun>" in each language's word order ----
  function vocab() {
    var names = root.HN_NAMES || {};
    for (var l = lang; l; l = PARENT[l]) if (names[l]) return names[l];
    return null;
  }
  /** The scene object's display name, e.g. "brass mug" → "taza de latón". */
  function objectName(english) {
    var v = vocab();
    var name = String(english);
    if (!v) return name;
    var adjs = Object.keys(v.adj).sort(function (a, b) { return b.length - a.length; });
    var adj = null;
    for (var i = 0; i < adjs.length; i++) if (name.indexOf(adjs[i] + ' ') === 0) { adj = adjs[i]; break; }
    if (!adj) return name;
    var noun = v.noun[name.slice(adj.length + 1)];
    if (!noun) return name;
    var word = noun[0], gender = noun[1];
    var forms = v.adj[adj];
    var a = typeof forms === 'string' ? forms : (forms[gender] || forms.m);
    return v.order === 'adj-noun' ? a + ' ' + word : word + ' ' + a;
  }
  /** Localized object kind (the shape tag): the noun of the kind's label. */
  function kindName(kind) {
    var defs = (root.HNContent && root.HNContent.OBJECT_DEFS) || [];
    var label = null;
    for (var i = 0; i < defs.length; i++) if (defs[i].kind === kind) { label = defs[i]; break; }
    var v = vocab();
    if (!label || !v || !v.noun[label.label]) return label ? label.label : kind;
    return v.noun[label.label][0];
  }

  /** Switch the locale (unknown tags fall back to en-US); returns the locale in use. */
  function setLocale(next) {
    lang = LOCALES.indexOf(next) >= 0 ? next : 'en-US';
    return lang;
  }

  root.HNI18N = {
    T: T, objectName: objectName, kindName: kindName, setLocale: setLocale,
    get lang() { return lang; },
    locales: LOCALES,
    get tables() { return root.HN_STRINGS || {}; },
    get names() { return root.HN_NAMES || {}; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
