/* Hidden Nook — object names in each language's word order (classic script,
 * global HNI18N): js/names.js holds the vocabulary (nouns with gender, adjective
 * forms). The string tables are the engine's (assets/strings.json); the engine
 * client (native/i18n.ts) calls setLocale with the locale they are in. Loaded with
 * loadClassic natively and through vm in the Node tests.
 */
(function (root) {
  'use strict';

  var LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  var PARENT = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
  var lang = 'en-US';

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
    objectName: objectName, kindName: kindName, setLocale: setLocale,
    get lang() { return lang; },
    locales: LOCALES,
    get names() { return root.HN_NAMES || {}; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
