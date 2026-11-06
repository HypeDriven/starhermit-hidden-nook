// Hidden Nook - object vocabulary (see i18n.js): per-language nouns [word, gender]
// and adjective forms (a string, or { m, f, n }), plus the word order used to
// compose an object's name.
(function (root) {
  'use strict';
  // ---- object vocabulary -----------------------------------------------------
  // Romance languages: noun first ("taza de latón"); German: declined adjective
  // first (strong nominative endings -er/-e/-es: "messingfarbener Becher").
  const g = (m, f) => ({ m, f });                       // gendered adjective
  const de = (stem) => ({ m: stem + 'er', f: stem + 'e', n: stem + 'es' });
  const NAMES = {
    'es-419': {
      order: 'noun-adj',
      noun: {
        'mug': ['taza', 'f'], 'key': ['llave', 'f'], 'book': ['libro', 'm'], 'candle': ['vela', 'f'],
        'spool of thread': ['carrete de hilo', 'm'], 'acorn': ['bellota', 'f'], 'bottle': ['botella', 'f'],
        'pocket watch': ['reloj de bolsillo', 'm'], 'teapot': ['tetera', 'f'], 'seashell': ['concha', 'f'],
        'bell': ['campana', 'f'], 'thimble': ['dedal', 'm'], 'feather': ['pluma', 'f'], 'coin': ['moneda', 'f'],
        'button': ['botón', 'm'], 'pencil': ['lápiz', 'm'], 'lantern': ['farol', 'm'], 'pinecone': ['piña', 'f'],
        'jar': ['frasco', 'm'], 'ribbon': ['cinta', 'f'],
      },
      adj: {
        'brass': 'de latón', 'copper': 'de cobre', 'ivory': 'marfil', 'crimson': 'carmesí', 'teal': 'verde azulado',
        'amber': 'ámbar', 'moss-green': 'verde musgo', 'violet': 'violeta', 'striped': 'a rayas',
        'speckled': g('moteado', 'moteada'), 'tiny': g('diminuto', 'diminuta'), 'chipped': g('desportillado', 'desportillada'),
        'silver': g('plateado', 'plateada'), 'wooden': 'de madera', 'ceramic': 'de cerámica',
        'faded': g('desteñido', 'desteñida'), 'golden': g('dorado', 'dorada'), 'indigo': 'añil',
        'rusty': g('oxidado', 'oxidada'), 'porcelain': 'de porcelana',
      },
    },
    'de-DE': {
      order: 'adj-noun',
      noun: {
        'mug': ['Becher', 'm'], 'key': ['Schlüssel', 'm'], 'book': ['Buch', 'n'], 'candle': ['Kerze', 'f'],
        'spool of thread': ['Garnrolle', 'f'], 'acorn': ['Eichel', 'f'], 'bottle': ['Flasche', 'f'],
        'pocket watch': ['Taschenuhr', 'f'], 'teapot': ['Teekanne', 'f'], 'seashell': ['Muschel', 'f'],
        'bell': ['Glocke', 'f'], 'thimble': ['Fingerhut', 'm'], 'feather': ['Feder', 'f'], 'coin': ['Münze', 'f'],
        'button': ['Knopf', 'm'], 'pencil': ['Bleistift', 'm'], 'lantern': ['Laterne', 'f'], 'pinecone': ['Kiefernzapfen', 'm'],
        'jar': ['Glas', 'n'], 'ribbon': ['Band', 'n'],
      },
      adj: {
        'brass': de('messingfarben'), 'copper': de('kupferfarben'), 'ivory': de('elfenbeinfarben'), 'crimson': de('karmesinrot'),
        'teal': de('petrolfarben'), 'amber': de('bernsteinfarben'), 'moss-green': de('moosgrün'), 'violet': de('violett'),
        'striped': de('gestreift'), 'speckled': de('gesprenkelt'), 'tiny': de('winzig'), 'chipped': de('angeschlagen'),
        'silver': de('silbern'), 'wooden': de('hölzern'), 'ceramic': de('tönern'), 'faded': de('verblasst'),
        'golden': de('golden'), 'indigo': de('indigoblau'), 'rusty': de('rostig'), 'porcelain': de('porzellanweiß'),
      },
    },
    'fr-FR': {
      order: 'noun-adj',
      noun: {
        'mug': ['tasse', 'f'], 'key': ['clé', 'f'], 'book': ['livre', 'm'], 'candle': ['bougie', 'f'],
        'spool of thread': ['bobine de fil', 'f'], 'acorn': ['gland', 'm'], 'bottle': ['bouteille', 'f'],
        'pocket watch': ['montre à gousset', 'f'], 'teapot': ['théière', 'f'], 'seashell': ['coquillage', 'm'],
        'bell': ['cloche', 'f'], 'thimble': ['dé à coudre', 'm'], 'feather': ['plume', 'f'], 'coin': ['pièce', 'f'],
        'button': ['bouton', 'm'], 'pencil': ['crayon', 'm'], 'lantern': ['lanterne', 'f'], 'pinecone': ['pomme de pin', 'f'],
        'jar': ['bocal', 'm'], 'ribbon': ['ruban', 'm'],
      },
      adj: {
        'brass': 'en laiton', 'copper': 'en cuivre', 'ivory': 'ivoire', 'crimson': g('cramoisi', 'cramoisie'),
        'teal': 'bleu canard', 'amber': 'ambre', 'moss-green': 'vert mousse', 'violet': g('violet', 'violette'),
        'striped': g('rayé', 'rayée'), 'speckled': g('moucheté', 'mouchetée'), 'tiny': 'minuscule',
        'chipped': g('ébréché', 'ébréchée'), 'silver': g('argenté', 'argentée'), 'wooden': 'en bois',
        'ceramic': 'en céramique', 'faded': g('délavé', 'délavée'), 'golden': g('doré', 'dorée'), 'indigo': 'indigo',
        'rusty': g('rouillé', 'rouillée'), 'porcelain': 'en porcelaine',
      },
    },
    'pt-BR': {
      order: 'noun-adj',
      noun: {
        'mug': ['caneca', 'f'], 'key': ['chave', 'f'], 'book': ['livro', 'm'], 'candle': ['vela', 'f'],
        'spool of thread': ['carretel de linha', 'm'], 'acorn': ['bolota', 'f'], 'bottle': ['garrafa', 'f'],
        'pocket watch': ['relógio de bolso', 'm'], 'teapot': ['bule', 'm'], 'seashell': ['concha', 'f'],
        'bell': ['sino', 'm'], 'thimble': ['dedal', 'm'], 'feather': ['pena', 'f'], 'coin': ['moeda', 'f'],
        'button': ['botão', 'm'], 'pencil': ['lápis', 'm'], 'lantern': ['lanterna', 'f'], 'pinecone': ['pinha', 'f'],
        'jar': ['pote', 'm'], 'ribbon': ['fita', 'f'],
      },
      adj: {
        'brass': 'de latão', 'copper': 'de cobre', 'ivory': 'marfim', 'crimson': 'carmesim', 'teal': 'azul-petróleo',
        'amber': 'âmbar', 'moss-green': 'verde-musgo', 'violet': 'violeta', 'striped': g('listrado', 'listrada'),
        'speckled': g('salpicado', 'salpicada'), 'tiny': g('minúsculo', 'minúscula'), 'chipped': g('lascado', 'lascada'),
        'silver': g('prateado', 'prateada'), 'wooden': 'de madeira', 'ceramic': 'de cerâmica',
        'faded': g('desbotado', 'desbotada'), 'golden': g('dourado', 'dourada'), 'indigo': 'anil',
        'rusty': g('enferrujado', 'enferrujada'), 'porcelain': 'de porcelana',
      },
    },
    'it-IT': {
      order: 'noun-adj',
      noun: {
        'mug': ['tazza', 'f'], 'key': ['chiave', 'f'], 'book': ['libro', 'm'], 'candle': ['candela', 'f'],
        'spool of thread': ['rocchetto di filo', 'm'], 'acorn': ['ghianda', 'f'], 'bottle': ['bottiglia', 'f'],
        'pocket watch': ['orologio da tasca', 'm'], 'teapot': ['teiera', 'f'], 'seashell': ['conchiglia', 'f'],
        'bell': ['campanella', 'f'], 'thimble': ['ditale', 'm'], 'feather': ['piuma', 'f'], 'coin': ['moneta', 'f'],
        'button': ['bottone', 'm'], 'pencil': ['matita', 'f'], 'lantern': ['lanterna', 'f'], 'pinecone': ['pigna', 'f'],
        'jar': ['barattolo', 'm'], 'ribbon': ['nastro', 'm'],
      },
      adj: {
        'brass': 'd’ottone', 'copper': 'di rame', 'ivory': 'avorio', 'crimson': 'cremisi', 'teal': 'verde acqua',
        'amber': 'ambra', 'moss-green': 'verde muschio', 'violet': 'viola', 'striped': 'a righe',
        'speckled': g('maculato', 'maculata'), 'tiny': g('minuscolo', 'minuscola'), 'chipped': g('scheggiato', 'scheggiata'),
        'silver': g('argentato', 'argentata'), 'wooden': 'di legno', 'ceramic': 'di ceramica',
        'faded': g('sbiadito', 'sbiadita'), 'golden': g('dorato', 'dorata'), 'indigo': 'indaco',
        'rusty': g('arrugginito', 'arrugginita'), 'porcelain': 'di porcellana',
      },
    },
  };
  root.HN_NAMES = NAMES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
