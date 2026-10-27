// The lamplit miniature room on starhermit:scene, as the browser build's
// NookRenderer drew it: the open dollhouse (floor with plank grooves, back
// and left walls with the wallpaper tile tinted by the theme), two back-wall
// shelves, the side table and its legs, three crates, the round rug, and at
// Room detail "detailed" the wood-grain and woven-rug canvas textures, the
// wall trim, the framed print, the glowing window and the clock face; the
// candle with its flickering flame (and glow light on High/Ultra), the wall
// clock's swinging pendulum, the drifting dust motes; the 20 procedural
// object kinds built from primitives, each with its grounded selection ring
// (amber when focused or hinted, green when found), the found object lifting
// and slowly turning, unfound ones bobbing. Lighting is the warm key (with
// shadows by the level), the theme-tinted hemisphere fill, the interior
// lamp, the RoomEnvironment reflections; ACES tone mapping at 1.35, the fog
// band, and the old post chain (ambient occlusion, bloom on HDR highlights
// above 2.2, the colour grade with its vignette, FXAA/SMAA/MSAA) as renderer
// settings.
//
// The browser build drew into a canvas between its rails: here the scene
// fills the window and the camera's view offset puts the room's picture in
// the playfield rectangle the UI leaves (setRect), so taps pick through the
// same projection.
//
// Gaps from three.js: lights take three.js intensities ÷ π; the key light's
// shadow covers `shadow.distance` along the view instead of a box fitted to
// the room by hand; the jar's glass writes depth as three.js's transparent
// materials do (`depthWrite: true`); Vector3 has no lerpVectors.
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, ClampToEdgeWrapping,
  Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry, PMREMGenerator,
  PointLight, Points, PointsMaterial, Raycaster, RepeatWrapping, RingGeometry, RoomEnvironment, SphereGeometry, SRGBColorSpace,
  TextureLoader, TorusGeometry, Vector3, pointerToNdc, renderer, scene,
  type Material, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas } from "starhermit:canvas";
import { Content as C, Rules as R, type Level, type Theme } from "./classic.ts";
import type { Look } from "./quality.ts";

const L = (i: number): number => i / Math.PI; // three.js light intensity → the engine's
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export const camera = new PerspectiveCamera(42, 1, 0.1, 200);
renderer.camera = camera;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
scene.background = new Color(0x0d1420);

let look: Look | null = null;
let reduced = false;
let level: Level | null = null;
let root = new Group();
scene.add(root);
let owned: { dispose(): void }[] = [];
let pickables: Object3D[] = [];
interface ItemView { group: Group; ring: Mesh; ringMat: MeshBasicMaterial; baseY: number; bobPhase: number; found: boolean; hinted: boolean; lift: number }
export const itemViews = new Map<number, ItemView>();
let particles: Points | null = null;
let moteBase: Float32Array | null = null;
let flame: Mesh | null = null;
let pendulum: Mesh | null = null;
let candleLight: PointLight | null = null;
let keyLight: DirectionalLight | null = null;
let hemi: HemisphereLight | null = null;
let hemiBase = 1;
let clockT = 0;
export let focusIndex = -1;

// ---- textures -------------------------------------------------------------------------------
// Procedural canvas textures for the "detailed" room (tileable, near-white so the authored
// material colour still decides the hue), authored at 256 px; `size` (the budget) scales them.
function woodTexture(seed: number, planks: number, size: number): OffscreenCanvas {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext("2d");
  g.scale(size / 256, size / 256);
  const rng = R.mulberry32(seed);
  g.fillStyle = "#e6e6e6";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 160; i++) {
    const y = rng() * 256;
    const v = 170 + Math.floor(rng() * 70);
    g.strokeStyle = `rgba(${v},${v},${v},${0.25 + rng() * 0.35})`;
    g.lineWidth = 0.6 + rng() * 2.2;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x * 0.03 + i) * (1 + rng() * 2.5));
    g.stroke();
  }
  for (let i = 0; i < 5; i++) { // knots
    const x = rng() * 256, y = rng() * 256;
    const grd = g.createRadialGradient(x, y, 0, x, y, 6 + rng() * 6);
    grd.addColorStop(0, "rgba(120,120,120,0.55)");
    grd.addColorStop(1, "rgba(200,200,200,0)");
    g.fillStyle = grd;
    g.fillRect(x - 14, y - 14, 28, 28);
  }
  if (planks) {
    g.fillStyle = "rgba(90,90,90,0.55)";
    for (let i = 0; i < planks; i++) g.fillRect(0, Math.round((i * 256) / planks), 256, 2);
  }
  return c;
}
function rugTexture(size: number): OffscreenCanvas {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext("2d");
  g.scale(size / 256, size / 256);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 256, 256);
  const ring = (r: number, w: number, col: string): void => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke(); };
  ring(118, 10, "#e8c98a");
  ring(104, 4, "#b8a8a0");
  ring(80, 12, "#d9b079");
  ring(56, 3, "#c9b8b0");
  for (let i = 0; i < 16; i++) { // woven diamond band
    const a = (i / 16) * Math.PI * 2;
    g.save();
    g.translate(128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92);
    g.rotate(a + Math.PI / 4);
    g.fillStyle = "#e0bf85";
    g.fillRect(-5, -5, 10, 10);
    g.restore();
  }
  ring(26, 8, "#e8c98a");
  const img = g.getImageData(0, 0, size, size); // fibre noise
  const d = img.data;
  const rng = R.mulberry32(0x5eed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 34;
    d[i] = d[i]! + n; d[i + 1] = d[i + 1]! + n; d[i + 2] = d[i + 2]! + n;
  }
  g.putImageData(img, 0, 0);
  return c;
}
let moteTex: Texture | null = null;
function moteTexture(): Texture {
  if (moteTex) return moteTex;
  const c = new OffscreenCanvas(64, 64);
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  moteTex = new CanvasTexture(c);
  return moteTex;
}
let artCanvas: OffscreenCanvas | null = null;
/** The framed landscape print above the shelves. */
function printCanvas(): OffscreenCanvas {
  if (artCanvas) return artCanvas;
  const c = new OffscreenCanvas(128, 76);
  const g = c.getContext("2d");
  const sky = g.createLinearGradient(0, 0, 0, 76);
  sky.addColorStop(0, "#f3d9a8"); sky.addColorStop(1, "#c98f6a");
  g.fillStyle = sky; g.fillRect(0, 0, 128, 76);
  g.fillStyle = "#7d6a8a"; g.beginPath(); g.moveTo(0, 60); g.lineTo(34, 30); g.lineTo(62, 52); g.lineTo(92, 24); g.lineTo(128, 56); g.lineTo(128, 76); g.lineTo(0, 76); g.fill();
  g.fillStyle = "#4c5a48"; g.fillRect(0, 62, 128, 14);
  g.fillStyle = "#fff4d8"; g.beginPath(); g.arc(98, 18, 7, 0, Math.PI * 2); g.fill();
  artCanvas = c;
  return c;
}
let wallpaper: Texture | null = null;
let wallpaperAsked = false;
const wallMats: (MeshLambertMaterial | MeshStandardMaterial)[] = [];
/** Best-effort: the decoded wallpaper tile multiplies the flat wall colour; missing, the walls stay flat. */
function loadWallpaper(): void {
  if (wallpaperAsked) return;
  wallpaperAsked = true;
  new TextureLoader().loadAsync("assets/wall-paper.webp").then((t) => {
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(4, 2);
    wallpaper = t;
    for (const m of wallMats) m.map = t;
  }, () => undefined);
}
let envTex: Texture | null = null;
function environment(): Texture | null {
  if (!envTex) {
    try { envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; }
    catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return envTex;
}

// ---- materials and geometry --------------------------------------------------------------------
function own<T extends { dispose(): void }>(o: T): T { owned.push(o); return o; }
interface Extra { map?: Texture | null; emissive?: number | Color; emissiveIntensity?: number; transparent?: boolean; opacity?: number }
/** Lit material for the budget: Lambert on Low (no PBR), Standard otherwise. */
function mat(color: number, rough?: number, metal?: number, extra?: Extra): MeshLambertMaterial | MeshStandardMaterial {
  if (!look || look.budget.material === "lambert") {
    const m = new MeshLambertMaterial({ color });
    if (extra) {
      if (extra.map) m.map = extra.map;
      if (extra.emissive != null) m.emissive = new Color(extra.emissive);
      if (extra.emissiveIntensity != null) m.emissiveIntensity = extra.emissiveIntensity;
      if (extra.transparent != null) m.transparent = extra.transparent;
      if (extra.opacity != null) m.opacity = extra.opacity;
    }
    return own(m);
  }
  return own(new MeshStandardMaterial({ color, roughness: rough ?? 0.7, metalness: metal || 0.05, ...(extra ?? {}) } as ConstructorParameters<typeof MeshStandardMaterial>[0]));
}
/** Glossy pieces (glazed ceramic, polished metal, lacquer) get a clear coat at "detailed" on High+. */
function gloss(color: number, rough: number, metal: number, coat?: number): MeshLambertMaterial | MeshStandardMaterial | MeshPhysicalMaterial {
  if (!look || !look.detailed || look.budget.material !== "physical") return mat(color, rough, metal);
  return own(new MeshPhysicalMaterial({ color, roughness: rough, metalness: metal || 0.05, clearcoat: coat ?? 0.7, clearcoatRoughness: 0.18 }));
}
function geo<T extends BufferGeometry>(g: T): T { return own(g); }
function canvasTex(c: OffscreenCanvas, rx: number, ry: number): Texture {
  const tex = own(new CanvasTexture(c));
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.anisotropy = 4;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
/** Round-geometry segment count for the budget (authored count × LOD multiplier, at least `min`). */
function seg(n: number, min = 6): number { return Math.max(min, Math.round(n * (look ? look.budget.segments : 1))); }
const scaled = (hex: number, k: number): number => new Color(hex).multiplyScalar(k).getHex();

// ---- the room ------------------------------------------------------------------------------------
function buildRoom(t: Theme, decoSeed: number): void {
  const detailed = !!look && look.detailed;
  scene.background = new Color(t.fog);
  scene.fog = new Fog(t.fog, 22, 46);

  // lighting: one dominant warm key + soft fill + hemisphere ambience
  hemi = new HemisphereLight(t.fill, 0x4a3a28, L(t.ambient * 1.6));
  hemiBase = hemi.intensity;
  root.add(hemi);
  const key = new DirectionalLight(t.key, L(2.4));
  key.position.set(6, 9, 7);
  key.target.position.set(0, 1.5, -0.5);
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 1;
  key.shadow.distance = 45;
  root.add(key, key.target);
  keyLight = key;
  applyShadows();
  // warm interior fill so the miniature room reads even on dim themes
  const lamp = new PointLight(0xffe0b0, L(30), 30, 1.8);
  lamp.position.set(0, 5.2, 1.5);
  root.add(lamp);

  const rng = R.mulberry32(decoSeed);
  const texSize = look ? look.budget.texture : 64;
  const woodA = detailed ? canvasTex(woodTexture(decoSeed ^ 0x51, 0, texSize), 2, 1) : null;
  const floorTex = detailed ? canvasTex(woodTexture(decoSeed ^ 0xf1, 4, texSize), 3, 2) : null;
  const add = (m: Mesh, x: number, y: number, z: number, cast = false, receive = true): Mesh => {
    m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = receive; root.add(m); return m;
  };

  // floor + two walls (miniature room, open dollhouse front)
  add(new Mesh(geo(new BoxGeometry(13, 0.3, 9)), mat(t.floor, detailed ? 0.72 : 0.9, 0.05, floorTex ? { map: floorTex } : undefined)), 0, -0.15, 0);
  const backMat = mat(t.wall, 0.95), leftMat = mat(t.wall, 0.95);
  add(new Mesh(geo(new BoxGeometry(13, 6.4, 0.3)), backMat), 0, 3.2, -4.35);
  add(new Mesh(geo(new BoxGeometry(0.3, 6.4, 9)), leftMat), -6.35, 3.2, 0);
  wallMats.length = 0;
  wallMats.push(backMat, leftMat);
  if (wallpaper) for (const m of wallMats) m.map = wallpaper;
  loadWallpaper();

  // plank grooves on the floor
  const plankMat = mat(scaled(t.floor, 0.8), 0.95);
  const grooveGeo = geo(new BoxGeometry(13, 0.02, 0.05));
  for (let i = 0; i < 6; i++) add(new Mesh(grooveGeo, plankMat), 0, 0.005, -4 + i * 1.6, false, false);

  // back-wall shelves
  const shelfMat = mat(0x6b4a2f, detailed ? 0.62 : 0.8, 0.05, woodA ? { map: woodA } : undefined);
  const shelfGeo = geo(new BoxGeometry(11, 0.16, 1.2));
  for (const y of [2.2, 3.6]) add(new Mesh(shelfGeo, shelfMat), 0, y - 0.55, -3.6, true);
  // side table + crates + rug
  const tableMat = detailed && look && look.budget.material === "physical"
    ? own(new MeshPhysicalMaterial({ color: 0x74543a, roughness: 0.55, metalness: 0.02, clearcoat: 0.35, clearcoatRoughness: 0.35, map: woodA }))
    : mat(0x74543a, 0.75);
  add(new Mesh(geo(new BoxGeometry(6.4, 0.18, 1.8)), tableMat), 0, 0.82, 0.6, true);
  const legGeo = geo(new BoxGeometry(0.22, 0.82, 0.22));
  for (const x of [-2.6, 2.6]) add(new Mesh(legGeo, shelfMat), x, 0.41, 0.6, detailed, false);
  const crateTex = detailed ? canvasTex(woodTexture(decoSeed ^ 0xc7, 3, texSize), 1, 1) : null;
  const crateMat = mat(0x7a5c3a, 0.85, 0.05, crateTex ? { map: crateTex } : undefined);
  const crateGeo = geo(new BoxGeometry(1.1, 0.9, 1.1));
  for (let i = 0; i < 3; i++) {
    const crate = add(new Mesh(crateGeo, crateMat), -2 + i * 2, 0.45, -0.2, true);
    crate.rotation.y = (rng() - 0.5) * 0.4;
  }
  const rugTex = detailed ? canvasTex(rugTexture(texSize), 1, 1) : null;
  add(new Mesh(geo(new CylinderGeometry(2.6, 2.6, 0.04, seg(detailed ? 64 : 40, 24))), mat(0x7a3a44, 0.98, 0, rugTex ? { map: rugTex } : undefined)), 0, 0.02, 1.8);

  if (detailed) buildTrim(t);

  // animated details: candle flame, wall-clock pendulum, dust motes
  add(new Mesh(geo(new CylinderGeometry(0.09, 0.11, 0.5, seg(12))), mat(0xf0e6c8, 0.6)), 5.4, 4.0, -3.6, false, false);
  // flame colour above 1.0 so the bloom pass picks it up (tone mapping keeps it warm)
  flame = add(new Mesh(geo(new ConeGeometry(0.06, 0.2, seg(10))), own(new MeshBasicMaterial({ color: new Color(0xffc65c).multiplyScalar(detailed ? 6 : 1) }))), 5.4, 4.36, -3.6, false, false);
  if (detailed && look && look.budget.candleLight) {
    // candle glow that flickers with the flame (an extra light in every lit shader: High/Ultra only)
    candleLight = new PointLight(0xffb45a, L(4), 5, 2);
    candleLight.position.set(5.4, 4.5, -3.3);
    root.add(candleLight);
  }
  const clockBody = add(new Mesh(geo(new CylinderGeometry(0.5, 0.5, 0.12, seg(24, 12))), gloss(0x8a6a3a, 0.45, 0.3, 0.5)), -5.2, 4.6, -4.1, false, false);
  clockBody.rotation.x = Math.PI / 2;
  if (detailed) {
    add(new Mesh(geo(new CircleGeometry(0.4, seg(32, 16))), mat(0xf2ead6, 0.5)), -5.2, 4.6, -4.03, false, false);
    const tickMat = mat(0x2b2118, 0.6);
    const tickLong = geo(new BoxGeometry(0.03, 0.09, 0.01)), tickShort = geo(new BoxGeometry(0.03, 0.05, 0.01));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const tick = add(new Mesh(k % 3 ? tickShort : tickLong, tickMat), -5.2 + Math.sin(a) * 0.33, 4.6 + Math.cos(a) * 0.33, -4.02, false, false);
      tick.rotation.z = -a;
    }
  }
  const pg = geo(new BoxGeometry(0.05, 0.8, 0.05));
  pg.translate(0, -0.4, 0);
  pendulum = add(new Mesh(pg, gloss(0xd4af37, 0.3, 0.8, 0.4)), -5.2, 4.2, -4.05, false, false);

  // dust particles (cosmetic layer — never raycastable): soft additive motes
  const n = look ? look.budget.motes : 100;
  const pos = new Float32Array(n * 3);
  const prng = R.mulberry32(decoSeed ^ 0xd157);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (prng() - 0.5) * 12;
    pos[i * 3 + 1] = prng() * 6;
    pos[i * 3 + 2] = (prng() - 0.5) * 8;
  }
  const pgeo = geo(new BufferGeometry());
  pgeo.setAttribute("position", new BufferAttribute(pos, 3));
  particles = new Points(pgeo, own(new PointsMaterial({
    color: 0xffeccc, size: moteSize(), map: moteTexture(), transparent: true, opacity: 0.4, depthWrite: false,
    blending: AdditiveBlending, sizeAttenuation: true,
  })));
  moteBase = pos.slice();
  root.add(particles);
}

// "detailed" room trim: skirting boards, a picture rail, a framed print and a small window.
// Wall-mounted only, above or beside every item anchor, so nothing new occludes a find.
function buildTrim(t: Theme): void {
  const trimMat = mat(new Color(t.wall).lerp(new Color(0xf0e2c8), 0.55).getHex(), 0.55);
  const add = (g: BufferGeometry, m: Material, x: number, y: number, z: number): Mesh => {
    const mesh = new Mesh(geo(g), m as MeshStandardMaterial); mesh.position.set(x, y, z); mesh.receiveShadow = true; root.add(mesh); return mesh;
  };
  add(new BoxGeometry(13, 0.32, 0.08), trimMat, 0, 0.16, -4.18);          // back skirting
  add(new BoxGeometry(0.08, 0.32, 9), trimMat, -6.18, 0.16, 0);           // left skirting
  add(new BoxGeometry(13, 0.1, 0.07), trimMat, 0, 4.25, -4.18);            // picture rail
  add(new BoxGeometry(0.07, 0.1, 9), trimMat, -6.18, 4.25, 0);
  add(new BoxGeometry(13, 0.22, 0.14), trimMat, 0, 6.29, -4.14);          // crown
  // framed print above the shelves
  const frame = gloss(0x5a3b22, 0.4, 0.1, 0.5);
  add(new BoxGeometry(2.3, 1.35, 0.06), frame, 1.4, 5.15, -4.17);
  const art = canvasTex(printCanvas(), 1, 1);
  art.wrapS = art.wrapT = ClampToEdgeWrapping;
  add(new PlaneGeometry(2.05, 1.12), mat(0xffffff, 0.8, 0, { map: art }), 1.4, 5.15, -4.13);
  // small window on the left wall: frame, glowing pane and sill
  const pane = own(new MeshStandardMaterial({
    color: 0x1a1a1a, emissive: new Color(t.key).lerp(new Color(t.fill), 0.35), emissiveIntensity: 2.4, roughness: 0.2,
  }));
  const win = add(new PlaneGeometry(1.8, 1.5), pane, -6.19, 5.1, 1.2);
  win.rotation.y = Math.PI / 2;
  add(new BoxGeometry(0.1, 1.64, 0.08), frame, -6.16, 5.1, 1.2);        // mullion
  add(new BoxGeometry(0.1, 0.08, 1.9), frame, -6.16, 5.1, 1.2);         // transom
  add(new BoxGeometry(0.1, 1.66, 0.1), frame, -6.16, 5.1, 0.25);
  add(new BoxGeometry(0.1, 1.66, 0.1), frame, -6.16, 5.1, 2.15);
  add(new BoxGeometry(0.1, 0.1, 2.0), frame, -6.16, 5.9, 1.2);
  add(new BoxGeometry(0.26, 0.08, 2.1), trimMat, -6.1, 4.32, 1.2);       // sill
}

// ---- procedural item meshes ----------------------------------------------------------------------
function buildItemMesh(kind: string, color: number, scale: number): Group {
  const g = new Group();
  const m = (gm: BufferGeometry, mt: Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Mesh => {
    const mesh = new Mesh(geo(gm), mt as MeshStandardMaterial);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const detailed = !!look && look.detailed;
  // glazed / lacquered kinds get a clear coat at "detailed"; metal kinds a polished coat
  const glazed = /^(mug|teapot|bottle|shell|button|jar|book)$/.test(kind);
  const body = glazed ? gloss(color, 0.42, 0.05, 0.8) : mat(color, 0.55, 0.15);
  const dark = mat(scaled(color, 0.55), 0.7, 0.1);
  const metal = gloss(color, 0.3, 0.75, 0.35);
  const PI = Math.PI;
  switch (kind) {
    case "mug":
      m(new CylinderGeometry(0.32, 0.28, 0.55, 20), body, 0, 0.28, 0);
      m(new TorusGeometry(0.2, 0.05, 10, 20, PI), dark, 0.34, 0.3, 0, 0, 0, -PI / 2);
      break;
    case "key":
      m(new TorusGeometry(0.2, 0.06, 10, 20), metal, 0, 0.1, 0, PI / 2);
      m(new BoxGeometry(0.5, 0.07, 0.07), metal, 0.42, 0.1, 0);
      m(new BoxGeometry(0.1, 0.07, 0.16), metal, 0.6, 0.1, 0.05);
      break;
    case "book":
      m(new BoxGeometry(0.55, 0.14, 0.75), body, 0, 0.07, 0);
      m(new BoxGeometry(0.5, 0.12, 0.7), mat(0xf0ead8, 0.9), 0.03, 0.074, 0); // pages sit under the cover (no coplanar z-fight)
      break;
    case "candle":
      m(new CylinderGeometry(0.14, 0.16, 0.6, 14), body, 0, 0.3, 0);
      m(new ConeGeometry(0.05, 0.14, 8), own(new MeshBasicMaterial({ color: new Color(0xffc65c).multiplyScalar(detailed ? 5 : 1) })), 0, 0.66, 0);
      break;
    case "spool":
      m(new CylinderGeometry(0.16, 0.16, 0.34, 14), body, 0, 0.2, 0);
      m(new CylinderGeometry(0.24, 0.24, 0.06, 14), dark, 0, 0.4, 0);
      m(new CylinderGeometry(0.24, 0.24, 0.06, 14), dark, 0, 0.03, 0);
      break;
    case "acorn":
      m(new SphereGeometry(0.24, 16, 12), body, 0, 0.2, 0);
      m(new SphereGeometry(0.26, 16, 8, 0, PI * 2, 0, PI / 2.6), dark, 0, 0.3, 0);
      break;
    case "bottle":
      m(new CylinderGeometry(0.2, 0.24, 0.6, 16), body, 0, 0.3, 0);
      m(new CylinderGeometry(0.07, 0.12, 0.3, 12), body, 0, 0.72, 0);
      break;
    case "clock":
      m(new CylinderGeometry(0.3, 0.3, 0.1, 24), metal, 0, 0.3, 0, PI / 2.3);
      m(new TorusGeometry(0.08, 0.03, 8, 16), metal, 0, 0.62, -0.13);
      break;
    case "teapot":
      m(new SphereGeometry(0.32, 18, 14), body, 0, 0.32, 0);
      m(new CylinderGeometry(0.05, 0.1, 0.35, 10), body, 0.36, 0.4, 0, 0, 0, -0.7);
      m(new TorusGeometry(0.18, 0.04, 8, 18, PI), dark, -0.32, 0.4, 0, 0, 0, PI / 2);
      m(new CylinderGeometry(0.1, 0.14, 0.1, 12), dark, 0, 0.62, 0);
      break;
    case "shell":
      m(new SphereGeometry(0.3, 16, 12, 0, PI), body, 0, 0.1, 0, 0, 0, PI / 2);
      m(new TorusGeometry(0.14, 0.05, 8, 14), dark, 0.1, 0.12, 0, PI / 2);
      break;
    case "bell":
      m(new ConeGeometry(0.26, 0.4, 16), metal, 0, 0.28, 0);
      m(new SphereGeometry(0.07, 10, 8), dark, 0, 0.06, 0);
      break;
    case "thimble":
      m(new CylinderGeometry(0.16, 0.22, 0.36, 14), metal, 0, 0.18, 0);
      break;
    case "feather":
      m(new ConeGeometry(0.1, 0.7, 8), body, 0, 0.35, 0, 0, 0, 0.5);
      m(new CylinderGeometry(0.015, 0.015, 0.5, 6), dark, -0.12, 0.25, 0, 0, 0, 0.5);
      break;
    case "coin":
      m(new CylinderGeometry(0.26, 0.26, 0.05, 24), metal, 0, 0.05, 0, 0.3, 0, 0.1);
      break;
    case "button":
      m(new CylinderGeometry(0.22, 0.22, 0.06, 20), body, 0, 0.05, 0);
      m(new CylinderGeometry(0.03, 0.03, 0.08, 8), dark, 0.06, 0.05, 0.05);
      m(new CylinderGeometry(0.03, 0.03, 0.08, 8), dark, -0.06, 0.05, -0.05);
      break;
    case "pencil":
      m(new CylinderGeometry(0.05, 0.05, 0.8, 8), body, 0, 0.06, 0, 0, 0, PI / 2);
      m(new ConeGeometry(0.05, 0.15, 8), mat(0xd8b98a, 0.8), 0.47, 0.06, 0, 0, 0, -PI / 2);
      break;
    case "lantern":
      m(new CylinderGeometry(0.2, 0.24, 0.4, 8), dark, 0, 0.28, 0);
      m(new CylinderGeometry(0.14, 0.14, 0.24, 8), own(new MeshStandardMaterial({ color: 0xffd98a, emissive: 0xffb84a, emissiveIntensity: detailed ? 3.5 : 0.55, roughness: 0.4 })), 0, 0.28, 0);
      m(new TorusGeometry(0.12, 0.025, 8, 14, PI), metal, 0, 0.52, 0);
      break;
    case "pinecone":
      m(new ConeGeometry(0.22, 0.5, 10), body, 0, 0.26, 0);
      m(new ConeGeometry(0.16, 0.3, 8), dark, 0, 0.4, 0);
      break;
    case "jar":
      // three.js writes depth for transparent materials; the engine does not unless asked
      m(new CylinderGeometry(0.24, 0.2, 0.5, 16), own(new MeshStandardMaterial({ color, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.75, depthWrite: true })), 0, 0.26, 0);
      m(new CylinderGeometry(0.2, 0.2, 0.08, 14), dark, 0, 0.54, 0);
      break;
    case "ribbon":
      m(new TorusGeometry(0.2, 0.07, 8, 18), body, -0.12, 0.12, 0, PI / 2);
      m(new TorusGeometry(0.2, 0.07, 8, 18), body, 0.12, 0.12, 0, PI / 2);
      break;
    default:
      m(new SphereGeometry(0.28, 16, 12), body, 0, 0.28, 0);
  }
  g.scale.setScalar(scale || 1);
  return g;
}

function buildItems(lv: Level): void {
  const ringGeo = geo(new RingGeometry(0.42, 0.55, 28));
  for (let i = 0; i < lv.items.length; i++) {
    const it = lv.items[i]!;
    const group = buildItemMesh(it.kind, it.color, it.scale);
    group.position.set(it.pos[0], it.pos[1], it.pos[2]);
    group.rotation.y = it.rotY || 0;
    // grounded selection ring marker
    const ringMat = own(new MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }));
    const ring = new Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(it.pos[0], Math.max(0.03, it.pos[1] + 0.02), it.pos[2]);
    ring.visible = false;
    root.add(ring);
    // every child mesh pickable
    group.traverse((o) => { if (o instanceof Mesh) { o.userData.itemIndex = i; pickables.push(o); } });
    root.add(group);
    itemViews.set(i, { group, ring, ringMat, baseY: it.pos[1], bobPhase: it.bobPhase || 0, found: false, hinted: false, lift: 0 });
  }
}

function disposeScene(): void {
  scene.remove(root);
  for (const d of owned) { try { d.dispose(); } catch { /* gone */ } }
  owned = [];
  pickables = [];
  itemViews.clear();
  root = new Group();
  scene.add(root);
  particles = null; moteBase = null; flame = null; pendulum = null; candleLight = null; keyLight = null; hemi = null;
}

/** The room of a level (null: the empty title backdrop). */
export function load(lv: Level | null): void {
  disposeScene();
  level = lv;
  if (!lv) {
    scene.background = new Color(0x0d1420);
    scene.fog = null;
    scene.environment = null;
    return;
  }
  const theme = C.THEMES.find((t) => t.id === lv.theme) || C.THEMES[0]!;
  buildRoom(theme, lv.seed ^ 0xdec0);
  buildItems(lv);
  applyEnv();
  resetCamera();
}
/** Rebuild the room for a new look, keeping item and camera state. */
function rebuild(): void {
  if (!level) return;
  const states: [number, boolean, boolean, number, number][] = [];
  for (const [i, v] of itemViews) states.push([i, v.found, v.hinted, v.lift, v.group.rotation.y]);
  const r = { yaw: rig.yaw, pitch: rig.pitch, dist: rig.dist, target: rig.target.clone() };
  const focus = focusIndex;
  load(level);
  for (const [i, found, hinted, lift, rot] of states) {
    const v = itemViews.get(i);
    if (!v) continue;
    v.found = found; v.hinted = hinted; v.lift = lift;
    v.group.rotation.y = rot;
  }
  rig.yaw = r.yaw; rig.pitch = r.pitch; rig.dist = r.dist; rig.target.copy(r.target);
  focusIndex = focus;
}

// ---- look -----------------------------------------------------------------------------------------
function applyShadows(): void {
  const on = !!look && look.shadows > 0;
  renderer.shadowMap.enabled = on;
  if (!keyLight || !look) return;
  keyLight.castShadow = on;
  if (on) keyLight.shadow.mapSize = look.shadows;
  keyLight.shadow.radius = look.shadows === 1024 ? 2 : 3;
}
function applyEnv(): void {
  const on = !!look && look.reflections && !!level;
  scene.environment = on ? environment() : null;
  scene.environmentIntensity = 0.45;
  // image-based light takes over part of the flat hemisphere fill
  if (hemi) hemi.intensity = hemiBase * (on ? 0.7 : 1);
}
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const assets = (q: Look | null): string => (q ? [q.detailed, JSON.stringify(q.budget)].join("|") : "");
  const needRebuild = assets(look) !== assets(next);
  look = next;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.85, radius: 0.6, distanceExponent: 1.4, thickness: 1.0, scale: 1.0,
    samples: next.ao === "high" ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8 },
  };
  // The threshold is on pre-tone-mapping HDR values (exposure 1.35): lit surfaces stay below it,
  // only the flames, the lantern, the window and hot specular glints bloom.
  renderer.bloom = next.bloom ? { strength: 0.6, radius: 0.45, threshold: 2.2, resolution: next.budget.bloomRes } : null;
  // The browser build's grade pass: a gentle S-curve (0.22), saturation 1.1, cool shadows /
  // warm highlights, the 0.24 vignette.
  renderer.grade = next.grade ? {
    space: "display", contrast: 0.11, saturation: 1.1,
    shadows: [0.97, 0.99, 1.04], highlights: [1.04, 1.0, 0.95], split: [0.25, 0.8],
    vignette: { amount: 0.24, inner: 0.38, outer: 0.85 },
  } : null;
  renderer.antialias = next.antialias;
  if (needRebuild && level) rebuild();
  else { applyShadows(); applyEnv(); }
}
export function setReducedMotion(on: boolean): void { reduced = on; }

// ---- camera ---------------------------------------------------------------------------------------
// authored camera rig: orbit target + yaw/pitch/distance
const HOME = { yaw: 0, pitch: 0.62 };
let homeDist = 15;
export const rig = { yaw: 0, pitch: 0.62, dist: 15, target: new Vector3(0, 1.6, -1) };
let camAnim: { from: Vector3; to: Vector3; t: number; dur: number } | null = null;
let onCameraMove: (() => void) | null = null;
export function setOnCameraMove(fn: () => void): void { onCameraMove = fn; }
export function resetCamera(): void {
  rig.yaw = HOME.yaw; rig.pitch = HOME.pitch; rig.dist = homeDist;
  rig.target.set(0, 1.6, -1);
  focusIndex = -1;
  camAnim = null;
}
export function panBy(dx: number, dy: number): void {
  // Orbit stays on the open face of the diorama: beyond ±0.75 rad yaw or
  // above ~1.0 rad pitch the side/back walls come between camera and room.
  rig.yaw = clamp(rig.yaw - dx * 0.005, -0.75, 0.75);
  rig.pitch = clamp(rig.pitch + dy * 0.004, 0.25, 1.0);
  if (onCameraMove) onCameraMove();
}
export function zoomBy(f: number): void {
  rig.dist = clamp(rig.dist * f, 7, 24);
  if (onCameraMove) onCameraMove();
}
export function focusItem(i: number): void {
  const v = itemViews.get(i);
  if (!v) return;
  focusIndex = i;
  // ease the camera target toward the item (interruptible)
  const dest = v.group.position.clone();
  dest.y += 0.3;
  camAnim = { from: rig.target.clone(), to: dest, t: 0, dur: reduced ? 0.01 : 0.35 };
  // focusing moves the camera; report it so keyboard-only players can
  // satisfy the lesson's look-around step without dragging
  if (onCameraMove) onCameraMove();
}
export function clearFocus(): void { focusIndex = -1; }
function stepCameraAnim(dt: number): void {
  const a = camAnim;
  if (!a) return;
  a.t = Math.min(1, a.t + dt / a.dur);
  const e = 1 - Math.pow(1 - a.t, 3);
  rig.target.copy(a.from).lerp(a.to, e);
  if (a.t >= 1) camAnim = null;
}
function applyCamera(): void {
  const cp = Math.cos(rig.pitch), sp = Math.sin(rig.pitch);
  camera.position.set(
    rig.target.x + Math.sin(rig.yaw) * cp * rig.dist,
    rig.target.y + sp * rig.dist,
    rig.target.z + Math.cos(rig.yaw) * cp * rig.dist,
  );
  camera.lookAt(rig.target);
}

// ---- the playfield rectangle ------------------------------------------------------------------------
export const view = { x: 0, y: 0, w: 1, h: 1, W: 1, H: 1 };
/** three.js sized attenuated points by half the canvas (the playfield) height; the engine by the window's. */
function moteSize(): number { return 0.09 * (view.H > 0 ? view.h / view.H : 1); }
/** The playfield's window rectangle (window px) in a W × H window. */
export function setRect(x: number, y: number, w: number, h: number, W: number, H: number): void {
  w = Math.max(1, w); h = Math.max(1, h);
  if (view.x === x && view.y === y && view.w === w && view.h === h && view.W === W && view.H === H) return;
  Object.assign(view, { x, y, w, h, W, H });
  if (particles) particles.material.size = moteSize();
  camera.setViewOffset(w, h, -x, -y, W, H);
  camera.updateProjectionMatrix();
  // Narrow playfields: the home distance grows so the whole room width fits
  // (the authored 15 assumes a ~1.3 aspect); the user-zoom clamp follows.
  const aspect = w / h;
  const next = Math.min(24, 15 * Math.max(1, 1.3 / aspect));
  const wasHome = Math.abs(rig.dist - homeDist) < 0.01;
  homeDist = next;
  if (wasHome) rig.dist = homeDist;
}
export function inView(x: number, y: number): boolean { return x >= view.x && x <= view.x + view.w && y >= view.y && y <= view.y + view.h; }

// ---- picking ------------------------------------------------------------------------------------------
const ray = new Raycaster();
/** The not-yet-found item under a window pixel, or null. */
export function pick(x: number, y: number): number | null {
  if (!level) return null;
  applyCamera();
  camera.updateMatrixWorld();
  ray.setFromCamera(pointerToNdc(x, y), camera);
  const hits = ray.intersectObjects(pickables, false);
  for (const h of hits) {
    const idx = h.object.userData.itemIndex as number | undefined;
    const v = idx == null ? undefined : itemViews.get(idx);
    if (v && !v.found) return idx!;
  }
  return null;
}
const _p = new Vector3();
/** An item's window position (for tests and the browser check). */
export function itemScreen(i: number): { x: number; y: number } | null {
  const v = itemViews.get(i);
  if (!v) return null;
  _p.copy(v.group.position).project(camera);
  return { x: ((_p.x + 1) / 2) * view.W, y: ((1 - _p.y) / 2) * view.H };
}

export function markFound(i: number): void { const v = itemViews.get(i); if (v) { v.found = true; v.hinted = false; } }
export function markHinted(i: number): void { const v = itemViews.get(i); if (v) v.hinted = true; }
export function markUnfound(i: number): void { const v = itemViews.get(i); if (v) { v.found = false; v.lift = 0; v.group.rotation.y = 0; } }
/** Settle every found object into its exact end pose (the round is over). */
export function settleFound(): void { for (const v of itemViews.values()) if (v.found) { v.lift = 0.35; v.group.position.y = v.baseY + 0.35; } }

// ---- the frame ----------------------------------------------------------------------------------------
export function update(dtIn: number): void {
  const dt = Math.min(0.1, Math.max(0, dtIn));
  clockT += dt;
  const t = clockT;
  stepCameraAnim(dt);
  // decorative animation, off with reduced motion
  if (!reduced) {
    if (flame) flame.scale.set(1 + Math.sin(t * 11) * 0.15, 1 + Math.sin(t * 13.7) * 0.25, 1);
    if (pendulum) pendulum.rotation.z = Math.sin(t * 2.2) * 0.35;
    if (candleLight) candleLight.intensity = L(4 + Math.sin(t * 11) * 0.6 + Math.sin(t * 23.3) * 0.4);
    if (particles && moteBase) {
      const p = particles.geometry.attributes.position as BufferAttribute;
      const arr = p.array as Float32Array;
      const n = arr.length / 3;
      for (let i = 0; i < n; i++) {
        arr[i * 3 + 1] = moteBase[i * 3 + 1]! + Math.sin(t * 0.4 + i) * 0.25;
        arr[i * 3] = moteBase[i * 3]! + Math.sin(t * 0.2 + i * 1.7) * 0.15;
      }
      p.needsUpdate = true;
    }
  }
  if (particles) particles.visible = !reduced;
  // selection/hint/found presentation (lift + grounded marker)
  for (const [i, v] of itemViews) {
    const targetLift = v.found ? 0.35 : 0;
    v.lift += (targetLift - v.lift) * Math.min(1, dt * (reduced ? 100 : 8));
    const bob = (!reduced && !v.found) ? Math.sin(t * 1.6 + v.bobPhase) * 0.02 : 0;
    v.group.position.y = v.baseY + v.lift + bob;
    const isFocus = i === focusIndex;
    const want = v.found ? 0.9 : (v.hinted ? 0.55 + Math.sin(t * 5) * 0.3 : (isFocus ? 0.75 : 0));
    v.ringMat.opacity += (want - v.ringMat.opacity) * Math.min(1, dt * 10);
    // a faded ring must not reach the depth/normal buffers (AO would draw a dark halo)
    v.ring.visible = v.ringMat.opacity > 0.01;
    v.ringMat.color.setHex(v.found ? 0x7dd87d : 0xffb84d);
    if (v.found && !reduced) v.group.rotation.y += dt * 0.6;
  }
  applyCamera();
}
