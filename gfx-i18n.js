// Strings for the Settings → Graphics section, in every locale the game targets.
// The rest of the game is English-only today (spec §10); this panel picks its locale from
// navigator.languages, falling back region → base language → en-US.

const en = {
  graphics: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})',
  low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra',
  renderScale: 'Render scale', fromPreset: 'From preset ({tier})',
  adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  postUnavailable: 'Post-processing is unavailable on this device, so the room is drawn without it.',
  unknownGpu: 'unknown GPU',
  cat: {
    shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Glow (bloom)', grade: 'Color grade',
    antialias: 'Anti-aliasing', reflections: 'Reflections', particles: 'Dust motes', detail: 'Room detail',
  },
  tier: {
    off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Plain', detailed: 'Detailed',
  },
  words: {
    noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
    bloom: 'bloom', reflections: 'reflections', noAa: 'no anti-aliasing', motes: 'motes',
  },
};

const enGB = {
  ...en,
  cat: { ...en.cat, grade: 'Colour grade' },
};

const es = {
  graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
  low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
  renderScale: 'Escala de renderizado', fromPreset: 'Según preajuste ({tier})',
  adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
  postUnavailable: 'El posprocesado no está disponible en este dispositivo; la habitación se dibuja sin él.',
  unknownGpu: 'GPU desconocida',
  cat: {
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor (bloom)', grade: 'Corrección de color',
    antialias: 'Antialiasing', reflections: 'Reflejos', particles: 'Motas de polvo', detail: 'Detalle de la habitación',
  },
  tier: {
    off: 'No', on: 'Sí', low: 'Bajas', medium: 'Medias', high: 'Altas',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Detallado',
  },
  words: {
    noShadows: 'sin sombras', shadows: 'sombras', ao: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa',
    bloom: 'resplandor', reflections: 'reflejos', noAa: 'sin antialiasing', motes: 'motas',
  },
};

const es419 = {
  ...es,
  adaptive: 'Resolución adaptable', showFps: 'Mostrar cuadros por segundo',
  postUnavailable: 'El posprocesamiento no está disponible en este dispositivo; la habitación se dibuja sin él.',
};

const de = {
  graphics: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
  low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra',
  renderScale: 'Renderskalierung', fromPreset: 'Laut Voreinstellung ({tier})',
  adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
  postUnavailable: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar, der Raum wird ohne sie gezeichnet.',
  unknownGpu: 'unbekannte GPU',
  cat: {
    shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchten (Bloom)', grade: 'Farbkorrektur',
    antialias: 'Kantenglättung', reflections: 'Spiegelungen', particles: 'Staubpartikel', detail: 'Raumdetails',
  },
  tier: {
    off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Schlicht', detailed: 'Detailliert',
  },
  words: {
    noShadows: 'keine Schatten', shadows: 'Schatten', ao: 'Umgebungsverdeckung', aoHigh: 'volle Umgebungsverdeckung',
    bloom: 'Leuchten', reflections: 'Spiegelungen', noAa: 'keine Kantenglättung', motes: 'Partikel',
  },
};

const fr = {
  graphics: 'Graphismes', quality: 'Qualité', auto: 'Automatique (détectée : {tier})',
  low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra',
  renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
  adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
  postUnavailable: 'Le post-traitement n’est pas disponible sur cet appareil ; la pièce est dessinée sans.',
  unknownGpu: 'GPU inconnu',
  cat: {
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux (bloom)', grade: 'Étalonnage des couleurs',
    antialias: 'Anticrénelage', reflections: 'Reflets', particles: 'Grains de poussière', detail: 'Détails de la pièce',
  },
  tier: {
    off: 'Désactivé', on: 'Activé', low: 'Basses', medium: 'Moyennes', high: 'Hautes',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Détaillé',
  },
  words: {
    noShadows: 'sans ombres', shadows: 'ombres', ao: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète',
    bloom: 'halo', reflections: 'reflets', noAa: 'sans anticrénelage', motes: 'grains',
  },
};

const frCA = {
  ...fr,
  graphics: 'Graphiques',
  cat: { ...fr.cat, bloom: 'Lueur (bloom)' },
};

const pt = {
  graphics: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})',
  low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
  renderScale: 'Escala de renderização', fromPreset: 'Conforme predefinição ({tier})',
  adaptive: 'Resolução adaptável', showFps: 'Mostrar taxa de quadros',
  postUnavailable: 'O pós-processamento não está disponível neste dispositivo; o cômodo é desenhado sem ele.',
  unknownGpu: 'GPU desconhecida',
  cat: {
    shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho (bloom)', grade: 'Correção de cor',
    antialias: 'Antisserrilhamento', reflections: 'Reflexos', particles: 'Partículas de poeira', detail: 'Detalhes do cômodo',
  },
  tier: {
    off: 'Desligado', on: 'Ligado', low: 'Baixas', medium: 'Médias', high: 'Altas',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simples', detailed: 'Detalhado',
  },
  words: {
    noShadows: 'sem sombras', shadows: 'sombras', ao: 'oclusão ambiente', aoHigh: 'oclusão ambiente completa',
    bloom: 'brilho', reflections: 'reflexos', noAa: 'sem antisserrilhamento', motes: 'partículas',
  },
};

const it = {
  graphics: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
  low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra',
  renderScale: 'Scala di rendering', fromPreset: 'Da preimpostazione ({tier})',
  adaptive: 'Risoluzione adattiva', showFps: 'Mostra frame al secondo',
  postUnavailable: 'La post-elaborazione non è disponibile su questo dispositivo; la stanza viene disegnata senza.',
  unknownGpu: 'GPU sconosciuta',
  cat: {
    shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore (bloom)', grade: 'Correzione colore',
    antialias: 'Antialiasing', reflections: 'Riflessi', particles: 'Granelli di polvere', detail: 'Dettagli della stanza',
  },
  tier: {
    off: 'No', on: 'Sì', low: 'Basse', medium: 'Medie', high: 'Alte',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Semplice', detailed: 'Dettagliato',
  },
  words: {
    noShadows: 'senza ombre', shadows: 'ombre', ao: 'occlusione ambientale', aoHigh: 'occlusione ambientale completa',
    bloom: 'bagliore', reflections: 'riflessi', noAa: 'senza antialiasing', motes: 'granelli',
  },
};

export const GFX_LOCALES = {
  'en-US': en, 'en-GB': enGB, 'es-419': es419, 'es-ES': es, 'de-DE': de,
  'fr-FR': fr, 'fr-CA': frCA, 'pt-BR': pt, 'it-IT': it,
};

const BASE = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };
const REGION = { 'en-gb': 'en-GB', 'en-au': 'en-GB', 'en-ie': 'en-GB', 'en-nz': 'en-GB', 'es-es': 'es-ES', 'fr-ca': 'fr-CA' };

/** Pick a supported locale from a list of BCP 47 tags (navigator.languages). */
export function pickLocale(langs) {
  for (const raw of langs || []) {
    const tag = String(raw || '').toLowerCase();
    if (!tag) continue;
    const exact = Object.keys(GFX_LOCALES).find((k) => k.toLowerCase() === tag);
    if (exact) return exact;
    if (REGION[tag]) return REGION[tag];
    const base = BASE[tag.split('-')[0]];
    if (base) return base;
  }
  return 'en-US';
}

export function gfxStrings(langs) {
  return GFX_LOCALES[pickLocale(langs)];
}
